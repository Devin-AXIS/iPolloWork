import { expect, test } from 'bun:test';
import {
  rulerMarginTicks,
  rulerTabPosition,
  TWIPS_PER_CM,
  TWIPS_PER_INCH,
  type RulerPageMetrics,
} from '../ruler-indent.ts';

/** US Letter, a 1" left margin and a 2" right margin, so the two origins differ. */
const PAGE: RulerPageMetrics = { pageWidth: 12240, leftMargin: 1440, rightMargin: 2880 };

const labels = (ticks: ReturnType<typeof rulerMarginTicks>) =>
  ticks.filter((tick) => tick.height === 8).map((tick) => [tick.position, tick.label ?? '0']);

test('a left-to-right paragraph counts from the left margin, outward on both sides', () => {
  // The tick on the sheet edge carries no label: only half of it would show.
  expect(labels(rulerMarginTicks(PAGE, {}, 'inch'))).toEqual([
    [0, '0'],
    [1440, '0'],
    [2880, '1'],
    [4320, '2'],
    [5760, '3'],
    [7200, '4'],
    [8640, '5'],
    [10080, '6'],
    [11520, '7'],
  ]);
});

test('a right-to-left paragraph counts from the right margin', () => {
  const origin = PAGE.pageWidth - PAGE.rightMargin;
  const marks = labels(rulerMarginTicks(PAGE, { rtl: true }, 'inch'));
  expect(marks).toContainEqual([origin, '0']);
  expect(marks).toContainEqual([origin + TWIPS_PER_INCH, '1']);
  expect(marks).toContainEqual([origin - 3 * TWIPS_PER_INCH, '3']);
  expect(marks.at(-1)).toEqual([PAGE.pageWidth, '0']);
});

test('the minor cadence follows the origin', () => {
  const ticks = rulerMarginTicks(PAGE, {}, 'inch');
  const at = (twips: number) => ticks.find((tick) => tick.position === twips)?.height;
  expect(at(1440 + 720)).toBe(5);
  expect(at(1440 + 360)).toBe(3);
  expect(at(1440 + 180)).toBe(2);
  expect(at(1440 - 720)).toBe(5);
  const cm = rulerMarginTicks(PAGE, { rtl: true }, 'cm');
  const origin = PAGE.pageWidth - PAGE.rightMargin;
  expect(cm.find((tick) => tick.position === origin - TWIPS_PER_CM)?.label).toBe('1');
  expect(
    cm.find((tick) => Math.abs(tick.position - (origin - TWIPS_PER_CM / 2)) < 1e-6)?.height
  ).toBe(5);
});

test('every tick stays on the sheet', () => {
  for (const rtl of [false, true])
    for (const unit of ['inch', 'cm'] as const)
      for (const tick of rulerMarginTicks(PAGE, { rtl }, unit)) {
        expect(tick.position).toBeGreaterThanOrEqual(-1e-6);
        expect(tick.position).toBeLessThanOrEqual(PAGE.pageWidth + 1e-6);
      }
  expect(rulerMarginTicks({ ...PAGE, pageWidth: 0 }, {}, 'inch')).toEqual([]);
});

test('a tab stop counts from the leading margin', () => {
  expect(rulerTabPosition(720, PAGE, {})).toBe(2160);
  expect(rulerTabPosition(720, PAGE, { rtl: true })).toBe(12240 - 2880 - 720);
});
