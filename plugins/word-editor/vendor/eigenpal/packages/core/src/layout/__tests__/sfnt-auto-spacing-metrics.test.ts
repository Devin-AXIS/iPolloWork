import { expect, test } from 'bun:test';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
  type ResolvedFont,
} from '../font-resource.ts';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import {
  createResolvedCjkAutoSpacingGapMetric,
  readCjkAutoSpacingFontMetrics,
} from '../sfnt-auto-spacing-metrics.ts';
import {
  autoSpacingCollectionFixture,
  autoSpacingSfntFixture,
} from './fixtures/sfnt-auto-spacing-fixture.ts';
import observations from './fixtures/cjk-auto-spacing-reference-metrics.json';

const style = (fontSizePt = 14): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Metadata fixture',
  fontSizePt,
});
function resolved(bytes = autoSpacingSfntFixture(), faceIndex = 0): ResolvedFont {
  const request = { family: 'Metadata fixture', weight: 400, style: 'normal' as const };
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 128 * 1024,
    resources: [
      { request, id: 'metadata-fixture', bytes, hash: sha256FontBytes(bytes), faceIndex },
    ],
    // This injected validator admits metadata fixtures only. These tests never shape glyphs.
    validateFont: (value, index) =>
      readCjkAutoSpacingFontMetrics(value, index)
        ? { valid: true }
        : { valid: false, diagnostic: 'Invalid metadata fixture' },
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return font;
}

test('SFNT average metrics preserve their own face and units per em', () => {
  expect(readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture(), 0)?.averageAdvanceEm).toBe(0.5);
  const data = autoSpacingCollectionFixture();
  expect(readCjkAutoSpacingFontMetrics(data, 0)?.averageAdvanceEm).toBe(0.5);
  expect(readCjkAutoSpacingFontMetrics(data, 1)?.averageAdvanceEm).toBe(821 / 2048);
});

test('SFNT reader rejects invalid face indices and collection versions', () => {
  for (const index of [-1, NaN, 0.5, 1])
    expect(readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture(), index)).toBeUndefined();
  const data = autoSpacingCollectionFixture();
  expect(readCjkAutoSpacingFontMetrics(data, 2)).toBeUndefined();
  new DataView(data.buffer).setUint32(4, 0x00030000);
  expect(readCjkAutoSpacingFontMetrics(data, 0)).toBeUndefined();
});

test('SFNT table directory obeys the existing 4096-record limit', () => {
  expect(
    readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture(128, 256, 4096), 0)?.averageAdvanceEm
  ).toBe(0.5);
  expect(readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture(128, 256, 4097), 0)).toBeUndefined();
});

test('SFNT reader rejects duplicate missing truncated and out-of-range tables', () => {
  const duplicate = autoSpacingSfntFixture();
  new DataView(duplicate.buffer).setUint32(28, 0x68656164);
  expect(readCjkAutoSpacingFontMetrics(duplicate, 0)).toBeUndefined();
  const outside = autoSpacingSfntFixture();
  new DataView(outside.buffer).setUint32(20, outside.length + 1);
  expect(readCjkAutoSpacingFontMetrics(outside, 0)).toBeUndefined();
  for (const length of [0, 11, 20, 50, 100])
    expect(
      readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture().subarray(0, length), 0)
    ).toBeUndefined();
  for (const average of [0, -1])
    expect(readCjkAutoSpacingFontMetrics(autoSpacingSfntFixture(average), 0)).toBeUndefined();
});

test('resolved metric scales only derived whitespace and caches one parse per admitted face', () => {
  const font = resolved();
  let reads = 0;
  const metric = createResolvedCjkAutoSpacingGapMetric(
    () => font,
    (bytes, index) => {
      reads++;
      return readCjkAutoSpacingFontMetrics(bytes, index);
    }
  )!;
  expect(metric(style())).toBe(3.5);
  expect(metric(style(20))).toBe(5);
  expect(reads).toBe(1);
});

test('resolved metric refuses missing faces invalid metrics and authored transformations', () => {
  expect(createResolvedCjkAutoSpacingGapMetric(() => null)!(style())).toBeUndefined();
  const metric = createResolvedCjkAutoSpacingGapMetric(() => resolved())!;
  for (const delta of [
    { characterSpacingPt: 0.1 },
    { horizontalScalePercent: 90 },
    { verticalAlign: 'superscript' },
    { fontSizePt: NaN },
  ])
    expect(metric({ ...style(), ...delta } as ResolvedRunStyle)).toBeUndefined();
  expect(
    createResolvedCjkAutoSpacingGapMetric(() => resolved(autoSpacingSfntFixture(32767)))!(style())
  ).toBeUndefined();
});

test('metadata fixture predictions retain all 32 reference gap observations and their original tolerance', () => {
  expect(observations.rows).toHaveLength(32);
  expect(observations.tolerancePt).toBe(0.2);
  for (const row of observations.rows) {
    const font = resolved(autoSpacingSfntFixture(row.averageWidth, row.unitsPerEm));
    const gap = createResolvedCjkAutoSpacingGapMetric(() => font)!(style(row.sizePt))!;
    expect(gap).toBeCloseTo(row.expectedGapPt, 12);
    expect(Math.abs(gap - row.referenceAdvancePt)).toBeLessThanOrEqual(observations.tolerancePt);
  }
});

test('the authored-family metric rejects substitute bytes and unrelated direct families', () => {
  const bytes = autoSpacingSfntFixture(980, 1000);
  const original = { family: 'Authored face', weight: 400, style: 'normal' as const };
  const replacement = { ...original, family: 'Substitute face' };
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 128 * 1024,
    resources: [
      { request: replacement, id: 'substitute', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
    ],
    substitutions: [{ from: original, to: replacement }],
    validateFont: () => ({ valid: true }),
  });
  const substituted = snapshot.resolve(original),
    direct = snapshot.resolve(replacement);
  if (substituted instanceof FontResolutionError || direct instanceof FontResolutionError)
    throw Error('fixture admission failed');
  let reads = 0;
  const reader = (value: Uint8Array, index: number) => {
    reads++;
    return readCjkAutoSpacingFontMetrics(value, index);
  };
  const requested = { ...style(), fontFamily: original.family };
  expect(
    createResolvedCjkAutoSpacingGapMetric(() => substituted, reader)!(requested)
  ).toBeUndefined();
  expect(createResolvedCjkAutoSpacingGapMetric(() => direct, reader)!(requested)).toBeUndefined();
  expect(reads).toBe(0);
  expect(
    createResolvedCjkAutoSpacingGapMetric(() => direct, reader)!({
      ...requested,
      fontFamily: replacement.family,
    })
  ).toBeCloseTo(6.86, 12);
  expect(reads).toBe(1);
});
