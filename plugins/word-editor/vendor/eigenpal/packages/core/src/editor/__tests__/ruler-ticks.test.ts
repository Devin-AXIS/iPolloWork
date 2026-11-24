// Display-only ruler geometry (interactive-paginated-editing M4.4).

import { describe, expect, test } from 'bun:test';
import { generateRulerTicks, PX_PER_INCH, rulerPageBox } from '../ruler-ticks.ts';

describe('ruler ticks (task M4.4)', () => {
  test('an inch ruler labels whole inches and never the origin', () => {
    const ticks = generateRulerTicks(PX_PER_INCH * 3, 'inch');
    const labelled = ticks.filter((t) => t.label !== undefined);
    expect(labelled.map((t) => t.label)).toEqual(['1', '2', '3']);
    expect(ticks[0]!.position).toBe(0);
    expect(ticks[0]!.label).toBeUndefined();
  });

  test('inch minors fall on eighths with the legacy tick heights', () => {
    const ticks = generateRulerTicks(PX_PER_INCH, 'inch');
    expect(ticks).toHaveLength(9);
    expect(ticks.map((t) => t.height)).toEqual([10, 2, 4, 2, 6, 2, 4, 2, 10]);
  });

  test('a cm ruler labels whole centimetres', () => {
    const ticks = generateRulerTicks(PX_PER_INCH * 2, 'cm');
    const labels = ticks.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(['1', '2', '3', '4', '5']);
  });

  test('ticks never run past the page', () => {
    const length = PX_PER_INCH * 2.5;
    for (const unit of ['inch', 'cm'] as const) {
      for (const tick of generateRulerTicks(length, unit)) {
        expect(tick.position).toBeLessThanOrEqual(length);
      }
    }
  });

  test('a degenerate page produces no ticks rather than an infinite loop', () => {
    expect(generateRulerTicks(0, 'inch')).toEqual([]);
    expect(generateRulerTicks(-5, 'inch')).toEqual([]);
    expect(generateRulerTicks(Number.NaN, 'inch')).toEqual([]);
    expect(generateRulerTicks(Number.POSITIVE_INFINITY, 'inch')).toEqual([]);
  });

  test('the ruler measures the first page by index, not by array order', () => {
    const pages = [
      { index: 1, box: { width: 999, height: 999 } },
      { index: 0, box: { width: 816, height: 1056 } },
    ];
    expect(rulerPageBox(pages)).toEqual({ width: 816, height: 1056 });
    expect(rulerPageBox([])).toBeNull();
  });

  test('US Letter measures 8.5 by 11 inches', () => {
    // 816 x 1056 px is what the engine publishes for US Letter at 96 px/inch.
    expect(816 / PX_PER_INCH).toBe(8.5);
    expect(1056 / PX_PER_INCH).toBe(11);
  });
});
