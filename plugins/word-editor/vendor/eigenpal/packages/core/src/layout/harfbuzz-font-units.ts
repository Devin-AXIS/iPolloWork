import { fixedPoint, type FixedPoint, type FixedPointRoundingMode } from './shaped-run.ts';

const roundRational = (
  numerator: bigint,
  denominator: bigint,
  mode: FixedPointRoundingMode
): number => {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (mode !== 'towardZero') {
    const doubled = remainder * 2n;
    if (
      doubled > denominator ||
      (doubled === denominator &&
        (mode === 'halfAwayFromZero' || (mode === 'halfToEven' && quotient % 2n !== 0n)))
    ) {
      quotient += 1n;
    }
  }
  const signed = negative ? -quotient : quotient;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Shaped fixed-point value exceeds the safe integer range');
  }
  return result;
};

/** Convert signed font units by an exact rational multiplier using the declared tie rule. */
export const roundFontUnitToFixedPoint = (
  fontUnits: number,
  denominator: number,
  numerator: number,
  mode: FixedPointRoundingMode
): FixedPoint => {
  if (!Number.isSafeInteger(fontUnits)) throw new RangeError('font units must be a safe integer');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('fixed-point denominator must be a positive safe integer');
  }
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError('fixed-point numerator must be a non-negative safe integer');
  }
  if (fontUnits === 0 || numerator === 0) return fixedPoint(0);
  const product = fontUnits * numerator;
  if (Number.isSafeInteger(product)) {
    // Integer multiplication and remainder are exact in this range. Remove the remainder
    // before division: rounding a fractional quotient can lose ties near the safe limit.
    const absolute = Math.abs(product);
    const remainder = absolute % denominator;
    let quotient = (absolute - remainder) / denominator;
    if (
      mode !== 'towardZero' &&
      (remainder > denominator - remainder ||
        (remainder === denominator - remainder &&
          (mode === 'halfAwayFromZero' || (mode === 'halfToEven' && quotient % 2 !== 0))))
    ) {
      quotient += 1;
    }
    return fixedPoint(quotient === 0 ? 0 : product < 0 ? -quotient : quotient);
  }
  return fixedPoint(
    roundRational(BigInt(fontUnits) * BigInt(numerator), BigInt(denominator), mode)
  );
};

export const fontUnitsConverter = (
  unitsPerEm: number,
  fontSizeHalfPoints: number,
  fixedPointScale: number,
  mode: FixedPointRoundingMode
): ((value: number) => FixedPoint) => {
  if (!Number.isSafeInteger(fontSizeHalfPoints) || fontSizeHalfPoints <= 0) {
    throw new RangeError('font size must be a positive integer number of half points');
  }
  if (fontSizeHalfPoints > Math.floor(Number.MAX_SAFE_INTEGER / fixedPointScale)) {
    throw new RangeError('font size and fixed-point scale product exceeds the safe integer range');
  }
  const numerator = fontSizeHalfPoints * fixedPointScale;
  const denominator = unitsPerEm * 2;
  return (value) => roundFontUnitToFixedPoint(value, denominator, numerator, mode);
};

/**
 * The same rational the fixed-point converter applies, with the rounding step left out.
 *
 * One IEEE division of two exactly representable integers, so it is deterministic and
 * reproducible — the same guarantee the fixed-point path gives, at the precision a painter
 * that sums advances needs.
 */
export const exactFontUnitsConverter = (
  unitsPerEm: number,
  fontSizeHalfPoints: number,
  fixedPointScale: number
): ((value: number) => number) => {
  const numerator = fontSizeHalfPoints * fixedPointScale;
  const denominator = unitsPerEm * 2;
  return (value) => (value * numerator) / denominator;
};
