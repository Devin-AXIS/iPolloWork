import { expect, test } from 'bun:test';
import { roundFontUnitToFixedPoint } from '../harfbuzz-font-units.ts';

test('zero conversions preserve rounding modes and positive zero', () => {
  for (const mode of ['halfAwayFromZero', 'halfToEven', 'towardZero'] as const) {
    for (const value of [0, -0]) {
      expect(Object.is(roundFontUnitToFixedPoint(value, 2048, 24000, mode), 0)).toBe(true);
    }
    for (const value of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
      expect(roundFontUnitToFixedPoint(value, 1, 0, mode)).toBe(0);
    }
  }
});

test('zero conversions still reject invalid inputs', () => {
  for (const denominator of [0, -1, 0.5, NaN, Infinity]) {
    expect(() => roundFontUnitToFixedPoint(0, denominator, 1, 'halfToEven')).toThrow(RangeError);
  }
  for (const numerator of [-1, 0.5, NaN, Infinity]) {
    expect(() => roundFontUnitToFixedPoint(0, 1, numerator, 'halfToEven')).toThrow(RangeError);
  }
  for (const value of [0.5, NaN, Infinity]) {
    expect(() => roundFontUnitToFixedPoint(value, 1, 0, 'halfToEven')).toThrow(RangeError);
  }
});

test('large rational products retain exact rounding and overflow checks', () => {
  expect(roundFontUnitToFixedPoint(Number.MAX_SAFE_INTEGER, 2, 2, 'halfToEven')).toBe(
    Number.MAX_SAFE_INTEGER
  );
  expect(roundFontUnitToFixedPoint(-Number.MAX_SAFE_INTEGER, 2, 2, 'towardZero')).toBe(
    -Number.MAX_SAFE_INTEGER
  );
  expect(() =>
    roundFontUnitToFixedPoint(Number.MAX_SAFE_INTEGER, 1, 2, 'halfAwayFromZero')
  ).toThrow(RangeError);
});

test('integer fast path agrees with exact rational arithmetic across ties and safe limits', () => {
  const exact = (units: number, denominator: number, numerator: number, mode: string): number => {
    const product = BigInt(units) * BigInt(numerator);
    const absolute = product < 0n ? -product : product;
    const divisor = BigInt(denominator);
    let quotient = absolute / divisor;
    const twiceRemainder = (absolute % divisor) * 2n;
    if (
      mode !== 'towardZero' &&
      (twiceRemainder > divisor ||
        (twiceRemainder === divisor && (mode === 'halfAwayFromZero' || quotient % 2n !== 0n)))
    )
      quotient++;
    return Number(product < 0n ? -quotient : quotient);
  };
  let seed = 0x12345678;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const cases: [number, number, number][] = [];
  for (const denominator of [1, 2, 3, 2048, 4096, Number.MAX_SAFE_INTEGER]) {
    for (const units of [1, 3, 5, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
      cases.push([units, denominator, 1], [-units, denominator, 1]);
    }
  }
  for (let index = 0; index < 2000; index++) {
    const units = (random() - 0x80000000) * (index % 2 ? 1 : 1048576);
    cases.push([units, 1 + (random() % 65536), 1 + (random() % 65536)]);
  }
  for (const mode of ['halfAwayFromZero', 'halfToEven', 'towardZero'] as const) {
    for (const [units, denominator, numerator] of cases) {
      const expected = exact(units, denominator, numerator, mode);
      if (Number.isSafeInteger(expected)) {
        expect(roundFontUnitToFixedPoint(units, denominator, numerator, mode)).toBe(expected);
      } else {
        expect(() => roundFontUnitToFixedPoint(units, denominator, numerator, mode)).toThrow(
          RangeError
        );
      }
    }
  }
});
