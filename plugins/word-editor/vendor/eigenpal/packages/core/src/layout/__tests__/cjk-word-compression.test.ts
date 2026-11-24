import { expect, test } from 'bun:test';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { TextMeasurer } from '../semantic-records.ts';

// Word for Mac PDF, Songti SC Regular at 12 pt. Origins are relative to the 72 pt margin.
// These values come from the PDF's glyph positions, independently of editor layout.
const wordLines = [
  {
    text: '甲方（出租方）：【    】',
    origins: [0.0, 12.0, 24.0, 36.0, 48.0, 60.0, 72.0, 78.0, 84.0, 96.0, 99.0, 102.0, 105.0, 108.0],
    end: 120,
  },
  {
    text: '原合同租期自【  】年【  】月【  】日起至【  】年【  】月【  】日止。',
    origins: [
      0.0, 12.0, 24.0, 36.0, 48.0, 60.0, 72.0, 84.0, 87.0, 90.0, 102.0, 114.0, 126.0, 129.0, 132.0,
      144.0, 156.0, 168.0, 171.0, 174.0, 186.0, 198.0, 210.0, 222.0, 234.0, 237.0, 240.0, 252.0,
      264.0, 276.0, 279.0, 282.0, 294.0, 306.0, 318.0, 321.0, 324.0, 336.0, 348.0, 360.0,
    ],
    end: 372,
  },
  {
    text: '签订了《    》（以下简称“原合同”），双方同意按以下第【  】种方式处理：',
    origins: [
      0.0, 12.0, 24.0, 36.0, 48.0, 51.0, 54.0, 57.0, 60.0, 66.0, 78.0, 90.0, 102.0, 114.0, 126.0,
      130.668, 142.668, 154.668, 166.668, 171.612, 177.612, 189.612, 201.612, 213.612, 225.612,
      237.612, 249.612, 261.612, 273.612, 285.612, 297.612, 300.612, 303.612, 315.612, 327.612,
      339.612, 351.612, 363.612, 375.612,
    ],
    end: 387.612,
  },
  {
    text: '（（甲））、乙',
    origins: [0.0, 6.0, 18.0, 30.0, 36.0, 42.0, 54.0],
    end: 66,
  },
] as const;
const policy = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  settings: {
    compression: 'compressPunctuation' as const,
    sourceEastAsianFont: true,
    strict: false,
    before: {},
    after: {},
  },
};
// Songti's measured advances isolate compression from platform font availability.
const measurer: TextMeasurer = {
  measure(text, style) {
    const advance = [...text].reduce(
      (sum, char) => sum + (char === ' ' ? 3 : char === '“' ? 4.668 : char === '”' ? 4.944 : 12),
      0
    );
    return (
      (((advance * style.fontSizePt) / 12) * style.horizontalScalePercent) / 100 +
      text.length * style.characterSpacingPt
    );
  },
  lineMetrics: () => ({ height: 16.8, baseline: 12 }),
};
function piece(text: string, start: number, fontSizePt = 12): FieldAwarePiece {
  return {
    text,
    start,
    end: start + text.length,
    props: [],
    style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, fontSizePt },
  };
}
for (const fixture of wordLines)
  test(`Word glyph origins survive every run seam: ${fixture.text}`, () => {
    for (let split = 0; split <= fixture.text.length; split++) {
      const pieces = [
        piece(fixture.text.slice(0, split), 0),
        piece(fixture.text.slice(split), split),
      ].filter((value) => value.text.length);
      const output = compressCjkPieces(pieces, policy, measurer);
      let x = 0;
      const origins: number[] = [];
      for (const run of output) {
        for (let offset = 0; offset < run.text.length; offset++)
          origins.push(
            x + measurer.measure(run.text.slice(0, offset), run.style) + (run.glyphOffsetPt ?? 0)
          );
        x += measurer.measure(run.text, run.style);
      }
      expect(origins.length).toBe(fixture.origins.length);
      origins.forEach((origin, index) => expect(origin).toBeCloseTo(fixture.origins[index]!, 3));
      expect(x).toBeCloseTo(fixture.end, 3);
    }
  });

test('a large centered colon cannot consume a smaller opening bracket bearing', () => {
  for (const horizontalScalePercent of [50, 100, 200]) {
    const colon = piece('：', 0, 24);
    const opening = piece('（', 1, 6);
    const scaledOpening = { ...opening, style: { ...opening.style, horizontalScalePercent } };
    const output = compressCjkPieces([colon, scaledOpening], policy, measurer);
    const naturalOpening = measurer.measure(opening.text, scaledOpening.style);
    const reduction = 24 - measurer.measure(output[0]!.text, output[0]!.style);
    expect(reduction).toBe(naturalOpening / 2);
    expect(output[0]!.glyphOffsetPt).toBe(0);
    expect(output[1]!.glyphOffsetPt).toBeUndefined();
    // Even a colon occupying its full advance cannot reach the opening's ink.
    const openingInkStart = 24 - reduction + naturalOpening / 2;
    expect(openingInkStart).toBeGreaterThanOrEqual(24);
  }
});
