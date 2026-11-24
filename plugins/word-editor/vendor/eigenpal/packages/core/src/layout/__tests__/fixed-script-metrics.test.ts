import { expect, test } from 'bun:test';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

for (const verticalAlign of ['superscript', 'subscript'] as const) {
  test(`fixed ${verticalAlign} shrinks advances and metrics without shrinking authored character spacing`, () => {
    const measurer = createFixedMeasurer(6, 14);
    const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 11, horizontalScalePercent: 150 };
    const base = measurer.measure('XX', style);
    const script = { ...style, verticalAlign, characterSpacingPt: 2 };
    expect(measurer.measure('XX', script)).toBeCloseTo(base * 0.65 + 4, 6);
    expect(measurer.lineMetrics(script).height).toBeCloseTo(
      measurer.lineMetrics(style).height * 0.65,
      6
    );
  });
}
