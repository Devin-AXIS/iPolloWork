// Ruler indent drag math.
//
// Every case here exists because a review found the rule easy to get wrong: the
// hanging-vs-left-box distinction, the clamps that differ from the margin drags, and the
// snap grid.

import { describe, expect, test } from 'bun:test';
import {
  dragIndent,
  handlePosition,
  snapTwips,
  SNAP_TWIPS_INCH,
  TWIPS_PER_INCH,
  type RulerIndent,
  type RulerPageMetrics,
} from '../ruler-indent.ts';

/** US Letter with one-inch margins: 8.5" wide, 1440-twip margins. */
const PAGE: RulerPageMetrics = { pageWidth: 12240, leftMargin: 1440, rightMargin: 1440 };
const FLUSH: RulerIndent = { left: 0, right: 0, firstLine: 0 };

describe('a right-to-left paragraph', () => {
  // `left` is the LEADING indent, on the right margin, and the first line counts from it.
  const PAGE_RTL: RulerPageMetrics = { pageWidth: 12240, leftMargin: 1800, rightMargin: 1440 };
  const indent: RulerIndent = { left: 720, right: 360, firstLine: -360, rtl: true };

  test('the handles sit on the mirrored axis', () => {
    expect(handlePosition('left', indent, PAGE_RTL)).toBe(12240 - 1440 - 720);
    expect(handlePosition('firstLine', indent, PAGE_RTL)).toBe(12240 - 1440 - 360);
    expect(handlePosition('right', indent, PAGE_RTL)).toBe(1800 + 360);
  });

  test('a drag reads its position on the same axis and keeps the flag', () => {
    const next = dragIndent('left', 12240 - 1440 - 1080, indent, PAGE_RTL);
    expect(next).toEqual({ left: 1080, right: 360, firstLine: -360, rtl: true });
    expect(dragIndent('right', 1800 + 720, indent, PAGE_RTL).right).toBe(720);
  });
});

describe('handle positions', () => {
  test('the hanging triangle and the left box are coincident, as in Word', () => {
    const indent: RulerIndent = { left: 720, right: 0, firstLine: -360 };
    expect(handlePosition('hanging', indent, PAGE)).toBe(handlePosition('left', indent, PAGE));
    expect(handlePosition('left', indent, PAGE)).toBe(1440 + 720);
  });

  test('the first-line marker carries the signed offset', () => {
    expect(handlePosition('firstLine', { left: 720, right: 0, firstLine: -360 }, PAGE)).toBe(1800);
    expect(handlePosition('firstLine', { left: 720, right: 0, firstLine: 360 }, PAGE)).toBe(2520);
  });

  test('the right marker measures in from the right margin', () => {
    expect(handlePosition('right', { left: 0, right: 720, firstLine: 0 }, PAGE)).toBe(
      12240 - 1440 - 720
    );
  });
});

describe('drag semantics', () => {
  test('the left box moves the whole paragraph, first line included', () => {
    const indent: RulerIndent = { left: 720, right: 0, firstLine: -360 };
    const next = dragIndent('left', 1440 + 1440, indent, PAGE);
    expect(next.left).toBe(1440);
    // The offset is untouched, so the first-line marker travels the same distance the box did.
    expect(next.firstLine).toBe(-360);
    expect(handlePosition('firstLine', next, PAGE)).toBe(
      handlePosition('firstLine', indent, PAGE) + 720
    );
  });

  test('the hanging triangle pins the first-line marker where it was', () => {
    const indent: RulerIndent = { left: 720, right: 0, firstLine: -360 };
    const before = handlePosition('firstLine', indent, PAGE);
    const next = dragIndent('hanging', 1440 + 1440, indent, PAGE);
    expect(next.left).toBe(1440);
    // `left` took 720; `firstLine` gives back exactly 720.
    expect(next.firstLine).toBe(-1080);
    expect(handlePosition('firstLine', next, PAGE)).toBe(before);
  });

  test('the first-line handle moves only itself', () => {
    const indent: RulerIndent = { left: 720, right: 0, firstLine: 0 };
    const next = dragIndent('firstLine', 1440 + 720 + 360, indent, PAGE);
    expect(next.left).toBe(720);
    expect(next.firstLine).toBe(360);
  });

  test('the right handle measures back from the right margin', () => {
    const next = dragIndent('right', 12240 - 1440 - 720, FLUSH, PAGE);
    expect(next.right).toBe(720);
  });
});

describe('snapping', () => {
  test('a drag lands on the eighth-inch grid', () => {
    expect(snapTwips(700, 'inch', false)).toBe(720);
    expect(snapTwips(800, 'inch', false)).toBe(720);
    expect(snapTwips(830, 'inch', false)).toBe(900);
    // Exactly half an inch is reachable, which whole-twip rounding never made possible.
    expect(snapTwips(715, 'inch', false) % SNAP_TWIPS_INCH).toBe(0);
  });

  test('Alt gives twip precision', () => {
    expect(snapTwips(703, 'inch', true)).toBe(703);
  });

  test('a centimetre ruler snaps to the millimetre', () => {
    const mm = snapTwips(100, 'cm', false);
    expect(Math.abs(mm - 113)).toBeLessThanOrEqual(1);
  });

  test('the drag path snaps too, not just the helper', () => {
    const next = dragIndent('left', 1440 + 700, FLUSH, PAGE);
    expect(next.left).toBe(720);
  });
});

describe('clamps', () => {
  test('indents may go negative, into the margin', () => {
    const next = dragIndent('left', 720, FLUSH, PAGE);
    expect(next.left).toBe(-720);
  });

  test('but never past the sheet edge', () => {
    const next = dragIndent('left', -5000, FLUSH, PAGE);
    expect(handlePosition('left', next, PAGE)).toBe(0);
  });

  test('the left box stops when the FIRST-LINE marker reaches the sheet, not the box', () => {
    // A hanging paragraph: the first-line marker leads the box by 720 twips to its left.
    const indent: RulerIndent = { left: 1440, right: 0, firstLine: -720 };
    const next = dragIndent('left', -5000, indent, PAGE);
    expect(handlePosition('firstLine', next, PAGE)).toBe(0);
    // The box itself is still on the sheet, which is exactly why it needed its own clamp.
    expect(handlePosition('left', next, PAGE)).toBe(720);
  });

  test('left and right markers may MEET — there is no minimum text width', () => {
    const withRight: RulerIndent = { left: 0, right: 720, firstLine: 0 };
    const next = dragIndent('left', 12240 - 1440 - 720, withRight, PAGE);
    expect(handlePosition('left', next, PAGE)).toBe(handlePosition('right', next, PAGE));
  });

  test('but they may not cross', () => {
    const withRight: RulerIndent = { left: 0, right: 720, firstLine: 0 };
    const next = dragIndent('left', 12240, withRight, PAGE);
    expect(handlePosition('left', next, PAGE)).toBeLessThanOrEqual(
      handlePosition('right', next, PAGE)
    );
  });

  test('the right handle cannot cross the leading left-side marker', () => {
    const indent: RulerIndent = { left: 1440, right: 0, firstLine: 720 };
    const next = dragIndent('right', 0, indent, PAGE);
    expect(handlePosition('right', next, PAGE)).toBe(handlePosition('firstLine', indent, PAGE));
  });

  test('a first-line drag cannot pass the right indent', () => {
    const indent: RulerIndent = { left: 0, right: 1440, firstLine: 0 };
    const next = dragIndent('firstLine', 12240, indent, PAGE);
    expect(handlePosition('firstLine', next, PAGE)).toBe(12240 - 1440 - 1440);
  });
});

describe('round trip', () => {
  test('dragging a handle to where it already is changes nothing', () => {
    const indent: RulerIndent = { left: 720, right: 360, firstLine: -360 };
    for (const handle of ['firstLine', 'hanging', 'left', 'right'] as const) {
      const at = handlePosition(handle, indent, PAGE);
      // Positions are already on the grid here, so the snap is a no-op and the drag is one.
      expect(dragIndent(handle, at, indent, PAGE)).toEqual(indent);
    }
  });

  test('an inch of drag is an inch of indent', () => {
    const next = dragIndent('left', PAGE.leftMargin + TWIPS_PER_INCH, FLUSH, PAGE);
    expect(next.left).toBe(TWIPS_PER_INCH);
  });
});
