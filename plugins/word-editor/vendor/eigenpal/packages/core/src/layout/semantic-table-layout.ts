import { withStoryLineGrid } from './line-grid.ts';
import { cellEdgeNeighbours } from './cell-edge-neighbours.ts';
import { listLayoutToken } from './list-marker-reuse.ts';
import { reuseParagraphAtWidth } from './paragraph-cache-width-reuse.ts';
import { cellParagraphInputs, cellParagraphBreakInputs } from './cell-paragraph-inputs.ts';
import { adjustedBreakIndex, paragraphKeeps } from './pagination-keeps.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import {
  endRowInsets,
  exactOpeningExtensionPt,
  exactTerminalBorderPt,
} from './table-exact-terminal-border.ts';
import { cellContextualSpacing, contextualCellNeighbours } from './contextual-paragraph-spacing.ts';
import { emitNestedTable } from './nested-table-layout.ts';
import { alignCellContent, createCellFloats, withCellFloatBox } from './cell-float-tables.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { paragraphBoxOutdent } from './paragraph-indent.ts';
import { lineContentX, pendingLineExclusionSkipAtPlacement } from './pending-line.ts';
import { emptyParagraphStyleFields } from './empty-paragraph-style.ts';
// Table row and cell layout over the canonical tree.
//
// Row, cell, and nested-table flow operate on typed tree nodes with the injected
// TextMeasurer and emit semantic records:
//
//   - a row is laid out in TWO PASSES — every cell flows into a buffer while the tallest
//     bottom is tracked, then every cell box is emitted at the final row height;
//   - a vMerge continuation emits its box but no content, so text is never duplicated;
//   - after all rows of a fragment are placed, vertical merges expand the restart box,
//     vAlign shifts content, and collapsed borders resolve onto layout-owned edges;
//   - top-level table rows paginate with a real-height preflight: an unsplit row that does
//     not fit moves to the next page; a row taller than a fresh page fragments at
//     paragraph/line boundaries (a w:cantSplit row first moves to a fresh page), or fails
//     closed under hRule=exact / unsupported nested cuts;
//   - nested tables retain their own geometry and continue at row boundaries, also inside a
//     vertical merge, or inside a row; a nested table with repeated headers stays whole while
//     a page can hold it.
//
// All coordinates are points, relative to the page content box — exactly the space body
// paragraph fragments already live in. Cell paragraph breaks go through the shared
// `breakParagraph`, so they hit the same cache with keys at the cell's content width.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { withoutAnchorSinks } from './table-probe-deps.ts';
export { layoutOnePassRow, measureRowHeight } from './table-row-probes.ts';
import {
  clipInlineDrawingRecordToRegion,
  shiftInlineDrawingRecord,
  type AnchoredDrawingRecord,
  type DrawingAnchorFrameContext,
} from './drawing-layout.ts';
import { authoredRowFields } from './table-row-record-fields.ts';
import {
  exactSpacingExtensionPt,
  rowOpeningGapPt,
  cellSpacingGeometry,
  spacedCellBox,
  closingCellSpacingPt,
  sumCols,
} from './table-cell-spacing.ts';
import { cellLineFits, clipsExactCellRow, rowFlowBounds } from './table-cell-paragraph-options.ts';
import { exclusionLayoutToken } from './drawing-exclusion.ts';
import type {
  FieldLinkProjector,
  FieldPageContext,
  HyperlinkProjector,
} from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import { cellBreakKeyInputs, cellBreakKeyParts } from './cell-break-key.ts';
import { rememberCellLine } from './table-row-geometry-reuse.ts';
import { alignCellLine } from './cell-line-alignment.ts';
import {
  inlinePictureClip,
  withInlinePictureRoom,
  type InlinePictureRoom,
} from './drawing-page-clip.ts';
import {
  cellParagraphLines,
  zonesReachingCellParagraph,
  type HeldCellBreak,
} from './cell-continuation-lines.ts';
import {
  continuedCellCursor,
  initialCellCursor,
  initialCellCursors,
  placesOversizedLine,
  unplacedHeldBreak,
  type CellPlaceCursor,
} from './table-cell-cursor.ts';
export { initialCellCursors, type CellPlaceCursor } from './table-cell-cursor.ts';
import { type PendingLine } from './paragraph-flow.ts';
import { mergeBoundariesOf, remapMergedLines } from './merged-paragraph-ranges.ts';
import { resolvedParagraphMarkChangeSites } from './revision-formatting-projection.ts';
import { paragraphMergeGroupOf } from './story-roots.ts';
import { cellHidesEndMark, cellTerminatorCollapses } from './table-cell-terminator.ts';
import {
  cellTextAreas,
  rowDepsForAnchors,
  type DeferredRowAnchor,
} from './table-anchor-republish.ts';
import {
  markRevisionFields,
  paragraphMarkMarkupVisible,
  visibleParagraphMarkRevisionsOf,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import {
  collapsedSpaceBefore,
  paragraphBorderExtentPt,
  paragraphBorderStrokeWidthPt,
} from './paragraph-style.ts';
import { cellAutoSpacing } from './table-cell-edge-spacing.ts';
import {
  positionedParagraphExclusionToken,
  breakPreparedParagraphLazily,
} from './paragraph-break-request.ts';
import type { CellParagraphPlacementOptions } from './table-cell-paragraph-options.ts';
import { cellReservedMarkHeights } from './table-cell-end-mark.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';
import { type StyleCascadeTable, type TableCellStyleFormatting } from './style-cascade.ts';
import { cellBorderContinuation, paragraphBorderGroupKey } from './cell-border-groups.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import {
  type SemanticTableCell,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphBorderStrokeRecord,
  ParagraphBottomBorderRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
  LayoutBox,
} from './semantic-records.ts';
import { type ResolvedListItem } from './list-resolve.ts';
import {
  directionalListFirstLineShift,
  listMarkerAlignShift,
  listMarkerLineOffset,
  listMarkerFirstLineMetrics,
  publishListMarker,
} from './list-marker.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import { cellListItem } from './cell-list-marker.ts';
import { type TableBorderOwnershipBudget } from './table-borders.ts';
import { type TableVMergeResolveBudget } from './table-vmerge.ts';
import { type CellContentInsets } from './table-cell-geometry.ts';
import { authoredRowMinimumFloorPt, type RowMinimumInsetMap } from './table-row-minimum-insets.ts';
import {
  cellFlowBox,
  layOutWaitingBottomToTopCells,
  rememberBottomToTopRelayouts,
  waitsForRowHeight,
} from './table-cell-text-direction.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { cellAnchorFlow, cellAnchorScope } from './cell-anchor-layout.ts';
import { cellBottomWithAnchors, publishCellParagraphAnchors } from './cell-paragraph-anchors.ts';
import { cellAnchorPageFit } from './cell-paragraph-anchors.ts';
export { finalizeTableRows } from './table-fragment-finalize.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { inlineDrawingFlow } from './inline-textbox-flow.ts';
import {
  cellAlignmentRoom,
  cellAlignmentShift,
  cellParagraphFirstTop,
} from './table-row-vertical.ts';

export {
  createTableBorderOwnershipBudget,
  MAX_BORDER_OWNERSHIP_INTERVALS,
} from './table-borders.ts';

export { paragraphDocumentOrderOf } from './paragraph-document-order.ts';

export {
  createTableVMergeResolveBudget,
  MAX_VMERGE_RESOLVE_CELLS,
  type TableVMergeResolveBudget,
} from './table-vmerge.ts';

/** Soft ceiling on fragments emitted for one authored row (hostile / runaway splits). */
export const MAX_TABLE_ROW_FRAGMENTS = 4096;

/** A cell box never narrows below this, however wide a `w:tblCellSpacing` gap is stated. */
export const MIN_CELL_BOX_PT = 1;

export { TablePaginationError, type TablePaginationErrorCode } from './table-pagination-error.ts';

/** Coupled text-box layout and cache invalidation for a hosted-story table flow lane. */
export interface HostedStoryFlowDeps {
  readonly layoutTextboxStoryFor: import('./inline-textbox-flow.ts').TextboxStoryLayouter;
  readonly hostedListTokenForParagraph: ((paragraph: OoxmlNode) => string) | null;
}

export interface TableFlowDeps {
  /** Layout-only outer extent; the authored content and clip heights remain unchanged. */
  readonly exactTerminalBorder?: { readonly row: SemanticTableRow; readonly widthPt: number };
  /** Height an exact row gains above its authored box when it opens a continuation fragment. */
  readonly exactOpeningExtension?: { readonly row: SemanticTableRow; readonly pt: number };
  /** The current row already has the full page band (possibly below repeated headers). */
  readonly rowAtPageStart?: boolean;
  /** A spaced table's row below its first opens a fragment the table continues in. */
  readonly opensTableBreak?: true;
  readonly paragraphLineUnitPt?: number;
  /** Story paragraphs outside cells snap to `paragraphLineUnitPt`; see {@link withStoryLineGrid}. */
  readonly snapsStoryLines?: true;
  /** A header or footer story keeps its last automatic space after; cells and frames drop it. */
  readonly keepsStoryEndAutoSpacing?: true;
  /** Whether a positioned table of this story carries `w:tblOverlap w:val="never"`. */
  readonly floatRefusesOverlap?: (tableId: string) => boolean;
  readonly measurer: TextMeasurer;
  /** Layout-only insets for one repeated-header/body occurrence. */
  readonly cellContentInsets?: ReadonlyMap<string, CellContentInsets>;
  /** Occurrence-specific row-minimum clearance, separate from a vMerge content span. */
  readonly cellMinimumContentInsets?: RowMinimumInsetMap;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]> | undefined;
  readonly producer: string;
  /** Produces a stable id from the paragraph-local line identity. */
  readonly nextLineId: (
    paragraphId: string,
    start: number,
    lineIndex: number,
    occurrence?: string
  ) => string;
  /** Stable visual occurrence for repeated header rows on the current page. */
  readonly pageOccurrenceKey?: () => string;
  readonly styleCascade?: StyleCascadeTable;
  /** Body tables' lead paragraphs by first row id, and the row being placed's cell edges. */
  readonly tableTopLeads?: ReadonlyMap<string, import('./cell-edge-neighbours.ts').EdgeNeighbour>;
  readonly cellEdges?: ReadonlyMap<string, import('./cell-edge-neighbours.ts').CellEdgeNeighbours>;
  /** When set (header/footer page projection), PAGE/NUMPAGES resolve against this context. */
  readonly pageContext?: FieldPageContext;
  /** Derived footnote/endnote marks for noteReference / noteRef projection. */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /**
   * Precomputed body-story list items (including cell paragraphs). Absent for header/footer
   * stories that do not share the body counter stream.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /** Text-box story layout and its host break-key invalidation, structurally inseparable. */
  readonly hostedStory?: HostedStoryFlowDeps;
  /**
   * `w:settings/w:defaultTabStop` in points; absent keeps the 0.5" schema default. A cell
   * paragraph tabs on the same document-wide grid as a body paragraph.
   */
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
  /** False in a header or footer before mode 15; see `CellAnchorScope.anchorsWrapText`. */
  readonly anchorsWrapText?: boolean;
  readonly outOfCellFloatParagraphs?: ReadonlySet<string>; // see table-out-of-cell-floats.ts
  /** Story boxes start their first table at traversal depth one. */
  readonly tableNestingOffset?: 1;
  /** The story is a text box's content. */
  readonly textBoxStory?: true;
  /** The cell content belongs to a fixed-layout table (`nestedAutofitStructure`). */
  readonly parentTableFixed?: true | undefined;
  /**
   * Turns a typed `w:hyperlink` into the sanitized record its spans carry. A link in a
   * table cell is an ordinary link; without this it would paint its text and be dead.
   */
  readonly projectLink?: HyperlinkProjector;
  /** Same seam for HYPERLINK fields: a field in a table cell is an ordinary field. */
  readonly projectFieldLink?: FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  /** @internal */
  readonly fieldCodeRanges?: import('./field-code-toc.ts').FieldCodeRanges;
  /** @internal Word TOC character-style suppression. */
  readonly tocLinkStyleRanges?: import('./toc-link-formatting.ts').TocLinkRanges;
  /** Document properties for document-property fields; the same object every flow shares. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /**
   * True when this table is in BODY flow, whose page fields are substituted at document finalize.
   * Propagates to every cell paragraph so a body-table PAGE field paints a placeholder; a table
   * in a header/footer keeps this false and its own live page path.
   */
  readonly bodyPageFields?: import('./field-page-furniture.ts').BodyPageFieldContext | false;
  /**
   * The story's resolved REF inputs — a REF field in a table cell is an ordinary field.
   * Present only in body flow, which folds the resolved values into every cell break key.
   */
  readonly refFields?: import('./field-ref.ts').RefFieldContext;
  readonly inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  /** Row page bottom, and the legacy crossing sink of row-start probes (`cellAnchorPageFit`). */
  readonly cellPageBottom?: number;
  readonly onCellAnchorCrossing?: () => void;
  /** Where inline pictures may paint sideways: the cell box, or a header's sheet; else the text. */
  readonly inlinePictureRoom?: InlinePictureRoom | undefined;
  /** Per-paragraph drawing projection/resource token for break cache keys. */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Per-paragraph semantic projection identity for cached cell lines. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** @deprecated Prefer {@link drawingTokenForParagraph}. */
  readonly drawingLayoutToken?: string;
  /**
   * Shared sparse ownership-interval budget for border finalize across nested tables in
   * one layout pass. Created once per flow; omit only in isolated unit tests.
   */
  readonly borderOwnershipBudget?: TableBorderOwnershipBudget;
  /**
   * Shared cell-visit budget for vMerge span resolve across nested tables in one layout
   * pass. Exhaustion fails soft (remaining restarts keep rowSpan 1).
   */
  readonly vMergeResolveBudget?: TableVMergeResolveBudget;
  /**
   * This layout is a MEASUREMENT, not a placement: nothing it produces is painted.
   *
   * A probe of one row lays out every nested table inside it, and planning merge heights in
   * those tables means probing THEIR rows, which lays out the tables below them again. That
   * multiplies rather than adds — a merge at each level of a nest a file controls ran three
   * times slower per level and took minutes at `MAX_TABLE_NESTING`. So a probe measures
   * nested tables unplanned, which is the height they had before this module existed.
   *
   * Erring tall is the safe direction: the caller reserves more room than the real
   * placement needs, which can move a row to a fresh page early but can never overflow the
   * page it was admitted onto.
   */
  readonly measuringOnly?: boolean;
  /** A kept row's successor opens with its whole `w:keepLines` paragraphs (`table-row-keeps.ts`). */
  readonly keepLinesOpening?: boolean;
  /**
   * Which tracked revisions this pass resolves away. A cell paragraph must resolve the same
   * mode as a body paragraph, or one table would show the proposed result while the text
   * around it showed the original.
   */
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  readonly anchorFrameBase?: () => Omit<
    DrawingAnchorFrameContext,
    'paragraphBox' | 'anchorLineBox' | 'anchorCharacterX' | 'columnBox' | 'cellBox' | 'layoutInCell'
  >;
  readonly pageContentClip?: () => import('./semantic-records.ts').LayoutBox;
  readonly collectAnchoredDrawings?: (drawings: readonly AnchoredDrawingRecord[]) => void;
  /** Root anchor sink — preserved when row defer strips {@link collectAnchoredDrawings}. */
  readonly publishAnchoredDrawings?: (drawings: readonly AnchoredDrawingRecord[]) => void;
  readonly columnBoxForParagraph?: (
    paragraphBox: import('./semantic-records.ts').LayoutBox
  ) => import('./semantic-records.ts').LayoutBox;
  readonly deferAnchoredDrawings?: (pending: {
    readonly paragraph: OoxmlNode;
    readonly paragraphId: string;
    readonly paragraphBox: LayoutBox;
    readonly lines: readonly LineRecord[];
    readonly cellOriginX: number;
    readonly cellContentWidth: number;
  }) => void;
  readonly onAnchorShift?: (paragraphId: string, dy: number) => void;
  readonly onAnchorRepublish?: (
    paragraphId: string,
    drawings: readonly AnchoredDrawingRecord[]
  ) => void;
  /** When true, row finalize forwards deferred anchors without publishing them. */
  readonly anchorDeferOnly?: boolean;
  /** Body-page wrap exclusion zones active while breaking cell paragraphs. */
  readonly pageExclusionZones?: () => readonly import('./drawing-exclusion.ts').ExclusionZone[];
  /** Document-order index for filtering wrap zones to earlier anchors only. */
  readonly paragraphOrderIndex?: (paragraphId: string) => number | undefined;
  /** The first paragraph of a table that opens the body, which keeps its end mark (`cellHidesEndMark`). */
  readonly documentFirstParagraphId?: string;
  /** The cell box whose flow places nested floating tables (`cell-float-tables.ts`). */
  readonly cellFloatBox?: import('./cell-float-tables.ts').CellFloatBox;
  /**
   * Reports every break-cache key a cell paragraph is cached under, so the host's
   * cache retention can name a table's cell entries without laying the table out.
   */
  readonly onCellBreakKey?: (key: string) => void;
}

export { sumCols } from './table-cell-spacing.ts';

/**
 * Place one paragraph's broken lines sequentially from `top`, producing a single fragment.
 *
 * The pending spans carry x offsets relative to the PARAGRAPH origin (that is what makes
 * the break cacheable across positions); placement shifts them by `originX` and stamps y,
 * exactly as body placement stamps `cursorY`.
 *
 * When `lineStart`/`maxBottom` are set, only lines that fit below `maxBottom` are placed and
 * the remainder line index is returned so a later page can continue the same paragraph.
 */
function placeCellParagraph(
  paragraph: OoxmlElement,
  originX: number,
  cellContentWidth: number,
  top: number,
  deps: TableFlowDeps,
  previousSpaceAfter: number,
  options?: CellParagraphPlacementOptions
): {
  readonly fragment: ParagraphFragmentRecord | null;
  readonly bottom: number;
  readonly spaceAfter: number;
  readonly nextLineIndex: number;
  readonly nextStartOffset: number;
  /** The break the page that continues this paragraph indexes; see `cellParagraphLines`. */
  readonly heldBreak?: HeldCellBreak;
  readonly complete: boolean;
  readonly fitted: boolean;
} {
  const paragraphId = paragraph.id;
  const keyFor = deps.cache?.keyFor?.bind(deps.cache) ?? paragraphLayoutKey;
  const storyListItem = deps.listItems?.get(paragraphId);
  // The marker is measured and painted with the table style's run formatting.
  const listItem = cellListItem(
    storyListItem,
    paragraph,
    deps.styleCascade,
    options?.tableCellStyle
  );
  const layoutInputs = withStoryLineGrid(
    cellParagraphInputs(
      paragraph,
      cellContentWidth,
      deps.styleCascade,
      storyListItem,
      options?.tableCellStyle,
      deps.paragraphLineUnitPt
    ),
    deps.snapsStoryLines && options?.inTableCell === false ? deps.paragraphLineUnitPt : undefined
  );
  const {
    props,
    indent,
    available,
    alignment,
    styleId,
    outlineLevel,
    spacing: authoredSpacing,
    bottomBorder,
    borders,
    shading,
  } = layoutInputs;
  const edgeSpacing = cellAutoSpacing(authoredSpacing, props, {
    firstInCell: options?.firstInCell === true,
    lastInCell: options?.lastInCell === true,
    fixedAutoSpacing: deps.styleCascade?.fixedParagraphSpacing === true,
    list: options?.inTableCell === true ? listItem : undefined,
    listItems: deps.listItems,
    neighbours: options?.borderNeighbours,
  });
  const spacing = cellContextualSpacing(
    edgeSpacing,
    layoutInputs.contextualSpacing,
    styleId,
    contextualCellNeighbours(paragraph, options?.borderNeighbours),
    deps.styleCascade,
    options?.tableCellStyle,
    options?.inTableCell === true ? deps.cellEdges?.get(paragraph.id) : undefined
  );
  const rtl = paragraphIsRtl(props);
  // `w:between` (§17.3.1.24): consecutive paragraphs with IDENTICAL border settings are ONE
  // bordered block — the box opens above the first and closes below the last, and each
  // interior boundary carries `w:between` or nothing. This is the cell twin of the body
  // flow's rule, so one document cannot draw the same callout two ways depending on whether
  // it sits in a `w:tc`.
  const { continuesAbove, continuesBelow } = cellBorderContinuation(
    paragraph,
    paragraphBorderGroupKey(layoutInputs),
    {
      styleCascade: deps.styleCascade,
      tableCellStyle: options?.tableCellStyle,
      listItems: deps.listItems,
    },
    options?.borderNeighbours
  );
  const topEdge = continuesAbove ? undefined : borders.top;
  // What closes the paragraph: the bottom rule, or the `between` rule when the block runs on.
  const closingEdge = continuesBelow ? borders.between : bottomBorder;
  const { tabStops, properties: breakProperties } = cellParagraphBreakInputs(
    paragraph,
    layoutInputs,
    deps.defaultTabStopPt,
    {
      listToken: listItem && listLayoutToken(listItem),
      hostedListToken: deps.hostedStory?.hostedListTokenForParagraph?.(paragraph) ?? '',
      refToken: deps.refFields?.tokenForParagraph(paragraphId) ?? '',
    }
  );
  // A cell paragraph breaks like a body paragraph: same line spacing, same first-line
  // offset. Contextual spacing compares neighbours within this cell.
  // A NUMBERED/BULLETED paragraph's first-line slot belongs to the MARKER: `listMarkerBox`
  // places it at `left - hanging` (or at `left + firstLine` for a positive-firstLine
  // level), and Word's `w:suff` puts the text back at `left` — or after the marker, or at
  // the next tab stop past an overflowing one (§17.9.30).
  const startOffset = options?.startOffset ?? 0;
  const startsParagraph = startOffset === 0 && (options?.lineStart ?? 0) === 0;
  // A legacy line-index cursor still breaks the full paragraph before slicing it.
  // Only a model-offset continuation removes the first-line indent from the break.
  const firstLineOffset =
    startOffset === 0
      ? directionalListFirstLineShift(listItem, indent, deps.measurer, tabStops, available, rtl)
      : 0;
  const anchorScope = cellAnchorScope(options?.inTableCell, deps, paragraphId);
  const storyFrame = !anchorScope.inTableCell ? deps.anchorFrameBase?.() : undefined;
  const rawZones = (anchorScope.anchorsWrapText && deps.pageExclusionZones?.()) || [];
  // The cell's own content box: tabs measure against it, and cell anchors resolve in it.
  const cellBoxWidth = indent.left + available + indent.right;
  // Only zones that can reach this paragraph: one above it or beside its lines changes nothing.
  const pageZones = zonesReachingCellParagraph(rawZones, {
    paragraphOrderIndex: deps.paragraphOrderIndex,
    originX,
    width: cellBoxWidth,
    paragraphId,
    top,
    // Where the breaker places the lines: its first-line origin is `left + firstLineOffset`.
    linesLeft: indent.left + Math.min(0, firstLineOffset),
    linesRight: cellBoxWidth - indent.right,
  });
  // Zone geometry alone does NOT identify the break: these zones stay in page-content Y
  // (only x is localized to the cell), so which band a line crosses depends on where the
  // paragraph starts. Two cells of the same text and width under the same float would
  // otherwise share a cache entry and the one that sits clear of the picture would inherit
  // the wrapped break of the one that does not.
  const exclusionToken = exclusionLayoutToken(pageZones);
  const positionedExclusionToken = positionedParagraphExclusionToken(exclusionToken, top);
  // `positioned` false names the break apart from where the paragraph sits, for a held break.
  const keyParts = cellBreakKeyParts(
    paragraph,
    deps,
    options?.inTableCell === true,
    options?.cellEndMark === true,
    anchorScope.rowsClearOutOfCellFloats
  );
  const keyFrom = (offset: number, positioned = true): string =>
    keyFor({
      ...cellBreakKeyInputs(paragraph, breakProperties, available, keyParts, offset),
      ...(positioned && positionedExclusionToken
        ? { exclusionToken: positionedExclusionToken }
        : {}),
    });
  let reportedKey: string | undefined;
  const breakRemainder = (): readonly PendingLine[] => {
    const key = (reportedKey = keyFrom(startOffset));
    if (deps.cache) deps.onCellBreakKey?.(key);
    return breakPreparedParagraphLazily(
      deps.cache,
      deps.cache ? key : null,
      () => ({
        compatibilityMode: deps.compatibilityMode,
        paragraph,
        paragraphId,
        indentLeft: indent.left,
        available,
        measurer: deps.measurer,
        formatting: layoutInputs,
        producer: deps.producer,
        styleCascade: deps.styleCascade,
        tabStops,
        ...(deps.pageContext ? { pageContext: deps.pageContext } : {}),
        flow: {
          firstLineOffset,
          ...(startOffset === 0 ? listMarkerFirstLineMetrics(listItem, deps.measurer) : {}),
          startOffset,
          marginExtent: { left: 0, right: cellBoxWidth },
          ...(deps.projectLink ? { projectLink: deps.projectLink } : {}),
          ...(deps.projectFieldLink ? { projectFieldLink: deps.projectFieldLink } : {}),
          showFieldCodes: deps.showFieldCodes,
          fieldCodeRanges: deps.fieldCodeRanges?.get(paragraphId),
          tocLinkStyleRanges: deps.tocLinkStyleRanges?.get(paragraphId),
          suppressEmptyPlaceholderLine: deps.fieldCodeRanges
            ?.get(paragraphId)
            ?.some((range) => range.suppressParagraph),
          ...(deps.documentProperties ? { documentProperties: deps.documentProperties } : {}),
          ...(deps.bodyPageFields ? { bodyPageFields: deps.bodyPageFields } : {}),
          ...(deps.refFields ? { refFields: deps.refFields } : {}),
          displayMode: deps.displayMode,
          ...(deps.revisionAuthorFilter ? { revisionAuthorFilter: deps.revisionAuthorFilter } : {}),
          ...(deps.noteMarks ? { noteMarks: deps.noteMarks } : {}),
          ...inlineDrawingFlow(deps.inlineDrawingLayout, deps.hostedStory),
          // Placement clips pictures where alignment put them, to the room or the text column.
          deferInlineDrawingHorizontalClip: true,
          contentLeft: 0,
          contentRight: cellBoxWidth,
          paragraphStartY: top,
          ...cellAnchorFlow(cellBoxWidth, available, anchorScope),
          ...(storyFrame?.storyKind === 'header' ? { anchorFrameBase: storyFrame } : {}),
          ...(pageZones.length > 0 ? { pageExclusionZones: pageZones } : {}),
        },
      }),
      () =>
        deps.cache && !rtl && startOffset === 0 && pageZones.length === 0 && !listItem
          ? reuseParagraphAtWidth(deps.cache, paragraph, key, available)
          : undefined
    );
  };
  const placement = cellParagraphLines({
    paragraph,
    startOffset,
    continuedAfter: options?.startOffset !== undefined ? (options?.lineStart ?? 0) : undefined,
    legacyLineStart: options?.lineStart ?? 0,
    held: options?.heldBreak,
    zones: pageZones,
    inlineDrawingLayout: deps.inlineDrawingLayout,
    heldKey: () => keyFrom(0, false),
    breakRemainder,
  });
  const { lines: brokenLines, lineStart, priorLineCount } = placement;
  const fragmentIndex = options?.fragmentIndex ?? 0;
  const maxBottom = options?.maxBottom ?? Number.POSITIVE_INFINITY;
  const includeAfter = options?.includeAfter ?? true;
  const includeBottomBorder = options?.includeBottomBorder ?? true;
  // ONE question, asked once, so the next kind of furniture is caught by construction rather
  // than arriving as the third late special case. The caller settles POSITION — last block of
  // a cell, behind a table that actually emitted, structurally empty. What decides whether
  // the collapse is SAFE is resolved here, and the line runs between two kinds of thing:
  //
  //   sized OFF the line box   borders, shading — a zero box paints a zero band, which is
  //                            what "occupies no space" should look like. These collapse.
  //   own intrinsic size       a list marker glyph, and the pilcrow and change bar a tracked
  //                            `w:ins`/`w:del` on the paragraph MARK publishes. A zero box
  //                            does not hide these, it MISPLACES them — paint centres the
  //                            marker half a line above its row and drops the change bar
  //                            entirely. These block the collapse.
  //
  // The mark revisions are read only in All Markup — that is the only view where the pilcrow
  // and the change bar exist. In the resolved or original view a terminator whose mark is
  // tracked-INSERTED publishes neither, so blocking there would keep a line Word's accept-all
  // output does not have. (A tracked DELETE is a different case and never reaches here: the
  // resolved view merges that paragraph away upstream.)
  // Check intrinsic glyphs only behind the collapse or hideMark placement gates.
  const publishesPlacedGlyphs = (): boolean =>
    listItem !== undefined ||
    (deps.displayMode === 'all-markup' &&
      paragraphMarkMarkupVisible(paragraph, 'all-markup', deps.revisionAuthorFilter));
  // An empty final paragraph in a `w:hideMark` cell collapses (`cellTerminatorCollapses`).
  // In an otherwise empty cell, a paragraph border still draws and keeps the line.
  const lines = brokenLines;
  const keepsBorderedLine =
    (options?.collapseInEmptyCell ?? false) && (topEdge !== undefined || closingEdge !== undefined);
  const collapseHeight =
    (options?.collapseHeight ?? false) && !keepsBorderedLine && !publishesPlacedGlyphs();

  const appliedBefore =
    startsParagraph && !collapseHeight
      ? collapsedSpaceBefore(spacing.before, previousSpaceAfter)
      : 0;
  const fragmentX = originX + indent.left;
  // The top rule and its gap are flow height above the first line, exactly as the bottom rule
  // is flow height below the last — so the cell's content band has to reserve it or a boxed
  // paragraph's frame paints over the cell's own top border. Reserved on the FIRST fragment
  // only: a paragraph continued onto the next page opens once, the way it closes once.
  const topExtent = startsParagraph && !collapseHeight ? paragraphBorderExtentPt(topEdge) : 0;
  const rawRecords: LineRecord[] = [];
  let y = cellParagraphFirstTop(top, appliedBefore, topExtent);
  let nextLineIndex = lineStart;
  let fitted = false;

  // Decide the cut before publishing line ids or drawings. A widow retreat must not
  // leave side effects from a line that will actually be placed on the following page.
  const lineTops: number[] = [];
  const anchorFit = cellAnchorPageFit(paragraph, deps, top, options);
  let probeY = y;
  for (let lineIndex = lineStart; lineIndex < lines.length; lineIndex += 1) {
    const pendingLine = lines[lineIndex]!;
    const isLastLine = lineIndex === lines.length - 1;
    const borderExtra =
      isLastLine && includeBottomBorder && closingEdge && !collapseHeight
        ? paragraphBorderExtentPt(closingEdge)
        : 0;
    const afterExtra = isLastLine && includeAfter && !collapseHeight ? spacing.after : 0;
    const skipBefore = collapseHeight
      ? 0
      : pendingLineExclusionSkipAtPlacement(pendingLine, probeY, pageZones);
    const lineBottom = collapseHeight
      ? probeY
      : probeY + skipBefore + pendingLine.height + borderExtra + afterExtra;
    const requiredBottom =
      isLastLine && !collapseHeight
        ? Math.max(lineBottom, options?.cellEndMarkMinBottom ?? lineBottom)
        : lineBottom;
    if (!cellLineFits(requiredBottom, maxBottom, probeY + skipBefore, collapseHeight, options)) {
      if (placesOversizedLine(options, deps, lineTops.length, skipBefore)) lineTops.push(probeY);
      break;
    }
    if (anchorFit?.(pendingLine, probeY + skipBefore, lineTops.length)) break;
    lineTops.push(probeY + skipBefore);
    if (!collapseHeight) probeY += skipBefore + pendingLine.height;
  }
  let lineEnd = lineStart + lineTops.length;
  // Legacy table flow ignores widow control even when the paragraph enables it.
  if (
    lineEnd < lines.length &&
    hasCompatibilityRule(deps.compatibilityMode, 'tableParagraphWidowControl') &&
    options?.applyWidowControl !== false
  ) {
    lineEnd = adjustedBreakIndex(
      lineEnd,
      lineStart,
      lines.length,
      // Cross-paragraph keeps remain a row-level decision. This cut only controls
      // how many lines of this paragraph remain on either side of the page edge.
      {
        ...paragraphKeeps(props),
        keepLines: !!deps.keepLinesOpening && paragraphKeeps(props).keepLines,
      },
      options?.aloneOnPage ?? true
    );
  }
  const lineAlignment = {
    measurer: deps.measurer,
    styleCascade: deps.styleCascade,
    props,
    alignment,
    rtl,
    inTableCell: options?.inTableCell === true,
  };
  // How far alignment moved the fragment's first line; its list marker moves with it.
  let firstAlignOffset = 0;
  for (let lineIndex = lineStart; lineIndex < lineEnd; lineIndex += 1) {
    const pendingLine = lines[lineIndex]!;
    const isLastLine = lineIndex === lines.length - 1;
    y = lineTops[lineIndex - lineStart]!;
    const lineIndent = originX + indent.left + (lineIndex === 0 && !rtl ? firstLineOffset : 0);
    const lineAvailableWidth = Math.max(1, available - (lineIndex === 0 ? firstLineOffset : 0));
    // Spans and inline drawings come from one pen, so they share one origin.
    const penX = originX - (rtl && lineIndex === 0 ? firstLineOffset : 0);
    const cellClip = inlinePictureClip(
      deps.inlinePictureRoom,
      { x: originX, width: cellContentWidth },
      top,
      maxBottom
    );
    const placedDrawings = pendingLine.drawings.map((drawing) =>
      Object.freeze({ ...shiftInlineDrawingRecord(drawing, penX, y), paragraphId })
    );
    const content = alignCellLine(
      pendingLine,
      paragraphId,
      penX,
      y,
      placedDrawings,
      lineIndent,
      lineAvailableWidth,
      isLastLine,
      lineAlignment
    );
    const { spans: alignedSpans, offset: alignOffset } = content;
    if (lineIndex === lineStart)
      firstAlignOffset = listMarkerLineOffset(alignOffset, lineAvailableWidth);
    const alignedDrawings = content.drawings.map((drawing) =>
      clipInlineDrawingRecordToRegion(drawing, cellClip)
    );
    rawRecords.push({
      id: deps.nextLineId(paragraphId, pendingLine.start, priorLineCount + lineIndex),
      range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
      spans: alignedSpans,
      ...(alignedDrawings.length > 0 ? { drawings: alignedDrawings } : {}),
      box: {
        x: originX + indent.left,
        y,
        width: available,
        // ZERO-height, not just zero flow: selection bands, `paragraphShadingBox` and
        // `caretBoxOnLine` all read this box, so a line that keeps its height while the cell
        // stops at `y` paints caret and highlight below the row. It costs the terminator its
        // caret until something is typed into it, which un-collapses it.
        height: collapseHeight ? 0 : pendingLine.height,
      },
      contentX: lineContentX(alignedSpans, alignedDrawings, lineIndent + alignOffset),
      baseline: collapseHeight
        ? Math.max(0, Math.min(pendingLine.baseline, options?.collapseBandAbove ?? 0))
        : pendingLine.baseline,
      leading: collapseHeight ? 0 : pendingLine.leading,
      trailingSpacing: collapseHeight ? 0 : pendingLine.trailingSpacing,
      ...(pendingLine.manualBreakAfter ? { manualBreakAfter: true } : {}),
      ...(pendingLine.deletedRanges ? { deletedRanges: pendingLine.deletedRanges } : {}),
      ...(pendingLine.anchorRevisions ? { anchorRevisions: pendingLine.anchorRevisions } : {}),
      ...(pendingLine.changeSites ? { changeSites: pendingLine.changeSites } : {}),
    });
    if (!collapseHeight) y += pendingLine.height;
    nextLineIndex = lineIndex + 1;
    fitted = true;
  }

  if (!fitted) {
    return {
      fragment: null,
      bottom: top,
      spaceAfter: previousSpaceAfter,
      nextLineIndex: priorLineCount + lineStart,
      nextStartOffset: startOffset,
      complete: false,
      fitted: false,
    };
  }

  const complete = nextLineIndex >= lines.length;
  const linesTop = rawRecords[0]!.box.y;
  const linesBottom = y;
  // Every `w:pBdr` edge, in the paint order body flow publishes: open, close, sides, bar.
  // `topEdge` and `closingEdge` already carry the `w:between` group decision.
  const strokes: ParagraphBorderStrokeRecord[] = [];
  let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
  let contentTop = linesTop;
  let contentBottom = linesBottom;
  // THE FOUR EDGES ARE ONE BOX — the same rule the body flow follows, and it has to be the
  // same here or one document paints the identical callout two ways depending on whether it
  // sits in a table cell or a header. The side rules stand outside the text column by their
  // own `w:space`, so horizontals drawn only across the column leave the frame open.
  // Stroke thickness uses the inflated compound band for `double`/etc. (shared with body).
  const leftStroke = borders.left ? paragraphBorderStrokeWidthPt(borders.left) : 0;
  const rightStroke = borders.right ? paragraphBorderStrokeWidthPt(borders.right) : 0;
  const outdent = paragraphBoxOutdent(indent, rtl);
  const columnLeft = fragmentX - outdent.left;
  const columnRight = fragmentX + available + outdent.right;
  const boxLeft = borders.left ? columnLeft - borders.left.spacePt - leftStroke : columnLeft;
  const boxRight = borders.right ? columnRight + borders.right.spacePt + rightStroke : columnRight;
  const boxWidth = Math.max(boxRight - boxLeft, 0);
  if (topExtent > 0 && topEdge) {
    const topStroke = paragraphBorderStrokeWidthPt(topEdge);
    const ruleY = linesTop - topEdge.spacePt - topStroke;
    strokes.push({
      side: 'top',
      edge: topEdge,
      box: { x: boxLeft, y: ruleY, width: boxWidth, height: topStroke },
    });
    contentTop = ruleY;
  }
  // Gated on `collapseHeight` exactly as the fit test is: charging the rule here after the
  // fit test charged nothing grows `contentBottom` past the row, and past `maxBottom` on a
  // page's last row. `topExtent` drops the top rule for the same reason, and the two edges
  // have to agree or a boxed terminator paints half its frame.
  if (complete && includeBottomBorder && closingEdge && !collapseHeight) {
    const closeStroke = paragraphBorderStrokeWidthPt(closingEdge);
    const ruleY = linesBottom + closingEdge.spacePt;
    const box = {
      x: boxLeft,
      y: ruleY,
      width: boxWidth,
      height: closeStroke,
    };
    // `bottomBorder` stays the BOTTOM rule alone: a `between` rule closing a grouped
    // paragraph is a different edge, and a consumer reading it as the box's bottom would
    // draw the block's frame at every interior boundary.
    if (!continuesBelow) bottomBorderRecord = { edge: closingEdge, box };
    strokes.push({ side: continuesBelow ? 'between' : 'bottom', edge: closingEdge, box });
    contentBottom = ruleY + closeStroke;
  }
  const appliedAfter = complete && includeAfter && !collapseHeight ? spacing.after : 0;
  // Side rules run corner to corner of THIS fragment's frame. Horizontally they are
  // publish-only: Word draws them outside the text column and never re-breaks the lines for
  // them, which is why `available` above is untouched by a box.
  //
  // Inside a `w:between` group they run THROUGH the inter-paragraph gap instead, so the box
  // reads as one outline rather than a ladder — the body flow's rule, in the cell lane.
  const sideTop = continuesAbove && startsParagraph ? top : contentTop;
  const sideBottom = continuesBelow && complete ? contentBottom + appliedAfter : contentBottom;
  const sideHeight = Math.max(sideBottom - sideTop, 0);
  if (borders.left) {
    strokes.push({
      side: 'left',
      edge: borders.left,
      box: {
        x: boxLeft,
        y: sideTop,
        width: leftStroke,
        height: sideHeight,
      },
    });
  }
  if (borders.right) {
    strokes.push({
      side: 'right',
      edge: borders.right,
      box: {
        x: columnRight + borders.right.spacePt,
        y: sideTop,
        width: rightStroke,
        height: sideHeight,
      },
    });
  }
  // `w:bar` is the change-bar rule beside the paragraph, not part of the frame — it runs the
  // text only and adds no flow height, so a barred cell paragraph is exactly as tall as a
  // bare one.
  if (borders.bar) {
    const barStroke = paragraphBorderStrokeWidthPt(borders.bar);
    strokes.push({
      side: 'bar',
      edge: borders.bar,
      box: {
        x: fragmentX - borders.bar.spacePt - barStroke,
        y: linesTop,
        width: barStroke,
        height: Math.max(linesBottom - linesTop, 0),
      },
    });
  }
  const bottom = contentBottom + appliedAfter;
  // Shading fills the FRAME when there is one (a side rule is what makes it a box), and the
  // line area otherwise — the body flow's rule, stated once more for the cell lane.
  const shadingBox =
    shading === undefined
      ? undefined
      : borders.left || borders.right
        ? {
            x: boxLeft,
            y: contentTop,
            width: boxWidth,
            height: Math.max(contentBottom - contentTop, 0),
          }
        : paragraphShadingBox(rawRecords, fragmentX, available);
  // The paragraph MARK, on the fragment that finishes the paragraph — the cell lane publishes
  // it for the same reason the body lane does, and until it did, a tracked split or merge
  // inside a `w:tc` drew nothing at all: no pilcrow, no margin rule, no review card.
  //
  // Read only when this fragment will carry it. Placement runs for trial rows and for every
  // continuation, and the projection walks `w:pPr/w:rPr` each time it is asked.
  // EXPLICIT, not defaulted. A lane that does not say which view it is drawing does not get
  // attribution: note stories pass no mode and mean the resolved one, so defaulting to
  // `all-markup` here lit up markup inside footnotes in the very view that must show none.
  // The lanes that do mean All Markup say so — the body always has, and furniture does now.
  const showsMarkup = complete && deps.displayMode === 'all-markup';
  const markProjection = showsMarkup
    ? visibleParagraphMarkRevisionsOf(paragraph, 'all-markup', deps.revisionAuthorFilter)
    : null;
  const markRevisions = markProjection?.revisions ?? [];
  const markFormatRevision = markProjection?.formatRevision ?? null;
  // The resolved lanes (no mode, or a resolved one) still report the mark decisions they
  // answered, for the Simple Markup change bar.
  const resolvedMode = deps.displayMode ?? 'proposed';
  const markChangeSites = complete
    ? resolvedParagraphMarkChangeSites(paragraph, resolvedMode, deps.revisionAuthorFilter)
    : [];
  const marker = startsParagraph
    ? publishListMarker(
        listItem,
        deps.measurer,
        rawRecords[0],
        originX + listMarkerAlignShift(firstAlignOffset, alignment, rtl),
        // The content box: indents wider than a narrow cell would mirror the marker out of it.
        rtl ? cellContentWidth : undefined,
        deps.inlineDrawingLayout?.pictureBulletResource
      )
    : undefined;

  // A cell is a story, so a resolved view merges inside it too — and the identity of the
  // merged half has to come back the same way it does in the body flow.
  const mergeGroup = paragraphMergeGroupOf(paragraph);
  const records = mergeGroup
    ? remapMergedLines(
        rawRecords,
        mergeBoundariesOf(mergeGroup, resolvedMode, deps.revisionAuthorFilter)
      )
    : rawRecords;
  const clipToBox = options?.clipOverflow === true && bottom > maxBottom + 0.001;
  const placedBottom = clipToBox ? Math.max(top, Math.min(maxBottom, bottom)) : bottom;
  const fragment = {
    kind: 'paragraph' as const,
    id: `${paragraphId}#f${fragmentIndex}`,
    ...(complete ? { paragraphEnd: true as const } : {}),
    paragraphId,
    fragmentIndex,
    range: {
      paragraphId,
      start: records[0]!.range.start,
      end: records[records.length - 1]!.range.end,
    },
    props,
    styleId,
    outlineLevel,
    alignment,
    spacing: { before: appliedBefore, after: appliedAfter },
    indent,
    tabStops,
    ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
    ...(strokes.length > 0 ? { borders: strokes } : {}),
    ...(shading === undefined ? {} : { shading }),
    ...(shadingBox === undefined ? {} : { shadingBox }),
    ...(marker ? { marker } : {}),
    ...markRevisionFields(markRevisions, markFormatRevision),
    ...(markChangeSites.length > 0 ? { markChangeSites } : {}),
    lines: records,
    ...(clipToBox ? { clipToBox: true as const } : {}),
    ...emptyParagraphStyleFields(
      records,
      layoutInputs.markRunProperties,
      deps.styleCascade?.themeFonts,
      complete
    ),
    box: {
      x: clipToBox ? originX : fragmentX,
      y: top,
      width: clipToBox ? cellContentWidth : available,
      height: placedBottom - top,
    },
  };

  publishCellParagraphAnchors(deps, {
    paragraph,
    paragraphId,
    paragraphBox: fragment.box,
    lines: records,
    originX,
    top,
    maxBottom,
    cellContentWidth,
    anchorScope,
  });

  if (complete && startsParagraph && !collapseHeight && !pageZones.length && !rtl && !listItem)
    rememberCellLine(
      fragment,
      paragraph,
      lines,
      layoutInputs,
      breakProperties,
      keyParts,
      deps,
      reportedKey,
      { appliedBefore, topExtent, appliedAfter }
    );
  return {
    fragment,
    bottom: placedBottom,
    spaceAfter: deps.styleCascade?.fixedParagraphSpacing ? 0 : appliedAfter,
    nextLineIndex: priorLineCount + nextLineIndex,
    nextStartOffset: lines[nextLineIndex]?.start ?? lines.at(-1)!.end,
    ...(complete ? {} : { heldBreak: placement.carry() }),
    complete,
    fitted: true,
  };
}

/**
 * Flow blocks within [left, right] from `top`; returns the fragments and the bottom y.
 * No pagination — blocks stack. Used for table cells and for header/footer stories,
 * which is exactly what makes a header break like a cell: same breaker, same records.
 */
export function flowBlocksInBox(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps
): { readonly blocks: BlockFragmentRecord[]; readonly bottom: number } {
  const bounded = flowBlocksInBoxBounded(
    blocks,
    left,
    right,
    top,
    Number.POSITIVE_INFINITY,
    depth,
    deps,
    {
      blockIndex: 0,
      lineIndex: 0,
      previousSpaceAfter: 0,
      paragraphFragmentIndex: 0,
      precededByEmittedTable: false,
    }
  );
  return { blocks: bounded.blocks, bottom: bounded.bottom };
}

function flowBlocksInBoxBounded(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  maxBottom: number,
  depth: number,
  deps: TableFlowDeps,
  cursor: CellPlaceCursor,
  tableCellStyle?: TableCellStyleFormatting,
  /** True for a `w:tc`: its last block may be the empty terminator a nested table forces. */
  inTableCell = false,
  cellEndMarkMinBottom?: number,
  hideEndMark = false,
  applyWidowControl = true,
  clipOverflow = false
): {
  readonly blocks: BlockFragmentRecord[];
  readonly bottom: number;
  readonly cursor: CellPlaceCursor;
  readonly complete: boolean;
  readonly fitted: boolean;
  readonly nestedSplitBlocked: boolean;
} {
  const fragments: BlockFragmentRecord[] = [];
  let y = top;
  let previousSpaceAfter = cursor.previousSpaceAfter;
  let blockIndex = cursor.blockIndex;
  let lineIndex = cursor.lineIndex;
  let startOffset = cursor.startOffset;
  const heldBreak = cursor.heldBreak;
  let nestedTable = cursor.nestedTable;
  let paragraphFragmentIndex = cursor.paragraphFragmentIndex;
  let fitted = false;
  let nestedSplitBlocked = false;
  // Carried across page cuts by the cursor; never re-derived from the source node's kind.
  let lastEmittedTable = cursor.precededByEmittedTable;
  const floats = inTableCell ? createCellFloats(blocks, left, right, deps) : undefined;

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex]!;
    if (block.kind === 'table') {
      if (lineIndex !== 0) {
        // Nested table progress has its own row cursor, never a paragraph line index.
        lineIndex = 0;
      }
      previousSpaceAfter = 0;
      const nested = (floats?.emit ?? emitNestedTable)(
        block,
        left,
        right,
        y,
        depth + 1,
        deps,
        maxBottom,
        nestedTable,
        !fitted && deps.rowAtPageStart === true
      );
      if (!nested) {
        lastEmittedTable = false;
        blockIndex += 1;
        continue;
      }
      if (!nested.fragment) {
        nestedSplitBlocked = !fitted;
        break;
      }
      fragments.push(nested.fragment);
      y = nested.bottom;
      fitted = true;
      lastEmittedTable = true;
      nestedTable = nested.remainder;
      if (nestedTable) break;
      blockIndex += 1;
      lineIndex = 0;
      startOffset = undefined;
      continue;
    }
    if (block.kind !== 'paragraph') {
      lastEmittedTable = false;
      blockIndex += 1;
      lineIndex = 0;
      startOffset = undefined;
      continue;
    }

    const collapsible = cellTerminatorCollapses(block, {
      inTableCell,
      last: blockIndex === blocks.length - 1,
      afterEmittedTable: lastEmittedTable,
      hideEndMark,
    });
    const placed = placeCellParagraph(
      block,
      left,
      Math.max(1, right - left),
      y,
      floats ? floats.paragraphDeps(deps) : deps,
      previousSpaceAfter,
      {
        inTableCell,
        lineStart: lineIndex,
        startOffset,
        // Only the cursor's own paragraph continues; every later block starts fresh.
        heldBreak: blockIndex === cursor.blockIndex ? heldBreak : undefined,
        applyWidowControl,
        aloneOnPage: !fitted && deps.rowAtPageStart !== false,
        fragmentIndex: paragraphFragmentIndex,
        maxBottom,
        clipOverflow,
        includeAfter: true,
        includeBottomBorder: true,
        firstInCell: blockIndex === 0,
        lastInCell:
          blockIndex === blocks.length - 1 && (inTableCell || !deps.keepsStoryEndAutoSpacing),
        cellEndMark:
          (hideEndMark || cellEndMarkMinBottom !== undefined) && blockIndex === blocks.length - 1,
        hideEndMark: hideEndMark && blockIndex === blocks.length - 1,
        cellEndMarkMinBottom: blockIndex === blocks.length - 1 ? cellEndMarkMinBottom : undefined,
        collapseHeight: collapsible,
        collapseInEmptyCell: collapsible && fragments.length === 0,
        collapseBandAbove: y - top,
        ...(tableCellStyle ? { tableCellStyle } : {}),
        borderNeighbours: {
          previous: blockIndex > 0 ? blocks[blockIndex - 1] : undefined,
          next: blocks[blockIndex + 1],
        },
      }
    );
    if (!placed.fitted || !placed.fragment) {
      break;
    }
    fragments.push(placed.fragment);
    y = placed.bottom;
    fitted = true;
    if (placed.complete) {
      previousSpaceAfter = placed.spaceAfter;
      lastEmittedTable = false;
      blockIndex += 1;
      lineIndex = 0;
      startOffset = undefined;
      paragraphFragmentIndex = 0;
    } else {
      // Paragraph continues on the next page.
      return {
        blocks: fragments,
        bottom: floats?.bottom(y) ?? y,
        cursor: continuedCellCursor(blockIndex, placed, paragraphFragmentIndex, lastEmittedTable),
        complete: false,
        fitted: true,
        nestedSplitBlocked: false,
      };
    }
  }

  return {
    blocks: fragments,
    bottom: cellBottomWithAnchors(floats?.bottom(y) ?? y, blocks, fragments, deps, inTableCell),
    cursor: {
      blockIndex,
      lineIndex,
      startOffset,
      ...unplacedHeldBreak(cursor, blockIndex, startOffset),
      ...(nestedTable ? { nestedTable } : {}),
      previousSpaceAfter,
      paragraphFragmentIndex,
      precededByEmittedTable: lastEmittedTable,
    },
    complete: blockIndex >= blocks.length,
    fitted,
    nestedSplitBlocked,
  };
}

/**
 * Lay out one row at `rowTop`: flow every cell, size the row to its tallest cell, emit
 * every cell box at that height. `left` is the table's left edge (page-content-relative),
 * threaded through directly so nested content never needs shifting after the fact.
 * Returns the record and the row's bottom y.
 */
export function layoutRowFragment(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  isHeaderRepeat: boolean,
  depth: number,
  deps: TableFlowDeps,
  cellSpacingPt = 0,
  vMerge?: RowVMergeLayoutOptions,
  pageBottomPt = Number.POSITIVE_INFINITY
): LayoutRowBoundedResult {
  // The row itself is unbounded — callers here place it and then compare `bottom` against
  // the page, which is how an overheight row fails closed. A DETACHED head is the one cell
  // that comparison cannot see, because it is kept out of the row's height on purpose, so
  // the page reaches it through `pageBottomPt` instead. A caller with no page (the probe,
  // a nested table) leaves it infinite and nothing changes.
  return layoutRowFragmentBounded(
    row,
    cols,
    left,
    rowTop,
    Number.POSITIVE_INFINITY,
    isHeaderRepeat,
    false,
    depth,
    deps,
    initialCellCursors(row),
    cellSpacingPt,
    vMerge,
    pageBottomPt
  );
}

export interface LayoutRowBoundedResult {
  readonly record: TableRowFragmentRecord;
  readonly bottom: number;
  /** Remaining cell cursors when the row did not finish; null when complete. */
  readonly remainder: CellPlaceCursor[] | null;
  /** True when at least one cell placed a line or nested block in this fragment. */
  readonly fitted: boolean;
  /**
   * True when a nested table blocked a safe split (would need to cut through nested
   * geometry). Callers must fail closed rather than overflow.
   */
  readonly nestedSplitBlocked: boolean;
}

/**
 * Height-budgeted row layout for pagination. Content stays at or above `rowTop` and at or
 * below `maxBottom`. Cells that cannot place anything leave empty boxes; callers decide
 * whether to move the row, continue splitting, or fail closed.
 *
 * `w:trHeight` (17.4.81):
 * - `auto` — content-sized (no invented floor);
 * - `atLeast` — floor the finished fragment to the authored minimum when it fits the
 *   budget; mid-row page splits stay content-driven so the floor cannot overflow the page;
 * - `exact` — fixed height, content clipped (Word 17.18.37). Overflow is not continued.
 *
 * `vMerge` is what a vertical merge does here (17.4.85): a head covering later rows paints
 * from this row bounded by its span, DETACHED from the row's own height.
 */
export function layoutRowFragmentBounded(
  row: SemanticTableRow,
  cols: readonly number[],
  tableLeft: number,
  rowTop: number,
  maxBottom: number,
  isHeaderRepeat: boolean,
  isContinuation: boolean,
  depth: number,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[],
  cellSpacingPt = 0,
  vMerge?: RowVMergeLayoutOptions,
  detachedBottomPt = maxBottom
): LayoutRowBoundedResult {
  // A legacy table can place a row apart from its grid (`legacy-row-placement.ts`).
  const left = tableLeft + (row.xShiftPt ?? 0);
  const detachedSpans = vMerge?.detachedSpanHeightPtByCellId;
  const total = sumCols(cols, 0, cols.length);
  // `w:tblCellSpacing` (17.4.45) is the space on each side of every cell, so neighbouring
  // cells, and a cell and the table edge, sit twice that apart. The gaps come out of the
  // table's own width, and every column gives up its share in proportion to its width.
  const gap = cellSpacingGeometry(cols, cellSpacingPt, row.spacingFrame);
  const defaultLineHeight = deps.measurer.lineMetrics(DEFAULT_RUN_STYLE).height;
  const heightRule = row.height;
  const exactHeightPt =
    heightRule.rule === 'exact'
      ? heightRule.valuePt +
        exactOpeningExtensionPt(row, deps) +
        exactSpacingExtensionPt(row, cellSpacingPt)
      : undefined;
  const atLeastHeightPt = heightRule.rule === 'atLeast' ? heightRule.valuePt : undefined;
  const terminalBorderPt =
    !isHeaderRepeat && !isContinuation && depth === 0 && cellSpacingPt === 0
      ? exactTerminalBorderPt(row, deps)
      : 0;
  // The same spacing opens a gap above each row's cells, so content starts that much lower.
  const opening = isContinuation
    ? 'remainder'
    : isHeaderRepeat || deps.opensTableBreak
      ? 'break'
      : 'start';
  const rowGapPt = rowOpeningGapPt(row, cellSpacingPt, opening);
  const deferredRowAnchors: DeferredRowAnchor[] = [];
  // Exact rows clip to their authored box; never flow past it even when the page allows more.
  const { flowMaxBottom, pageBottom } = rowFlowBounds(maxBottom, rowTop, exactHeightPt);
  const cellEdges = cellEdgeNeighbours(row, deps.styleCascade, deps.tableTopLeads?.get(row.id));
  const { rowDeps, flushDeferred } = rowDepsForAnchors(
    { ...deps, cellPageBottom: pageBottom, cellEdges },
    deferredRowAnchors
  );
  const flowDeps: TableFlowDeps =
    isHeaderRepeat && deps.pageOccurrenceKey
      ? {
          ...rowDeps,
          nextLineId: (paragraphId, start, lineIndex) =>
            rowDeps.nextLineId(paragraphId, start, lineIndex, deps.pageOccurrenceKey!()),
        }
      : rowDeps;

  interface FlowedCell {
    readonly cell: SemanticTableCell;
    readonly x: number;
    readonly width: number;
    readonly gridColumn: number;
    readonly blocks: readonly BlockFragmentRecord[];
    readonly contentTop: number;
    readonly contentBottom: number;
    readonly physicalBottom: number;
    readonly insets: { top: number; right: number; bottom: number; left: number };
    readonly nextCursor: CellPlaceCursor;
    readonly complete: boolean;
    readonly fitted: boolean;
    readonly nestedSplitBlocked: boolean;
    readonly flowTo?: (
      right: number,
      relayout?: boolean
    ) => ReturnType<typeof flowBlocksInBoxBounded>;
  }
  const flowed: FlowedCell[] = [];
  let anyFitted = false;
  let anyNestedBlocked = false;
  // Continuation and waiting `btLr` cells size no row; alone, their end marks do.
  const waits = waitsForRowHeight;
  const markSizedRow =
    row.cells.length > 0 && row.cells.every((cell) => cell.vMergeContinue || waits(cell));
  let rowBottom = rowTop;

  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
    const cell = row.cells[cellIndex]!;
    const cursor: CellPlaceCursor = cursors[cellIndex] ?? initialCellCursor();
    // The reader resolves gridBefore and bounds the total span before border-grid walks.
    const { gridSpan: span, gridColumn } = cell;
    const slotX = left + sumCols(cols, 0, gridColumn);
    const slotW = sumCols(cols, gridColumn, Math.min(gridColumn + span, cols.length)) || total;
    const spaced =
      gap && gridColumn < cols.length
        ? spacedCellBox(gap, row.cells, gridColumn, span, cols.length)
        : null;
    const cellX = spaced ? left + spaced.x : slotX;
    const cellW = Math.max(spaced ? spaced.width : slotW, MIN_CELL_BOX_PT);
    const ownInsets = endRowInsets(cell, deps, terminalBorderPt, rowTop, maxBottom, cellSpacingPt);
    const insets = rowGapPt > 0 ? { ...ownInsets, top: ownInsets.top + rowGapPt } : ownInsets;
    // Each page fragment retains the cell padding, even when its paragraph continues.
    const topInset = insets.top;
    // A detached head answers to the page and to its own SPAN, and to nothing about this
    // row: `hRule="exact"` fixes the height of the ROW (17.18.37) while the merged content
    // goes on through the rows below it. The span arrives as a HEIGHT and becomes a bottom
    // here, against the row top being placed, so it cannot outlive a move to another page —
    // and a head that outruns either bound hands back a remainder rather than losing a line.
    const spanHeightPt = detachedSpans?.get(cell.id);
    const isDetached = spanHeightPt !== undefined;
    // A fixed-row span shorter than its head clips it at the span bottom.
    const clipsSpan = isDetached && vMerge?.clippedSpanCellIds?.has(cell.id) === true;
    const cellMaxBottom = isDetached
      ? Math.min(detachedBottomPt, rowTop + spanHeightPt)
      : flowMaxBottom;
    const vertical = cell.textDirection === 'btLr';
    const box = cellFlowBox(vertical, cellX, cellW, rowTop, cellMaxBottom, insets);
    const { flowLeft, flowRight, contentTop, contentMaxBottom } = box;

    const { markFloor, continuation: continuationPt } = cellReservedMarkHeights(
      cell,
      flowRight - flowLeft,
      flowDeps,
      { vertical, markSizedRow }
    );
    let blocks: readonly BlockFragmentRecord[] = [];
    let contentBottom = contentTop;
    let nextCursor = cursor;
    let complete = true;
    let fitted = false;
    let nestedSplitBlocked = false;
    // Pictures paint over the cell margins and crop at the cell box (a btLr cell: its text).
    const pictureRoom = vertical ? undefined : { left: cellX, right: cellX + cellW };
    const cellDeps = withInlinePictureRoom(
      withCellFloatBox(flowDeps, cell.blocks, pictureRoom, rowTop),
      pictureRoom
    );
    const flowTo = (right: number, relayout = false): ReturnType<typeof flowBlocksInBoxBounded> =>
      flowBlocksInBoxBounded(
        cell.blocks,
        flowLeft,
        right,
        contentTop,
        contentMaxBottom,
        depth,
        relayout ? withoutAnchorSinks(cellDeps) : cellDeps,
        cursor,
        cell.styleFormatting,
        true,
        vertical
          ? undefined
          : rowTop + Math.min(markFloor, exactHeightPt ?? Infinity) - insets.bottom,
        cellHidesEndMark(cell, deps.documentFirstParagraphId),
        // Fixed cell boxes clip; their bottom is not a paragraph page break. A detached head
        // answers to its span, not to its own row's rule.
        !vertical && (isDetached ? !clipsSpan : exactHeightPt === undefined),
        clipsSpan ||
          clipsExactCellRow(
            vertical,
            exactHeightPt,
            isDetached,
            cell.headsVerticalMerge === true,
            rowTop,
            maxBottom
          )
      );

    if (!cell.vMergeContinue && !waits(cell)) {
      if (contentMaxBottom < contentTop - 0.001) {
        complete = cursor.blockIndex >= cell.blocks.length;
      } else {
        const flow = flowTo(flowRight);
        blocks = flow.blocks;
        contentBottom = flow.bottom;
        nextCursor = flow.cursor;
        complete = flow.complete;
        fitted = flow.fitted;
        nestedSplitBlocked = flow.nestedSplitBlocked;
        if (fitted) anyFitted = true;
        if (nestedSplitBlocked) anyNestedBlocked = true;
      }
    }

    // Fitted content owns the height (including its final paragraph's spaceAfter). Do not
    // re-floor with defaultLineHeight — that invented bottom pad when the measured line was
    // shorter than the DEFAULT_RUN_STYLE line. Continuations contribute no phantom line.
    const lastBlock = blocks.at(-1);
    const appliedMarkFloor =
      complete && lastBlock?.kind === 'paragraph' && lastBlock.box.height > 0 ? markFloor : 0;
    const cellBottom = Math.min(
      cellMaxBottom,
      Math.max(
        rowTop + appliedMarkFloor,
        cell.vMergeContinue || waits(cell)
          ? continuationPt > 0
            ? rowTop + topInset + continuationPt + insets.bottom
            : rowTop
          : fitted
            ? contentBottom + insets.bottom
            : rowTop + topInset + defaultLineHeight + insets.bottom
      )
    );
    if (cellBottom > rowBottom && !isDetached) rowBottom = cellBottom;

    flowed.push({
      cell,
      x: cellX,
      width: cellW,
      gridColumn,
      blocks,
      contentTop,
      contentBottom,
      physicalBottom: cellBottom,
      insets: { ...insets, top: topInset },
      nextCursor,
      // A head its fixed span clips owes nothing: what the span cannot hold is not carried.
      complete: cell.vMergeContinue || clipsSpan ? true : complete,
      fitted,
      nestedSplitBlocked,
      ...(waits(cell) ? { flowTo } : {}),
    });
  }

  rowBottom = Math.min(flowMaxBottom, Math.max(rowBottom, rowTop));
  for (const entry of flowed) {
    if (detachedSpans?.has(entry.cell.id) === true) continue;
    const needed = entry.physicalBottom;
    if (needed > rowBottom && needed <= flowMaxBottom + 0.001) {
      rowBottom = needed;
    }
  }
  // A row whose ONLY cells are detached merge heads has had nothing raise it: the two passes
  // above skip detached cells on purpose. Keep its paragraph-line floor, but do not
  // apply that floor to rows consisting entirely of continuation cells: the merged
  // head and authored row heights already supply their required span geometry.
  if (
    rowBottom <= rowTop + 0.001 &&
    flowed.some(
      (entry) =>
        !entry.cell.vMergeContinue && !cellHidesEndMark(entry.cell, deps.documentFirstParagraphId)
    )
  ) {
    let lineBottom = rowTop;
    for (const entry of flowed) {
      if (cellHidesEndMark(entry.cell, deps.documentFirstParagraphId)) continue;
      const line = rowTop + entry.insets.top + defaultLineHeight + entry.insets.bottom;
      if (line > lineBottom) lineBottom = line;
    }
    rowBottom = Math.min(flowMaxBottom, lineBottom);
  }
  rowBottom = Math.min(flowMaxBottom, rowBottom);

  // Exact: force the authored height (clamped to the page budget) and clip leftover content.
  // atLeast: a complete row fills its minimum, bounded by the available page band.
  let clipExact = false;
  let appliedTerminalBorderPt = 0;
  if (exactHeightPt !== undefined) {
    const exactBottom = rowTop + exactHeightPt;
    if (exactBottom <= maxBottom + 0.001) {
      appliedTerminalBorderPt = terminalBorderPt;
      rowBottom = exactBottom + appliedTerminalBorderPt;
      clipExact = true;
    } else {
      // Exact taller than remaining band — keep content-sized clamp; pagination fails closed.
      rowBottom = Math.min(maxBottom, rowBottom);
    }
  } else {
    // Two floors: the authored `atLeast` CONTENT minimum and the height a vMerge span
    // assigned this row. The authored minimum also floors the fragment that completes a
    // split row: its continuation is at least that tall. The span floor applies to the first
    // fragment only, since flooring both halves counts the span twice. A span floor already
    // includes the row's insets through its height probe. Pad only the authored minimum,
    // then take the maximum, or merged rows count the padding twice.
    const authoredFloorPt =
      atLeastHeightPt === undefined
        ? 0
        : authoredRowMinimumFloorPt(
            atLeastHeightPt,
            flowed,
            deps.cellMinimumContentInsets,
            rowGapPt
          );
    const spanFloorPt = isContinuation ? 0 : (vMerge?.heightFloorPt ?? 0);
    const minBottom = rowTop + Math.max(Math.min(authoredFloorPt, maxBottom - rowTop), spanFloorPt);
    const floors = minBottom > rowBottom && minBottom <= maxBottom + 0.001;
    if (floors && flowed.every((entry) => entry.complete)) rowBottom = minBottom;
  }
  rowBottom = Math.min(maxBottom + appliedTerminalBorderPt, rowBottom);
  const rowHeight = Math.max(0, rowBottom - rowTop);
  const cellHeight = Math.max(0, rowHeight - rowGapPt);
  if (layOutWaitingBottomToTopCells(flowed, rowHeight) && markSizedRow) anyFitted = true;

  const cells: TableCellFragmentRecord[] = flowed.map((entry) => {
    let blocks = entry.blocks;
    // vAlign only when the cell finished on this fragment (no more continuation).
    const cellComplete = clipExact ? true : entry.complete;
    if (
      !entry.cell.vMergeContinue &&
      cellComplete &&
      entry.cell.vAlign !== 'top' &&
      blocks.length > 0
    ) {
      const contentHeight = entry.contentBottom - entry.contentTop;
      const available =
        entry.cell.textDirection === 'btLr'
          ? entry.width - entry.insets.left - entry.insets.right - contentHeight
          : cellAlignmentRoom(
              rowHeight - appliedTerminalBorderPt,
              entry.insets.top,
              entry.insets.bottom,
              contentHeight
            );
      if (available > 0)
        blocks = alignCellContent(blocks, cellAlignmentShift(entry.cell.vAlign, available));
    }
    return {
      id: entry.cell.id,
      ...(entry.cell.revisionShading
        ? {
            revisionShading: entry.cell.revisionShading,
            revisionShadingAuthor: entry.cell.revisionShadingAuthor,
          }
        : {}),
      gridColumn: entry.gridColumn,
      ...(entry.cell.logicalGridColumn === undefined
        ? {}
        : { logicalGridColumn: entry.cell.logicalGridColumn }),
      ...(entry.cell.gridColumnId ? { gridColumnId: entry.cell.gridColumnId } : {}),
      gridSpan: entry.cell.gridSpan,
      vMergeContinue: entry.cell.vMergeContinue,
      ...(entry.cell.vMergeContinue ? { paintInert: true as const } : {}),
      rowSpan: 1,
      ...(entry.cell.shading === undefined ? {} : { shading: entry.cell.shading }),
      ...(entry.cell.textDirection === 'btLr' ? { textDirection: 'btLr' as const } : {}),
      blocks,
      box: { x: entry.x, y: rowTop + rowGapPt, width: entry.width, height: cellHeight },
    };
  });

  // Exact clips: leftover cell content is not continued onto the next page (17.18.37).
  const remainderCursors = clipExact
    ? null
    : flowed.every((entry) => entry.complete)
      ? null
      : flowed.map((entry) => entry.nextCursor);
  const complete = clipExact || flowed.every((entry) => entry.complete);

  rememberBottomToTopRelayouts(flowed, cells);
  flushDeferred(cells, rowTop, rowHeight, cellTextAreas(flowed));

  return {
    record: {
      id: row.id,
      ...authoredRowFields(row),
      rowIndex: 0,
      isHeaderRow: row.isHeader,
      isHeaderRepeat,
      ...(isContinuation ? { isContinuation: true as const } : {}),
      ...(row.cantSplit || row.height.rule === 'exact' ? { placesWhole: true as const } : {}),
      cells,
      box: { x: left, y: rowTop, width: total, height: rowHeight },
    },
    bottom: rowBottom,
    remainder: complete ? null : remainderCursors,
    fitted: anyFitted || row.cells.every((cell) => cell.vMergeContinue) || clipExact,
    nestedSplitBlocked: anyNestedBlocked,
  };
}

/** Lay out every row of a structure (no pagination) and finalize merges/borders. */
export function layoutTableFragment(
  structure: SemanticTableStructure,
  left: number,
  top: number,
  fragmentIndex: number,
  tableId: string,
  depth: number,
  deps: TableFlowDeps,
  isHeaderRepeat: (row: SemanticTableRow) => boolean = () => false
): { readonly fragment: TableFragmentRecord; readonly bottom: number } {
  // No merge planning here, deliberately. Planning gives a head a bound it can hand a
  // remainder back against, and the only lossless answer to that is to place the row again —
  // which needs a sink the discarded attempt's anchored drawings can be taken back from.
  // This function publishes straight through the `deps` it is handed and has none, so it
  // sizes merged heads the way this file did before it planned anything. A caller that wants
  // the planning has to bring a rollback-able sink with it, as `emitNestedTable` does.
  const rawRows: TableRowFragmentRecord[] = [];
  const occurrenceInsets = new Map<
    TableRowFragmentRecord,
    ReadonlyMap<string, CellContentInsets>
  >();
  let y = top;
  for (const [index, row] of structure.rows.entries()) {
    const rowDeps = index === 0 ? firstRowContentDeps(structure, row, deps) : deps;
    const placed = layoutRowFragment(
      row,
      structure.columnWidthsPt,
      left,
      y,
      isHeaderRepeat(row),
      depth,
      rowDeps,
      structure.cellSpacingPt
    );
    rawRows.push(placed.record);
    if (rowDeps.cellContentInsets) occurrenceInsets.set(placed.record, rowDeps.cellContentInsets);
    y = placed.bottom;
  }
  y += closingCellSpacingPt(structure);
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget,
    undefined,
    undefined,
    undefined,
    occurrenceInsets
  );
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
  const rowOrdinals = new Map<string, number>();
  return {
    fragment: annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: `${tableId}#f${fragmentIndex}`,
        tableId,
        fragmentIndex,
        rows,
        box: { x: left, y: top, width, height: y - top },
      },
      structure.columnWidthsPt,
      depth,
      rowOrdinals
    ),
    bottom: y,
  };
}
