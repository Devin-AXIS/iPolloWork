// Ruler indent geometry and drag math.
//
// Pure functions over twips: where each of Word's four indent handles sits, and what a drag
// to a given position makes of the paragraph's indent. Engine-owned and adapter-agnostic for
// the reason `ruler-ticks.ts` is — the hanging-vs-left-box rule is subtle enough that React
// and Vue must not each grow their own copy of it.
//
// The vocabulary is the contract's: twips, and ONE signed first-line offset where negative
// is a hanging indent.

// The unit comes from the tick module rather than being redeclared: the snap grid and the
// tick cadence are the same grid, and two definitions could drift apart.
import type { RulerUnit } from './ruler-ticks.ts';

/** Twips per inch, as OOXML defines them. */
export const TWIPS_PER_INCH = 1440;

/** Twips per centimetre, as Word rounds them. */
export const TWIPS_PER_CM = 567;

/** Word snaps ruler drags to the eighth-inch grid its ticks already draw. */
export const SNAP_TWIPS_INCH = TWIPS_PER_INCH / 8;
/** The centimetre ruler's grid is the millimetre. */
export const SNAP_TWIPS_CM = TWIPS_PER_CM / 10;

export type { RulerUnit };

/**
 * The four handles Word's ruler carries.
 *
 * `hanging` and `left` sit at the SAME position and differ only in what a drag takes with
 * them — the box moves the whole paragraph, the triangle leaves the first line where it is.
 */
export type RulerIndentHandle = 'firstLine' | 'hanging' | 'left' | 'right';

/** A paragraph's indent as the ruler works with it. Twips; `firstLine` signed. */
export interface RulerIndent {
  readonly left: number;
  readonly right: number;
  readonly firstLine: number;
  /**
   * The paragraph reads right to left. Its `left` indent is then the LEADING one, on the
   * right margin, and its first-line offset counts from there, so the ruler axis mirrors.
   */
  readonly rtl?: boolean;
}

/** The page the handles are placed against. Twips. */
export interface RulerPageMetrics {
  readonly pageWidth: number;
  readonly leftMargin: number;
  readonly rightMargin: number;
}

/**
 * How a ruler drag resolves: which grid it snaps to, and whether it snaps at all.
 *
 * @public
 */
export interface RulerDragOptions {
  /** Which snap grid applies. Defaults to inches. */
  readonly unit?: RulerUnit;
  /** Alt held: continuous, twip-precision drag, bypassing the snap grid — as in Word. */
  readonly precise?: boolean;
}

/** The same page seen from its right sheet edge, for a right-to-left paragraph. */
const mirrored = (page: RulerPageMetrics): RulerPageMetrics => ({
  pageWidth: page.pageWidth,
  leftMargin: page.rightMargin,
  rightMargin: page.leftMargin,
});

const clamp = (value: number, low: number, high: number): number =>
  high < low ? low : value < low ? low : value > high ? high : value;

/**
 * Where a handle sits, in twips from the page's LEFT SHEET EDGE (not the margin).
 *
 * With `indent.rtl`, `indent.left` is the leading indent and sits on the right margin.
 */
export function handlePosition(
  handle: RulerIndentHandle,
  indent: RulerIndent,
  page: RulerPageMetrics
): number {
  if (indent.rtl) {
    return page.pageWidth - handlePosition(handle, { ...indent, rtl: false }, mirrored(page));
  }
  switch (handle) {
    case 'firstLine':
      return page.leftMargin + indent.left + indent.firstLine;
    // Coincident by design, as in Word.
    case 'hanging':
    case 'left':
      return page.leftMargin + indent.left;
    case 'right':
      return page.pageWidth - page.rightMargin - indent.right;
  }
}

/** Round to the ruler's grid, or to the twip when the drag is precise. */
export function snapTwips(value: number, unit: RulerUnit, precise: boolean): number {
  if (precise) return Math.round(value);
  const step = unit === 'cm' ? SNAP_TWIPS_CM : SNAP_TWIPS_INCH;
  return Math.round(Math.round(value / step) * step);
}

/**
 * The indent a drag of `handle` to `positionTwips` produces.
 *
 * Clamps differ from the MARGIN drags this ruler also carries, and deliberately:
 *
 * - Indents may go NEGATIVE, pulling text into the margin, which Word allows. The floor is
 *   the sheet edge, not the margin.
 * - There is no minimum text width. The 720-twip floor the margin drags use mirrors an
 *   engine refusal that does not exist for indents, and enforcing one here would make a
 *   narrow pull-quote unreachable. Left and right markers may MEET; they may not cross.
 * - The left box needs a first-line clamp of its own. It does not move `firstLine`, so on a
 *   hanging paragraph dragging the box left can push the first-line marker off the sheet
 *   while the box itself is still in range. The drag stops when the LEADING marker lands.
 */
export function dragIndent(
  handle: RulerIndentHandle,
  positionTwips: number,
  indent: RulerIndent,
  page: RulerPageMetrics,
  options: RulerDragOptions = {}
): RulerIndent {
  if (indent.rtl) {
    const next = dragIndent(
      handle,
      page.pageWidth - positionTwips,
      { ...indent, rtl: false },
      mirrored(page),
      options
    );
    return { ...next, rtl: true };
  }
  const x = snapTwips(positionTwips, options.unit ?? 'inch', options.precise ?? false);
  const rightEdge = page.pageWidth - page.rightMargin - indent.right;
  const leadingLeft = page.leftMargin + indent.left + Math.max(0, indent.firstLine);

  switch (handle) {
    case 'firstLine': {
      // The marker itself is what is being placed, so the clamp is on the sheet and on not
      // passing the right indent.
      const placed = clamp(x, 0, rightEdge);
      return { ...indent, firstLine: placed - page.leftMargin - indent.left };
    }
    case 'left': {
      // Both markers move together, so BOTH bound the drag.
      const low = -page.leftMargin - Math.min(0, indent.firstLine);
      const high = rightEdge - page.leftMargin - Math.max(0, indent.firstLine);
      return { ...indent, left: clamp(x - page.leftMargin, low, high) };
    }
    case 'hanging': {
      // The first-line marker is PINNED: `left` absorbs the move and `firstLine` gives back
      // exactly what `left` took, so `leftMargin + left + firstLine` is unchanged.
      const next = clamp(x - page.leftMargin, -page.leftMargin, rightEdge - page.leftMargin);
      return {
        ...indent,
        left: next,
        firstLine: indent.firstLine + (indent.left - next),
      };
    }
    case 'right': {
      const placed = clamp(x, leadingLeft, page.pageWidth);
      return { ...indent, right: page.pageWidth - page.rightMargin - placed };
    }
  }
}

/**
 * Where a tab stop sits, in twips from the page's left sheet edge. `tabTwips` counts from the
 * paragraph's leading margin, as `w:tab/@w:pos` does: leftward from the right margin when
 * `indent.rtl` is set.
 *
 * @public
 */
export function rulerTabPosition(
  tabTwips: number,
  page: RulerPageMetrics,
  indent: Pick<RulerIndent, 'rtl'>
): number {
  return indent.rtl ? page.pageWidth - page.rightMargin - tabTwips : page.leftMargin + tabTwips;
}

/**
 * One horizontal ruler tick, in twips from the page's left sheet edge.
 *
 * @public
 */
export interface RulerMarginTick {
  /** Twips from the page's left sheet edge. */
  readonly position: number;
  /** Tick length in CSS pixels: 8 for a whole unit, 5 for a half, 3 or 2 for minor ticks. */
  readonly height: number;
  /** Whole units from the paragraph's leading margin; omitted at the margin and on minor ticks. */
  readonly label?: string;
}

/**
 * Horizontal ruler ticks counted from the margin the paragraph starts at: the left margin, or
 * the right margin when `indent.rtl` is set. Labels count whole units outward on both sides,
 * so the margin zone also reads 1, 2, and so on toward the sheet edge.
 *
 * @public
 */
export function rulerMarginTicks(
  page: RulerPageMetrics,
  indent: Pick<RulerIndent, 'rtl'>,
  unit: RulerUnit
): RulerMarginTick[] {
  if (!Number.isFinite(page.pageWidth) || page.pageWidth <= 0) return [];
  const origin = indent.rtl ? page.pageWidth - page.rightMargin : page.leftMargin;
  const perUnit = unit === 'inch' ? 8 : 10;
  const step = (unit === 'inch' ? TWIPS_PER_INCH : TWIPS_PER_CM) / perUnit;
  const ticks: RulerMarginTick[] = [];
  const first = -Math.floor(origin / step);
  const last = Math.floor((page.pageWidth - origin) / step);
  for (let index = first; index <= last; index += 1) {
    const position = origin + index * step;
    const minor = Math.abs(index) % perUnit;
    if (minor === 0) {
      const units = Math.abs(index) / perUnit;
      // A label centred on a sheet edge would show only half of itself.
      const labelled = units > 0 && position > 0 && position < page.pageWidth;
      ticks.push({ position, height: 8, ...(labelled ? { label: String(units) } : {}) });
    } else if (minor === perUnit / 2) ticks.push({ position, height: 5 });
    else if (unit === 'cm' || minor % 2 === 0) ticks.push({ position, height: 3 });
    else ticks.push({ position, height: 2 });
  }
  return ticks;
}
