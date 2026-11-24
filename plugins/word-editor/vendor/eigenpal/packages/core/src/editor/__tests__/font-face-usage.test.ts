import { expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  type ResolvedRunStyle,
  type TextMeasurer,
} from '../../layout/index.ts';
import { createFontFaceUsage } from '../font-face-usage.ts';
import {
  authoredCjkGapMetric,
  withAuthoredCjkGapMetric,
} from '../../layout/cjk-auto-spacing-metric-port.ts';

const style = (fontFamily: string | null, bold = false, italic = false) =>
  ({ fontFamily, bold, italic, fontSizePt: 11 }) as unknown as ResolvedRunStyle;

test('records each face the measurer measures, once', () => {
  const usage = createFontFaceUsage();
  const measurer = usage.wrap(createFixedMeasurer());
  const arial = style('Arial');
  measurer.measure('a', arial);
  measurer.measure('b', arial);
  measurer.lineMetrics(style('arial'));
  measurer.lineMetrics(style(null, true, true));
  measurer.measure('c', style('Arial', true));
  expect(usage.faces()).toEqual([
    { family: 'Arial', weight: 400, style: 'normal' },
    { family: null, weight: 700, style: 'italic' },
    { family: 'Arial', weight: 700, style: 'normal' },
  ]);
});

test('the wrapper answers what the measurer answers, also a class-based one', () => {
  class Measurer implements TextMeasurer {
    #scale = 2;
    measure(text: string) {
      return text.length * this.#scale;
    }
    lineMetrics() {
      return { height: this.#scale, baseline: 1 };
    }
    inkBounds() {
      return { left: 0, right: this.#scale };
    }
  }
  const usage = createFontFaceUsage();
  const inner = new Measurer();
  const measurer = usage.wrap(inner);
  expect(measurer.measure('abc', style('X'))).toBe(6);
  expect(measurer.inkBounds?.('a', style('X'))).toEqual({ left: 0, right: 2 });
  expect(measurer.caretAdvances).toBeUndefined();
  // One wrapper per measurer, so caches keyed by the measurer keep working.
  expect(usage.wrap(inner)).toBe(measurer);
});

test('the wrapper keeps the authored CJK gap metric of the measurer', () => {
  const inner = withAuthoredCjkGapMetric(createFixedMeasurer(), () => 3);
  const measurer = createFontFaceUsage().wrap(inner);
  expect(authoredCjkGapMetric(measurer, style('X'))).toBe(3);
});
