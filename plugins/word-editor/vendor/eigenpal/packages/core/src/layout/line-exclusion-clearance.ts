import {
  mergeAvailableIntervalsAtY,
  topAndBottomSkipBeforeLine,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { shiftInlineDrawingRecord } from './drawing-layout.ts';
import { narrowRectangularWrapSkip } from './narrow-wrap-clearance.ts';
import { breakClearanceSkip } from './text-wrapping-break-clear.ts';
import type { PendingLine } from './pending-line.ts';
import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Whether an exclusion band has reached this line's logical text range. */
export function exclusionZoneAppliesToLine(
  zone: ExclusionZone,
  paragraphId: string,
  line: Pick<PendingLine, 'start' | 'end'>,
  anchorLineStarts: ReadonlyMap<number, number>
): boolean {
  if (zone.anchorParagraphId !== paragraphId) return true;
  // Page- and margin-positioned bands also wrap lines before their anchor character.
  if (zone.pageFramedBand) return true;
  const anchorLineStart = anchorLineStarts.get(zone.anchorModelStart);
  if (anchorLineStart !== undefined && line.start >= anchorLineStart) return true;
  return line.end >= zone.anchorModelStart;
}

/** A taller run must not pull already placed text into a newly intersected rectangle. */
export function relocateLineForExclusionGrowth(
  line: PendingLine,
  y: number,
  height: number,
  zones: readonly ExclusionZone[],
  left: number,
  right: number,
  spacing: ParagraphLineSpacing,
  candidateWidth: number
): number | null {
  const oldHeight = applyLineSpacing(spacing, line.height, line.baseline).height;
  if (height <= oldHeight + 0.001 || (line.spans.length === 0 && line.drawings.length === 0))
    return 0;
  const before = mergeAvailableIntervalsAtY(y, zones, left, right, oldHeight);
  const after = mergeAvailableIntervalsAtY(y, zones, left, right, height);
  const fits = (box: { x: number; width: number }, intervals: typeof before) =>
    intervals.some(
      (interval) => box.x >= interval.start - 0.001 && box.x + box.width <= interval.end + 0.001
    );
  const blocksText = line.spans.some(
    (span) => span.text.trim() && fits(span.box, before) && !fits(span.box, after)
  );
  const blocksDrawing = line.drawings.some(
    (drawing) => fits(drawing, before) && !fits(drawing, after)
  );
  if (!blocksText && !blocksDrawing) return 0;
  // Tabs own absolute stops and cannot be translated with ordinary text.
  if (line.spans.some((span) => span.text.includes('\t'))) return null;
  let first = Infinity,
    last = -Infinity;
  for (const span of line.spans) {
    first = Math.min(first, span.box.x);
    last = Math.max(last, span.box.x + span.box.width);
  }
  for (const drawing of line.drawings) {
    first = Math.min(first, drawing.x);
    last = Math.max(last, drawing.x + drawing.width);
  }
  const passage = after.find(
    (interval) =>
      Math.max(first, interval.start) + last - first + candidateWidth <= interval.end + 0.001
  );
  if (!passage) return null;
  const shift = Math.max(0, passage.start - first);
  for (let index = 0; index < line.spans.length; index++) {
    const span = line.spans[index]!;
    line.spans[index] = { ...span, box: { ...span.box, x: span.box.x + shift } };
  }
  for (let index = 0; index < line.drawings.length; index++)
    line.drawings[index] = shiftInlineDrawingRecord(line.drawings[index]!, shift, 0);
  line.width += shift;
  return shift;
}

/** Keep clearance on the pending line so placement and pagination consume it once. */
export function createLineExclusionClearance(context: {
  line: () => PendingLine;
  top: () => number;
  /** Paragraph spacing above the line; see {@link topAndBottomSkipBeforeLine}. */
  spaceAbove?: () => number;
  zones: () => readonly ExclusionZone[];
  left: () => number;
  right: number;
  /** Intrinsically sized cell stories reserve their own floating content separately. */
  clearOwnEmptyAnchor?: boolean;
  emptyStyle: ResolvedRunStyle;
  measurer: TextMeasurer;
  lineSpacing: ParagraphLineSpacing;
  /** Whether the line holds content; see {@link lineHoldsContent}. */
  holdsContent: () => boolean;
  /** The paragraph being broken, whose own floats move with it to a later region. */
  paragraphId?: string;
  /** Page-content Y of the flow region's bottom, when the caller paginates. */
  regionBottom?: number;
}) {
  let appliedLine: PendingLine | undefined;
  /** The line whose only skip is the estimate taken before it had content. */
  let estimatedLine: PendingLine | undefined;
  /**
   * Move the line below the top-and-bottom bands it crosses. Normally only an empty line moves;
   * `withContent` also moves one that holds content, for a band its own anchor just raised.
   */
  const applyTopAndBottomSkipIfNeeded = (withContent = false): void => {
    const line = context.line();
    if (!withContent && (appliedLine === line || context.holdsContent())) return;
    const zones = context.zones();
    if (zones.length === 0) return;
    const metrics = context.measurer.lineMetrics(context.emptyStyle);
    const skip = topAndBottomSkipBeforeLine(
      context.top(),
      line.height > 0 ? line.height : metrics.height,
      zones,
      context.spaceAbove?.() ?? 0
    );
    if (skip > (withContent ? (line.exclusionSkipBefore ?? 0) : 0) + 0.001) {
      appliedLine = line;
      estimatedLine = line;
      line.exclusionSkipBefore = skip;
    }
  };
  /**
   * Push a text line below the floats that block it. The paragraph's first line takes its
   * spacing above again below the float, once, as it does below a full-width band.
   */
  const pushTextLineDown = (line: PendingLine, skip: number): void => {
    const prior = line.exclusionSkipBefore ?? 0;
    const spaceAbove = prior > 0.001 ? 0 : Math.max(0, context.spaceAbove?.() ?? 0);
    line.exclusionSkipBefore = prior + skip + spaceAbove;
    line.width = 0;
    appliedLine = line;
    estimatedLine = undefined;
  };
  const applyNarrowWrapSkipIfNeeded = (text: string, style: ResolvedRunStyle): void => {
    const line = context.line();
    if (context.holdsContent()) return;
    applyTopAndBottomSkipIfNeeded();
    const zones = context.zones();
    if (zones.length === 0) return;
    const metrics = context.measurer.lineMetrics(style);
    const firstCodePoint = text.codePointAt(0);
    const glyph = firstCodePoint === undefined ? '' : String.fromCodePoint(firstCodePoint);
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      Math.max(
        metrics.height,
        applyLineSpacing(context.lineSpacing, metrics.height, metrics.baseline).height
      ),
      zones,
      context.left(),
      context.right,
      context.measurer.measure(displayText(glyph, style), style)
    );
    if (skip > 0.001) pushTextLineDown(line, skip);
  };
  const applyInlineObjectSkipIfNeeded = (width: number, height: number): void => {
    const line = context.line();
    const hasContent = context.holdsContent();
    applyTopAndBottomSkipIfNeeded();
    const zones = context.zones();
    if (zones.length === 0) return;
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      Math.max(line.height, height + Math.max(0, line.height - line.baseline)),
      zones,
      context.left(),
      context.right,
      // An oversized inline object still has to clear a blocked column. This
      // clips only its clearance footprint, never its authored paint geometry.
      Math.min(line.width + width, Math.max(0, context.right - context.left()))
    );
    if (skip > 0.001) {
      line.exclusionSkipBefore = (line.exclusionSkipBefore ?? 0) + skip;
      if (!hasContent) line.width = 0;
      appliedLine = line;
      estimatedLine = undefined;
    }
  };
  /**
   * Move an empty line down when no passage beside the floats holds its opening segment.
   *
   * The segment is the line's first unbreakable piece: a word, an inline object, or the
   * first piece of a word too long for the column. It needs a passage at least as wide as
   * itself, capped at the column, so only a segment wider than the whole column is broken
   * by character, and only where the full column is clear. Returns whether the line moved.
   */
  const applyOpeningSegmentSkipIfNeeded = (width: number, height: number): boolean => {
    const line = context.line();
    if (context.holdsContent()) return false;
    const zones = context.zones();
    if (zones.length === 0) return false;
    const left = context.left();
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      height,
      zones,
      left,
      context.right,
      Math.min(width, Math.max(0, context.right - left))
    );
    if (!(skip > 0.001)) return false;
    // Below the region a float anchored in this paragraph moves on with it, and blocks the
    // line again there. Keep the line beside the float instead of overlapping it.
    const bottom = context.regionBottom;
    if (
      bottom !== undefined &&
      context.top() + (line.exclusionSkipBefore ?? 0) + skip + height > bottom + 0.001 &&
      zones.some(
        (zone) =>
          zone.anchorParagraphId === context.paragraphId && zone.input.mode !== 'topAndBottom'
      )
    )
      return false;
    pushTextLineDown(line, skip);
    return true;
  };
  const finalizeTopAndBottomClearance = (): void => {
    const line = context.line();
    const zones = context.zones();
    if (zones.length === 0) return;
    const final = topAndBottomSkipBeforeLine(
      context.top(),
      line.height,
      zones,
      context.spaceAbove?.() ?? 0
    );
    // The early skip measured the paragraph mark, not the placed runs. When only full-width
    // bands are in play, the final height decides, so a line that ends up clear stays put.
    const estimateOnly =
      estimatedLine === line && zones.every((zone) => zone.input.mode === 'topAndBottom');
    const skip = estimateOnly ? final : Math.max(final, line.exclusionSkipBefore ?? 0);
    if (skip > 0.001) line.exclusionSkipBefore = skip;
    else delete (line as { exclusionSkipBefore?: number }).exclusionSkipBefore;
  };
  /** The line after a clearing break, and the zones the break clears from those it sees. */
  let breakClear:
    | {
        readonly line: PendingLine;
        readonly select: (zones: readonly ExclusionZone[]) => readonly ExclusionZone[];
      }
    | undefined;
  const clearBreakZones = (line: PendingLine, height: number): void => {
    const zones = breakClear!.select(context.zones());
    const prior = line.exclusionSkipBefore ?? 0;
    const skip = breakClearanceSkip(
      context.top() + prior,
      height,
      zones,
      context.left(),
      context.right
    );
    if (!(skip > 0.001)) return;
    line.exclusionSkipBefore = prior + skip;
    appliedLine = line;
    estimatedLine = undefined;
  };
  /**
   * Open the line after a text wrapping break below the floats it clears (`w:br w:clear`),
   * measured at the paragraph mark's height. {@link commitBreakClearance} checks the band of
   * the height the line takes.
   */
  const applyBreakClearance = (
    select: (zones: readonly ExclusionZone[]) => readonly ExclusionZone[]
  ): void => {
    const line = context.line();
    line.breakClearance = true;
    applyTopAndBottomSkipIfNeeded();
    breakClear = { line, select };
    const metrics = context.measurer.lineMetrics(context.emptyStyle);
    clearBreakZones(
      line,
      applyLineSpacing(context.lineSpacing, metrics.height, metrics.baseline).height
    );
  };
  const commitBreakClearance = (): void => {
    const line = context.line();
    if (breakClear?.line !== line) return;
    clearBreakZones(line, line.height);
    breakClear = undefined;
  };
  const clearEmptyParagraph = (paragraphId: string): void => {
    // An anchor-only paragraph needs a passage for its floating objects' attachment.
    // Its own rectangles clear the mark too, but only inherited clearance moves their origin.
    const line = context.line();
    if (context.holdsContent()) return;
    const zones = context.zones();
    const top = context.top() + (line.exclusionSkipBefore ?? 0);
    const width = context.measurer.measure('¶', context.emptyStyle);
    let inherited = narrowRectangularWrapSkip(
      top,
      line.height,
      zones.filter((zone) => zone.anchorParagraphId !== paragraphId),
      context.left(),
      context.right,
      width
    );
    const skip = narrowRectangularWrapSkip(
      top,
      line.height,
      context.clearOwnEmptyAnchor === false
        ? zones.filter((zone) => zone.anchorParagraphId !== paragraphId)
        : zones,
      context.left(),
      context.right,
      width
    );
    if (skip > 0.001) {
      const ownEnd =
        top +
        inherited +
        narrowRectangularWrapSkip(
          top + inherited,
          line.height,
          zones.filter((zone) => zone.anchorParagraphId === paragraphId),
          context.left(),
          context.right,
          width
        );
      // Clearing an own band cannot jump through an earlier paragraph's blocking band.
      if (
        narrowRectangularWrapSkip(
          ownEnd,
          line.height,
          zones.filter((zone) => zone.anchorParagraphId !== paragraphId),
          context.left(),
          context.right,
          width
        ) > 0.001
      )
        inherited = skip;
      line.exclusionSkipBefore = (line.exclusionSkipBefore ?? 0) + skip;
      line.anchorClearanceBefore = inherited;
    }
  };
  /**
   * Move an empty paragraph's line below the floats when none leaves a passage beside it for
   * the paragraph mark. A passage keeps the line in place beside the floats.
   */
  const clearBlockedEmptyLine = (): void => {
    const line = context.line();
    if (context.holdsContent()) return;
    // Only floating drawings, from the body or from a header or footer. Empty paragraphs beside
    // a floating table keep their place, whether the table is in the body or in a header or
    // footer.
    const zones = context
      .zones()
      .filter((zone) => zone.sourceKind !== 'table' && zone.furnitureSource?.kind !== 'table');
    if (zones.length === 0) return;
    const top = context.top() + (line.exclusionSkipBefore ?? 0);
    const width = context.measurer.measure('¶', context.emptyStyle);
    const left = context.left();
    const skip = narrowRectangularWrapSkip(top, line.height, zones, left, context.right, width);
    // Like a text line, it keeps its space before below the floats, applied once.
    if (skip > 0.001) pushTextLineDown(line, skip);
  };
  return {
    applyBreakClearance,
    commitBreakClearance,
    clearEmptyParagraph,
    clearBlockedEmptyLine,
    applyTopAndBottomSkipIfNeeded,
    applyNarrowWrapSkipIfNeeded,
    applyInlineObjectSkipIfNeeded,
    applyOpeningSegmentSkipIfNeeded,
    finalizeTopAndBottomClearance,
  };
}

/** Keep prospective metrics separate from the line until the candidate is actually placed. */
export function createLineExclusionProbe(context: {
  line: () => PendingLine;
  top: () => number;
  left: number;
  right: number;
  lineSpacing: ParagraphLineSpacing;
  initialMetrics: ReturnType<TextMeasurer['lineMetrics']>;
}) {
  let candidate = context.initialMetrics;
  let candidateWidth = Infinity;
  let candidatePicture = false;
  const y = () => context.top() + (context.line().exclusionSkipBefore ?? 0) + 0.001;
  const height = () => {
    const line = context.line();
    const baseline = Math.max(line.baseline, candidate.baseline);
    const extent =
      baseline + Math.max(line.height - line.baseline, candidate.height - candidate.baseline);
    const spacing = context.lineSpacing;
    // Modern modes test a band against the line's content only, not a multiple's extra below.
    if (spacing.wrapsContentOnly && spacing.gridPitch === undefined) return extent;
    // An auto multiple above single spacing scales the text band of a picture line, not the
    // picture: the line keeps the picture's box plus the multiple's extra text band.
    if (
      spacing.rule === 'auto' &&
      spacing.value > 240 &&
      spacing.gridPitch === undefined &&
      (candidatePicture || line.drawings.length > 0)
    ) {
      const band = context.initialMetrics.height;
      return Math.max(
        applyLineSpacing(spacing, band, context.initialMetrics.baseline).height,
        extent + band * (spacing.value / 240 - 1)
      );
    }
    return applyLineSpacing(spacing, extent, baseline).height;
  };
  return {
    setMetrics: (
      metrics: ReturnType<TextMeasurer['lineMetrics']>,
      width = Infinity,
      picture = false
    ) => {
      candidate = metrics;
      candidateWidth = width;
      candidatePicture = picture;
    },
    setWidth: (width: number) => {
      candidateWidth = width;
    },
    /** The spaced height the line would take with the candidate placed on it. */
    height,
    intervals: (zones: readonly ExclusionZone[]) =>
      mergeAvailableIntervalsAtY(y(), zones, context.left, context.right, height()),
    relocate: (zones: readonly ExclusionZone[]) =>
      relocateLineForExclusionGrowth(
        context.line(),
        y(),
        height(),
        zones,
        context.left,
        context.right,
        context.lineSpacing,
        candidateWidth
      ),
  };
}
