// Where a list marker sits, and where the first line of its paragraph starts.
//
// Split out of `list-resolve.ts`: resolving WHICH marker a paragraph has and placing that
// marker are separate jobs, and only the placement is measured. DOM-free, points everywhere.

import {
  EMPTY_TAB_STOPS,
  nextTabDestination,
  type ResolvedTabStops,
  type TabStop,
} from './paragraph-tabs.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** The marker as it paints: `w:caps` draws it in capitals, so it measures in capitals too. */
export function listMarkerDisplayText(item: ResolvedListItem): string {
  return displayText(item.markerText, item.markerStyle);
}

/**
 * The space suffix in ems of the marker's size, whatever the marker's face: the advance of the
 * Arial space (569 of 2048 units). Reference renderings give the same gap after markers in
 * Times New Roman, Courier New, Arial, and Wingdings, at every size, superscript included.
 */
const SUFFIX_SPACE_EM = 569 / 2048;

/**
 * The width of a `w:suff="space"` suffix. It does not take the marker face's own space: it is
 * 569/2048 em at the marker's size, scaled and spaced as the marker is, so a monospaced or
 * symbol bullet gets the same gap as any other.
 */
export function listSuffixSpaceWidth(style: ResolvedRunStyle): number {
  return (
    SUFFIX_SPACE_EM * style.fontSizePt * (style.horizontalScalePercent / 100) +
    style.characterSpacingPt
  );
}

/** The ascent of the marker glyphs as they paint, or 0 for an empty or hidden marker. */
export function listMarkerAscent(item: ResolvedListItem, measurer: TextMeasurer): number {
  if (item.markerText.length === 0 || item.markerStyle.hidden) return 0;
  return measurer.lineMetrics(item.markerStyle, listMarkerDisplayText(item)).baseline;
}

/**
 * The marker's own width: a picture bullet's authored extent, or the measured glyphs.
 *
 * A `w:lvlPicBulletId` level draws an image INSTEAD of `w:lvlText`, so the image is what
 * occupies the hanging slot and what the `w:suff` tab has to clear.
 */
export function listMarkerWidth(item: ResolvedListItem, measurer: TextMeasurer): number {
  if (item.picBullet) return item.picBullet.width;
  return measurer.measure(listMarkerDisplayText(item), item.markerStyle);
}

/** Whether this item paints anything in its marker slot at all. */
function hasMarker(item: ResolvedListItem): boolean {
  return item.markerText.length > 0 || item.picBullet !== undefined;
}

/**
 * Horizontal marker box inside the first-line indent slot.
 *
 * Coordinates are relative to the same origin as paragraph content (`indent.left` is the
 * text start). Returns null when there is nothing to paint.
 *
 * `w:hanging` and a positive `w:firstLine` are one mutually exclusive slot
 * (§17.3.1.10, §17.3.1.12), so the marker has two placements, not an interaction:
 * a hanging level puts the marker BEFORE the text start (`left - hanging`); a
 * positive-firstLine level puts it AFTER (`left + firstLine`) — the standard legal
 * shape `w:ind w:left="0" w:firstLine="720"` numbers at 0.5" while continuation
 * lines return to the margin. Reading only the hanging model painted every such
 * marker at the left margin.
 */
export function listMarkerBox(
  item: ResolvedListItem,
  markerWidth: number,
  lineY: number,
  lineHeight: number
): { x: number; y: number; width: number; height: number } | null {
  if (!hasMarker(item)) return null;
  const x = markerSlotX(item, markerWidth);
  return { x, y: lineY, width: Math.max(markerWidth, 0), height: lineHeight };
}

/** Where a marker of `markerWidth` starts in its slot, including a zero-width empty marker. */
function markerSlotX(item: ResolvedListItem, markerWidth: number): number {
  const textLeft = item.indent.left;
  const hanging = item.indent.hanging;
  // The hanging spelling wins when a hostile file states both (Word's collapse); a
  // NEGATIVE firstLine is the hang spelled the other way and stays on the hanging model.
  const firstLineOffset = hanging > 0 ? -hanging : item.indent.firstLine;
  // A hanging marker may pass the margin, on either side and from any indent: measured
  // with `w:left` 0 and -284 under hangs of 720 and 426, in both directions.
  // lvlJc aligns the marker around the first-line position, not within the gap
  // between that position and the paragraph's text indent.
  let x = textLeft + firstLineOffset;
  if (item.markerAlign === 'right') x -= markerWidth;
  else if (item.markerAlign === 'center') x -= markerWidth / 2;
  return x;
}

/**
 * The first authored stop strictly past `x` that a numbering suffix may use. Legacy `num`
 * stops count; the implied hanging-indent stop and the default interval do not.
 */
function firstNumberingStopPast(tabStops: ResolvedTabStops, x: number): TabStop | undefined {
  return tabStops.stops.find((stop) => !stop.implied && stop.positionPt > x);
}

/**
 * Where the FIRST line of a list paragraph starts, relative to `indent.left` (§17.9.30).
 *
 * A list paragraph's hanging indent is the marker's slot, so ordinarily the text starts at
 * `indent.left` and this is 0 — `w:suff="tab"` with a marker that fits and no nearer stop
 * is exactly that case. The other cases move the first line:
 *
 * - `w:suff="space"` — one space after the marker, then the text. Not a tab, not the indent.
 * - `w:suff="nothing"` — the text begins immediately after the marker.
 * - `w:suff="tab"` with an authored stop between the marker end and the indent — the indent
 *   is an implicit stop, not the only one, so the nearer stop wins and the first line
 *   starts LEFT of the indent. With `w:doNotUseIndentAsNumberingTabStop` the indent does
 *   not compete: the first authored stop past the marker wins wherever it is, and the
 *   indent is the fallback only when there is none. Default-interval stops never compete
 *   while the marker fits.
 * - `w:suff="tab"` with a marker WIDER than its slot (`viii.`, `%1.%2.%3.`) — the suffix tab
 *   advances to the next tab stop past the marker, so the first line moves right instead of
 *   the marker being painted over its own first word.
 *
 * A positive-firstLine level's marker ends PAST the text start, so its suffix tab always
 * takes the stop lookup. The paragraph's legacy `num` stops participate in this lookup,
 * even though ordinary text tabs ignore them. `tabStops` is the paragraph's full cascade,
 * numbering-level stops included.
 *
 * A level whose marker text is empty (`w:lvlText w:val=""`, `w:numFmt="none"`) paints nothing,
 * but it still holds a zero-width marker at the start of its slot, and the suffix applies
 * from there: `nothing` starts the text at the slot, `space` one space after it, and `tab` at
 * the next stop, which is the indent for a hanging level.
 */
export function listFirstLineOffset(
  item: ResolvedListItem,
  measurer: TextMeasurer,
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  rightEdge = Number.POSITIVE_INFINITY
): number {
  const markerWidth = hasMarker(item) ? Math.max(listMarkerWidth(item, measurer), 0) : 0;
  const textLeft = item.indent.left;
  const markerEnd = markerSlotX(item, markerWidth) + markerWidth;
  if (item.suffix === 'nothing') return markerEnd - textLeft;
  if (item.suffix === 'space') {
    return markerEnd + listSuffixSpaceWidth(item.markerStyle) - textLeft;
  }
  if (markerEnd <= textLeft) {
    // `tab` with a marker that fits: the indent is the implicit stop, and an authored stop
    // can be nearer (or, when the indent is not a numbering stop, simply first).
    const stop = firstNumberingStopPast(tabStops, markerEnd);
    if (!stop) return 0;
    if (stop.positionPt >= textLeft && !tabStops.ignoreIndentAsNumberingTabStop) return 0;
    return Math.min(stop.positionPt, Math.max(markerEnd, rightEdge)) - textLeft;
  }
  // An overflowing marker looks further along the paragraph's own stops.
  return nextTabDestination(tabStops, markerEnd, rightEdge, true).positionPt - textLeft;
}

/**
 * First-line offset for ANY paragraph: `w:firstLine` right, `w:hanging` left — except a list
 * item, whose first line is placed by its marker and `w:suff` ({@link listFirstLineOffset}).
 */
export function firstLineShift(
  item: ResolvedListItem | undefined,
  indent: { readonly left: number; readonly hanging: number; readonly firstLine: number },
  measurer: TextMeasurer,
  tabStops?: ResolvedTabStops,
  available?: number
): number {
  if (item) {
    return listFirstLineOffset(
      item,
      measurer,
      tabStops,
      available === undefined ? undefined : indent.left + available
    );
  }
  return indent.hanging > 0 ? -indent.hanging : indent.firstLine;
}
