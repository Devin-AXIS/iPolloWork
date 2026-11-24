import { syncPendingDrawingBaselines, repositionPendingDrawings } from './pending-line-drawings.ts';
import { numericWidthTrace } from './numeric-width-proof.ts';
import { storePendingLines } from './paragraph-break-cache-store.ts';
import {
  paragraphFinalAt,
  rememberHangingPunctuation,
  spaceShrinkMarkAdvance,
} from './paragraph-hanging-punctuation.ts';
import {
  appendColumnBreak,
  appendEquation,
  appendUnsupportedContent,
} from './unsupported-content-flow.ts';
import { besideFloatWidth } from './legacy-inline-beside-float.ts';
import { continuationPiecesWithRules } from './paragraph-continuation-pieces.ts';
import { paragraphOwnAnchorStarts } from './paragraph-own-anchors.ts';
import { cellTabReplayScope, tabClosesLine, tabDestinationForFlow } from './paragraph-tab-flow.ts';
import { growRunBorderLineMetrics } from './run-border-strokes.ts';
import { lineSpacingBand } from './equation-line-spacing.ts';
import {
  clipLineDrawingsAtTop,
  growPendingLineDrawingExtent,
  lineHoldsContent,
  markPendingLineWrapAdvances,
  placeLeadingIgnoredBreaks,
  admittedToNarrowPassage,
} from './pending-line.ts';
import { spaceShrinkWordTail } from './space-shrink-word-tail.ts';
import { graphemeContinuationWidth } from './grapheme-continuation-width.ts';
import { wordFollowsOnlyTabs } from './leading-tab-word.ts';
import { growScriptLineMetrics } from './paragraph-mark-metrics.ts';
import { spacedLine } from './positioned-run-spacing.ts';
import { paragraphMarkStyles } from './paragraph-mark-styles.ts';
import { splitAtSpacedSoundMarks } from './sound-mark-pieces.ts';
import { returnUncoveredHintedText } from './east-asia-hint-coverage.ts';
import { markSyntheticBoldSpans, paragraphSpanMetadata } from './paragraph-span-metadata.ts';
import {
  endsAtHyphenBreak,
  spaceShrinkFit,
  createShrinkProbe,
  opensWithHangingSpace,
  lineEndAt,
  compressLineSpaces,
} from './paragraph-space-shrink.ts';
import { piecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { bidiSourceBoundaries } from './bidi-piece-coalescing.ts';
export {
  paragraphAlignment,
  alignSpans,
  lineAlignmentMeasure,
  type Alignment,
} from './paragraph-alignment.ts';
import { bidiPieces, paragraphIsRtl } from './rtl-paragraph.ts';
import { recordLineWrapPassages } from './line-wrap-passages.ts';
import { wrapBreakSpace } from './wrap-break-space.ts';
import { PAGE_BREAK_CHAR, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  propertiesOfRunContainer as propertiesOf,
  type FieldAwarePiece,
  type FieldPageContext,
  type RunPropertyCascader,
} from './field-projection.ts';
import { DEFAULT_REVISION_DISPLAY_MODE, revisionsVisible } from './revision-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import { cjkChopCutAllowedAt, wordBoundaries } from './cjk-line-break.ts';
import { cjkParagraphBreaks, protectedSeamAfter, protectsSeam } from './cjk-paragraph-breaks.ts';
import { createParagraphCjkOpticalFitter, appendOpticalCjkCandidate } from './cjk-optical-fit.ts';
import {
  compressCjkPieces,
  canHangCjkPunctuation,
  lineLocalBearingRetry,
  cjkSeamNaturalWidths,
  type LineLocalAdvances,
} from './cjk-spacing.ts';
import { lineEndMarksMayHang, resolveCjkTypography } from './cjk-typography.ts';
import {
  automaticTextSpan,
  candidateAutomaticGap,
  justifiedGroupGapSlack,
  piecesMayTakeAutomaticSpacing,
  splitAtAutomaticSpacing,
} from './cjk-automatic-spacing.ts';
import {
  EMPTY_TAB_STOPS,
  tabAdvanceWidth,
  tabStopSpanFields,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import { SINGLE_LINE_SPACING } from './paragraph-style.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import {
  createLineExclusionClearance,
  createLineExclusionProbe,
  exclusionZoneAppliesToLine,
} from './line-exclusion-clearance.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { rangesWithin, type MutableChangeSite } from './field-pieces.ts';
import {
  buildInlineDrawingRecord,
  inlineDrawingVerticalLayout,
  measureInlineDrawing,
} from './drawing-layout.ts';
import {
  remainingWidthAtX,
  snapXToAvailableInterval,
  synthesizeParagraphTopAndBottomZones,
  synthesizeParagraphWrapExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { ScanlineInterval } from './drawing-wrap.ts';
import { createEquationLayouter } from './equation-layout.ts';
import { anchorLineStartsByModelOffset } from './anchor-line-probe.ts';
import * as lineEndSpaces from './line-end-whitespace.ts';
import { chopOversizedWord } from './oversized-word-break.ts';
import {
  breakClearSelector,
  ownParagraphFramedClearZones,
  withOwnClearZones,
  type TextWrappingBreakClear,
} from './text-wrapping-break-clear.ts';
import { canChopPiece, isLayoutOwnedPiece } from './layout-owned-piece.ts';
import { fitTextGroupOf, fitTextGroups, fittedLineOpenDecision } from './fit-text-groups.ts';
import type { WordCarryContext } from './word-carry.ts';
import { carryWordAtOptionalHyphens } from './optional-hyphen-break.ts';
import { measuredWidth, styleCutAtHyphen } from './optional-hyphen-joining.ts';
import { collectLineChangeSites } from './paragraph-change-sites.ts';
import { rebreakForEarlierOwnBands } from './top-and-bottom-earlier-lines.ts';
// Ignore subpixel rounding: a tab that ends exactly at the margin must not wrap.
const OVERFLOW_TOLERANCE_PT = 0.001;
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import { ignoreCellColumnBreaks } from './table-cell-column-breaks.ts';
export type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
export { propertiesOf };
import {
  measureFollowingTabSegment,
  placeableContentSuffixes,
  positionalTabDestination,
} from './paragraph-piece-metrics.ts';

// The pending-line record and its budget/freeze helpers live in pending-line.ts;
// re-exported so every existing import through this module stays stable.
import {
  coalesceIdeographicSpans,
  frozenLine,
  growLineMetrics,
  growLineMetricsForText,
  positionedRunMetrics,
  holdsOnlyPageBreak,
  lineBandText,
  isHeightlessWhitespace,
  onlyLeadingBreaksBefore,
  onlyPageBreaksBefore,
  pendingLineFlowExtent,
  pendingLineFlowExtentAtPlacement,
  type PendingLine,
} from './pending-line.ts';
export {
  coalesceIdeographicSpans,
  frozenLine,
  pendingLineFlowExtent,
  pendingLineFlowExtentAtPlacement,
  type PendingLine,
};

export { indentTwips, MAX_PARAGRAPH_INDENT_TWIPS, paragraphIndent } from './paragraph-indent.ts';

/**
 * Measure and break one paragraph into pending lines at `available` width.
 * Cache hits skip measurement. Span x offsets are paragraph-relative, never page-relative.
 */
export function breakParagraph(
  paragraph: OoxmlNode,
  paragraphId: string,
  indentLeft: number,
  available: number,
  measurer: TextMeasurer,
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  cacheKey: string | null,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  flow?: ParagraphFlowOptions,
  advances: LineLocalAdvances = { preserveColonAdvances: false }
): readonly PendingLine[] {
  const cached = cacheKey !== null && cache ? cache.get(cacheKey) : undefined;
  if (cached) return cached;

  const lineSpacing = flow?.lineSpacing ?? SINGLE_LINE_SPACING;
  // A manual page break in a table cell or a text frame keeps its offset but has no geometry.
  const pageBreaksIgnored =
    flow?.cellAnchorScope?.inTableCell === true || flow?.pageBreaksIgnored === true;

  // Collect deleted ranges during projection: removed content has no visible span.
  const deletedRanges: { start: number; end: number }[] = [];
  // Content a resolved view removed leaves no piece either; its site is collected the same
  // way, for the Simple Markup change bar. Kept content carries its sites on the piece.
  const changeSites: MutableChangeSite[] = [];
  const displayPieces = piecesOfParagraphForDisplay(
    paragraph,
    inheritedRunProperties,
    pageContext,
    cascadeRuns,
    flow?.projectLink,
    flow?.noteMarks,
    flow?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
    deletedRanges,
    flow?.inlineDrawingLayout,
    flow?.themeFonts,
    flow?.projectFieldLink,
    flow?.documentProperties,
    flow?.bodyPageFields ?? false,
    flow?.refFields,
    flow?.revisionAuthorFilter,
    flow?.showFieldCodes,
    flow?.fieldCodeRanges,
    flow?.tocLinkStyleRanges,
    changeSites
  );
  const rawPieces = ignoreCellColumnBreaks(
    displayPieces,
    flow?.cellAnchorScope?.inTableCell === true
  );
  const paragraphProperties = () =>
    propertiesOf(
      'children' in paragraph
        ? paragraph.children.find((child) => child.kind === 'paragraphProperties')
        : undefined
    );
  const paragraphRtl = flow?.paragraphRtl ?? paragraphIsRtl(paragraphProperties());
  const allPieces = fitTextGroups(
    bidiPieces(rawPieces, paragraphRtl, bidiSourceBoundaries(paragraph), pageBreaksIgnored),
    measurer
  );
  const startOffset = Math.max(0, flow?.startOffset ?? 0);
  const carriesSlot = flow?.firstLineAfterLeadingBreaks === true;
  const slotOpen =
    startOffset === 0 || (carriesSlot && onlyPageBreaksBefore(allPieces, startOffset));
  // The first line starts `firstLineOffset` from the paragraph's left indent — right for
  // `w:firstLine`, left (negative) for `w:hanging`. Every later line starts at the indent. A
  // continuation from `startOffset` is no first line, unless only leading breaks precede it.
  // Text after page or column breaks that open the paragraph keeps the first-line indent.
  const indentOpen = slotOpen || onlyLeadingBreaksBefore(allPieces, startOffset);
  const firstLineOffset = indentOpen ? (flow?.firstLineOffset ?? 0) : 0;
  const markerBaselineFloor = slotOpen ? (flow?.firstLineMinimumBaseline ?? 0) : 0;
  const markerAscent = slotOpen ? Math.max(0, flow?.firstLineMarkerAscent ?? 0) : 0;
  const typography =
    flow?.typography ??
    resolveCjkTypography(paragraphProperties(), undefined, flow?.markRunProperties);
  const visiblePieces = splitAtSpacedSoundMarks(
    splitAtAutomaticSpacing(
      returnUncoveredHintedText(
        continuationPiecesWithRules(allPieces, startOffset, flow, available),
        measurer
      ),
      typography,
      measurer
    ),
    measurer
  );
  const { preserveColonAdvances } = advances;
  const pieces = compressCjkPieces(visiblePieces, typography, measurer, advances);
  const automaticSpacing = piecesMayTakeAutomaticSpacing(pieces, typography);
  const seamNaturalWidths = cjkSeamNaturalWidths(pieces, visiblePieces, measurer);
  const placeableSuffixes = placeableContentSuffixes(pieces, pageBreaksIgnored);
  const replayScope = cellTabReplayScope(flow?.cellAnchorScope, rawPieces);
  const endsParagraph = lineEndAt(pieces);
  const paragraphFinal = paragraphFinalAt(pieces);
  const endSpacesAt = lineEndSpaces.paragraphEndSpacesOf(pieces, paragraphRtl, measurer);
  const cjkBreaks = cjkParagraphBreaks(pieces, typography);
  const clusterTail = graphemeContinuationWidth(pieces, measurer, typography);
  const { opticalParagraph, opticalCompression, fitCjkOptically } = createParagraphCjkOpticalFitter(
    allPieces,
    pieces,
    cjkBreaks,
    measurer,
    typography,
    !!flow?.pageExclusionZones?.length,
    preserveColonAdvances,
    flow?.cjkPunctuationFit === true
  );
  const layoutEquation = createEquationLayouter(measurer, flow?.equationCacheToken);
  const equationLayoutOf = (piece: FieldAwarePiece) =>
    piece.equation ? layoutEquation(piece.equation, piece.style, piece.equationLayout) : null;
  if (pieces.length === 0 && flow?.suppressEmptyPlaceholderLine) {
    return [];
  }
  const {
    empty: emptyStyle,
    cascade: cascadeStyle,
    unstyledMark: unstyledMarkStyle,
    lineStart: lineStartStyle,
  } = paragraphMarkStyles(
    flow?.markRunProperties ?? inheritedRunProperties,
    inheritedRunProperties,
    flow?.themeFonts,
    measurer,
    pieces.length > 0
  );
  const rightEdge = indentLeft + available;
  const contentLeft = flow?.contentLeft ?? indentLeft;
  const contentRight = flow?.contentRight ?? rightEdge;
  const contentOriginX = flow?.contentOriginX ?? 0;
  // The right-to-left line's leading (right) indent, from the paragraph's full measure.
  const rtlLeadingIndent = Math.max(0, (flow?.marginExtent?.right ?? rightEdge) - rightEdge);
  const wrapRight = Math.min(contentRight, contentOriginX + rightEdge);
  // A right-to-left line fills a float's passages from the right; see `wrap-break-space.ts`.
  const breakSpace = wrapBreakSpace(paragraphRtl, contentOriginX + indentLeft, available, {
    firstLineOffset,
    contentLeft,
    wrapRight,
    largestTieLeft: flow?.largestWrapTieLeft === true,
  });
  const lines: PendingLine[] = [];
  let previousLineCut = false; // The last line closed inside a word the oversized cut split.
  let alignedTabRight = 0;
  let line: PendingLine = {
    spans: [],
    start: startOffset,
    end: startOffset,
    drawings: [],
    width: 0,
    height: 0,
    baseline: 0,
    leading: 0,
    trailingSpacing: 0,
  };
  const anchorLineTopByModelStart = new Map<number, number>();

  // The break-time wrap synthesis follows the published records (`paragraph-own-anchors.ts`).
  const anchorDisplayMode = flow?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const ownAnchors = paragraphOwnAnchorStarts({
    paragraph,
    drawingLayout: flow?.inlineDrawingLayout,
    startOffset,
    displayMode: anchorDisplayMode,
    revisionAuthorFilter: flow?.revisionAuthorFilter,
  });
  const topAndBottomAnchorStarts = ownAnchors.topAndBottom;
  const wrapAnchorStarts = ownAnchors.wrap;

  const sameParagraphAnchorStarts = [
    ...(flow?.pageExclusionZones ?? [])
      .filter((zone) => zone.anchorParagraphId === paragraphId)
      .map((zone) => zone.anchorModelStart),
    ...topAndBottomAnchorStarts,
    ...wrapAnchorStarts,
  ];

  const numericTrace =
    rawPieces.length === 1 &&
    allPieces.length === 1 &&
    startOffset === 0 &&
    sameParagraphAnchorStarts.length === 0 &&
    deletedRanges.length === 0 &&
    changeSites.length === 0 &&
    !preserveColonAdvances
      ? numericWidthTrace(
          pieces,
          available,
          indentLeft,
          firstLineOffset,
          paragraphRtl,
          flow,
          OVERFLOW_TOLERANCE_PT
        )
      : undefined;

  const anchorLineStartByOffset = anchorLineStartsByModelOffset({
    seamNaturalWidths,
    typography,
    cjkBreaks,
    pieces,
    measurer,
    available,
    firstLineOffset,
    anchorStarts: sameParagraphAnchorStarts,
    equationLayoutOf,
    pageBreaksIgnored,
  });

  for (const start of wrapAnchorStarts) {
    const lineStart = anchorLineStartByOffset.get(start);
    if (lineStart !== undefined) anchorLineTopByModelStart.set(start, lineStart);
  }
  // A paragraph-framed band that crosses lines before its anchor line clears them as well.
  for (const start of flow?.ownBandsFromFirstLine ?? [])
    if (topAndBottomAnchorStarts.has(start)) anchorLineTopByModelStart.set(start, 0);

  const emptyExclusionZones: readonly ExclusionZone[] = Object.freeze([]);
  /** The bands of the paragraph's own top-and-bottom anchors whose lines have opened. */
  const ownTopAndBottomZones = (): readonly ExclusionZone[] =>
    flow?.inlineDrawingLayout && anchorLineTopByModelStart.size > 0
      ? synthesizeParagraphTopAndBottomZones({
          paragraph,
          paragraphId,
          drawingLayout: flow.inlineDrawingLayout,
          contentLeft,
          contentRight,
          // `positionV relativeFrom="paragraph"` measures from above the spacing before.
          paragraphStartY:
            (flow.anchorParagraphStartY ?? flow.paragraphStartY ?? 0) -
            (flow.paragraphSpaceBefore ?? 0),
          anchorLineTopByModelStart,
          anchorCellBox: flow.anchorCellBox,
          cellAnchorScope: flow.cellAnchorScope,
          ...(flow.anchorFrameBase ? { frameBase: flow.anchorFrameBase } : {}),
          displayMode: anchorDisplayMode,
          ...(flow.revisionAuthorFilter ? { revisionAuthorFilter: flow.revisionAuthorFilter } : {}),
        })
      : emptyExclusionZones;
  const activeExclusionZones = (): readonly ExclusionZone[] => {
    if (!flow?.pageExclusionZones?.length && anchorLineTopByModelStart.size === 0)
      return emptyExclusionZones;
    const pageZones =
      flow?.pageExclusionZones?.filter((zone) => {
        if (!exclusionZoneAppliesToLine(zone, paragraphId, line, anchorLineStartByOffset))
          return false;
        // Anchor paragraph uses break-time synthesis; page zones are for inherited bands only.
        if (zone.anchorParagraphId === paragraphId) {
          if (!zone.sourceKind && zone.input.mode === 'topAndBottom') return false;
          if (flow?.anchorCellBox != null) return false;
        }
        return true;
      }) ?? [];
    // A story whose text ignores its anchors' wrap (a header before mode 15) carves nothing.
    const anchorsWrap = flow?.cellAnchorScope?.anchorsWrapText !== false;
    const synthesizedWrap =
      anchorsWrap &&
      flow?.inlineDrawingLayout &&
      flow.anchorCellBox != null &&
      anchorLineTopByModelStart.size > 0
        ? synthesizeParagraphWrapExclusionZones({
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphStartY: flow.paragraphStartY ?? 0,
            anchorLineTopByModelStart,
            anchorCellBox: flow.anchorCellBox,
            cellAnchorScope: flow.cellAnchorScope,
            ...(flow.layoutTextboxStory ? { layoutTextboxStory: flow.layoutTextboxStory } : {}),
            displayMode: anchorDisplayMode,
            ...(flow.revisionAuthorFilter
              ? { revisionAuthorFilter: flow.revisionAuthorFilter }
              : {}),
          })
        : Object.freeze([]);
    const synthesized = anchorsWrap ? ownTopAndBottomZones() : emptyExclusionZones;
    if (!synthesizedWrap.length && !synthesized.length) return breakSpace.zones(pageZones);
    return breakSpace.zones(Object.freeze([...pageZones, ...synthesizedWrap, ...synthesized]));
  };

  // Whether the line being built takes the first-line slot: the first line, or the first
  // after page breaks that open the paragraph when the slot carries past them. Kept as state,
  // so a run of leading breaks costs one check per break line.
  let firstLineOpen = true;
  const opensFirstLine = (): boolean => firstLineOpen;
  const holdsContent = (): boolean => lineHoldsContent(line, pageBreaksIgnored);
  // Where the line being built starts, and how much room it has. Only the first differs.
  const lineOffset = (): number => (opensFirstLine() ? firstLineOffset : 0);
  const lineOrigin = (): number => contentOriginX + indentLeft + lineOffset();
  const baseLineAvailable = (): number => Math.max(1, available - lineOffset());

  // Closed line heights stay fixed. Accumulate in the same order as a full reduction,
  // without rescanning every previous line for each float or drawing placement.
  let closedLineExtent = 0;
  const priorLineExtent = (): number => closedLineExtent;

  const currentLineTopY = (): number => (flow?.paragraphStartY ?? 0) + priorLineExtent();

  const recordTopAndBottomAnchorLineTop = (modelStart: number): void => {
    if (topAndBottomAnchorStarts.has(modelStart)) {
      anchorLineTopByModelStart.set(modelStart, priorLineExtent());
    }
  };
  /**
   * Record the top of each top-and-bottom anchor the probe puts on the line that opens, so the
   * band moves that line before any text on it is placed beside floats at the old height.
   */
  const recordTopAndBottomAnchorsOnOpeningLine = (): void => {
    for (const start of topAndBottomAnchorStarts) {
      if (
        anchorLineStartByOffset.get(start) === line.start &&
        !anchorLineTopByModelStart.has(start)
      )
        anchorLineTopByModelStart.set(start, priorLineExtent());
    }
  };

  const {
    applyTopAndBottomSkipIfNeeded,
    applyNarrowWrapSkipIfNeeded,
    applyInlineObjectSkipIfNeeded,
    applyOpeningSegmentSkipIfNeeded,
    finalizeTopAndBottomClearance,
    clearEmptyParagraph,
    clearBlockedEmptyLine,
    applyBreakClearance,
    commitBreakClearance,
  } = createLineExclusionClearance({
    line: () => line,
    top: currentLineTopY,
    spaceAbove: () => (lines.length === 0 ? (flow?.paragraphSpaceBefore ?? 0) : 0),
    zones: activeExclusionZones,
    left: () => Math.max(breakSpace.left, lineOrigin()),
    right: breakSpace.right,
    clearOwnEmptyAnchor: flow?.anchorCellBox == null,
    emptyStyle: lineStartStyle,
    measurer,
    lineSpacing,
    holdsContent,
    paragraphId,
    ...(flow?.regionBottomY !== undefined ? { regionBottom: flow.regionBottomY } : {}),
  });

  // Own floats placed from the paragraph top, which a clearing break finds wherever the paragraph
  // lands, even before a pass has published them on this page.
  let ownClear: readonly ExclusionZone[] | undefined;
  const ownClearZones = (): readonly ExclusionZone[] =>
    (ownClear ??=
      startOffset > 0 || !flow?.inlineDrawingLayout
        ? []
        : ownParagraphFramedClearZones({
            ...(flow.anchorFrameBase ? { frameBase: flow.anchorFrameBase } : {}),
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphTop:
              (flow.anchorParagraphStartY ?? flow.paragraphStartY ?? 0) -
              (flow.paragraphSpaceBefore ?? 0),
            displayMode: anchorDisplayMode,
            ...(flow.revisionAuthorFilter
              ? { revisionAuthorFilter: flow.revisionAuthorFilter }
              : {}),
          })).filter((zone) =>
      exclusionZoneAppliesToLine(zone, paragraphId, line, anchorLineStartByOffset)
    );
  /** The floats a `w:br w:clear` on the line being built clears, chosen where the pen stands. */
  const breakClearOnLine = (clear: TextWrappingBreakClear) =>
    clear === 'all'
      ? (zones: readonly ExclusionZone[]) =>
          withOwnClearZones(zones, breakSpace.zones(ownClearZones()))
      : breakClearSelector(breakSpace.clearSide(clear), activeExclusionZones(), {
          y: currentLineTopY() + (line.exclusionSkipBefore ?? 0),
          height: line.height,
          left: Math.max(breakSpace.left, lineOrigin()),
          right: breakSpace.right,
          penX: lineOrigin() + line.width,
        });

  // Where the line will actually sit. A band that pushed this line down has already been
  // recorded on it, so probing must ask about the shifted position — probing the unshifted
  // top reports the line as still inside the band it just cleared, which leaves it with no
  // room and strands its first character on a line of its own.
  const exclusionProbe = createLineExclusionProbe({
    line: () => line,
    top: currentLineTopY,
    left: breakSpace.left,
    right: breakSpace.right,
    lineSpacing,
    initialMetrics: measurer.lineMetrics(lineStartStyle),
  });
  const availableIntervals = exclusionProbe.intervals;
  const probeX = createShrinkProbe(activeExclusionZones, availableIntervals, paragraphRtl);

  /**
   * First usable x at or after the pen, with the first-line indent preserved.
   *
   * Word measures a first-line indent from the start of the line's USABLE segment, so an
   * exclusion that swallows the indent's origin moves the indent along with the edge.
   * Snapping alone deleted it: the first line then began flush with every other line of the
   * paragraph, at the float's near edge.
   */
  const penTargetAfterExclusion = (
    currentX: number,
    intervals: readonly ScanlineInterval[]
  ): number | null => {
    const snap = snapXToAvailableInterval(currentX, intervals);
    if (!snap) return null;
    if (snap.x <= currentX + 0.001 || line.width > 0.001 || lineOffset() <= 0) return snap.x;
    const indented = snapXToAvailableInterval(snap.x + lineOffset(), intervals);
    return indented ? indented.x : snap.x;
  };

  const snapLineToAvailableInterval = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return true;
    applyTopAndBottomSkipIfNeeded();
    const shift = exclusionProbe.relocate(zones);
    if (shift === null) return false;
    wordStartWidth += shift;
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    const target = penTargetAfterExclusion(currentX, intervals);
    if (target === null) return false;
    if (target > currentX + 0.001) {
      line.width = target - lineOrigin();
    }
    return true;
  };

  /**
   * Total capacity of the line being built, in `line.width` units: how far the pen may travel
   * from `lineOrigin()`. Callers test `line.width + width` against it, so it MUST stay a
   * capacity; the room ahead of the pen would halve every line beside an exclusion zone.
   */
  const lineAvailable = (): number => {
    const base = baseLineAvailable();
    const zones = activeExclusionZones();
    if (zones.length === 0) return Math.max(base, alignedTabRight - lineOrigin());
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) return 0;
    const intervals = availableIntervals(zones);
    const origin = lineOrigin() + line.width;
    const remaining = remainingWidthAtX(origin, intervals);
    if (remaining <= 0.001) return 0;
    return Math.min(base, line.width + remaining);
  };

  /** Room left ahead of the pen on the current line. */
  const remainingLineWidth = (): number => Math.max(0, lineAvailable() - line.width);

  /** Record the float passages this line aligns inside; see {@link recordLineWrapPassages}. */
  const recordWrapSegment = (): void => {
    const zones = activeExclusionZones();
    if (zones.length > 0)
      recordLineWrapPassages(line, availableIntervals(zones), lineOrigin(), breakSpace);
  };

  const tryAdvanceToNextPassage = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return false;
    // A float anchored in an EARLIER paragraph has no offset in this one to be "past" — its
    // zone applies to every line here. Requiring a same-paragraph anchor left those lines
    // stranded in the first passage: they stopped at the picture's near edge and broke,
    // never resuming in the column beside it.
    const zoneIsOpen = zones.some(
      (zone) => zone.anchorParagraphId !== paragraphId || line.end > zone.anchorModelStart
    );
    if (!zoneIsOpen) return false;
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    let foundCurrent = false;
    for (const interval of intervals) {
      if (!foundCurrent) {
        if (currentX >= interval.start - 0.000_001 && currentX < interval.end - 0.000_001) {
          foundCurrent = true;
        }
        continue;
      }
      if (interval.end - interval.start > 0.001) {
        line.width = interval.start - lineOrigin();
        return true;
      }
    }
    return false;
  };

  const advancePastAnchorExclusionForPlacement = (modelStart: number): void => {
    if (
      sameParagraphAnchorStarts.length === 0 ||
      modelStart < Math.min(...sameParagraphAnchorStarts)
    ) {
      return;
    }
    const zones = activeExclusionZones().filter(
      (zone) => zone.anchorParagraphId === paragraphId && modelStart >= zone.anchorModelStart
    );
    if (zones.length === 0) return;
    applyTopAndBottomSkipIfNeeded();
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    let containingIndex = -1;
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      if (currentX >= interval.start - 0.001 && currentX < interval.end - 0.001) {
        containingIndex = index;
        break;
      }
    }
    // Only move a pen standing INSIDE the picture. Skipping to the next passage whenever one
    // existed emptied the near column of a centred float: every word after the anchor hopped
    // the picture, so the space beside it took one word per line and the rest piled up on the
    // far side. Filling the near passage first, then advancing on overflow, is what Word does.
    if (containingIndex >= 0) return;
    const target = penTargetAfterExclusion(currentX, intervals);
    if (target !== null && target > currentX + 0.001) {
      line.width = target - lineOrigin();
    }
  };

  // A top-and-bottom anchor does not end its line: the text before and after it shares one
  // line, which moves below the band as a whole when the band crosses it.
  const clearTopAndBottomAfterAnchor = (modelStart: number): void => {
    const zones = activeExclusionZones().filter(
      (zone) =>
        zone.input.mode === 'topAndBottom' &&
        zone.anchorParagraphId === paragraphId &&
        modelStart >= zone.anchorModelStart
    );
    if (zones.length > 0) applyTopAndBottomSkipIfNeeded(holdsContent());
  };

  // A line admitted to its passage breaks an oversized segment there instead of moving it.
  const movesOpeningSegment = (width: number): boolean =>
    !admittedToNarrowPassage(pieces, line.start, previousLineCut) &&
    applyOpeningSegmentSkipIfNeeded(width, exclusionProbe.height());

  const ensurePlacementWidth = (width: number, depth = 0): boolean => {
    if (depth > 64) return remainingLineWidth() >= width;
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) {
      if (holdsContent()) {
        closeLine();
        return ensurePlacementWidth(width, depth + 1);
      }
      if (movesOpeningSegment(width)) return ensurePlacementWidth(width, depth + 1);
      return true;
    }
    if (width <= remainingLineWidth() + 0.001) return true;
    if (holdsContent()) {
      if (tryAdvanceToNextPassage() && width <= remainingLineWidth() + 0.001) return true;
      closeLine();
      return ensurePlacementWidth(width, depth + 1);
    }
    // An EMPTY line that cannot hold the word may still have room beside the float. A picture
    // offset a few points from the margin leaves a sliver of a passage in front of it; without
    // this the word was chopped at the character to fill that sliver, one letter per line,
    // while the usable column to its right stayed empty.
    if (tryAdvanceToNextPassage()) return ensurePlacementWidth(width, depth + 1);
    // No passage at this height holds the segment: the line moves down to the first height
    // where one does. Each move clears at least one band, so the recursion makes progress.
    if (movesOpeningSegment(width)) return ensurePlacementWidth(width, depth + 1);
    // Only a segment wider than the clear column remains; it overflows and is broken here.
    return true;
  };

  const { changeSitesOn, claimTrailingChangeSites } = collectLineChangeSites(changeSites);

  /**
   * Where the word being placed started on this line; `-1` when the line has no partial word.
   *
   * A word can span RUNS (`<w:del>which</w:del><w:ins>that</w:ins>`, or a bold prefix), and a
   * run boundary is not a break opportunity: breaking there split a word across two lines.
   */
  let wordStartSpan = -1;
  let wordStartWidth = 0;
  let wordStartEnd = 0;
  /** Line metrics before the word, restored when the word moves. */
  let wordStartMetrics = { height: 0, baseline: 0 };
  /** The last character emitted, which decides whether the NEXT span may open a line. */
  let lastEmitted = '';

  /**
   * Band of the runs that hold this line's placed inline pictures. Under `auto` spacing it is
   * the text band of a line without text: never the paragraph's run cascade or its mark.
   */
  let pictureRunBand: { height: number; baseline: number } | undefined;
  const growLineMetricsForDrawing = (
    style: ResolvedRunStyle,
    measure: ReturnType<typeof measureInlineDrawing>
  ): { extentTopY: number } => {
    const textMetrics = measurer.lineMetrics(style);
    pictureRunBand ??= { height: 0, baseline: 0 };
    growLineMetrics(pictureRunBand, textMetrics);
    const layout = inlineDrawingVerticalLayout(
      textMetrics.baseline,
      line.height || textMetrics.height,
      measure
    );
    if (line.height === 0) {
      line.height = layout.lineHeight;
      line.baseline = layout.baseline;
    } else if (layout.lineHeight > line.height) {
      line.height = layout.lineHeight;
      line.baseline = Math.max(line.baseline, layout.baseline);
    } else {
      line.baseline = Math.max(line.baseline, layout.baseline);
    }
    return { extentTopY: layout.extentTopY };
  };

  const closeLine = (): void => {
    previousLineCut = false; // Only the oversized-word cut sets it again.
    placeLeadingIgnoredBreaks(line, pageBreaksIgnored);
    const empty =
      line.drawings.length === 0 && line.spans.every((span) => isHeightlessWhitespace(span.text));
    const metrics = measurer.lineMetrics(empty ? emptyStyle : cascadeStyle);
    // Baseline of the visible glyph band before mark / spacing. Paint's padding-top is
    // `spaced.baseline - glyphBaseline` (space above); auto extras grow BELOW instead.
    let glyphBaseline = line.baseline;
    if (line.height === 0) {
      line.height = metrics.height;
      line.baseline = metrics.baseline;
      glyphBaseline = metrics.baseline;
    } else {
      glyphBaseline += growScriptLineMetrics(line, unstyledMarkStyle.verticalAlign, measurer);
    }
    // The list marker is painted as furniture, but it sits on THIS line's baseline, so its
    // face reserves space above it like the run the marker is in Word. The descent is the
    // text's alone. Only the paragraph's first line carries a marker.
    const firstLine = opensFirstLine();
    if (firstLine && firstLineOffset !== 0) line.firstLineOffset = firstLineOffset;
    if (firstLine && markerAscent > line.baseline) {
      const raised = markerAscent - line.baseline;
      line.baseline = markerAscent;
      line.height += raised;
      glyphBaseline += raised;
    }
    growRunBorderLineMetrics(line, measurer);
    markSyntheticBoldSpans(line, measurer);
    syncPendingDrawingBaselines(line, pageBreaksIgnored);
    growPendingLineDrawingExtent(line);
    // Apply paragraph line spacing once to the finished box.
    const naturalHeight = line.height;
    // `auto` scales the TEXT band, not a tall inline drawing or equation (ECMA-376
    // 17.3.1.33). A drawing line above single spacing keeps the drawing's box and adds the
    // multiple's extra text band below it. An equation line keeps the equation's extent and
    // adds or loses the multiple's share of its band (`lineSpacingBand`).
    const hasUnscaledInlineExtent =
      line.drawings.length > 0 ||
      line.spans.some((span) => span.equation !== undefined || span.unsupported !== undefined);
    const scalesTextBandOnly = lineSpacing.rule === 'auto' && hasUnscaledInlineExtent;
    const holdsUnscaledPicture =
      scalesTextBandOnly &&
      line.drawings.length > 0 &&
      !line.spans.some((span) => span.equation !== undefined) &&
      lineSpacing.gridPitch === undefined;
    const addsTextBandExtra = holdsUnscaledPicture && lineSpacing.value > 240;
    // Below single spacing the multiple takes its missing text band off the line's top: the
    // line is the picture less that band, never less than the scaled text band.
    const removesTextBand = holdsUnscaledPicture && lineSpacing.value < 240;
    const fallbackBand = pictureRunBand?.height ?? metrics.height;
    const band = scalesTextBandOnly
      ? lineSpacingBand(line, lineSpacing, measurer, fallbackBand, pageBreaksIgnored)
      : undefined;
    const equationBand = band?.equation ? band : undefined;
    const spacingBase = band?.height ?? naturalHeight;
    const bandBaseline = band?.baseline ?? line.baseline;
    const spaced = spacedLine(lineSpacing, spacingBase, bandBaseline, line.spans, measurer);
    if (!scalesTextBandOnly) line.baseline = spaced.baseline;
    else if (equationBand) line.baseline += spaced.baseline - bandBaseline;
    const floored = firstLine && lineSpacing.rule !== 'exact' ? markerBaselineFloor : 0;
    const markerFloor = Math.max(0, floored - line.baseline);
    line.baseline += markerFloor;
    // Space ABOVE the glyph band only (exact baseline placement, not auto/atLeast). Never negative.
    line.leading = Math.max(0, line.baseline - glyphBaseline);
    const textBandExtra = equationBand
      ? spaced.height - spacingBase
      : addsTextBandExtra
        ? Math.max(0, spaced.height - spacingBase)
        : removesTextBand
          ? Math.min(0, spaced.height - spacingBase)
          : 0;
    line.height = scalesTextBandOnly
      ? Math.max(spaced.height, naturalHeight + textBandExtra)
      : spaced.height;
    // A baseline below the shortened line's foot moves up to it, so a picture ends there.
    if (removesTextBand) line.baseline = Math.min(line.baseline, line.height);
    // Like a text line's auto extra, the depth below the drawing may cross the bottom margin.
    const drawingLineTrailing = addsTextBandExtra ? Math.max(0, line.height - naturalHeight) : 0;
    const spacedExtent = equationBand ? line.height : spaced.height;
    line.height += markerFloor;
    // Baseline shifts from line spacing must move inline drawings too, or authored distT/distB
    // and the text baseline drift apart. For `exact`, keep the authored box — tall drawings
    // clip/overflow per content-clip policy; auto/atLeast still grow to contain distB.
    repositionPendingDrawings(line);
    // A picture taller than a shortened line paints only below the line's top.
    if (removesTextBand) clipLineDrawingsAtTop(line);
    if (lineSpacing.rule !== 'exact') growPendingLineDrawingExtent(line);
    line.trailingSpacing =
      line.drawings.length === 0 && lineSpacing.rule !== 'exact'
        ? Math.max(0, Math.min(spaced.trailing ?? Infinity, spacedExtent - naturalHeight))
        : drawingLineTrailing;
    finalizeTopAndBottomClearance();
    commitBreakClearance();
    if (empty && (wrapAnchorStarts.size > 0 || topAndBottomAnchorStarts.size > 0))
      clearEmptyParagraph(paragraphId);
    else if (empty && firstLine) clearBlockedEmptyLine();
    // Mark wrap advances after merging, using the shape paint receives.
    coalesceIdeographicSpans(line);
    markPendingLineWrapAdvances(line);
    const deleted = rangesWithin(deletedRanges, line.start, line.end);
    if (deleted.length > 0) line.deletedRanges = deleted;
    const sites = changeSitesOn(line, line.spans, line.changeSites);
    if (sites.length > 0) line.changeSites = sites;
    recordWrapSegment();
    lines.push(line);
    closedLineExtent = closedLineExtent + line.height + (line.exclusionSkipBefore ?? 0);
    firstLineOpen = false;
    wordStartSpan = -1;
    wordStartWidth = 0;
    alignedTabRight = 0;
    pictureRunBand = undefined;
    line = {
      spans: [],
      drawings: [],
      start: line.end,
      end: line.end,
      width: 0,
      height: 0,
      baseline: 0,
      leading: 0,
      trailingSpacing: 0,
    };
    recordTopAndBottomAnchorsOnOpeningLine();
    applyTopAndBottomSkipIfNeeded();
  };

  /** Whether the last thing placed was a line break, so the paragraph ends on a fresh line. */
  let trailingLineBreak = false;
  /** Whether nothing but ignored page breaks precedes the word being placed on its line. */
  const wordOpensLine = (): boolean => {
    for (let index = 0; index < wordStartSpan; index += 1) {
      if (!pageBreaksIgnored || line.spans[index]!.text !== PAGE_BREAK_CHAR) return false;
    }
    return wordStartSpan >= 0;
  };
  /** Whether the pen snapped past a float after the word's last span, which splits the word. */
  const penLeftWord = (): boolean => {
    if (wordStartSpan < 0 || line.spans.length <= wordStartSpan) return false;
    lineAvailable();
    const last = line.spans[line.spans.length - 1]!;
    return lineOrigin() + line.width > last.box.x + last.box.width + 0.001;
  };
  const wordCarry: WordCarryContext = {
    line: () => line,
    measurer,
    pageBreaksIgnored,
    holdsContent,
    closeLine: () => closeLine(),
    ensurePlacementWidth: (width) => ensurePlacementWidth(width),
    tryAdvanceToNextPassage,
    lineAvailable,
    lineOrigin,
    applyNarrowWrapSkipIfNeeded,
    setProbeWidth: (width) => exclusionProbe.setWidth(width),
  };

  // A remainder re-broken after a clearing break (on a later page, say) opens clear as well.
  recordTopAndBottomAnchorsOnOpeningLine();
  const restartClear =
    startOffset > 0
      ? allPieces.find((p) => p.end === startOffset && p.breakClear)?.breakClear
      : undefined;
  if (restartClear) {
    // A remainder clears only floats its region's page publishes, and floats of other
    // paragraphs. A zone of its own rebuilt from the remainder's top (in a table cell) is not
    // where a float anchored earlier is; one anchored on this line moves with it, so clearing
    // it again on every region would leave the line no region to fit.
    const select = breakClearOnLine(restartClear);
    const placed = new Set(breakSpace.zones(flow?.pageExclusionZones ?? []));
    applyBreakClearance((zones) =>
      select(zones).filter((zone) => zone.anchorParagraphId !== paragraphId || placed.has(zone))
    );
  }
  const shrinkTail = spaceShrinkWordTail(pieces, measurer);
  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex]!;
    if (piece.breakKind === 'column') {
      const opensParagraph: boolean = firstLineOpen && !line.spans.length && !line.drawings.length;
      appendColumnBreak(line, piece, paragraphId, lineOrigin() + line.width, measurer);
      closeLine();
      lines[lines.length - 1]!.columnBreakAfter = true;
      firstLineOpen = opensParagraph;
      // Like a trailing hard break: the paragraph mark after it takes a line in the next column.
      trailingLineBreak = true;
      continue;
    }
    if (piece.unsupported) {
      const unsupported = piece.unsupported;
      const atomWidth = Math.min(unsupported.width, lineAvailable());
      if (unsupported.display === 'block' && holdsContent()) closeLine();
      if (holdsContent() && line.width + atomWidth > lineAvailable()) closeLine();
      exclusionProbe.setMetrics(
        { height: unsupported.height, baseline: unsupported.height },
        atomWidth
      );
      applyInlineObjectSkipIfNeeded(atomWidth, unsupported.height);
      if (!ensurePlacementWidth(atomWidth)) continue;
      appendUnsupportedContent(line, piece, paragraphId, lineOrigin() + line.width, atomWidth);
      wordStartSpan = -1;
      lastEmitted = '';
      if (unsupported.display === 'block') closeLine();
      continue;
    }
    if (piece.equation) {
      const equation = equationLayoutOf(piece)!;
      const atomWidth = equation.geometry.box.width;
      if (holdsContent() && line.width + atomWidth > lineAvailable()) closeLine();
      exclusionProbe.setMetrics(
        {
          height: equation.geometry.box.height,
          baseline: equation.geometry.baseline,
        },
        atomWidth
      );
      applyInlineObjectSkipIfNeeded(atomWidth, equation.geometry.box.height);
      if (!ensurePlacementWidth(atomWidth)) continue;
      appendEquation(line, piece, equation, paragraphId, lineOrigin() + line.width);
      wordStartSpan = -1;
      lastEmitted = '';
      continue;
    }
    if (
      piece.projected &&
      !piece.inlineDrawing &&
      !piece.noteSeparator &&
      piece.text === '\uFFFC'
    ) {
      recordTopAndBottomAnchorLineTop(piece.start);
      // A tracked anchored drawing leaves no span on its anchor line, so the line records the
      // attribution for the margin change bar. A drawing the display mode hides cues no bar.
      if (
        piece.anchoredAtom &&
        piece.revisions !== undefined &&
        revisionsVisible(piece.revisions, anchorDisplayMode, flow?.revisionAuthorFilter)
      ) {
        line.anchorRevisions = [...(line.anchorRevisions ?? []), ...piece.revisions];
      }
      // A resolved view keeps the picture as plain furniture; the line still records the site.
      if (piece.anchoredAtom && piece.changeSites) {
        line.changeSites = [...(line.changeSites ?? []), ...piece.changeSites];
      }
      line.end = piece.end;
      continue;
    }
    if (piece.inlineDrawing) {
      recordTopAndBottomAnchorLineTop(piece.start);
      const measure = measureInlineDrawing(piece.inlineDrawing.projection);
      const atomWidth = measure.totalWidth;
      // A picture that does not fit before a float resumes past it (probed at the line's own
      // metrics: the picture's would move its text), and the text before it stays put.
      let jumps = false;
      if (holdsContent() && line.width + atomWidth > lineAvailable()) {
        const settledWidth = line.width;
        jumps = tryAdvanceToNextPassage() && line.width + atomWidth <= lineAvailable() + 0.001;
        line.width = settledWidth;
        if (!jumps) closeLine();
      }
      exclusionProbe.setMetrics(
        { height: measure.lineContribution, baseline: measure.lineContribution },
        atomWidth,
        true
      );
      const jumpedLine = line;
      // A horizontal rule spans the line wherever it sits, so floats beside it do not move it.
      const rule = !!piece.inlineDrawing.projection.horizontalRule;
      const placeWidth = besideFloatWidth(atomWidth, flow, holdsContent(), activeExclusionZones);
      if (!jumps && !rule) applyInlineObjectSkipIfNeeded(placeWidth, measure.lineContribution);
      if (!rule && !ensurePlacementWidth(placeWidth)) continue;
      if (jumps && line !== jumpedLine) {
        // Placement refused the jump at the picture's own height and closed the line.
        applyInlineObjectSkipIfNeeded(atomWidth, measure.lineContribution);
        if (!ensurePlacementWidth(atomWidth)) continue;
      }
      const { extentTopY } = growLineMetricsForDrawing(piece.style, measure);
      const slotX = lineOrigin() + line.width;
      line.drawings.push(
        buildInlineDrawingRecord({
          input: piece.inlineDrawing,
          paragraphId,
          start: piece.start,
          slotX,
          y: extentTopY,
          baseline: line.baseline,
          contentLeft: contentOriginX,
          contentRight: contentOriginX + rightEdge,
          ...(flow?.deferInlineDrawingHorizontalClip ? { deferHorizontalClip: true } : {}),
          ...(piece.revisions ? { revisions: piece.revisions } : {}),
          ...(piece.style.shaping ? { bidiShaping: piece.style.shaping } : {}),
          layoutTextboxStory: flow?.layoutTextboxStory,
          measurer,
        })
      );
      // A picture a resolved view kept has no span to carry its site; the line takes it.
      if (piece.changeSites) {
        line.changeSites = [...(line.changeSites ?? []), ...piece.changeSites];
      }
      line.width += atomWidth;
      line.end = piece.end;
      wordStartSpan = -1;
      lastEmitted = '';
      continue;
    }
    if (piece.text === PAGE_BREAK_CHAR) {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: PAGE_BREAK_CHAR,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...paragraphSpanMetadata(piece),
      });
      line.end = piece.end;
      if (pageBreaksIgnored || pieces[pieceIndex + 1]?.breakKind === 'line') continue;
      growLineMetrics(line, breakMetrics);
      const slotLine: boolean = firstLineOpen;
      closeLine();
      const closed = lines[lines.length - 1]!;
      closed.pageBreakAfter = true;
      firstLineOpen = slotLine && holdsOnlyPageBreak(closed);
      // NOT `trailingLineBreak`: an empty remainder publishes no line on the page the break
      // opened, so the following block sits at its top (`paragraph-spacing-borders` and
      // `section-aware-pagination` pin it). A click beside the mark resolves BEFORE it.
      trailingLineBreak = flow?.pageBreakMarkOnNextPage === true;
      continue;
    }
    if (piece.text === '\n') {
      if (piece.breakKind === 'line') line.manualBreakAfter = true;
      // A hard break ends the line without ending the paragraph — and it OCCUPIES a model
      // offset. Emitting no span for it meant the text reconstructed from the records was
      // shorter than the model: Select All stopped short and left residue, a copied break
      // came back as a space, and Delete before a trailing break merged the next paragraph
      // instead of removing the break. A zero-width span keeps the two in step.
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: '\n',
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...paragraphSpanMetadata(piece),
      });
      growLineMetrics(line, breakMetrics);
      line.end = piece.end;
      const cleared = piece.breakClear ? breakClearOnLine(piece.breakClear) : undefined;
      closeLine();
      if (cleared) applyBreakClearance(cleared);
      trailingLineBreak = true;
      continue;
    }
    trailingLineBreak = false;
    clearTopAndBottomAfterAnchor(piece.start);
    if (
      sameParagraphAnchorStarts.length > 0 &&
      piece.start >= Math.min(...sameParagraphAnchorStarts)
    ) {
      advancePastAnchorExclusionForPlacement(piece.start);
    }
    // The face this piece MEASURES in. Spans keep `piece.style` — the run's real
    // resolution — plus the slot, and re-resolve through the same helper.
    const faceStyle = styleForFontSlot(piece.style, piece.fontSlot);
    // Layout-owned pieces get no ideographic boundaries: every span publishes the whole
    // piece range, so a per-ideograph split painted dozens of spans claiming one range. An
    // oversized result is cut once per line instead, and checks kinsoku by its own text,
    // because the paragraph table holds a field as one unit.
    const layoutOwned = isLayoutOwnedPiece(piece);
    const canChopWord = canChopPiece(piece);
    const textBreaks = layoutOwned ? null : cjkBreaks;
    let consumed = 0;
    for (const boundary of cjkBreaks?.boundaries(piece) ??
      wordBoundaries(piece.text, !layoutOwned)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      const metrics = measurer.lineMetrics(
        faceStyle,
        lineBandText(piece, displayText(candidate, faceStyle))
      );
      exclusionProbe.setMetrics(positionedRunMetrics(metrics, faceStyle));
      const spanRange = layoutOwned
        ? { paragraphId, start: piece.start, end: piece.end }
        : { paragraphId, start: piece.start + consumed, end: piece.start + boundary };

      if (candidate === '\t') {
        if (
          holdsContent() &&
          tabClosesLine(
            replayScope,
            pageBreaksIgnored,
            !paragraphRtl &&
              !piece.positionalTab &&
              (activeExclusionZones().length === 0 ||
                lineOrigin() + lineAvailable() >= contentOriginX + rightEdge - 0.5),
            tabStops,
            lineOrigin() + line.width,
            rightEdge,
            line.width >= lineAvailable(),
            placeableSuffixes[pieceIndex]![boundary] === 1
          )
        )
          closeLine();
        const currentX = lineOrigin() + line.width;
        // RTL stops use leading-edge coordinates before bidi placement and alignment.
        const leading = paragraphRtl ? rtlLeadingIndent : 0;
        const stopX = paragraphRtl ? leading + lineOffset() + line.width : currentX;
        const stopRight = paragraphRtl ? leading + available : rightEdge;
        const segment = measureFollowingTabSegment(
          pieces,
          pieceIndex,
          boundary,
          measurer,
          pageBreaksIgnored
        );
        // A `w:ptab` states its own destination and leader, so it does NOT consult the
        // paragraph's tab stops — a table-of-contents line authored with one has none.
        // A positional tab whose destination is at or behind the caret cannot advance —
        // a left-aligned one almost never can, and it is also the fallback for a malformed
        // `w:alignment`. Falling back to the ordinary stop rule keeps the glyphs apart
        // instead of reproducing the very run-together text this element exists to prevent.
        const positional = piece.positionalTab
          ? positionalTabDestination(piece.positionalTab, indentLeft, rightEdge, flow?.marginExtent)
          : null;
        // Authored aligned tabs may reach the containing margin beyond the paragraph's
        // right indent. Only their following segment gets that extra room.
        const tabEdge =
          activeExclusionZones().length === 0
            ? Math.max(stopRight, flow?.marginExtent?.right ?? stopRight)
            : stopRight;
        const destination = tabDestinationForFlow(
          tabStops,
          stopX,
          stopRight,
          tabEdge,
          currentX,
          rightEdge,
          positional,
          flow?.leftTabsPastMargin,
          paragraphRtl,
          alignedTabRight
        );
        alignedTabRight = destination.segmentRight;
        const width = tabAdvanceWidth(
          destination.alignment,
          positional === null ? stopX : currentX,
          destination.positionPt,
          segment.width,
          paragraphRtl && positional === null ? segment.rtlDecimalOffset : segment.decimalOffset
        );
        line.spans.push({
          range: spanRange,
          text: '\t',
          props: piece.props,
          style: piece.style,
          box: { x: currentX, y: 0, width, height: metrics.height },
          // The leader and alignment belong to the stop that was REACHED, so they are resolved
          // here with the destination rather than re-derived from the paragraph at paint
          // time — and the leader glyph is MEASURED here too, in this run's own face, because
          // paint has no measurer and a guessed advance cannot space the dots as typing would.
          ...tabStopSpanFields(destination, (glyph) => measurer.measure(glyph, piece.style)),
          ...(piece.link ? { link: piece.link } : {}),
          ...(layoutOwned && !piece.positionalTab ? { projected: true as const } : {}),
          ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
          ...paragraphSpanMetadata(piece),
        });
        line.width += width;
        growLineMetricsForText(line, metrics, '\t', faceStyle);
        line.end = layoutOwned ? piece.end : piece.start + boundary;
        // A tab lets the next word open a line. Clear the previous word so overflow
        // cannot carry it with the tab and replay the old advance from a new origin.
        lastEmitted = '\t';
        consumed = boundary;
        continue;
      }
      // Measured as DRAWN: `w:caps` changes the glyphs, so measuring the source text
      // would size the line for characters the reader never sees. Note marks may reserve
      // a wider measureText (eachPage) while painting the real digits.
      const automaticGap = candidateAutomaticGap(
        automaticSpacing && { line: () => line, lineOrigin, paragraphId, typography, measurer },
        piece,
        faceStyle,
        candidate,
        spanRange.start
      );
      const measureSource = piece.measureText ?? candidate;
      let width = piece.noteSeparator
        ? Math.min(piece.noteSeparator === 'separator' ? 144 : lineAvailable(), lineAvailable())
        : piece.fieldAtom?.formControl?.kind === 'checkbox'
          ? faceStyle.fontSizePt
          : measurer.measure(displayText(measureSource, faceStyle), faceStyle);
      exclusionProbe.setWidth(width);
      // The anchor probe and placement use the same paragraph-wide break decision.
      const openDecision =
        piece.noteSeparator || line.spans.at(-1)?.noteSeparator
          ? 'opens'
          : fittedLineOpenDecision(piece, consumed, lastEmitted, candidate, cjkBreaks);
      const opensWord = openDecision === 'opens';
      if (opensWord) {
        wordStartSpan = line.spans.length;
        wordStartWidth = line.width;
        wordStartEnd = line.end;
        wordStartMetrics = { height: line.height, baseline: line.baseline };
      }
      advancePastAnchorExclusionForPlacement(piece.start + consumed);
      applyNarrowWrapSkipIfNeeded(candidate, faceStyle);
      // A space belongs to a following protected group even across a source-run seam.
      const groupContinues = () =>
        protectedSeamAfter(cjkBreaks, pieces, pieceIndex, boundary, candidate);
      const protectedEnd =
        opticalParagraph && !sameParagraphAnchorStarts.length && groupContinues();
      const endSpaces = endSpacesAt(pieceIndex, boundary, candidate, lineAvailable());
      // Spaces that take room still hang where they would not fit even on a fresh line.
      const keepsEnd =
        protectedEnd ||
        fitTextGroupOf(piece) !== undefined ||
        (endSpaces.takesRoom && line.width + width <= lineAvailable() + 0.001);
      const clipsWordEnd = !layoutOwned && piece.measureText === undefined && !keepsEnd;
      const naturalWidth = width;
      const measureFace = (text: string) =>
        measurer.measure(displayText(text, faceStyle), faceStyle);
      // Against the line the word lands on: it may move before it is placed.
      const clipWordEndAtPen = () =>
        clipsWordEnd
          ? lineEndSpaces.clipWordEnd(
              candidate,
              naturalWidth,
              lineAvailable() - line.width - automaticGap(),
              measureFace,
              OVERFLOW_TOLERANCE_PT
            )
          : undefined;
      let clippedWordEnd = clipWordEndAtPen();
      width = clippedWordEnd?.width ?? width;
      const ends = paragraphFinal(pieceIndex, boundary);
      const hangsAtLineEnd = (text = candidate, textWidth = width) =>
        lineEndMarksMayHang(typography, line.spans, measurer) &&
        canHangCjkPunctuation(text, piece, lineAvailable() - line.width, textWidth, measurer, {
          paragraphFinal: ends,
          policy: typography,
        });
      let hangs = hangsAtLineEnd();
      const applyOpticalFit =
        opticalCompression && sameParagraphAnchorStarts.length === 0
          ? () => {
              const fit = fitCjkOptically(
                line,
                pieceIndex,
                candidate,
                spanRange,
                width,
                lineOrigin() + line.width,
                // Reserve the source-owned advance before any optical line mutation.
                lineAvailable() - automaticGap(),
                !lineEndSpaces.isCollapsibleLineEndWhitespace(candidate) ||
                  (opensWord && placeableSuffixes[pieceIndex]![boundary] === 1)
              );
              if (fit) {
                width = fit.width;
                if (wordStartSpan >= 0 && fit.spanStarts) {
                  wordStartSpan = fit.spanStarts[wordStartSpan]!;
                  wordStartWidth =
                    wordStartSpan < line.spans.length
                      ? line.spans[wordStartSpan]!.box.x - lineOrigin()
                      : line.width;
                }
              }
              return fit;
            }
          : undefined;
      const opticalSourceLine = line;
      let opticalFit = applyOpticalFit?.();
      // A fit may compress the line so that its final mark hangs past the margin.
      if (opticalFit?.hangs) hangs = true;
      // Hang overflowing space runs on this line, preserving text/ranges and authored leading spaces.
      const lineEndWhitespace =
        !keepsEnd &&
        lineEndSpaces.isCollapsibleLineEndWhitespace(candidate) &&
        ((placeableSuffixes[pieceIndex]![boundary] !== 1 &&
          !(
            pageBreaksIgnored &&
            consumed === 0 &&
            lineEndSpaces.endsWordAcrossIgnoredBreaks(pieces, pieceIndex, candidate, lastEmitted)
          )) ||
          (!layoutOwned &&
            holdsContent() &&
            line.width + width > lineAvailable() + OVERFLOW_TOLERANCE_PT));
      if (lineEndWhitespace) {
        width = Math.min(width, Math.max(0, lineAvailable() - line.width));
      }
      // A bearing shared across a line break is lost, so fit at the natural advance.
      const baseFitWidth = opticalFit ? width : (seamNaturalWidths.get(piece) ?? width);
      // An optical fit already holds the rest of its group, a cluster tail in the next run too.
      const followingCluster = opticalFit ? 0 : (clusterTail?.(pieceIndex, boundary) ?? 0);
      const fitWidth =
        baseFitWidth + followingCluster + automaticGap() + (lineEndWhitespace ? 0 : endSpaces.room);
      const pastMargin = line.width + fitWidth > lineAvailable() + OVERFLOW_TOLERANCE_PT;
      // A justified line shrinks its spaces before a half-width final mark hangs. Only a word
      // past the margin needs the mark's advance.
      const shrinkMark =
        flow?.spaceShrink && !opticalFit && pastMargin
          ? spaceShrinkMarkAdvance(candidate, piece, measurer, typography, ends)
          : 0;
      let overflows =
        (!hangs || shrinkMark > 0) &&
        // A space after a word that borrowed inter-word space hangs on its line.
        !(lineEndWhitespace && flow?.spaceShrink) &&
        pastMargin;
      const followingWidth =
        overflows && flow?.spaceShrink ? shrinkTail(pieceIndex, boundary) : undefined;
      const shrinkFit =
        overflows &&
        flow?.spaceShrink !== undefined &&
        // A word split across runs still borrows from the span where the word began.
        (opensWord || (openDecision === 'continues' && wordStartSpan > 0)) &&
        // Text after a right, center or decimal tab is placed against its stop, not justified.
        alignedTabRight === 0 &&
        line.drawings.length === 0 &&
        !(flow.spaceShrink.everyAlignment && line.compressesSpaces) &&
        (placeableSuffixes[pieceIndex]![boundary] === 1 || endsParagraph(pieceIndex, boundary)) &&
        spaceShrinkFit(
          line.spans,
          measurer,
          {
            text: candidate,
            style: faceStyle,
            lineWidth: line.width + automaticGap(),
            available: lineAvailable(),
            wordStart: opensWord ? line.spans.length : wordStartSpan,
            wordStartWidth: opensWord ? line.width : wordStartWidth,
            wordEnds:
              followingWidth !== undefined ||
              endsParagraph(pieceIndex, boundary) ||
              (boundary < piece.text.length
                ? !layoutOwned && (piece.text[boundary] === ' ' || endsAtHyphenBreak(candidate))
                : opensWithHangingSpace(pieces[pieceIndex + 1])),
            followingWidth: followingWidth ?? 0,
            passageStart: probeX(lineOrigin() + line.width),
            hangingMarkAdvance: shrinkMark,
          },
          flow.spaceShrink
        );
      // The spaces make room for the mark, or it hangs beside spaces at their floor.
      if (shrinkMark > 0 && overflows)
        if (shrinkFit) hangs = shrinkFit === 'hangs';
        else if (hangs) overflows = false;
      const borrowsSpace = shrinkFit !== false;
      // Leading tabs define the opening word's remaining measure. Chop the word
      // there instead of closing a line that contains only those tabs.
      const chopsAfterLeadingTabs =
        overflows &&
        canChopWord &&
        !paragraphRtl &&
        alignedTabRight === 0 &&
        !flow?.pageExclusionZones?.length &&
        sameParagraphAnchorStarts.length === 0 &&
        wordFollowsOnlyTabs(line, wordStartSpan);
      if (
        (!opensWord && penLeftWord()) ||
        (overflows && !borrowsSpace && holdsContent() && !chopsAfterLeadingTabs)
      ) {
        // Trailing spaces hang at a line end, so only the word's ink needs room where it goes.
        const inkWidth =
          clipsWordEnd && !opticalFit
            ? lineEndSpaces.wordInkWidth(candidate, measureFace)
            : undefined;
        const placeWidth = () => (inkWidth ?? baseFitWidth) + automaticGap();
        if (protectsSeam(openDecision) && (wordStartSpan < 0 || wordOpensLine())) {
          // The group opens this line, so it is wider than the line: the chop below cuts it at
          // its last fitting character, a kinsoku seam too. A `forbidden` seam stays here.
        } else if (opensWord || wordStartSpan < 0) {
          if (tryAdvanceToNextPassage() && line.width + placeWidth() <= lineAvailable() + 0.001) {
            // carry on in the next horizontal passage on this line
          } else {
            closeLine();
            if (!ensurePlacementWidth(placeWidth())) continue;
            wordStartSpan = 0;
            wordStartWidth = 0;
            wordStartEnd = line.end;
            wordStartMetrics = { height: line.height, baseline: line.baseline };
          }
        } else {
          // Mid-word overflow: a run boundary is not a break opportunity, so the whole word
          // moves to where the same text in one run would go, unless an optional hyphen fits.
          const start = carryWordAtOptionalHyphens(
            wordCarry,
            { span: wordStartSpan, width: wordStartWidth, end: wordStartEnd, ...wordStartMetrics },
            placeWidth(),
            overflows,
            OVERFLOW_TOLERANCE_PT
          );
          wordStartSpan = start.span;
          wordStartWidth = start.width;
          wordStartEnd = start.end;
          wordStartMetrics = { height: start.height, baseline: start.baseline };
        }
        if (inkWidth !== undefined) {
          clippedWordEnd = clipWordEndAtPen();
          width = clippedWordEnd?.width ?? naturalWidth;
        }
      } else if (!holdsContent() && fitWidth > remainingLineWidth() + 0.001) {
        // The pen of an empty line may already stand in a later passage: the test above is
        // the room ahead of it, not the line's capacity from its origin.
        if (!ensurePlacementWidth(fitWidth)) continue;
      } else if (borrowsSpace) {
        line.borrowedSpace = true;
        if (flow?.spaceShrink?.everyAlignment) {
          const start = opensWord ? line.spans.length : wordStartSpan;
          const gained = compressLineSpaces(line, start, measurer, flow.spaceShrink.floor!);
          if (!opensWord) wordStartWidth += gained;
        }
        // Only this admission may compress the paragraph's last line when it is aligned.
        if (endsParagraph(pieceIndex, boundary)) line.spaceShrink = true;
      }
      // Overflow can close the previous line after the clearance check above.
      // Recheck the newly opened line before placing this candidate, including
      // floats that intersect its lower glyph band but not its top scanline.
      applyNarrowWrapSkipIfNeeded(candidate, faceStyle);
      // A protected group that moves must also fit against its destination line.
      if (!opticalFit && line !== opticalSourceLine) opticalFit = applyOpticalFit?.();
      if (opticalFit?.hangs || (line !== opticalSourceLine && hangsAtLineEnd())) hangs = true;
      // A word opening the line after a break at an optional hyphen no longer joins back
      // across it, so it is placed, and may be cut, at its unjoined width.
      const lineStartStyle =
        consumed === 0 && line.spans.length === 0 && !clippedWordEnd
          ? styleCutAtHyphen(piece.style, 'before')
          : null;
      if (lineStartStyle)
        width = measuredWidth(candidate, lineStartStyle, piece.fontSlot, measurer);
      let remaining = candidate;
      let remainingStart = piece.start + consumed;
      let remainingWidth = width;
      let remainingStyle = lineStartStyle ?? piece.style;
      if (
        canChopWord &&
        !hangs &&
        (!holdsContent() || (!opensWord && wordOpensLine()) || chopsAfterLeadingTabs) &&
        width + followingCluster + automaticGap() >
          remainingLineWidth() +
            OVERFLOW_TOLERANCE_PT +
            // The whole group is on the line once its last candidate arrives.
            (openDecision === 'kinsoku' && flow?.cjkPunctuationFit && !groupContinues()
              ? justifiedGroupGapSlack(line.spans, automaticGap())
              : 0)
      ) {
        // Only the cut word's first piece opens the line after a hyphen break.
        let opening = lineStartStyle;
        const prefixFace = () => (opening ? styleForFontSlot(opening, piece.fontSlot) : faceStyle);
        const chopped = chopOversizedWord(candidate, remainingStart, width, {
          // The automatic gap before the first fragment takes room on its line too.
          remainingLineWidth: () => remainingLineWidth() - automaticGap(),
          lineHasText: holdsContent,
          measureText: (text) => measurer.measure(displayText(text, prefixFace()), prefixFace()),
          appendPrefix: (prefix) => {
            const gap = automaticGap(prefix.text, prefix.modelStart);
            line.width += gap;
            const metrics = measurer.lineMetrics(faceStyle, displayText(prefix.text, faceStyle));
            line.spans.push(
              automaticTextSpan(
                piece,
                layoutOwned
                  ? spanRange
                  : {
                      paragraphId,
                      start: prefix.modelStart,
                      end: prefix.modelStart + prefix.text.length,
                    },
                prefix.text,
                opening ?? piece.style,
                lineOrigin() + line.width,
                prefix.width,
                metrics.height,
                gap,
                layoutOwned
              )
            );
            line.width += prefix.width;
            growLineMetricsForText(line, metrics, prefix.text, faceStyle);
            line.end = layoutOwned ? piece.end : prefix.modelStart + prefix.text.length;
            opening = null;
          },
          closeLine,
          // A line the cut closes ends inside the word, so the next line continues it.
          closeCutLine: () => {
            closeLine();
            previousLineCut = true;
          },
          overflowTolerancePt: OVERFLOW_TOLERANCE_PT,
          onWidthComparison: numericTrace?.observe,
          followingWidth: followingCluster,
          keepWithPrevious: openDecision === 'forbidden',
          // Kinsoku vetoes measured cuts: 天。地。人。 must not chop onto a leading 。.
          cutAllowedAt: textBreaks
            ? (_text, index) => textBreaks.cutAllowed(piece, consumed, index)
            : cjkChopCutAllowedAt,
          finalMarkHangs: hangsAtLineEnd,
        });
        if (chopped.finalMarkHangs) hangs = true;
        remaining = chopped.text;
        remainingStart = chopped.modelStart;
        remainingWidth = chopped.width;
        remainingStyle = opening ?? piece.style;
        if (chopped.brokeLine) {
          wordStartSpan = 0;
          wordStartWidth = 0;
          wordStartEnd = line.end;
          wordStartMetrics = { height: line.height, baseline: line.baseline };
        }
      }
      // The chop leaves its final protected group pending, including oversized groups
      // whose next run may start with another closing character or combining mark.
      if (remaining.length > 0) {
        const metrics = measurer.lineMetrics(
          faceStyle,
          lineBandText(piece, displayText(remaining, faceStyle))
        );
        if (consumed > 0 && line.spans.length > 0 && line.end === remainingStart)
          line.width += lineEndSpaces.spaceKern(lastEmitted, remaining, faceStyle, measureFace);
        const gap = automaticGap(remaining, remainingStart);
        line.width += gap;
        const span: StyleSpanRecord = automaticTextSpan(
          piece,
          layoutOwned
            ? spanRange
            : { paragraphId, start: remainingStart, end: piece.start + boundary },
          remaining,
          remainingStyle,
          lineOrigin() + line.width,
          remainingWidth,
          metrics.height,
          gap,
          layoutOwned && !piece.positionalTab,
          lineEndWhitespace
        );
        rememberHangingPunctuation(line, span, piece, measurer, hangs, lineAvailable(), flow);
        if (opticalFit) appendOpticalCjkCandidate(line.spans, span, opticalFit);
        else lineEndSpaces.appendWordEnd(line.spans, span, clippedWordEnd);
        line.width += remainingWidth;
        growLineMetricsForText(line, metrics, remaining, faceStyle);
        line.end = layoutOwned ? piece.end : piece.start + boundary;
      }
      lastEmitted = candidate;
      consumed = boundary;
    }
  }
  // Retain the final line for the caret and paragraph mark; wraps do not inherit mark metrics.
  if (line.spans.length > 0 || line.drawings.length > 0 || lines.length === 0 || trailingLineBreak)
    closeLine();
  // A shared punctuation bearing holds only on one line: retry with natural advances.
  const retry = lineLocalBearingRetry(lines, advances);
  if (retry)
    return breakParagraph(
      paragraph,
      paragraphId,
      indentLeft,
      available,
      measurer,
      cache,
      cacheKey,
      inheritedRunProperties,
      tabStops,
      pageContext,
      cascadeRuns,
      flow,
      retry
    );
  // Only a band that wraps text moves lines: a story that ignores its anchors' wrap has none.
  const settled =
    flow?.ownBandsFromFirstLine === undefined &&
    ownAnchors.paragraphFramedTopAndBottom.size > 0 &&
    flow?.cellAnchorScope?.anchorsWrapText !== false
      ? rebreakForEarlierOwnBands({
          lines,
          zones: ownTopAndBottomZones(),
          starts: ownAnchors.paragraphFramedTopAndBottom,
          flow,
          rebreak: (rebreakFlow) =>
            breakParagraph(
              paragraph,
              paragraphId,
              indentLeft,
              available,
              measurer,
              undefined,
              null,
              inheritedRunProperties,
              tabStops,
              pageContext,
              cascadeRuns,
              rebreakFlow,
              advances
            ),
        })
      : null;
  if (!settled) claimTrailingChangeSites(lines);
  const result = settled ?? lines;
  if (!settled) numericTrace?.finish(result);
  storePendingLines(cache, cacheKey, result);
  return result;
}
