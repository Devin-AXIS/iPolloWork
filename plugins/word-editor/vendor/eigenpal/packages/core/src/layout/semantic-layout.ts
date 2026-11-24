import { sectionPrepassInputsMatch } from './section-prepass-inputs.ts';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';
import { tryUpdateTableSession, reuseUnchangedLayout } from './table-text-session.ts';
import { carryLayoutReadCaches } from './layout-read-caches.ts';
import { withFieldResultsMode } from '../store/package/field-result-mode.ts';
import { resolveBodyRefFields } from './style-separator-ref.ts';
import { styleSeparatorToken } from './style-separator-group.ts';
import {
  bodyParagraphCacheKey,
  bodyParagraphOptionFlow,
  bodyParagraphPlacementFlow,
  bodyContentBounds,
  framedParagraphFlow,
} from './body-paragraph-flow.ts';
import { layoutWithCharacterHeadersSteps } from './character-header-layout.ts';
import { contextualParagraphSpacing, flowNeighbourBeside } from './contextual-paragraph-spacing.ts';
import { resolveParagraphFrame } from './paragraph-drop-cap.ts';
import {
  anchorLineSkipsExclusion,
  anchorsSpacingDependentBand,
  createLinePlacementZones,
} from './drawing-placement-exclusion.ts';
import { createParagraphDrawingWrap } from './paragraph-drawing-wrap.ts';
import { continuedPageZones, continuedWrapFlags } from './continued-page-zones.ts';
import { retainedFurnitureWrap } from './furniture-drawing-exclusion.ts';
import { tocLinkRanges, tocLinkStyleToken } from './toc-link-formatting.ts';
import { tocCodeRanges } from './field-code-toc.ts';
import { tocIdsToken, type TocIdSets } from './toc-id-sets.ts';
import { createLiveExclusionZones } from './live-exclusion-zones.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import * as sectionPrep from './section-preparation.ts';
import { resolveListAutoSpacing } from './list-auto-spacing.ts';
import { emptyParagraphStyleFields, markStyleOf } from './empty-paragraph-style.ts';
import { anchorsFrames, frameOrigins, positionedFrameBottom } from './paragraph-frame.ts';
import { ParagraphFrameFlow } from './paragraph-frame-flow.ts';
// Semantic paragraph layout over the canonical tree (tasks 7.1, 7.3).
//
// Produces the revision-tagged records in `semantic-records.ts`: pages, paragraph fragments,
// lines and style spans, each carrying a stable source range. It reads the CANONICAL TREE
// and a measurement port, never the DOM and never ProseMirror.
//
// A paragraph that does not fit the remaining page height is FRAGMENTED rather than moved
// wholesale: the lines that fit stay, the rest continue on the next page under the same
// paragraph id. That is what makes a cross-page paragraph one paragraph for selection and
// two boxes for pagination.

import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { WML_MAIN_DOCUMENT_PART } from '../store/package/opc-names.ts';
import {
  finalizePageFieldProjection,
  summarizeFlushedPage,
  withPageFieldSources,
} from './field-projection.ts';
import {
  aggregateParagraphTokensForTableBlock,
  framedTokenJoin,
  listTokenForTableBlock,
  paragraphLayoutKey,
  registerTableCellBreakKeys,
  createTableCellBreakKeyCollector,
  retainLiveBreakKeys,
  withDrawingContext,
} from './layout-cache.ts';
import {
  lineAlignmentMeasure,
  pendingLineFlowExtentAtPlacement,
  type PendingLine,
} from './paragraph-flow.ts';
import { alignBodyLineSpans, lineAlignOffset } from './paragraph-alignment.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  markRevisionFields,
  visibleParagraphMarkRevisionsOf,
} from './revision-projection.ts';
import {
  appliedSpaceBefore,
  paragraphBorderExtentPt,
  collapsedSpaceBefore,
} from './paragraph-style.ts';
import {
  adjustedBreakIndex,
  keepNextChains,
  markJoinFlowKeys,
  paragraphKeeps,
  KEEP_BREAK_RETRY_ALLOWANCE,
} from './pagination-keeps.ts';
import { positionedTableDeps } from './table-pinned-break.ts';
import {
  prepareParagraphBreakInputs,
  breakPreparedParagraphLazily,
  createParagraphBreakRetention,
} from './paragraph-break-request.ts';
import { collapsingSpaceAfter, resolveParagraphLayoutInputs } from './style-cascade.ts';
import { paragraphBorderGroupKey } from './cell-border-groups.ts';
import { paragraphBoxOutdent } from './paragraph-indent.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import { paragraphFragmentBorders } from './paragraph-fragment-borders.ts';
import { holdsOnlyPageBreak, lineBreakAfterFields, lineContentX } from './pending-line.ts';
import { interimSectionAligner, publishLayoutPass } from './layout-pass-publish.ts';
import { alignLineWithPictures } from './line-picture-alignment.ts';
import { createLeadingBreakGroups } from './leading-break-border-group.ts';
import { type TableAnchorFrames } from './semantic-table.ts';
import * as tableFloat from './table-float-position.ts';
import * as tableWrap from './table-float-exclusion.ts';
import {
  bodyAnchorFrameBase,
  openingAbove,
  holdsDrawingIn,
  atKeptBreakY,
  holdsOnlyColumnBreak,
  opensWithPageBreak,
  paragraphHoldsNothing,
  paragraphPaintsNothing,
} from './body-flow-helpers.ts';
import { shiftAnchoredDrawingY } from './drawing-overlap.ts';
import { createOwnAnchorPageFit, linesWithOwnAnchorNeeds } from './paragraph-own-anchors.ts';
import {
  collectAnchoredDrawings as collectAnchoredDrawingRecords,
  drawingSourceOrder,
} from './anchored-drawing-collect.ts';
import { keptFloatAnchor } from './balanced-float-anchors.ts';
import { createEarlierLinePush, ownTableStaysForAnchor } from './earlier-line-push.ts';
import { createStackPlacement } from './table-float-stack.ts';
import { isBareSectionMark } from './section-mark-break.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  paragraphDocumentOrderOf,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { paginateTableInFlowSteps, type TableFlowCursor } from './table-flow-pagination.ts';
import { tableKeepFlow } from './table-row-keeps.ts';
import * as terminalTables from './terminal-table-anchor.ts';
import { mergeBoundariesOf, remapMergedLines } from './merged-paragraph-ranges.ts';
import { resolvedParagraphMarkChangeSites } from './revision-formatting-projection.ts';
import { paragraphMergeGroupOf, storyBlocks } from './story-roots.ts';
import {
  clipInlineDrawingToBodyBand,
  columnPaperClip,
  publishAnchoredDrawingsForParagraph,
  anchoredDrawingAtomsInParagraph,
  pageClipRegion,
  shiftAnchoredDrawingRecords,
  shiftInlineDrawingRecord,
  type AnchoredDrawingRecord,
} from './drawing-layout.ts';
import {
  DrawingExclusionConvergenceError,
  exclusionLayoutToken,
  MAX_ANCHOR_PAGE_DEFERRALS,
  sortDrawingsForPaint,
  travellingTopAndBottomSkip,
  withAnchoredDrawingLayoutFallback,
  type ExclusionZone,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
} from './drawing-exclusion.ts';
import { bodyLineId } from './body-line-id.ts';
import { fragmentAnchorFrame } from './anchor-frame-lines.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { drawingTokenForTableBlockMemo, withDrawingSourceOrder } from './inline-drawing-source.ts';
import {
  emptyTocPlaceholderParagraphIds,
  emptyTocSuppressedResultParagraphIds,
  tocFieldChromeParagraphIds,
} from './toc-layout.ts';
import { furnitureLayoutContext, remapPage } from './hf-layout.ts';
import type { BodyPageFieldContext } from './field-page-furniture.ts';
import { createSectionPageFurniture } from './section-page-furniture.ts';
import { createPageContentInsets, registerOverflowPageShell } from './page-furniture-insets.ts';
import { convergenceTailShiftAllowed } from './page-reuse-guards.ts';
import { commonKeyPrefix, commonKeySuffix } from './flow-key-diff.ts';
import { createPreviousPassZones } from './previous-pass-zones.ts';
import { lineBandSkip, ownTableKeepsTop, tableBandSpaceAfter } from './table-band-space-after.ts';
import { hostSheetGeometry } from './continued-sheet-geometry.ts';
import { TextTableCarry } from './table-text-carry.ts';
import { documentOpeningCellParagraph } from './table-cell-terminator.ts';
import { layoutPassContextKey } from './layout-pass-context-key.ts';
import {
  contentControlContextToken,
  withContentControlMetadata,
} from './content-control-boundary-layout.ts';
import {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSectionsFromBlocks,
  geometryOfSection,
  paragraphSectionNode,
  sectionLineGridPt,
} from './section-properties.ts';
import { pageBreakBeforeRules } from './page-break-before.ts';
import { previousBodyLayout } from './previous-body-pages.ts';
import { columnBoxAt, columnSeparatorBoxes, resolveSectionColumns } from './section-columns.ts';
import {
  inheritNotesLayoutInput,
  layoutSemanticDocumentWithNotesSteps,
  noteRoundBlocks,
} from './note-pagination.ts';
import { closingSpaceAfterPt, droppableSpacingPt, keepNoteClosing } from './note-area-fit.ts';
import { passProducerOf } from './pass-producer.ts';
import { documentProjectionProducer } from './document-property-context.ts';

import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type ParagraphFragmentRecord,
  type LayoutBox,
  type LineRecord,
  type PageRecord,
  type SemanticLayout,
} from './semantic-records.ts';
import { withResolvedListItems, withResolvedListItemsForSession } from './list-resolve.ts';
import { listItemToken, markerFlowToken, relabelListMarkers } from './list-marker-reuse.ts';
import { limitBodyBlocks } from './body-block-limit.ts';
import { refTokenForTableBlock } from './field-ref.ts';
import {
  createListFirstLineMetrics,
  listMarkerAlignShift,
  listMarkerLineOffset,
  markerLineStart,
  publishListMarker,
} from './list-marker.ts';
import { FlowCheckpointOwner, flowCheckpointsMatch } from './flow-checkpoint.ts';
import { sectionReserveResume } from './note-reserve-resume.ts';
import {
  convergedCheckpoints,
  createLayoutSession,
  nextParityDependent,
  type FlowCheckpoint,
} from './layout-session.ts';
import { furnitureForSection, layoutMultiSectionDocumentSteps } from './multi-section-layout.ts';
import { hostedStoryFlowDeps, layoutTextboxStory } from './textbox-story-layout.ts';
import { inlineDrawingFlow } from './inline-textbox-flow.ts';
import { convergeExclusionLayout } from './exclusion-layout-steps.ts';
import { withAlignedProgress, withInterimLayout, withRelabeledProgress } from './interim-layout.ts';
import { layoutWithFurnitureRetry } from './furniture-retry-layout.ts';
import { drainLayoutSteps, stepsInFieldResultsMode, type LayoutSteps } from './layout-steps.ts';
import { preparedBlocks } from './prepared-block-memo.ts';
import { tableTopLeads } from './cell-edge-neighbours.ts';
import {
  type BlockLayoutOptions as ColumnBalanceBlockLayoutOptions,
  type BlockLayoutResult,
} from './column-balance-layout.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import type { PreparedBlock, SectionPrepass } from './section-prepass-types.ts';
import { sectionFlowKeys } from './section-flow-keys.ts';

export type BlockLayoutOptions = ColumnBalanceBlockLayoutOptions<SemanticLayoutOptions> & {
  readonly disabledParagraphFrameIds?: ReadonlySet<string>;
  readonly paragraphFrameFallbackRound?: number;
  /** Set by the one retry of `layoutBlocksWithGeometry`: blocking unsupported furniture zones yield. */
  readonly yieldHiddenFurnitureZones?: boolean;
};

/**
 * Lay one story part out into pages.
 *
 * The engine's layout entry point. Walks body, header, footer and note roots, flattens block
 * SDTs, paginates tables with header-row repeats and vertical merges, and resolves every
 * paragraph through the style cascade.
 *
 * Incremental when given a {@link LayoutSession}: per-block cache keys plus flow checkpoints mean
 * a pass that changes nothing returns the previous pages by identity.
 */
export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  return withFieldResultsMode(options.fieldResults, () =>
    drainLayoutSteps(layoutSemanticDocumentSteps(part, revision, options))
  );
}

/**
 * {@link layoutSemanticDocument}, pausing inside long tables of a single-section body without
 * notes; see `layout-steps.ts`. Other documents lay out as one step.
 *
 * @internal
 */
export function layoutSemanticDocumentSteps(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): LayoutSteps<SemanticLayout> {
  // The footnote search lays the body out several times; a private session lets each round
  // reuse the last one's work, as a cold open with a session does.
  const opts =
    options.notes && !options.session ? { ...options, session: createLayoutSession() } : options;
  return stepsInFieldResultsMode(options.fieldResults, layoutInModeSteps(part, revision, opts));
}

function* layoutInModeSteps(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): LayoutSteps<SemanticLayout> {
  // ONE revision projection for both. Section block ranges index this exact list; using a
  // different display mode or author predicate maps filtered blocks to the wrong geometry.
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const authorFilter = options.revisionAuthorFilter;
  const { blocks, all: allBlocks } = limitBodyBlocks(
    storyBlocks(part, displayMode, authorFilter, options.styleCascade, options.numberingIndex),
    options
  );
  // A prefix that cuts nothing IS the document: its page fields and footnote search are final.
  if (options.bodyBlockLimit !== undefined && blocks.length === allBlocks.length)
    options = { ...options, bodyBlockLimit: undefined };
  const sections = enumerateDocumentSectionsFromBlocks(part, blocks).sections;
  // Wrapper-only metadata (alias/tag/lock/…) lives outside flattened paragraph nodes. Fold a
  // fingerprint into the producer so incremental identity reuse cannot keep stale boundaries.
  const controlToken = contentControlContextToken(part);
  const linkStyleRanges = tocLinkRanges(part);
  const optionsWithControlContext: SemanticLayoutOptions = {
    ...options,
    fieldCodeRanges: options.showFieldCodes ? tocCodeRanges(part) : undefined,
    tocLinkStyleRanges: linkStyleRanges,
    displayMode,
    producer: documentProjectionProducer(options, controlToken, tocLinkStyleToken(linkStyleRanges)),
    tocFieldChromeParagraphIds:
      options.tocFieldChromeParagraphIds ?? tocFieldChromeParagraphIds(part),
    emptyTocPlaceholderParagraphIds:
      options.emptyTocPlaceholderParagraphIds ?? emptyTocPlaceholderParagraphIds(part),
    emptyTocSuppressedResultParagraphIds:
      options.emptyTocSuppressedResultParagraphIds ?? emptyTocSuppressedResultParagraphIds(part),
  };
  // Full-body list resolve so counters continue across sections and table cells.
  const drawingOptions = withDrawingSourceOrder(optionsWithControlContext, part);
  const optionsWithLists = options.session
    ? withResolvedListItemsForSession(drawingOptions, allBlocks, options.session)
    : withResolvedListItems(drawingOptions, allBlocks);

  // REF cross-references resolve against the document's bookmarks and resolved numbering,
  // so the context is built here — the one place that sees both — and rides the options
  // spreads into every section pass. Note stories join the context (their REF fields cite
  // body targets), so paint agrees across stories. Null for the common REF-free document.
  // NOTEREF fields number against THIS walk's section bounds paired with the notes input's
  // per-section properties — the pairing `attachNotesToLayout` numbers the note areas with,
  // so field and area agree by construction.
  // Over the whole body, so a field before an opening's cut keeps its later target's value.
  const refFields = resolveBodyRefFields(
    part,
    allBlocks,
    blocks === allBlocks ? sections : enumerateDocumentSectionsFromBlocks(part, allBlocks).sections,
    optionsWithLists
  );
  const optionsForBody = refFields === null ? optionsWithLists : { ...optionsWithLists, refFields };

  function* runBodySteps(opts: SemanticLayoutOptions): LayoutSteps<SemanticLayout> {
    const [roundBlocks, roundSections] = noteRoundBlocks(part, blocks, sections, opts);
    if (sections.length > 1) {
      // Reports document pages as each section completes them, labelled as a single section's.
      return yield* withRelabeledProgress(
        layoutMultiSectionDocumentSteps(
          roundBlocks,
          roundSections,
          revision,
          opts,
          layoutBlocksWithGeometrySteps
        ),
        optionsWithLists.listItems,
        options.measurer
      );
    }

    const section = roundSections[0];
    const geometry =
      opts.geometry ?? (section ? geometryOfSection(section.properties) : DEFAULT_PAGE_GEOMETRY);
    const furniture = furnitureForSection(opts, 0, roundSections.length) ?? opts.furniture;
    const sectionNumbering = section?.properties.pageNumbering;
    const interim = {
      revision,
      numbering: sectionNumbering,
      listItems: optionsWithLists.listItems,
    };
    const laid = yield* withInterimLayout(
      layoutBlocksWithGeometrySteps(roundBlocks, revision, {
        ...opts,
        geometry,
        furniture,
        furniturePageNumberStart: sectionNumbering?.start ?? 1,
        paragraphLineUnitPt: sectionLineGridPt(section?.properties),
        sectionColumns: section?.properties.columns ?? DEFAULT_SECTION_PROPERTIES.columns,
        ...(section?.properties.pageBorders
          ? { sectionPageBorders: section.properties.pageBorders }
          : {}),
        ...(sectionNumbering?.fmt ? { bodyPageNumberFormat: sectionNumbering.fmt } : {}),
      }),
      { ...interim, measurer: options.measurer }
    );
    const numbering = sectionNumbering;
    // Carry boundary metadata through field annotation so a no-change resume still early-exits
    // in `attachContentControlBoundaries` instead of allocating a fresh `pages` array.
    const annotated: SemanticLayout = withContentControlMetadata(
      {
        revision: laid.layout.revision,
        pages: withPageFieldSources(
          laid.pages,
          numbering?.start ?? 1,
          laid.pages.length,
          numbering?.fmt
        ),
      },
      laid.layout
    );
    const finalized = finalizePageFieldProjection(annotated, {
      provisional: opts.bodyBlockLimit !== undefined || opts.noteRoundBlockLimit !== undefined,
    });
    carryLayoutReadCaches(laid.layout, finalized);
    // The notes pass mints overflow sheets from this layout; publish what index they land at.
    registerOverflowPageShell(finalized, (_sectionAnchorIndex, documentPageIndex, box, shift) =>
      laid.overflowShellAt(documentPageIndex, box, shift)
    );
    if (opts.session) {
      opts.session.multi = null;
      opts.session.previous = finalized;
    }
    return finalized;
  }
  const finish = (layout: SemanticLayout): SemanticLayout => {
    let projected = layout;
    if (layout.displayMode !== displayMode) {
      const { contentControls, controlContextToken, ...base } = layout;
      projected = {
        ...base,
        displayMode,
        ...(contentControls !== undefined ? { contentControls } : {}),
        ...(controlContextToken !== undefined ? { controlContextToken } : {}),
      };
    }
    // Reused records keep the labels they were laid out with; renumbered ones get theirs here.
    // A sliced open's prefix passes only append blocks, which renumber nothing before them.
    if (options.session && options.bodyBlockLimit === undefined) {
      projected = relabelListMarkers(projected, optionsWithLists.listItems, options.measurer);
    }
    const pass = publishLayoutPass(projected, part, controlToken, allBlocks, sections, blocks);
    carryLayoutReadCaches(layout, pass.published);
    if (options.session) options.session.previous = pass.retained;
    return pass.published;
  };

  if (!options.notes && options.session) {
    options.session.notes = null;
    options.session.notePageBottomReserves = null;
  }
  // Notes inherit the body's projector seams and document properties (link, field link, doc
  // props) unless the notes input pinned its own — see `inheritNotesLayoutInput`. The REF
  // context rides along the same way: the note flow folds each paragraph's resolved values
  // into its break key and the notes-pass fingerprint folds the values token, so a
  // renumbering edit repaints the notes that cite the renumbered target.
  const notesInput =
    options.notes &&
    inheritNotesLayoutInput(options.notes, refFields ? { ...options, refFields } : options);
  const steps = layoutWithCharacterHeadersSteps(part, optionsForBody, (opts) =>
    notesInput
      ? layoutSemanticDocumentWithNotesSteps(part, sections, opts, notesInput, runBodySteps, blocks)
      : runBodySteps(opts)
  );
  const aligner = interimSectionAligner(part, controlToken, sections, blocks);
  return finish(yield* withAlignedProgress(steps, aligner));
}

function* layoutBlocksPass(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions
): LayoutSteps<BlockLayoutResult> {
  const geometry = options.geometry;
  const keyFor = options.cache?.keyFor?.bind(options.cache) ?? paragraphLayoutKey;
  const contentWidthForReflow = geometry.width - geometry.margin.left - geometry.margin.right;
  const columns = resolveSectionColumns(
    options.sectionColumns ?? DEFAULT_SECTION_PROPERTIES.columns,
    contentWidthForReflow
  );
  // Drawings, frames and floating tables reflow under the zones they produce; that loop
  // lays the blocks out again, so it owns the result when it applies.
  const exclusions = yield* convergeExclusionLayout(
    bodies,
    revision,
    options,
    columns,
    contentWidthForReflow,
    layoutBlocksWithGeometrySteps
  );
  if (exclusions) return exclusions;

  const measurer = options.measurer;
  const cache = options.cache;
  // Defaults to a constant deliberately NAMED for the risk: fonts resolve asynchronously, so
  // a caller that swaps the measurer without changing this is served the pre-font layout for
  // the rest of the session. The style-cascade token is folded in so a different styles part
  // cannot reuse breaks measured under another inheritance table.
  const styleCascade = options.styleCascade;
  const listItems = options.listItems;
  const refFields = options.refFields;
  // The default-tab interval moves every default-interval tab, and the prepared-block memo
  // is keyed by producer — so it belongs here rather than only in the per-paragraph token.
  const defaultTabStopPt = options.defaultTabStopPt;
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const authorFilter = options.revisionAuthorFilter;
  const showsMarkup = displayMode === 'all-markup';
  const tocChromeParagraphIds = options.tocFieldChromeParagraphIds;
  const emptyTocPlaceholderIds = options.emptyTocPlaceholderParagraphIds;
  const emptyTocSuppressedResultIds = options.emptyTocSuppressedResultParagraphIds;
  const tocIds: TocIdSets = {
    chrome: tocChromeParagraphIds,
    placeholder: emptyTocPlaceholderIds,
    suppressed: emptyTocSuppressedResultIds,
  };
  /** `''` for a part with no TOC, which skips the per-block verdict scan entirely. */
  const tocToken = tocIdsToken(tocIds);
  // In `producer`, not beside it in the section context: a note mark is measured INTO the
  // broken lines, so the break cache holds the citation's width under a key built from
  // this. Keying only the section left a warm cache serving `1`-wide slots to roman marks.
  //
  // NOT THE NUMBER OF LIST ITEMS. `producer` is in the session context, in every paragraph's
  // break-cache key and in the prepared-block memo, so folding a COUNT in meant one Enter in
  // a list re-measured every paragraph in the document and rebuilt every page — while two
  // different numbering states with the same count still hashed the same. What a numbering
  // change actually affects is each list paragraph, and each one carries its own
  // `listItem.cacheToken` in its key and in the memo above.
  const producer = passProducerOf(
    options.disabledParagraphFrameIds?.size
      ? framedTokenJoin([
          options.producer ?? '',
          framedTokenJoin([...options.disabledParagraphFrameIds].sort()),
        ])
      : options.producer,
    styleCascade,
    options.noteMarks,
    defaultTabStopPt,
    displayMode,
    authorFilter,
    options.bodyPageNumberFormat,
    options.compatibilityMode
  );

  // Prepass and incremental keys use the first region. Placement re-prepares a block when it
  // enters an unequal-width later column; multi-column passes conservatively skip resume.
  const contentWidth = columns.widths[0]!;
  const keptTables = tableKeepFlow(options, contentWidth, styleCascade);

  // PAGE FURNITURE. A header taller than the top-margin remainder pushes that page's content
  // area down (Word's behaviour), and the header a page shows is the one its OWN variant
  // resolves to — see `page-furniture-insets.ts` for why the worst case over the variants is
  // not the same thing.
  const furniture = options.furniture;
  const headerDistance = geometry.headerDistance ?? 36;
  const footerDistance = geometry.footerDistance ?? 36;
  const pageBottomReserves = options.pageBottomReserves;
  const session = options.session;
  const lineCounterStart = options.lineCounterStart ?? 0;
  const furniturePageNumberStart =
    options.furniturePageNumberStart ?? (options.pageIndexStart ?? 0) + 1;
  const furnitureContext =
    furnitureLayoutContext(furniture, headerDistance, footerDistance) +
    (furniture?.evenAndOddHeaders ? `|fp:${furniturePageNumberStart & 1}` : '');
  const flowStartY = options.flowStartY ?? 0;
  const spaceBeforeCarry = options.spaceBeforeCarry ?? 0;
  // Physical sheet position remains separate from displayed header/footer numbering.
  const pageIndexStart = options.pageIndexStart ?? 0;
  const insetsFor = createPageContentInsets({
    ...(furniture ? { furniture } : {}),
    pageHeight: geometry.height,
    marginTop: geometry.margin.top,
    marginBottom: geometry.margin.bottom,
    headerDistance,
    footerDistance,
    pageIndexStart,
    pageNumberStart: furniturePageNumberStart,
    ...(options.continuedPageInsets ? { continuedPageInsets: options.continuedPageInsets } : {}),
  });
  /**
   * What the body flow measures a page-field placeholder against.
   *
   * The section's `w:pgNumType/@w:fmt` rides along as the format a PAGE field without
   * switches renders in. A section is one format, so this is fixed for the pass.
   */
  const bodyPageFieldContext: BodyPageFieldContext = Object.freeze(
    options.bodyPageNumberFormat !== undefined ? { format: options.bodyPageNumberFormat } : {}
  );
  const leadingBreakGroups = createLeadingBreakGroups(options, bodyPageFieldContext);

  const columnRegionBottom = options.columnRegionBottom;
  const columnRegionPage = options.columnRegionPage ?? 0;
  const continuedInsets = options.continuedPageInsets;
  // Local page 0 of a continued section IS the host sheet: its text wraps around the host's
  // header and footer drawings (never this section's) and the floats earlier sections left.
  const continuedZones =
    continuedInsets && options.continuedPageFurniture
      ? continuedPageZones(
          options.continuedPageFurniture,
          continuedInsets,
          geometry.margin.left,
          contentWidthForReflow,
          {
            omitHiddenFurniture: options.yieldHiddenFurnitureZones,
            drawingLayout: options.inlineDrawingLayout,
          }
        )
      : undefined;
  const contextFor = layoutPassContextKey({
    geometry,
    flowStartY,
    spaceBeforeCarry,
    continuedInsets,
    continuedZones: continuedZones ? exclusionLayoutToken(continuedZones) : '',
    furnitureContext,
    columns,
    columnRegionBottom,
    columnRegionPage,
    sectionPageBorders: options.sectionPageBorders,
    sectionMarkCollapses: options.sectionMarkCollapses,
  });
  // Only the reserve entries THIS pass can read belong in its context key.
  const reserveResume = sectionReserveResume(
    session,
    contextFor,
    pageBottomReserves,
    pageIndexStart,
    options.pageBottomReservesFollowFlow === true
  );
  const context = reserveResume.context;
  const startPageParity = pageIndexStart & 1;
  /** Set when this pass places an anchored drawing whose geometry reads page parity. */
  let usedPageParity = false;
  const collectingCellBreakKeys = createTableCellBreakKeyCollector();
  const markPageParityRead = (): void => {
    usedPageParity = true;
  };

  const pages: PageRecord[] = [];
  // Built HERE, above the unchanged-pass early return below, not beside the flow that uses it.
  // `overflowShellAt` is handed to the notes pass by that return; a closure over a `const`
  // declared after it would stay in its temporal dead zone, as the rest never runs there.
  const sectionFurniture = createSectionPageFurniture({
    ...(furniture ? { furniture } : {}),
    geometry,
    headerDistance,
    footerDistance,
    pageIndexStart,
    pageNumberStart: furniturePageNumberStart,
    contentWidth: contentWidthForReflow,
    insetsFor,
    pageCount: () => pages.length,
    ...(options.sectionPageBorders ? { pageBorders: options.sectionPageBorders } : {}),
  });
  const { pageBox, overflowShellAt, furnitureZonesFor, pageShell } = sectionFurniture;

  const { furnitureHasWrap, furnitureHoldsTables, admission } = continuedWrapFlags(
    retainedFurnitureWrap(furniture, options.yieldHiddenFurnitureZones, furnitureZonesFor),
    continuedZones
  );
  const liveZones = createLiveExclusionZones(options, columns, contentWidthForReflow, bodies);
  const previousPassZones = createPreviousPassZones({
    byPage: options.drawingExclusionZonesByPage,
    hostZones: continuedZones,
    furnitureHoldsTables,
    furnitureZones: (index) => furnitureZonesFor(index, options.yieldHiddenFurnitureZones),
  });
  const pageExclusionZones = (): readonly ExclusionZone[] =>
    liveZones.zones(pages, pendingAnchoredDrawings, previousPassZones(pages.length));

  /**
   * Available body height on the page currently being filled (`pages.length`).
   *
   * A balance-search limit binds the selected page only: content pushed past it lands on a
   * full-height overflow page, so a block taller than the limit still terminates, and the
   * search reads an increased page count as "does not fit".
   */
  const contentHeightOf = (reservedPt: number, index = pages.length): number => {
    const base = Math.max(1, insetsFor(index).height - reservedPt);
    return columnRegionBottom !== undefined && index === columnRegionPage
      ? Math.max(1, Math.min(base, columnRegionBottom))
      : base;
  };
  const contentHeight = (index = pages.length): number =>
    // Reserves are keyed by DOCUMENT page index (computeFootnoteReserves); this pass fills
    // the document page at `pageIndexStart + index`. A continuous section's local page 0
    // IS the previous section's last sheet: both passes read the same document slot, so
    // every flow sharing the sheet stops above the same note area.
    contentHeightOf(reserveResume.reserveAt(index) ?? 0, index);
  const noteReserveHere = () => reserveResume.reserveAt(pages.length);
  /** The same band with the footnote reserve ignored — the table paginator's recovery. */
  const unreservedContentHeight = (): number => contentHeightOf(0);

  // Prepass: everything needed to KEY a paragraph, before any of them is placed. Resuming
  // means knowing where the first change is, and that cannot be discovered while walking.
  //
  // Memoized on NODE IDENTITY: a paragraph the commit did not touch is the same object, and
  // its properties, indents and key derive from nothing but the node, the available width
  // and the producer. Recomputing the key — a serialization of the paragraph's subtree —
  // for every paragraph on every pass made the prepass, not placement, the cost of an
  // incremental layout: a one-character edit re-keyed the entire document.
  // Constant per pass. `withDrawingContext` folds it into EVERY per-block drawing token
  // and into the prepass epoch below, so key namespacing and memo validity can never
  // disagree about which context minted a key — including a caller that supplies tokens
  // while toggling the context, which a fallback-only namespace could not separate.
  const hasInlineDrawingContext = options.inlineDrawingLayout !== undefined;
  // Body textbox stories flow without a page-field context: a PAGE field inside a body text
  // box contributes only its cached result, like a direct body field.
  const layoutTextboxStoryForBody = (
    projection: import('../store/package/drawing-projection.ts').DrawingProjection
  ) =>
    layoutTextboxStory(projection, {
      measurer,
      producer,
      cache,
      styleCascade,
      ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
      compatibilityMode: options.compatibilityMode,
      maxUnwrappedBoxWidthPt: contentWidthForReflow,
      ...(displayMode ? { displayMode } : {}),
      ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
      ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
      ...(options.projectLink ? { projectLink: options.projectLink } : {}),
      ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
      showFieldCodes: options.showFieldCodes,
      ...(options.numberingIndex ? { numberingIndex: options.numberingIndex } : {}),
      inlineDrawingLayout: options.inlineDrawingLayout,
      drawingTokenForParagraph: options.drawingTokenForParagraph,
      projectionTokenForParagraph: options.projectionTokenForParagraph,
      projectionTokenForTable: options.projectionTokenForTable,
    });
  // ONE capability for every hosted-story fold of this flow. The prepass block fold and
  // the cell lane below therefore cannot drift to different numbering inputs, and a future
  // lane cannot publish hosted stories without carrying the invalidation provider too.
  const hostedStory = hasInlineDrawingContext
    ? hostedStoryFlowDeps(
        layoutTextboxStoryForBody,
        options.numberingIndex,
        styleCascade,
        displayMode,
        authorFilter
      )
    : undefined;
  const marksPageBreak = options.sectionMarkCollapses !== true;
  const prepareBlock = (block: OoxmlElement, availableWidth: number): PreparedBlock => {
    // The RAW token, compared by the memo below so a table's kilobyte aggregate keeps its
    // identity fast path; the context joins only when a key is actually built. `||`, not
    // `??`, matching the cell lane: a per-paragraph callback answering `''` falls through
    // to the document-wide token.
    const paragraphDrawingToken =
      block.kind === 'paragraph'
        ? styleSeparatorToken(block, options.drawingTokenForParagraph) ||
          options.drawingLayoutToken ||
          ''
        : block.kind === 'table' && options.drawingTokenForParagraph
          ? drawingTokenForTableBlockMemo(
              block,
              options.drawingLayoutEpoch,
              options.drawingTokenForParagraph
            ) ||
            options.drawingLayoutToken ||
            ''
          : options.drawingLayoutToken || '';
    const projectionToken = `${
      block.kind === 'paragraph'
        ? styleSeparatorToken(block, options.projectionTokenForParagraph)
        : block.kind === 'table' && options.projectionTokenForParagraph
          ? (options.projectionTokenForTable?.(block) ??
            aggregateParagraphTokensForTableBlock(block, options.projectionTokenForParagraph))
          : ''
    }|${options.paragraphLineUnitPt ?? '-'}`;
    // A TABLE'S LIST STATE IS ITS CELLS'. `listItems` is keyed by PARAGRAPH, and a numbered
    // list that continues inside a table cell has its markers there — so reading the table's
    // own id gave an empty token, and a renumbering that left the table's flow key untouched
    // reused the cell markers verbatim. The drawing token aggregates for the same reason.
    // The list state of any text-box story this block hosts, for the same reason the drawing
    // token aggregates hosted-story atoms: a box's markers come from `numbering.xml`, and a
    // numbering edit moves nothing else in this block's key.
    const hostedListToken = styleSeparatorToken(block, hostedStory?.hostedListTokenForParagraph);
    // Length-framed pair: both sides embed file-influenced marker text (and the table
    // aggregate itself contains NULs), so no separator join stays injective.
    const ownListToken =
      block.kind === 'table'
        ? listTokenForTableBlock(block, listItems, styleCascade)
        : listItemToken(listItems?.get(block.id));
    const listToken =
      ownListToken === '' && hostedListToken === ''
        ? ''
        : framedTokenJoin([ownListToken, hostedListToken]);
    // The RESOLVED VALUES this block's REF fields paint. The block's own subtree is identical
    // after a renumbering edit elsewhere, so only this token can invalidate its memo and key.
    const refToken =
      refFields === undefined
        ? ''
        : block.kind === 'table'
          ? refTokenForTableBlock(block, refFields)
          : styleSeparatorToken(block, (member) => refFields.tokenForParagraph(member.id));
    const memo = preparedBlocks.get(block);
    if (
      memo &&
      memo.contentWidth === availableWidth &&
      memo.frameEnabled ===
        (columns.count === 1 && !options.disabledParagraphFrameIds?.has(block.id)) &&
      memo.marksPageBreak === marksPageBreak &&
      memo.producer === producer &&
      memo.drawingToken === paragraphDrawingToken &&
      memo.projectionToken === projectionToken &&
      memo.listToken === listToken &&
      memo.refToken === refToken &&
      memo.drawingContext === hasInlineDrawingContext
    ) {
      return memo.entry;
    }
    const keyedDrawingToken = withDrawingContext(paragraphDrawingToken, hasInlineDrawingContext);
    let entry: PreparedBlock;
    if (block.kind === 'table') {
      // Include cell and hosted-story list tokens to invalidate keys after renumbering.
      entry = {
        kind: 'table',
        table: block,
        key: keyFor({
          paragraph: block,
          properties: [
            ...(listToken ? [{ localName: 'list', attributes: { token: listToken } }] : []),
            ...(refToken ? [{ localName: 'refFields', attributes: { token: refToken } }] : []),
          ],
          width: availableWidth,
          producer,
          drawingToken: keyedDrawingToken,
          projectionToken,
        }),
      };
    } else {
      const listItem = listItems?.get(block.id);
      let preparedParagraph = resolveParagraphLayoutInputs(
        block,
        availableWidth,
        styleCascade,
        listItem,
        undefined,
        false,
        options.paragraphLineUnitPt
      );
      const frame =
        columns.count === 1 && !options.disabledParagraphFrameIds?.has(block.id)
          ? resolveParagraphFrame(
              block,
              preparedParagraph,
              measurer,
              styleCascade,
              options.inlineDrawingLayout,
              options.compatibilityMode
            )
          : undefined;
      if (frame)
        preparedParagraph = resolveParagraphLayoutInputs(
          block,
          frame.width,
          styleCascade,
          listItem,
          undefined,
          false,
          options.paragraphLineUnitPt
        );
      const {
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        outlineLevel,
        inheritedRunProperties,
        markRunProperties,
      } = preparedParagraph;
      // Before a section that opens a page, a bare section mark paints no borders or shading.
      const bareMark = marksPageBreak && !listItem && isBareSectionMark(block);
      const borders = bareMark ? {} : preparedParagraph.borders;
      const shading = bareMark ? undefined : preparedParagraph.shading;
      const { tabStops, properties: breakProperties } = prepareParagraphBreakInputs(
        preparedParagraph,
        defaultTabStopPt,
        { listToken: markerFlowToken(listItem), hostedListToken, refToken }
      );
      entry = {
        kind: 'paragraph',
        ...(frame ? { frame } : {}),
        paragraph: block,
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        outlineLevel,
        borders,
        // The box's own INSETS, not its resolved edges. `available` is
        // `contentWidth - indent.left - indent.right`, so keying on `indent.left + available`
        // folded the CONTENT WIDTH into the group's identity — and a multi-column section
        // prepares the prepass at column 0's width while placing each block at the width of
        // the column it lands in. With unequal columns those two never agreed, so grouping
        // collapsed outside column 0 and every paragraph there drew its own box. Which
        // column a paragraph lands in is a layout outcome; the group is an authored
        // relationship between neighbours, and only the authored insets may decide it.
        borderGroupKey: paragraphBorderGroupKey({ borders, indent, props }),
        shading,
        inheritedRunProperties,
        markRunProperties,
        tabStops,
        keeps: paragraphKeeps(props),
        ...(listItem ? { listItem } : {}),
        key: keyFor({
          paragraph: block,
          properties: breakProperties,
          width: available,
          producer,
          drawingToken: keyedDrawingToken,
          projectionToken,
        }),
      };
    }
    preparedBlocks.set(block, {
      contentWidth: availableWidth,
      frameEnabled: columns.count === 1 && !options.disabledParagraphFrameIds?.has(block.id),
      marksPageBreak,
      producer,
      drawingToken: paragraphDrawingToken,
      projectionToken,
      listToken,
      refToken,
      drawingContext: hasInlineDrawingContext,
      entry,
    });
    return entry;
  };
  // SECTION PREPASS MEMO. Everything derived below is a pure function of the block list
  // plus the inputs the memo compares, and on a typing pass in a many-section document
  // every section but the edited one has an IDENTICAL block list — while rebuilding these
  // arrays anyway made the prepass, not placement, the floor cost of a keystroke.
  // `drawingLayoutEpoch` stands in for the per-block drawing tokens (the epoch moves
  // whenever any drawing projection or resource in the part does); a caller that threads
  // per-paragraph drawing tokens WITHOUT an epoch keeps the recompute path (null), because
  // the memo could not see a token move. The inline-drawing context joins the epoch
  // exactly as it joins every per-block token, so a session that toggles the context
  // between passes is never served the other context's keys.
  const drawingEpoch =
    (options.drawingTokenForParagraph !== undefined || options.drawingLayoutToken !== undefined) &&
    options.drawingLayoutEpoch === undefined
      ? null
      : withDrawingContext(options.drawingLayoutEpoch ?? '', hasInlineDrawingContext);
  const projectionEpoch =
    options.projectionTokenForParagraph !== undefined && options.projectionEpoch === undefined
      ? null
      : (options.projectionEpoch ?? '');
  // A bare section mark's borders depend on the next section's break (`marksPageBreak`).
  const framePolicy =
    sectionPrep.framePolicy(columns.count, options.disabledParagraphFrameIds) +
    `|${options.paragraphLineUnitPt ?? '-'}|${options.sectionMarkCollapses === true ? 'c' : 'p'}`;
  const prepassMemo = session?.prepass as SectionPrepass | null | undefined;
  const prepassInputs = {
    framePolicy,
    drawingEpoch,
    projectionEpoch,
    producer,
    contentWidth,
    styleCascade,
    numberingIndex: options.numberingIndex,
    tocToken,
    refToken: refFields?.valuesToken ?? '',
  };
  const prepassNonListInputsValid = sectionPrepassInputsMatch(prepassMemo, prepassInputs);
  // Numbering reaches a table only through list tokens its rebuilt key and each cached cell
  // prove: a list toggle adds a definition and leaves other tables' rows and widths valid.
  const numberingBefore = prepassMemo?.numberingIndex;
  const autofitInputsEqual =
    prepassNonListInputsValid ||
    sectionPrepassInputsMatch(prepassMemo, { ...prepassInputs, numberingIndex: numberingBefore });
  const prepassInputsValid = prepassNonListInputsValid && prepassMemo.listItems === listItems;
  const prepassValid =
    prepassInputsValid &&
    prepassMemo.bodies.length === bodies.length &&
    prepassMemo.bodies.every((block, index) => block === bodies[index]);
  const prepass: SectionPrepass = prepassValid ? prepassMemo : buildSectionPrepass();
  function buildSectionPrepass(): SectionPrepass {
    // Frame admission can vary during wrap probes without moving resource epochs.
    // Keep those passes on the full preparation path.
    const unframed = columns.count === 1 && !options.disabledParagraphFrameIds;
    const reusable = prepassInputsValid && unframed ? prepassMemo : null;
    // Only the list map moved: a paragraph keeps its entry while its own list item is the same.
    const listMoved = !reusable && prepassNonListInputsValid && unframed ? prepassMemo : null;
    const orderSource = reusable ?? (autofitInputsEqual ? prepassMemo : null);
    const prepared = resolveListAutoSpacing(
      sectionPrep.prepareSectionBlocks(
        bodies,
        reusable ?? listMoved,
        (block) => prepareBlock(block, contentWidth),
        listMoved
          ? (block) =>
              block.kind === 'paragraph' &&
              listMoved.listItems?.get(block.id) === listItems?.get(block.id)
          : undefined
      ),
      options.paragraphLineUnitPt,
      styleCascade
    );
    const keys = prepared.map((entry) => entry.key);
    const positioned = tableWrap.anchorFlow(
      prepared,
      contentWidth,
      styleCascade,
      displayMode,
      authorFilter,
      options.compatibilityMode
    );
    const terminalTextTables = terminalTables.terminalTextTableGroup(
      prepared,
      contentWidth,
      styleCascade,
      displayMode,
      authorFilter,
      options.compatibilityMode
    );
    const {
      flowKeys: flow,
      keepsNext,
      markerTexts,
      flowKeyIntern,
    } = sectionFlowKeys({
      prepared,
      keys,
      positioned,
      terminalTextTables,
      styleCascade,
      listItems,
      tocToken,
      tocIds,
      leadingBreakFlowKeys: leadingBreakGroups.flowKeys,
      keptTables,
      flowKeyIntern: prepassMemo?.flowKeyIntern,
    });

    return {
      framePolicy,
      positioned,
      bodies,
      producer,
      contentWidth,
      styleCascade,
      listItems,
      numberingIndex: options.numberingIndex,
      drawingEpoch: drawingEpoch ?? '',
      projectionEpoch: projectionEpoch ?? '',
      prepared,
      keys,
      // Paragraph order reads no list state, so a list edit keeps it.
      paragraphDocumentOrder:
        orderSource &&
        sectionPrep.sameSectionParagraphOrder(
          orderSource.bodies,
          bodies,
          drawingInputsUnchangedByTextEdit
        )
          ? orderSource.paragraphDocumentOrder
          : paragraphDocumentOrderOf(
              prepared,
              contentWidth,
              styleCascade,
              displayMode,
              authorFilter,
              options.compatibilityMode
            ),
      keepsNext,
      markerTexts,
      tocToken,
      refToken: refFields?.valuesToken ?? '',
      flowKeys: flow,
      flowKeyIntern,
      terminalTextTables,
    };
  }
  if (session && drawingEpoch !== null && projectionEpoch !== null && !prepassValid) {
    session.prepass = prepass;
  }
  const { prepared, keys, paragraphDocumentOrder, keepsNext, terminalTextTables } = prepass;
  const flowKeys = markJoinFlowKeys(prepass.flowKeys, options.markJoinsBreakSheet === true);
  const { positionedTables, positionedTablePolicy } = prepass.positioned;
  /** Retain the whole document's live keys — block keys plus recorded table-cell keys. */
  const publishRetainedKeys = (): void => {
    // `false`: the orchestrator skips this pass's sweep; a standalone pass asks its own stride.
    if (options.retainKeys === false) return;
    if (options.retainKeys === undefined && cache && !(cache.retentionPassDue?.() ?? true)) {
      return;
    }
    retainLiveBreakKeys(
      cache,
      options.retainKeys,
      keys,
      prepared.flatMap((entry) => (entry.kind === 'table' ? [entry.table] : []))
    );
  };
  const previous = previousBodyLayout(session?.previous ?? null);
  // A geometry or producer change invalidates every checkpoint, because it moves every
  // break; resuming from one would place new content against a stale flow. A parity flip
  // only matters when the previous pass actually read parity (even/odd headers or an
  // inside/outside-anchored drawing).
  const comparable =
    previous !== null &&
    session !== undefined &&
    (session.context === context || reserveResume.moved !== undefined) &&
    session.producer === producer &&
    (!session.parityDependent || session.startPageParity === startPageParity);
  const resumable = columns.count === 1 && comparable;

  /** The first paragraph whose layout inputs differ from the previous pass. */
  const firstChanged = comparable
    ? reserveResume.resumeLimit(session.checkpoints, commonKeyPrefix(flowKeys, session.keys))
    : 0;
  // How many trailing paragraphs are unchanged: where the flow may reconverge. Content after an
  // edit is reused only if it is the same AND lands in the same place; this bounds the first half.
  const commonSuffix = resumable ? commonKeySuffix(flowKeys, session.keys, firstChanged) : 0;

  // NOTHING CHANGED. Every key matches and the document is the same length, so the previous
  // layout still describes it exactly — re-placing it would allocate a second set of
  // identical records and destroy the identity a consumer uses to skip repainting.
  if (comparable && firstChanged === prepared.length && prepared.length === session.keys.length) {
    const unchanged = reuseUnchangedLayout(session, revision, lineCounterStart);
    session.startPageParity = startPageParity;
    publishRetainedKeys();
    return { ...unchanged, overflowShellAt };
  }
  const positionedFlow = tableFloat.positionedTableFlow(positionedTables, flowKeys);
  const positionedByTable = new Map(positionedTables.map((anchor) => [anchor.table.id, anchor]));
  const earlierLinePush = createEarlierLinePush(paragraphDocumentOrder, (page, anchorId) =>
    paragraphDrawingWrap.tablePush(page, anchorId)
  );
  let pageFragments: BlockFragmentRecord[] = [];
  let columnIndex = 0;
  let regionFragmentStart = 0;
  const columnLeft = (): number => columns.lefts[columnIndex]!;
  const columnWidth = (): number => columns.widths[columnIndex]!;
  const anchorFrames = (): TableAnchorFrames => ({
    text: { left: columnLeft(), width: columnWidth() },
    margin: { left: 0, width: contentWidthForReflow },
    page: { left: -geometry.margin.left, width: geometry.width },
  });
  const regionHasFragments = (): boolean =>
    tableFloat.hasFlowFragments(pageFragments, regionFragmentStart);
  let pendingAnchoredDrawings: AnchoredDrawingRecord[] = [];
  let deferredAnchoredDrawings: AnchoredDrawingRecord[] = [];
  const anchorPageDeferCounts = new Map<string, number>();
  const pendingFloatIds = new Set<string>();
  const floatSignals: tableFloat.PositionedTableAnchorSignal[] = [];
  // Adjacent tables with the same position stack (`table-float-stack.ts`).
  const stacks = createStackPlacement(positionedTables, {
    fragments: () => pageFragments,
    cursorY: () => cursorY,
    pushOf: (anchorId, order) => earlierLinePush.of(pages.length, flowColumnIndex, anchorId, order),
  });
  // A table stays when its band pushes its own anchor on (`ownTableStaysForAnchor`).
  const ownTableStays = (anchorId: string, extent: number): boolean =>
    ownTableStaysForAnchor(pageExclusionZones(), anchorId, {
      column: columns.count > 1 ? flowColumnIndex : undefined,
      pushed: earlierLinePush.of(pages.length, flowColumnIndex, anchorId),
      overrun: cursorY + extent - contentHeight(),
    });
  /** Records that `anchorId` reached `anchorY` on the page being filled. */
  const noteAnchor = (anchorId: string, anchorY = cursorY): void =>
    positionedFlow.note(floatSignals, anchorId, flowColumnIndex, pageFragments.length, anchorY);
  // Pass-local: the shared flow token prevents checkpoint resume inside this group.
  const terminalTextTableIds = new Set<string>();
  // A continuous section resumes the previous section's column rather than opening a
  // sheet, so its first block starts at that column's used height and its first paragraph
  // is NOT at a page top — page-top space-before suppression must not apply to it, and the
  // preceding paragraph's space-after still collapses against its space-before.
  const paragraphFrames = new ParagraphFrameFlow();
  let cursorY = flowStartY;
  // A continuous section can open its column region below content already on the sheet.
  let columnRegionTop = flowStartY;
  let flowColumnIndex = 0;
  let lineCounter = lineCounterStart;
  let previousSpaceAfter = spaceBeforeCarry;
  const checkpoints: FlowCheckpoint[] = [];
  const textCarry = new TextTableCarry({
    fragments: () => pageFragments,
    setFragments: (next) => void (pageFragments = next),
    column: () => ({ left: columnLeft(), width: columnWidth() }),
    enabled: styleCascade?.textBesideBrokenFloatingTable === true,
    applies: () => columns.count === 1 && !(continuedInsets && pages.length === 0),
  });
  const checkpointOwner = new FlowCheckpointOwner({
    textCarry,
    paragraphFrames,
    positionedFlow,
    pendingFloatIds,
    floatSignals,
    anchorPageDeferCounts,
  });
  const checkpointNow = (): FlowCheckpoint =>
    checkpointOwner.capture({
      pageCount: pages.length,
      pageFragments,
      pendingAnchoredDrawings,
      deferredAnchoredDrawings,
      cursorY,
      lineCounter,
      previousSpaceAfter,
      flowColumnIndex,
    });
  let startIndex = 0;
  let placed = 0;
  let reusedPages = 0;
  let firstParagraphOfSection = flowStartY === 0;

  // RESUME. The checkpoint before the first changed paragraph describes a flow the new
  // document still agrees with, so the pages completed by then are carried over by
  // REFERENCE — unchanged pages keep their identity, which is what lets a consumer skip
  // repainting them.
  if (resumable && firstChanged > 0 && firstChanged < session.checkpoints.length) {
    const checkpoint = session.checkpoints[firstChanged]!;
    pages.push(...previous!.pages.slice(0, checkpoint.pageCount));
    ({
      pageFragments,
      pendingAnchoredDrawings,
      deferredAnchoredDrawings,
      cursorY,
      flowColumnIndex,
      lineCounter,
      previousSpaceAfter,
    } = checkpointOwner.restore(checkpoint));
    columnIndex = flowColumnIndex;
    startIndex = firstChanged;
    firstParagraphOfSection = false;
    reusedPages = pages.length;
    checkpoints.push(...session.checkpoints.slice(0, firstChanged));
  }

  const publishParagraphFrames = (
    anchorId: string,
    anchorY: number,
    anchorLines: readonly LineRecord[] = []
  ): void => {
    const inset = insetsFor(pages.length).top;
    for (const fragment of paragraphFrames.publish(
      frameOrigins(pageIndexStart + pages.length + 1, geometry, inset, {
        x: columnLeft(),
        y: anchorY,
        width: columnWidth(),
        height: contentHeight() - anchorY,
      }),
      anchorId,
      flowColumnIndex,
      anchorLines,
      markPageParityRead
    ))
      pageFragments.push(fragment);
  };

  const columnCount = columns.count;
  const anchorColumnBox = (box: LayoutBox) =>
    columnBoxAt(columns, flowColumnIndex, contentWidth, box);

  const anchorFrameBase = () =>
    bodyAnchorFrameBase({
      pageNumber: pageIndexStart + pages.length + 1,
      onPageParityRead: markPageParityRead,
      // A continued section's first sheet keeps the host's bottom margin (17.6.11, 17.6.22).
      geometry: hostSheetGeometry(geometry, pages.length === 0 ? continuedInsets : undefined),
      insets: insetsFor(pages.length),
      contentWidth,
      contentHeight: contentHeight(),
      ownerPartName: options.inlineDrawingLayout?.ownerPartName ?? WML_MAIN_DOCUMENT_PART,
      compatibilityMode: options.compatibilityMode,
    });

  const pageContentClip = (): LayoutBox => pageClipRegion(anchorFrameBase());
  const lineAnchorsBeforeBandPush = hasCompatibilityRule(
    options.compatibilityMode,
    'lineAnchorsBeforeBandPush'
  );
  const anchorScope = {
    drawingLayout: options.inlineDrawingLayout,
    displayMode,
    revisionAuthorFilter: authorFilter,
    layoutTextboxStory: hostedStory?.layoutTextboxStoryFor,
  };

  const sourceOrderOf = drawingSourceOrder(options.inlineDrawingLayout, options.drawingSourceOrder);

  const collectAnchoredDrawings = (drawings: readonly AnchoredDrawingRecord[]): void =>
    collectAnchoredDrawingRecords(
      drawings,
      {
        pending: pendingAnchoredDrawings,
        deferred: deferredAnchoredDrawings,
        deferCounts: anchorPageDeferCounts,
      },
      sourceOrderOf,
      options.inlineDrawingLayout ? anchorFrameBase : undefined
    );

  const carryDeferredToNextPage = (): void => {
    if (deferredAnchoredDrawings.length === 0) return;
    const carried = deferredAnchoredDrawings.map((drawing) =>
      shiftAnchoredDrawingY(drawing, cursorY - drawing.y)
    );
    deferredAnchoredDrawings = [];
    collectAnchoredDrawings(carried);
  };

  let publishPositionedTablesForPage = (): void => undefined;
  const flushPage = (): void => {
    publishPositionedTablesForPage();
    const { usedBottom, hasBodyPageFields } = summarizeFlushedPage(pageFragments, columnRegionTop);
    // Header and footer furniture and page borders come with the shell (`pageShell`).
    pages.push({
      ...pageShell(pages.length),
      fragments: pageFragments,
      hasBodyPageFields,
      ...(columns.separator
        ? { columnSeparators: columnSeparatorBoxes(columns, columnRegionTop, usedBottom) }
        : {}),
      ...(pendingAnchoredDrawings.length > 0
        ? { anchoredDrawings: sortDrawingsForPaint(pendingAnchoredDrawings) }
        : {}),
    });
    pageFragments = textCarry.nextPage();
    pendingAnchoredDrawings = [];
    cursorY = 0;
    columnIndex = 0;
    flowColumnIndex = 0;
    columnRegionTop = 0;
    regionFragmentStart = 0;
  };

  const paintsNothing = (entry: PreparedBlock, lines: readonly PendingLine[]): boolean =>
    entry.kind === 'paragraph' && paragraphPaintsNothing(entry, lines, options.inlineDrawingLayout);

  const advanceColumn = (): void => {
    if (columnIndex + 1 < columns.count) {
      columnIndex += 1;
      flowColumnIndex = columnIndex;
      cursorY = columnRegionTop;
      previousSpaceAfter = 0;
      regionFragmentStart = pageFragments.length;
      return;
    }
    flushPage();
    carryDeferredToNextPage();
  };

  // Share counters/cache with body flow; budget border ownership and vMerge once per pass.
  const tableDeps: TableFlowDeps = {
    paragraphLineUnitPt: options.paragraphLineUnitPt,
    ...positionedTableDeps(positionedTables, positionedTablePolicy),
    measurer,
    cache,
    producer,
    // Per table node, so retention can name cell entries of tables a resumed pass never places.
    onCellBreakKey: collectingCellBreakKeys.add,
    nextLineId: (paragraphId, start, lineIndex, occurrence) => {
      lineCounter += 1;
      return bodyLineId(paragraphId, start, lineIndex, occurrence);
    },
    // SECTION-LOCAL page index: the occurrence only disambiguates the same header row
    // across this section's own pages, and an absolute index went stale on any remap.
    pageOccurrenceKey: () => String(pages.length),
    styleCascade,
    // The document's first paragraph keeps its end mark (`cellHidesEndMark`).
    documentFirstParagraphId:
      pageIndexStart === 0 && flowStartY === 0
        ? documentOpeningCellParagraph(bodies[0])
        : undefined,
    tableTopLeads: tableTopLeads(prepared),
    listItems,
    ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
    compatibilityMode: options.compatibilityMode,
    ...(options.projectLink ? { projectLink: options.projectLink } : {}),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    showFieldCodes: options.showFieldCodes,
    fieldCodeRanges: options.fieldCodeRanges,
    tocLinkStyleRanges: options.tocLinkStyleRanges,
    ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
    // Body flow: page fields in table cells paint a placeholder for document finalize to fill.
    bodyPageFields: bodyPageFieldContext,
    ...(refFields ? { refFields } : {}),
    ...(options.noteMarks ? { noteMarks: options.noteMarks } : {}),
    // `!== undefined`, matching how every key lane derives the context bit, so the cell
    // lane's namespace can never disagree with the body's about whether a context exists.
    ...(options.inlineDrawingLayout !== undefined
      ? { inlineDrawingLayout: options.inlineDrawingLayout }
      : {}),
    ...(options.drawingTokenForParagraph
      ? { drawingTokenForParagraph: options.drawingTokenForParagraph }
      : options.drawingLayoutToken
        ? { drawingLayoutToken: options.drawingLayoutToken }
        : {}),
    ...(options.projectionTokenForParagraph
      ? { projectionTokenForParagraph: options.projectionTokenForParagraph }
      : {}),
    ...(options.inlineDrawingLayout
      ? {
          anchorFrameBase,
          pageContentClip,
          hostedStory,
          publishAnchoredDrawings: collectAnchoredDrawings,
          collectAnchoredDrawings,
          columnBoxForParagraph: anchorColumnBox,
          onAnchorShift: (paragraphId, dy) =>
            shiftAnchoredDrawingRecords(pendingAnchoredDrawings, paragraphId, dy),
          onAnchorRepublish: (paragraphId, drawings) => {
            for (let index = pendingAnchoredDrawings.length - 1; index >= 0; index -= 1) {
              if (pendingAnchoredDrawings[index]!.anchorParagraphId === paragraphId) {
                pendingAnchoredDrawings.splice(index, 1);
              }
            }
            pendingAnchoredDrawings.push(...drawings);
          },
        }
      : {}),
    ...(options.inlineDrawingLayout || furnitureHasWrap
      ? { pageExclusionZones, paragraphOrderIndex: (id: string) => paragraphDocumentOrder.get(id) }
      : {}),
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    displayMode,
    ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
  };

  const tableUpdate = tryUpdateTableSession({
    session,
    previous: prepassMemo,
    prepass,
    inputsEqual: prepassInputsValid,
    rowInputsEqual: autofitInputsEqual,
    // Returns the other pages as they were, so never when a page's reserve moved.
    eligible:
      resumable &&
      reserveResume.moved === undefined &&
      !furnitureHasWrap &&
      // Live zones too: a pass that finds any collects them, and the next pass is not eligible.
      !options.drawingExclusionZonesByPage?.size,
    firstChanged,
    commonSuffix,
    deps: tableDeps,
    pageBand: contentHeight,
    revision,
    lineCounterStart,
  });
  if (tableUpdate) {
    publishRetainedKeys();
    return { ...tableUpdate, overflowShellAt };
  }

  type PreparedParagraph = Extract<PreparedBlock, { kind: 'paragraph' }>;

  const firstLineSlotOf = createListFirstLineMetrics(listItems, measurer);

  const { rememberBreakKey, releasePlacedBreaks } = createParagraphBreakRetention(cache);

  const paragraphDrawingWrap = createParagraphDrawingWrap({
    compatibilityMode: options.compatibilityMode,
    displayMode,
    revisionAuthorFilter: authorFilter,
    seedForwardOnly: (options.drawingExclusionPass ?? 0) < 0,
    drawingLayout: options.inlineDrawingLayout,
    ...(hostedStory ? { layoutTextboxStory: hostedStory.layoutTextboxStoryFor } : {}),
    paragraphAt: (index) => {
      const entry = prepared[index];
      return entry?.kind === 'paragraph' ? entry : undefined;
    },
    paragraphOrder: paragraphDocumentOrder,
    paragraphIndex: (id) =>
      prepared.findIndex((entry) => entry.kind === 'paragraph' && entry.paragraph.id === id),
    tableIndex: (id) =>
      prepared.findIndex((entry) => entry.kind === 'table' && entry.table.id === id),
    columns,
  });

  const { breaksBeforeAt, keepsBeforeAtPageStart, spaceBeforeAt } = pageBreakBeforeRules(
    prepared.length,
    options.compatibilityMode,
    () => firstParagraphOfSection,
    // The HTML automatic gap only: under fixed spacing the authored measurement stays.
    styleCascade?.fixedParagraphSpacing !== true && pageIndexStart === 0 && flowStartY === 0
  );

  // Placement and keep-with-next lookahead share cached line breaks.
  const breakBlock = (
    entry: PreparedParagraph,
    entryIndex: number,
    startOffset = 0,
    placedParagraphStartY?: number,
    omittedAnchor?: string
  ) => {
    const paragraphId = entry.paragraph.id;
    const keepEmptyTocPlaceholder = emptyTocPlaceholderIds?.has(paragraphId) ?? false;
    const suppressChrome =
      options.fieldCodeRanges?.get(paragraphId)?.some((range) => range.suppressParagraph) ||
      (!keepEmptyTocPlaceholder &&
        ((tocChromeParagraphIds?.has(paragraphId) ?? false) ||
          (emptyTocSuppressedResultIds?.has(paragraphId) ?? false)));
    const available = entry.available;
    const columnX = columnLeft();
    // Exclusions are in placed coordinates. The flow cursor still precedes paragraph
    // spacing and the opening border here; measuring at that cursor can wrap a line
    // around an already-cleared float, or let it paint through one below the gap.
    let paragraphStartY = placedParagraphStartY ?? cursorY;
    let paragraphSpaceBefore = 0;
    if (placedParagraphStartY === undefined && startOffset === 0 && !entry.frame) {
      const previous = prepared[entryIndex - 1];
      const sameStyle =
        entry.styleId !== null &&
        flowNeighbourBeside(prepared, entryIndex, -1, styleCascade) === entry.styleId;
      const before =
        entry.contextualSpacing && sameStyle
          ? 0
          : spaceBeforeAt(entryIndex, entry, entry.spacing.before);
      const continuesBorder = leadingBreakGroups.joins(previous, entry);
      paragraphSpaceBefore = appliedSpaceBefore(
        before,
        previousSpaceAfter,
        cursorY === 0 && !regionHasFragments(),
        keepsBeforeAtPageStart(entryIndex, entry)
      );
      paragraphStartY +=
        paragraphSpaceBefore +
        paragraphBorderExtentPt(continuesBorder ? undefined : entry.borders.top);
    }
    const localPageZones = paragraphDrawingWrap.breakZones(
      entry,
      entryIndex,
      flowColumnIndex,
      pageExclusionZones(),
      anchorFrameBase,
      paragraphStartY,
      columnX,
      columnX + columnWidth(),
      startOffset,
      paragraphSpaceBefore,
      omittedAnchor
    );
    const exclusionToken = exclusionLayoutToken(localPageZones, contentHeight());
    const anchorParagraphStartY =
      paragraphStartY - paragraphDrawingWrap.displacement(pages.length, paragraphId);
    const cacheKey =
      cache && !suppressChrome
        ? bodyParagraphCacheKey(entry, options.inlineDrawingLayout, {
            exclusionToken,
            paragraphStartY,
            anchorParagraphStartY,
            paragraphSpaceBefore,
            regionBottomY: contentHeight(),
            columnIndex: flowColumnIndex,
            startOffset,
            frameMarginLeft: geometry.margin.left,
            pageNumber: pageIndexStart + pages.length + 1,
          })
        : null;
    if (cacheKey !== null) rememberBreakKey(paragraphId, cacheKey);
    // The placement-dependent flow options are built only when the measured break is absent.
    return breakPreparedParagraphLazily(cache, cacheKey, () => ({
      compatibilityMode: options.compatibilityMode,
      paragraph: entry.paragraph,
      paragraphId,
      indentLeft: entry.indent.left,
      available,
      measurer,
      formatting: entry,
      producer,
      styleCascade,
      tabStops: entry.tabStops,
      flow: {
        ...firstLineSlotOf(entry),
        startOffset,
        marginExtent: { left: 0, right: entry.indent.left + available + entry.indent.right },
        ...bodyParagraphOptionFlow(entry.paragraph, options),
        // Body flow: an empty-cache page field paints a placeholder finalize substitutes per page.
        bodyPageFields: bodyPageFieldContext,
        ...(refFields ? { refFields } : {}),
        displayMode,
        ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
        ...inlineDrawingFlow(options.inlineDrawingLayout, hostedStory),
        ...framedParagraphFlow(entry.frame !== undefined),
        ...bodyContentBounds(entry.indent, available, columnCount > 1 ? columnWidth() : undefined),
        ...bodyParagraphPlacementFlow({
          paragraphStartY,
          anchorParagraphStartY,
          anchorFrameBase: anchorFrameBase(),
          regionBottomY: contentHeight(),
          paragraphSpaceBefore,
          pageExclusionZones: localPageZones,
          suppressChrome,
        }),
      },
    }));
  };

  const pageExclusionZonesForEntry = (entry: PreparedParagraph, entryIndex: number) =>
    paragraphDrawingWrap.select(entry, entryIndex, flowColumnIndex, pageExclusionZones(), {
      placement: true,
    });

  const placementZonesForLine = createLinePlacementZones({
    drawingLayout: options.inlineDrawingLayout,
    displayMode,
    ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
    pageZones: pageExclusionZonesForEntry,
    band: (entry) =>
      columnCount > 1
        ? { left: columnLeft(), right: columnLeft() + columnWidth() }
        : { left: 0, right: entry.indent.left + entry.available + entry.indent.right },
    paragraphTop: (id, y) => y - paragraphDrawingWrap.displacement(pages.length, id),
    columnIndex: () => flowColumnIndex,
    frameBase: anchorFrameBase,
  });

  const placementSkipBefore = (
    entry: PreparedParagraph,
    entryIndex: number,
    brokenLines: readonly PendingLine[],
    lineIndex: number,
    fragmentFirstLine: number,
    fragmentParagraphStartY: number,
    pendingLine: PendingLine,
    appliedSkipByLineIndex: ReadonlyMap<number, number>,
    spaceBefore: number,
    bandAfter: number,
    ownBefore: number
  ): number => {
    if (anchorLineSkipsExclusion(entry.paragraph, options.inlineDrawingLayout, pendingLine))
      return 0;
    // Own bands frame from above the spacing before, as `paragraph-flow` synthesizes them.
    const zones = placementZonesForLine(
      entry,
      entryIndex,
      brokenLines,
      lineIndex,
      fragmentFirstLine,
      fragmentParagraphStartY - spaceBefore,
      appliedSkipByLineIndex
    );
    const above = lineIndex === fragmentFirstLine ? spaceBefore : 0;
    const live =
      zones.length > 0
        ? lineBandSkip(cursorY, pendingLine.height, zones, above, bandAfter, {
            id: entry.paragraph.id,
            spaceAbove: lineIndex === fragmentFirstLine ? ownBefore : 0,
          })
        : 0;
    const breakSkip = pendingLine.exclusionSkipBefore ?? 0;
    return Math.max(live, breakSkip);
  };

  /**
   * The part of a fragment's first-line skip that its own `wrapTopAndBottom` anchors cause.
   * When it and the line exceed an empty region, moving on only adds blank pages.
   */
  const ownBandSkip = (
    entry: PreparedParagraph,
    entryIndex: number,
    brokenLines: readonly PendingLine[],
    lineIndex: number,
    fragmentParagraphStartY: number,
    spaceBefore: number
  ): number =>
    travellingTopAndBottomSkip(cursorY, brokenLines[lineIndex]!.height, spaceBefore, {
      inherited: pageExclusionZonesForEntry(entry, entryIndex),
      // The zones the next line would see: the page's, plus the bands of this line's anchors.
      withOwn: placementZonesForLine(
        entry,
        entryIndex,
        brokenLines,
        lineIndex + 1,
        lineIndex,
        fragmentParagraphStartY - spaceBefore,
        new Map()
      ),
    });

  const tableVerticalFrames = (anchorY: number) =>
    tableFloat.bodyTableVerticalAnchorFrames(anchorFrameBase(), anchorY, geometry.margin.top);
  const anchorTableBand = tableWrap.anchorTableBandOf({
    anchors: positionedTables,
    pending: pendingFloatIds,
    width: columnWidth,
    deps: tableDeps,
    frames: anchorFrames,
    verticalFrames: tableVerticalFrames,
    earlier: () => pageFragments,
    signals: floatSignals,
    pushOf: stacks.push,
  });

  const layoutTableInFlow = (
    table: OoxmlElement,
    anchorY = cursorY,
    positionTextTable = false,
    next?: number,
    positionShiftX = 0,
    stackTop?: number
  ): boolean =>
    drainLayoutSteps(
      layoutTableInFlowSteps(table, anchorY, positionTextTable, next, positionShiftX, stackTop)
    );
  /** {@link layoutTableInFlow}, pausing between table rows. */
  function* layoutTableInFlowSteps(
    table: OoxmlElement,
    anchorY = cursorY,
    positionTextTable = false,
    next?: number,
    positionShiftX = 0,
    stackTop?: number
  ): LayoutSteps<boolean> {
    const savedCursorY = cursorY;
    const positioned = positionedByTable.get(table.id);
    // Text beside a broken text-anchored table's first fragment (`table-text-carry.ts`).
    const carry = textCarry.open(positionTextTable ? undefined : positioned, anchorY);
    // The paginator owns the cursor. The adapter syncs it around each story-flow advance.
    const flow: TableFlowCursor = {
      positionTextTable,
      positionShiftX,
      ...(stackTop !== undefined ? { stackTop } : {}),
      cursorY: anchorY,
      columnWidth,
      columnLeft,
      flowColumn: () => (columns.count > 1 ? flowColumnIndex : undefined),
      contentHeight,
      unreservedContentHeight,
      advanceColumn: () => {
        if (carry.hold(flow)) return;
        cursorY = flow.cursorY;
        advanceColumn();
        flow.cursorY = carry.moved(cursorY);
      },
      advancePage: () => {
        if (carry.hold(flow)) return;
        flushPage();
        carryDeferredToNextPage();
        flow.cursorY = carry.moved(cursorY);
      },
      pageHoldsContent: (top) => pageFragments.length > 0 || top > 0,
      // One column opens every continuation at the page top, and resumes only run there.
      columnTop: () => (columns.count > 1 ? columnRegionTop : 0),
      // The first column keeps the page answer: a continuous section can open it below content.
      regionHoldsContent: (top) =>
        columnIndex > 0
          ? regionHasFragments() || top > columnRegionTop
          : flow.pageHoldsContent(top),
      anchorFrames,
      verticalAnchorFrames: () => tableVerticalFrames(anchorY),
      styleCascade,
      displayMode,
      ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
      deps: tableDeps,
      compatibilityMode: options.compatibilityMode,
      shiftAnchor: (paragraphId, dy) =>
        shiftAnchoredDrawingRecords(pendingAnchoredDrawings, paragraphId, dy),
      // A sink, not the array: completing a page replaces `pageFragments`, and a reference
      // taken when the table started would collect its later fragments into a dead array.
      publishFragment: (fragment, wraps) =>
        carry.published(
          pageFragments.push(
            tableWrap.withFloatingWrap(fragment, positioned, flowColumnIndex, wraps)
          )
        ),
      followingKeepOpening: (room) =>
        next === undefined ? undefined : keepChains.opening(next, room),
    };
    const result = yield* paginateTableInFlowSteps(table, flow);
    cursorY = result.outOfFlow ? savedCursorY : (carry.close() ?? flow.cursorY);
    return result.outOfFlow;
  }

  publishPositionedTablesForPage = (): void =>
    tableFloat.publishPositionedTablesOnPage(
      positionedTables,
      pendingFloatIds,
      pageFragments,
      floatSignals,
      (table, anchorColumn, anchorY, anchorFragmentIndex) => {
        const savedColumn = columnIndex;
        const savedFlowColumn = flowColumnIndex;
        columnIndex = anchorColumn;
        flowColumnIndex = anchorColumn;
        collectingCellBreakKeys.begin();
        try {
          // A table that stacks starts at the bottom of the one above it, whatever its anchor.
          const stacked = stacks.top(table.id);
          // A raised table keeps the place its anchor had before it pushed earlier lines down.
          const start = tableWrap.positionedTableStart(
            table,
            keptFloatAnchor(options, pages.length, table.id) ?? anchorY - stacks.push(table.id),
            columnWidth(),
            anchorFrames(),
            pageFragments,
            anchorFragmentIndex,
            tableDeps,
            contentHeight()
          );
          if (stacked !== undefined) layoutTableInFlow(table, anchorY, true, undefined, 0, stacked);
          else layoutTableInFlow(table, start.anchorY, true, undefined, start.dx);
          registerTableCellBreakKeys(table, collectingCellBreakKeys.keys());
        } finally {
          collectingCellBreakKeys.end();
          columnIndex = savedColumn;
          flowColumnIndex = savedFlowColumn;
        }
      }
    );
  /** The section's last block, when it is an empty paragraph carrying the section mark. */
  const emptySectionMarkAt = (at: number, lines?: readonly PendingLine[]) => {
    const mark = prepared[at];
    return at === prepared.length - 1 &&
      mark?.kind === 'paragraph' &&
      !mark.frame &&
      paragraphSectionNode(mark.paragraph) !== undefined &&
      (listItems?.get(mark.paragraph.id) ?? mark.listItem) === undefined &&
      paragraphHoldsNothing(mark, lines ?? breakBlock(mark, at), options.inlineDrawingLayout)
      ? mark
      : undefined;
  };
  /** The mark a trailing page break kept on its own sheet (`markJoinsBreakSheet`). */
  let markOnBreakSheet = -1;
  // Before a continuous section, the empty closing mark is out of flow; its fragment stays.
  const collapsesSectionMark = (at: number, lines?: readonly PendingLine[]): boolean => {
    if (at === markOnBreakSheet) return true;
    // A mark that is its section's only block, or anchors the frames before it, keeps its line.
    if (options.sectionMarkCollapses !== true || at === 0 || anchorsFrames(prepared[at - 1]))
      return false;
    const mark = emptySectionMarkAt(at, lines);
    return mark !== undefined && !breaksBeforeAt(at, mark);
  };
  // `w:keepNext` chains. Members measure at THIS column's width (a memo hit when equal).
  const keepChains = keepNextChains(
    {
      blocks: prepared,
      dynamicBlock: (at) =>
        prepared[at]?.kind === 'paragraph' &&
        anchorsSpacingDependentBand(prepared[at].paragraph, options.inlineDrawingLayout),
      contextKey: () => {
        const zones = pageExclusionZones();
        const base = `${columnWidth()}:${markOnBreakSheet}:`;
        return zones.length
          ? base +
              `${flowColumnIndex}:${cursorY}:${previousSpaceAfter}:${firstParagraphOfSection}:${exclusionLayoutToken(zones)}`
          : base;
      },
      linesFor: (at) => {
        const member = prepareBlock(bodies[at]!, columnWidth());
        if (member.kind !== 'paragraph') return [];
        return linesWithOwnAnchorNeeds(bodies[at]!, breakBlock(member, at), {
          ...anchorScope,
          modern: () => anchorFrameBase().wrappedParagraphAnchorBottom === 'margin',
          opening: () =>
            openingAbove(member, prepared[at - 1], styleCascade?.fixedParagraphSpacing),
        });
      },
      skipBlock: (at) =>
        prepared[at]?.kind === 'paragraph' && (!!prepared[at].frame || !!emptySectionMarkAt(at)),
      breaksBefore: (at) => prepared[at]?.kind === 'paragraph' && breaksBeforeAt(at, prepared[at]),
      sumAdjacentSpacing: styleCascade?.fixedParagraphSpacing,
      noteClosing: () => keepNoteClosing(noteReserveHere(), pageFragments, options),
      tableOpening: (at) =>
        keptTables.opening(prepared[at], columnWidth(), contentHeight(), tableDeps),
    },
    options.compatibilityMode
  );
  let converged = false;
  let convergedAt = prepared.length;
  /** Whole pages the convergence tail moved by; reused checkpoints shift with it. */
  let convergedPageDelta = 0;
  let reportedPages = 0;
  for (let index = startIndex; index < prepared.length; index += 1) {
    // A live pass reports each completed page, so a host can show them before it ends.
    if (session && pages.length > reportedPages) {
      reportedPages = pages.length;
      yield { pages };
    }
    const entry = prepareBlock(bodies[index]!, columnWidth());

    // The flow as it stands BEFORE this block: what a later pass resumes from.
    checkpoints[index] = checkpointNow();

    // CONVERGENCE. Once inside the unchanged tail, if the IN-PAGE flow returns to exactly
    // the state the previous pass was in at this same paragraph — cursor, pending fragments
    // (compared structurally), anchor state — everything after lays out identically, and the
    // rest of the previous layout is reused: verbatim when the completed page count also
    // matches, remapped whole sheets over when it does not.
    //
    // Tested at EVERY paragraph of the unchanged tail, not just its first: an edit puts the
    // flow out of step for the rest of the page it lands on, and the state only comes back
    // into line once the page it disturbed has been completed.
    if (resumable && commonSuffix > 0 && index >= prepared.length - commonSuffix) {
      const mark = session.checkpoints[index + (session.keys.length - prepared.length)];
      if (mark) reserveResume.followShift(pages.length - mark.pageCount); // A seeded notes pass.
      const tailHolds = mark && reserveResume.tailHolds(mark, pages.length);
      if (mark && tailHolds) {
        // The shift rule first (delta 0 appends, else `remapPage`): it costs less than the compare.
        const delta = pages.length - mark.pageCount;
        const shiftedTail = delta !== 0 ? reserveResume.shiftedTail(mark, pages.length) : undefined;
        const shiftable = convergenceTailShiftAllowed({
          delta,
          titlePage: furniture?.titlePage === true,
          evenAndOddHeaders: furniture?.evenAndOddHeaders === true,
          parityDependent: session.parityDependent,
          usedPageParity,
          markPageCount: mark.pageCount,
          continuedInsets: continuedInsets !== undefined,
          firstPageBorders:
            options.sectionPageBorders !== undefined &&
            options.sectionPageBorders.display !== 'allPages',
          hasNoteReserves: pageBottomReserves !== undefined && !shiftedTail,
          hasExclusionZones:
            (options.drawingExclusionZonesByPage?.size ?? 0) > 0 || liveZones.sawLiveZones,
        });
        if (shiftable && flowCheckpointsMatch(mark, checkpoints[index]!)) {
          if (shiftedTail) reserveResume.adoptShiftedTail(shiftedTail);
          const tail =
            delta === 0
              ? previous!.pages.slice(mark.pageCount)
              : previous!.pages
                  .slice(mark.pageCount)
                  .map((page, offset) =>
                    remapPage(page, pages.length + offset, pageBox(pages.length + offset).y)
                  );
          pages.push(...tail);
          reusedPages += tail.length;
          converged = true;
          convergedAt = index;
          convergedPageDelta = delta;
          // Line ids are paragraph-local, so a changed line count before this join does not
          // invalidate the tail. Still carry the tail's line COUNT so a multi-section
          // orchestrator receives the correct terminal count for this revision.
          lineCounter += session.endLineCounter - mark.lineCounter;
          break;
        }
      }
    }

    placed += 1;

    if (entry.kind === 'table') {
      if (terminalTextTableIds.has(entry.table.id)) continue;
      if (
        terminalTextTables?.start === index &&
        columns.count === 1 &&
        pendingFloatIds.size === 0 &&
        !pageFragments.some(tableFloat.isOutOfFlowTableFragment) &&
        !pageExclusionZones().length
      ) {
        const anchor = prepared[terminalTextTables.anchorIndex]!;
        if (anchor.kind === 'paragraph') {
          const anchorLines = breakBlock(anchor, terminalTextTables.anchorIndex);
          if (anchorLines.length === 1 && anchorLines[0]!.spans.length === 0) {
            // The cursor already includes the lead paragraph's after-spacing. Use the
            // same collapsed gap as anchor placement; after-spacing never decides fit.
            const before = collapsedSpaceBefore(anchor.spacing.before, previousSpaceAfter);
            const placed = terminalTables.placeTerminalTextTables(terminalTextTables, {
              cursorY: cursorY + before,
              anchorHeight: anchorLines[0]!.height,
              contentWidth,
              contentHeight: contentHeight(),
              frames: anchorFrames(),
              deps: tableDeps,
              styleCascade,
              displayMode,
              authorFilter,
            });
            if (placed) {
              const tagged = terminalTables.withTerminalFloatingWrap(
                placed.fragments,
                positionedTables,
                flowColumnIndex
              );
              for (const fragment of tagged) pageFragments.push(fragment);
              for (const [memberIndex, table] of terminalTextTables.tables.entries()) {
                terminalTextTableIds.add(table.id);
                registerTableCellBreakKeys(table, placed.cellBreakKeys[memberIndex]!);
              }
              continue;
            }
          }
        }
      }
      if (
        positionedTablePolicy.has(entry.table.id) &&
        !furnitureHoldsTables &&
        tableWrap.admitsAtAnchor(entry.table, tableDeps, {
          allowBreak: columns.count === 1,
          zones: admission(
            liveZones.byPage(pages, pendingAnchoredDrawings, options.drawingExclusionZonesByPage)
          ),
          page: pages.length,
          width: Math.min(...columns.widths),
          frames: anchorFrames(),
          verticalFrames: tableVerticalFrames(cursorY),
          bottom: contentHeight(),
        })
      ) {
        positionedFlow.add(pendingFloatIds, entry.table.id);
        // It stands in the flow: the space after above it is whole; it opens the section.
        if (positionedByTable.get(entry.table.id)?.float.vertAnchor === 'text')
          [previousSpaceAfter, firstParagraphOfSection] = [0, false];
        continue;
      }
      // Tables waiting for the anchor of a text-anchored table placed in the flow are placed
      // where the body reaches that table, even when it then moves to the next page.
      const inFlow = positionedByTable.get(entry.table.id);
      if (inFlow?.float.vertAnchor === 'text') noteAnchor(inFlow.anchorId);
      // The waiting tables this one stacks below go into the flow first, right above it.
      for (const waiting of stacks.takeWaiting(entry.table.id, pendingFloatIds)) {
        const waitingTable = positionedByTable.get(waiting)!.table;
        collectingCellBreakKeys.begin();
        layoutTableInFlow(waitingTable, stacks.anchor(waiting), false, index);
        registerTableCellBreakKeys(waitingTable, collectingCellBreakKeys.keys());
        collectingCellBreakKeys.end();
      }
      // Text frames (17.3.1.11) before an ordinary table anchor at the table; it then stands
      // beside them or below them (`table-float-collision.ts`).
      if (!inFlow && tableDeps.pageExclusionZones && paragraphFrames.checkpoint())
        publishParagraphFrames(entry.table.id, cursorY);
      // An in-flow table anchors the floating tables before it, and starts below the bands
      // of those floats, or of a page-positioned float spanning the column, that cross its top.
      cursorY = positionedFlow.noteTable(
        floatSignals,
        entry.table.id,
        flowColumnIndex,
        pageFragments.length,
        cursorY,
        pageExclusionZones(),
        // Its clearance needs the published wrap zones (`table-float-collision.ts`).
        !inFlow && tableDeps.pageExclusionZones !== undefined
      );
      const top = stacks.anchor(entry.table.id);
      collectingCellBreakKeys.begin();
      try {
        const outOfFlow = yield* layoutTableInFlowSteps(entry.table, top, false, index + 1);
        if (!outOfFlow) previousSpaceAfter = 0;
        firstParagraphOfSection = false;
        registerTableCellBreakKeys(entry.table, collectingCellBreakKeys.keys());
      } finally {
        collectingCellBreakKeys.end();
      }
      continue;
    }

    const frame = entry.frame;
    const { paragraph, props, contextualSpacing, styleId, borders, shading, keeps } = entry;
    // Width-specific preparation owns line inputs; the prepass owns neighbor spacing.
    const preparedEntry = prepared[index]!;
    const preparedSpacing =
      preparedEntry.kind === 'paragraph' ? preparedEntry.spacing : entry.spacing;
    const startBefore = spaceBeforeAt(index, entry, preparedSpacing.before);
    const authoredSpacing =
      startBefore === preparedSpacing.before
        ? preparedSpacing
        : { ...preparedSpacing, before: startBefore };
    let { indent, alignment, markRunProperties } = entry;
    const rtl = paragraphIsRtl(entry.props);
    let available = entry.available;
    const previousEntry = index > 0 ? prepared[index - 1] : undefined;
    const nextEntry = prepared[index + 1];
    const listItem = listItems?.get(paragraph.id) ?? entry.listItem;
    // `w:firstLine` moves the first line right of the indent, `w:hanging` moves it left.
    // The schema treats them as mutually exclusive; where a producer writes both, hanging
    // wins, which is how Word reads it.
    // A NUMBERED/BULLETED paragraph's first-line slot belongs to the MARKER: `listMarkerBox`
    // places it at `left - hanging` (or at `left + firstLine` for a positive-firstLine
    // level), and Word's `w:suff` puts the text back at `left` — or after the marker, or at
    // the next tab stop past an overflowing one (§17.9.30).
    const paragraphId = paragraph.id;
    // `w:between` (§17.3.1.24): consecutive paragraphs with IDENTICAL border settings are ONE
    // bordered block in Word — the box opens above the first and closes below the last, and
    // each interior boundary carries `w:between` or nothing. Applying a box to three selected
    // paragraphs in Word draws one box, not three, and this is why.
    // A paragraph that opens with a page break leaves the group: its text opens a new box.
    const continuesAbove = leadingBreakGroups.joins(previousEntry, entry);
    const continuesBelow = leadingBreakGroups.joins(entry, nextEntry);
    const topEdge = continuesAbove ? undefined : borders.top;
    // What closes the paragraph: the bottom rule, or the `between` rule when the block runs on.
    const closingEdge = continuesBelow ? borders.between : borders.bottom;
    const topExtent = paragraphBorderExtentPt(topEdge);
    const borderExtent = paragraphBorderExtentPt(closingEdge);

    // A fresh section already starts on a new sheet. Only break when this sheet
    // holds content, including the host content of a continued section.
    if (
      breaksBeforeAt(index, entry) &&
      (pageFragments.length > 0 || cursorY > 0) &&
      index !== markOnBreakSheet
    ) {
      const fits = () => cursorY + anchorTableBand(paragraphId, cursorY, 0) <= contentHeight();
      if (tableWrap.staysBeforeAnchorBreak(positionedTables, pendingFloatIds, paragraphId, fits))
        noteAnchor(paragraphId, cursorY);
      flushPage();
      previousSpaceAfter = 0;
    }

    let lines = breakBlock(entry, index);
    const measureBackwardWrap = (startOffset = 0, paragraphStartY?: number): void => {
      paragraphDrawingWrap.measure(pages.length, index, pageExclusionZones(), lines, (anchorId) =>
        breakBlock(entry, index, startOffset, paragraphStartY, anchorId)
      );
    };
    measureBackwardWrap();
    if (lines.length === 0) {
      // Cross-paragraph TOC field chrome: tree preserved, no painted row or flow height.
      releasePlacedBreaks(paragraphId);
      noteAnchor(paragraph.id);
      continue;
    }
    // A blank paragraph-level `w:sectPr` is the section break, not content. It cannot open a
    // sheet merely because its line misses the bottom; the next section's break owns that.
    const sectionMark = paragraphSectionNode(paragraph) !== undefined;
    const markerStart = markerLineStart(lines);
    const marksSectionBreak = sectionMark && paintsNothing(entry, lines);
    const collapsedMark = sectionMark && !frame && collapsesSectionMark(index, lines);
    const holdsSheet = (): boolean =>
      collapsedMark ||
      (marksSectionBreak &&
        (columnRegionBottom === undefined || pages.length !== columnRegionPage) &&
        columnIndex + 1 >= columns.count);
    // Floating tables and text frames anchor at the paragraph start, which would stay behind.
    const breakLineFits = () => cursorY + (lines[0]?.height ?? 0) <= contentHeight() + 0.01;
    const leadingBreak = (): boolean =>
      leadingBreakGroups.admits(previousEntry, entry) &&
      paragraphFrames.checkpoint() === undefined &&
      !tableFloat.positionedTablesByAnchor(positionedTables).has(paragraphId) &&
      opensWithPageBreak(entry, lines, options.inlineDrawingLayout, breakLineFits());
    // `w:contextualSpacing` (17.3.1.9) drops the gap between paragraphs of the SAME style.
    // ListParagraph styles can set it to suppress paragraph gaps between list items.
    const spacing = contextualParagraphSpacing(
      collapsedMark ? { before: 0, after: 0 } : authoredSpacing,
      contextualSpacing,
      styleId,
      flowNeighbourBeside(prepared, index, -1, styleCascade),
      flowNeighbourBeside(prepared, index, 1, styleCascade)
    );
    // Whether a line's own wrapping objects still cross the margin (`wrappedAnchorsEndAtBottomMargin`).
    const pageFit = createOwnAnchorPageFit(paragraph, {
      ...anchorScope,
      frameBase: anchorFrameBase,
      column: () => ({ x: columnLeft(), width: columnWidth() }),
    });
    let keepTailAt = -1; // Where a kept paragraph that splits early breaks; a rebreak clears it.
    const rebreakInCurrentColumn = (startOffset: number, placedParagraphStartY?: number): void => {
      const next = prepareBlock(paragraph, columnWidth());
      if (next.kind !== 'paragraph') return;
      indent = next.indent;
      alignment = next.alignment;
      available = next.available;
      markRunProperties = next.markRunProperties;
      // Export caches release superseded suffixes; live caches retain their normal
      // memo policy. Otherwise a long paragraph keeps a full pending-line tree for
      // every page it crosses, even after those lines have been published.
      releasePlacedBreaks(paragraphId);
      lines = [...breakBlock(next, index, startOffset, placedParagraphStartY)];
      keepTailAt = -1;
      measureBackwardWrap(startOffset, placedParagraphStartY);
    };

    const savedFrameFlow =
      frame || collapsedMark ? { cursorY, previousSpaceAfter, firstParagraphOfSection } : null;
    const frameStart = frame
      ? paragraphFrames.start(
          frame,
          previousEntry?.kind === 'paragraph' ? previousEntry.paragraph.id : undefined
        )
      : null;
    if (frameStart) {
      cursorY = frameStart.cursorY;
      previousSpaceAfter = collapsingSpaceAfter(frameStart.previousSpaceAfter, styleCascade);
    }

    // A held mark whose line misses the bottom paints nothing there and takes no room from a
    // footnote area: it stays out of the flow, as a collapsed mark does.
    let markPastBottom = false;
    // Fit uses unsuppressed lead; top-of-page suppression applies after any flush below.
    if (!frame) {
      const lead = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
      const emptyStyle = markStyleOf(markRunProperties, styleCascade?.themeFonts);
      // Spacing-after never decides its own line's fit (§17.3.1.33): trailing space clips at the
      // break. Only the closing border rule is painted below the last line, so only it joins the
      // budget; an oversized `w:after` (the signature-block idiom) would mint blank pages.
      const firstTail = lines.length <= 1 ? borderExtent : 0;
      const prospectiveFirstTop = cursorY + lead + topExtent;
      const firstZones = placementZonesForLine(
        entry,
        index,
        lines,
        0,
        0,
        prospectiveFirstTop,
        new Map()
      );
      const firstExtent = lines[0]
        ? pendingLineFlowExtentAtPlacement(prospectiveFirstTop, lines[0], firstZones, firstTail)
        : measurer.lineMetrics(emptyStyle).height + firstTail;
      let needed =
        lead +
        topExtent +
        Math.max(
          firstExtent,
          paragraphFrames.requiredAnchorBand(lines),
          anchorTableBand(paragraphId, prospectiveFirstTop, firstExtent)
        );
      // An own object that cannot end at the bottom margin takes the paragraph along.
      const ownY = () => cursorY - paragraphDrawingWrap.displacement(pages.length, paragraphId);
      const anchorMoves = !!lines[0] && pageFit.crosses(lines[0], lines.length <= 1, ownY, cursorY);
      // `w:keepNext` (§17.3.1.15): priced ONCE per chain, at its head (`keepNextGroupNeed`).
      if (keeps.keepNext && !keepsNext[index - 1]) {
        const need = keepChains.need(index, previousSpaceAfter, {
          cursorY,
          contentHeight: contentHeight(),
          lead,
          topExtent,
          pricedLead: collapsedMark
            ? 0
            : collapsedSpaceBefore(authoredSpacing.before, previousSpaceAfter),
          freshLead: keepsBeforeAtPageStart(index, entry) ? spacing.before : 0,
        });
        if (need !== null) needed = Math.max(needed, need);
      }
      markPastBottom = !collapsedMark && cursorY + needed > contentHeight() && holdsSheet();
      const overflows = cursorY + needed > contentHeight() || anchorMoves;
      if (overflows && cursorY > 0 && !holdsSheet() && !leadingBreak()) {
        const plainExtent = lead + topExtent + (lines[0]?.height ?? 0) + firstTail;
        if (!frame && ownTableStays(paragraphId, plainExtent)) noteAnchor(paragraphId, cursorY);
        advanceColumn();
        previousSpaceAfter = 0;
        rebreakInCurrentColumn(0);
      }
    }

    // In legacy layout, an anchor that its own floating table covers there does not open it.
    const atTopOfPage =
      cursorY === 0 &&
      !regionHasFragments() &&
      !ownTableKeepsTop(options.compatibilityMode, pageExclusionZones(), paragraphId);
    // Lines holding only a leading page break take no space before and draw no rule. Both
    // open the text after the breaks, on its own sheet.
    let breakLinesOnly = !frame && leadingBreak();
    // Collapsed with the space after above, in every mode: the text keeps what it would get.
    const collapsedBefore = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
    const textBefore = breakLinesOnly ? collapsedBefore : 0;
    const appliedBefore = breakLinesOnly
      ? 0
      : appliedSpaceBefore(
          spacing.before,
          previousSpaceAfter,
          frame ? false : atTopOfPage,
          frame ? false : keepsBeforeAtPageStart(index, entry)
        );
    if (appliedBefore > 0) cursorY += appliedBefore;
    // Below its own floating table the anchor no longer opens the page: it keeps that space.
    const ownTableBefore = breakLinesOnly ? 0 : collapsedBefore;
    // The top rule and its gap are flow height above the first line, exactly as the bottom
    // rule is flow height below the last — pagination has to see both or a boxed paragraph
    // overhangs the bottom margin by the height of its own frame.
    if (topExtent > 0 && !breakLinesOnly) cursorY += topExtent;
    firstParagraphOfSection = false;
    keepTailAt = keepChains.tailBreak(index, lines.length, cursorY, contentHeight());

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    const closingAfter = (line: PendingLine): number =>
      closingSpaceAfterPt(noteReserveHere(), pageFragments, pending, line, spacing.after, options);
    const droppedBelow = (line: PendingLine): number =>
      droppableSpacingPt(noteReserveHere(), pageFragments, pending, line, options);
    let fragmentStart = lines[0]?.start ?? 0;
    let fragmentBefore = appliedBefore;
    // Reserved above the FIRST fragment only: a paragraph continued onto the next page opens
    // once, the same way it closes once.
    let fragmentTopExtent = breakLinesOnly ? 0 : topExtent;
    let endedWithPageBreak = false;
    /** The fragment is a leading page break's empty line, kept out of flow on a full page. */
    let keptBreakLine = false;
    /** Where that kept line would sit unclamped: its shading fills there, past the band. */
    let keptBreakY = 0;
    /** After a break line. Text after leading breaks opens with its space before and top rule. */
    const openAfterBreak = (endsHere: boolean): void => {
      fragmentBefore = 0;
      fragmentTopExtent = 0;
      endedWithPageBreak = !breakLinesOnly || endsHere;
      if (endedWithPageBreak) return;
      breakLinesOnly = false;
      fragmentBefore = textBefore;
      fragmentTopExtent = paragraphBorderExtentPt(borders.top);
      cursorY += fragmentBefore + fragmentTopExtent;
    };
    let fragmentParagraphStartY = cursorY;
    /** Clearance applied above the fragment's first placed line, for anchor framing. */
    let fragmentFirstLineSkip = 0;
    /** How far alignment moved the fragment's first line; its list marker moves with it. */
    let fragmentFirstAlignOffset = 0;
    const appliedSkipByLineIndex = new Map<number, number>();
    previousSpaceAfter = 0;
    const paragraphHasAnchors =
      options.inlineDrawingLayout !== undefined &&
      anchoredDrawingAtomsInParagraph(entry.paragraph, options.inlineDrawingLayout).length > 0;

    const { revisions: markRevisions, formatRevision: markFormatRevision } =
      visibleParagraphMarkRevisionsOf(entry.paragraph, displayMode, authorFilter);
    const markChangeSites = resolvedParagraphMarkChangeSites(
      entry.paragraph,
      displayMode,
      authorFilter
    );
    const mergeGroup = paragraphMergeGroupOf(entry.paragraph);
    const mergeBoundaries = mergeGroup
      ? mergeBoundariesOf(mergeGroup, displayMode, authorFilter)
      : null;

    // The fragment's first line skip that wrapping bands caused (see `fragmentAnchorFrame`).
    const bandSkip = (applied = fragmentFirstLineSkip) =>
      Math.max(0, applied - (lines[fragmentFirstLine]?.anchorClearanceBefore ?? 0));
    /** The paragraph top this fragment's anchors publish against (`applied`: first line skip). */
    const anchorParagraphY = (applied = fragmentFirstLineSkip): number =>
      fragmentParagraphStartY -
      fragmentBefore -
      fragmentTopExtent +
      applied -
      bandSkip(applied) -
      paragraphDrawingWrap.displacement(pages.length, paragraphId);
    const flushFragment = (isLast: boolean): void => {
      if (pending.length === 0) return;
      const regionX = columnLeft();
      const columnX = columnLeft();
      const linesTop = pending[0]!.box.y;
      const top = linesTop - fragmentBefore - fragmentTopExtent;
      const linesBottom =
        pending[pending.length - 1]!.box.y + pending[pending.length - 1]!.box.height;
      const appliedAfter = isLast ? spacing.after : 0;
      const {
        strokes,
        bottomBorder: bottomBorderRecord,
        contentTop,
        contentBottom,
        boxLeft,
        boxWidth,
        bottom,
        height,
      } = paragraphFragmentBorders({
        borders,
        // Only text after leading break lines opens a later fragment: with its own top rule.
        topEdge: fragmentIndex === 0 ? topEdge : borders.top,
        closingEdge,
        continuesAbove,
        continuesBelow,
        inFrame: Boolean(frame),
        isLast,
        fragmentIndex,
        topExtent: fragmentTopExtent,
        appliedAfter,
        top,
        linesTop,
        linesBottom,
        regionX,
        indentLeft: indent.left,
        available,
        outdent: paragraphBoxOutdent(indent, rtl),
        drawn: !breakLinesOnly,
      });
      if (isLast) cursorY = Math.max(cursorY, bottom);
      // A resolved view lays a run of paragraphs out as one. The layout is what the document
      // becomes; the identity has to stay what the document HAS, or an edit in the merged half
      // addresses a position the store does not hold.
      const mergedLines = mergeBoundaries ? remapMergedLines(pending, mergeBoundaries) : null;
      const holdsMarker =
        markerStart === undefined ? fragmentIndex === 0 : pending[0]!.range.start === markerStart;
      const rawMarker = holdsMarker
        ? publishListMarker(
            listItem,
            measurer,
            pending[0],
            listMarkerAlignShift(fragmentFirstAlignOffset, alignment, rtl),
            rtl ? indent.left + available + indent.right : undefined,
            options.inlineDrawingLayout?.pictureBulletResource
          )
        : undefined;
      const marker = rawMarker
        ? { ...rawMarker, box: { ...rawMarker.box, x: rawMarker.box.x + regionX } }
        : undefined;
      if (!frame && fragmentIndex === 0) {
        publishParagraphFrames(paragraphId, fragmentParagraphStartY, pending);
        noteAnchor(paragraphId, fragmentParagraphStartY - fragmentBefore - fragmentTopExtent);
      }
      const publishedFragment: ParagraphFragmentRecord = {
        kind: 'paragraph',
        id: `${paragraphId}#f${fragmentIndex}`,
        paragraphId,
        fragmentIndex,
        range: mergedLines
          ? // A merged fragment holds more than one paragraph and this field holds one range,
            // so it cannot be the fragment's extent. It takes the one its LAST line reports —
            // where the fragment ENDS — and everything that resolves a position reads spans
            // instead, which name their own paragraphs. `pushLineCaretStops` reads `start`
            // from here only to dedupe a continuation line's first stop, and a merged
            // fragment's lines are compared against their own segment starts anyway.
            mergedLines[mergedLines.length - 1]!.range
          : {
              paragraphId,
              start: fragmentStart,
              end: pending[pending.length - 1]!.range.end,
            },
        props,
        styleId: entry.styleId,
        outlineLevel: entry.outlineLevel,
        alignment: entry.alignment,
        spacing: { before: fragmentBefore, after: appliedAfter },
        indent,
        ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
        ...(strokes.length > 0 ? { borders: strokes } : {}),
        ...(collapsedMark || keptBreakLine || markPastBottom ? { outOfFlow: true as const } : {}),
        ...(shading === undefined || collapsedMark
          ? {}
          : {
              shading,
              // A BORDERED paragraph is shaded across the whole frame, not just the text
              // band: Word fills the box its borders draw, `w:space` padding included, so a
              // fill that stopped at the line area left a pale stripe floating inside an
              // empty rectangle. Unbordered shading keeps the line area, which is what Word
              // fills there. Borders paint after this, so the frame is never covered.
              // Gated on a real FRAME — a side rule is what makes the fill a box. A heading
              // with only `w:bottom` is the common single-edge case, and widening its fill
              // down to the rule would be a silent change in the opposite direction.
              shadingBox: atKeptBreakY(
                borders.left || borders.right
                  ? {
                      x: boxLeft,
                      y: contentTop,
                      width: boxWidth,
                      height: Math.max(contentBottom - contentTop, 0),
                    }
                  : paragraphShadingBox(pending, regionX + indent.left, available)!,
                keptBreakLine ? { y: keptBreakY, clip: pageContentClip() } : undefined
              ),
            }),
        tabStops: entry.tabStops,
        ...(marker ? { marker } : {}),
        // Final fragment only — a paragraph split across pages must not draw two pilcrows —
        // and `all-markup` only, as Word draws attribution in All Markup alone. The record's
        // own declaration carries the rest of the reasoning.
        ...(isLast ? { paragraphEnd: true as const } : {}),
        ...(isLast && showsMarkup ? markRevisionFields(markRevisions, markFormatRevision) : {}),
        ...(isLast && markChangeSites.length > 0 ? { markChangeSites } : {}),
        lines: mergedLines ?? pending,
        ...emptyParagraphStyleFields(pending, markRunProperties, styleCascade?.themeFonts, isLast),
        box: { x: columnX + indent.left, y: top, width: available, height },
      };
      if (frame) paragraphFrames.add(frame, publishedFragment, frameStart?.groupId, index);
      else pageFragments.push(publishedFragment);
      // Each fragment publishes the anchors its lines hold, framed by its own lines.
      const anchorRange = {
        start: fragmentIndex === 0 ? 0 : fragmentStart,
        end: isLast ? Infinity : pending[pending.length - 1]!.range.end,
      };
      if (
        options.inlineDrawingLayout &&
        paragraphHasAnchors &&
        holdsDrawingIn(entry.paragraph, anchorRange)
      ) {
        const anchorFrame = fragmentAnchorFrame({
          pending,
          top,
          height,
          column: { x: columnX, width: columnWidth() },
          indentLeft: indent.left,
          available,
          displacement: paragraphDrawingWrap.displacement(pages.length, paragraphId),
          bandSkip: bandSkip(),
          lineBeforeBandPush: lineAnchorsBeforeBandPush,
        });
        collectAnchoredDrawings(
          publishAnchoredDrawingsForParagraph({
            paragraph: entry.paragraph,
            paragraphId,
            paragraphBox: anchorFrame.paragraphBox,
            lines: anchorFrame.lines,
            fragmentRange: anchorRange,
            drawingLayout: options.inlineDrawingLayout,
            frameBase: anchorFrameBase(),
            columnBox: anchorColumnBox(anchorFrame.paragraphBox),
            cellBox: null,
            pageClip: pageContentClip(),
            cellAnchorScope: null,
            measurer,
            sourceOrderOf,
            // The drawing-context guard above is the same predicate that creates this bundle.
            layoutTextboxStory: hostedStory!.layoutTextboxStoryFor,
            displayMode,
            ...(authorFilter ? { revisionAuthorFilter: authorFilter } : {}),
          })
        );
      }
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
      fragmentBefore = 0;
      fragmentTopExtent = 0;
    };

    // First line of this paragraph on the CURRENT page: the anchor a keep rule retreats to.
    // Not always 0 — a paragraph already cut by a page boundary keeps what it kept. Each
    // retreat moves a line onto a later page, so the walk terminates; `maxRetreats` guards a
    // future rule that could cycle, and fails OPEN at the natural break rather than throwing.
    let fragmentFirstLine = 0;
    let retreats = 0;
    let maxRetreats = lines.length + KEEP_BREAK_RETRY_ALLOWANCE;
    let emptyFurnitureAdvances = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const pendingLine = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;
      // Spacing-after stays out of the fit budget (see the firstTail note above): it moves
      // where the NEXT paragraph starts, never whether this line fits, and it clips at the
      // page boundary rather than carrying over. Above a footnote area it must fit too.
      const tail = isLastLine ? borderExtent + closingAfter(pendingLine) : 0;
      const bandAfter = isLastLine
        ? tableBandSpaceAfter(options.compatibilityMode, spacing.after)
        : 0;
      if (lineIndex === fragmentFirstLine) {
        fragmentParagraphStartY = cursorY;
      }
      const skipBefore = frame
        ? 0
        : placementSkipBefore(
            entry,
            index,
            lines,
            lineIndex,
            fragmentFirstLine,
            fragmentParagraphStartY,
            pendingLine,
            appliedSkipByLineIndex,
            fragmentBefore,
            bandAfter,
            fragmentIndex === 0 ? ownTableBefore : 0
          );
      // Auto spacing below the glyph band may cross the bottom text margin, not a footnote
      // area. The painted line keeps its full box; only the pagination budget drops it.
      // An empty anchor's own clearance moves its mark, not the anchor onto another sheet.
      const lineExtent =
        (pendingLine.anchorClearanceBefore ?? skipBefore) +
        Math.max(0, pendingLine.height - droppedBelow(pendingLine)) +
        tail;
      // A leading page break's empty line stays: the break itself opens the next sheet.
      keptBreakLine =
        !frame && lineIndex === 0 && cursorY + lineExtent > contentHeight() && leadingBreak();
      // An own object that cannot end at the bottom margin takes its line to the next column.
      const anchorMoves =
        (pending.length > 0 || regionHasFragments() || columnRegionTop > 0) &&
        pageFit.crosses(
          pendingLine,
          isLastLine,
          () => anchorParagraphY(pending.length > 0 ? undefined : skipBefore),
          cursorY + skipBefore - (pending.length > 0 ? 0 : fragmentBefore + fragmentTopExtent)
        );
      // An intrinsically oversized line cannot fit another empty sheet; publish it once.
      const overflowsPage =
        lineIndex === keepTailAt ||
        (!frame &&
          (cursorY + lineExtent > contentHeight() || anchorMoves) &&
          !holdsSheet() &&
          !keptBreakLine &&
          (pending.length > 0 ||
            pageFragments.length > 0 ||
            columnRegionTop > 0 ||
            ((pages.length > 0 || (furnitureHasWrap && skipBefore > 0)) &&
              ownBandSkip(entry, index, lines, lineIndex, fragmentParagraphStartY, fragmentBefore) +
                Math.max(0, pendingLine.height - pendingLine.trailingSpacing) +
                tail <=
                contentHeight())));
      if (overflowsPage) {
        keepTailAt = -1;
        // A floating table that the previous pass placed beside this anchor stays there when
        // its band pushes the anchor on: only the anchor moves to the next column or page.
        const first = lineIndex === 0 && fragmentIndex === 0 && !frame;
        if (first && ownTableStays(paragraphId, lineExtent - skipBefore))
          noteAnchor(paragraphId, cursorY);
        if (
          !regionHasFragments() &&
          skipBefore > 0 &&
          pageExclusionZones().some((zone) => zone.sourceKind === 'furniture') &&
          ++emptyFurnitureAdvances > MAX_DRAWING_EXCLUSION_REFLOW_PASSES * columnCount
        ) {
          throw new DrawingExclusionConvergenceError(
            'wrapping page furniture leaves no room for body content'
          );
        }
        // `w:widowControl` (§17.3.1.44) / `w:keepLines` (§17.3.1.16) change where a paragraph
        // may be CUT, not where it fits: retreat off a stranded line, or off keepLines whole.
        const alone = !regionHasFragments();
        const breakAt =
          retreats < maxRetreats
            ? adjustedBreakIndex(lineIndex, fragmentFirstLine, lines.length, keeps, alone)
            : lineIndex;
        const retreated = breakAt < lineIndex;
        // Un-placing hands line ids BACK: a line re-placed on the next page must carry the id
        // it already took, or every id below it is out of step with a clean pass.
        for (let back = lineIndex; back > breakAt; back -= 1) {
          pending.pop();
          const removedPending = lines[back - 1]!;
          const removedSkip =
            appliedSkipByLineIndex.get(back - 1) ?? removedPending.exclusionSkipBefore ?? 0;
          appliedSkipByLineIndex.delete(back - 1);
          cursorY -= removedPending.height + removedSkip;
          lineCounter -= 1;
        }
        // Moving WHOLE preserves the next column's origin; space-before drops, the top rule travels.
        // So does an own object that takes the paragraph's first line along.
        const movesWhole =
          (retreated || anchorMoves) && pending.length === 0 && fragmentIndex === 0;
        const nextOffset = lines[breakAt]!.start;
        const priorColumnWidth = columnWidth();
        const priorPageHadExclusions = pageExclusionZones().length > 0;
        // An anchor that keeps or widow rules move whole leaves its own table here as well.
        if (movesWhole && retreated && !frame && ownTableStays(paragraphId, lines[0]!.height))
          noteAnchor(paragraphId, cursorY);
        flushFragment(false);
        advanceColumn();
        fragmentBefore = 0;
        if (movesWhole) cursorY += fragmentTopExtent;
        else fragmentTopExtent = 0;
        if (
          columnWidth() !== priorColumnWidth ||
          priorPageHadExclusions ||
          pageExclusionZones().length > 0
        ) {
          // The remaining model text sees the new page's bands even when its
          // column width is unchanged. Old wrap advances and vertical skips are
          // placement-specific and cannot travel with a pre-broken line.
          rebreakInCurrentColumn(nextOffset, cursorY);
          appliedSkipByLineIndex.clear();
          maxRetreats = Math.max(maxRetreats, lines.length + KEEP_BREAK_RETRY_ALLOWANCE);
          fragmentFirstLine = 0;
          if (retreated) retreats += 1;
          lineIndex = -1;
          continue;
        }
        fragmentFirstLine = breakAt;
        fragmentParagraphStartY = cursorY;
        if (retreated || (columnRegionTop > 0 && cursorY + lineExtent > contentHeight())) {
          if (retreated) retreats += 1;
          lineIndex = breakAt - 1;
          continue;
        }
      }
      emptyFurnitureAdvances = 0;
      const columnX = columnLeft();
      appliedSkipByLineIndex.set(lineIndex, skipBefore);
      if (skipBefore > 0)
        earlierLinePush.note(
          pages.length,
          flowColumnIndex,
          paragraphId,
          cursorY,
          pendingLine.height + bandAfter,
          skipBefore,
          pageExclusionZones()
        );
      cursorY += skipBefore;
      // Inside the band, so the page's notes and furniture still see the body where it ends.
      if (keptBreakLine) {
        keptBreakY = cursorY;
        cursorY = Math.min(cursorY, Math.max(0, contentHeight() - pendingLine.height));
      }
      const firstLineOffset = pendingLine.firstLineOffset ?? 0;
      const lineIndent = columnX + indent.left + (rtl ? 0 : firstLineOffset);
      const lineAvailableWidth = Math.max(1, available - firstLineOffset);
      // Spans and inline drawings come from one pen, so they share one origin.
      const penX = columnX - (rtl ? firstLineOffset : 0);
      const placedSpans = pendingLine.spans.map((span) => ({
        ...span,
        // The broken range already names this paragraph unless a shared break was reused.
        range: span.range.paragraphId === paragraphId ? span.range : { ...span.range, paragraphId },
        box: { ...span.box, x: span.box.x + penX, y: cursorY },
      }));
      // Word aligns inside the passage a float leaves the line, not the page margins.
      const measure = lineAlignmentMeasure(pendingLine, penX, lineIndent, lineAvailableWidth);
      const placedDrawings = pendingLine.drawings.map((drawing) =>
        Object.freeze({ ...shiftInlineDrawingRecord(drawing, penX, cursorY), paragraphId })
      );
      const content = alignLineWithPictures(
        placedSpans,
        placedDrawings,
        rtl,
        (spans) =>
          alignBodyLineSpans(
            spans,
            measurer,
            measure,
            alignment,
            entry.props,
            pendingLine,
            isLastLine,
            styleCascade,
            rtl
          ),
        (aligned) =>
          lineAlignOffset(placedSpans, aligned, alignment, measure.available, measure.used)
      );
      const { spans: alignedSpans, offset: alignOffset } = content;
      // Clip where alignment put each picture: paper or mid-gap sideways, the body band vertically.
      let alignedDrawings = content.drawings;
      if (alignedDrawings.length > 0) {
        const paperClip = columnPaperClip(pageContentClip(), columns, columnIndex);
        alignedDrawings = alignedDrawings.map((drawing) =>
          clipInlineDrawingToBodyBand(drawing, paperClip, contentHeight())
        );
      }
      const record: LineRecord = {
        id: bodyLineId(paragraph.id, pendingLine.start, lineIndex),
        range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
        spans: alignedSpans,
        box: {
          x: columnLeft() + indent.left,
          y: cursorY,
          width: available,
          height: pendingLine.height,
        },
        contentX: lineContentX(alignedSpans, alignedDrawings, lineIndent + alignOffset),
        baseline: pendingLine.baseline,
        leading: pendingLine.leading,
        trailingSpacing: pendingLine.trailingSpacing,
        ...(pendingLine.manualBreakAfter ? { manualBreakAfter: true } : {}),
        ...lineBreakAfterFields(pendingLine),
        ...(pendingLine.deletedRanges ? { deletedRanges: pendingLine.deletedRanges } : {}),
        ...(alignedDrawings.length > 0 ? { drawings: alignedDrawings } : {}),
        ...(pendingLine.anchorRevisions ? { anchorRevisions: pendingLine.anchorRevisions } : {}),
        ...(pendingLine.changeSites ? { changeSites: pendingLine.changeSites } : {}),
      };
      lineCounter += 1;
      if (pending.length === 0) {
        fragmentFirstLineSkip = skipBefore;
        fragmentFirstAlignOffset = listMarkerLineOffset(alignOffset, lineAvailableWidth);
      }
      pending.push(record);
      cursorY += pendingLine.height;
      // An own object that still crosses the bottom margin here ends the page after its line.
      const lineY = record.box.y - (pending.length > 1 ? 0 : fragmentBefore + fragmentTopExtent);
      if (!frame && pageFit.crosses(pendingLine, isLastLine, () => anchorParagraphY(), lineY))
        cursorY = Math.max(cursorY, contentHeight());
      if (pendingLine.columnBreakAfter) {
        const priorColumnWidth = columnWidth();
        const priorPageHadExclusions = pageExclusionZones().length > 0;
        flushFragment(isLastLine);
        advanceColumn();
        const next = lines[lineIndex + 1];
        openAfterBreak(!next || holdsOnlyPageBreak(next) || holdsOnlyColumnBreak(next));
        if (
          !isLastLine &&
          (columnWidth() !== priorColumnWidth ||
            priorPageHadExclusions ||
            pageExclusionZones().length > 0)
        ) {
          rebreakInCurrentColumn(pendingLine.end, cursorY);
          appliedSkipByLineIndex.clear();
          maxRetreats = Math.max(maxRetreats, lines.length + KEEP_BREAK_RETRY_ALLOWANCE);
          fragmentFirstLine = 0;
          lineIndex = -1;
          continue;
        }
        fragmentFirstLine = lineIndex + 1;
      } else if (pendingLine.pageBreakAfter) {
        const priorPageHadExclusions = pageExclusionZones().length > 0;
        flushFragment(isLastLine);
        // Keep the empty section mark with its break when the next section opens a sheet.
        if (isLastLine && options.markJoinsBreakSheet && !frame && emptySectionMarkAt(index + 1)) {
          markOnBreakSheet = index + 1;
        } else flushPage();
        // The text starts on this sheet, so its space after collapses with the next paragraph.
        openAfterBreak(isLastLine || holdsOnlyPageBreak(lines[lineIndex + 1]!));
        if (!isLastLine && (priorPageHadExclusions || pageExclusionZones().length > 0)) {
          rebreakInCurrentColumn(pendingLine.end, cursorY);
          appliedSkipByLineIndex.clear();
          maxRetreats = Math.max(maxRetreats, lines.length + KEEP_BREAK_RETRY_ALLOWANCE);
          fragmentFirstLine = 0;
          lineIndex = -1;
          continue;
        }
        // An explicit break is the author's cut; the keep rules apply afresh after it.
        fragmentFirstLine = lineIndex + 1;
      }
    }
    flushFragment(true);
    releasePlacedBreaks(paragraphId);
    previousSpaceAfter = collapsingSpaceAfter(endedWithPageBreak ? 0 : spacing.after, styleCascade);
    if (savedFrameFlow) {
      cursorY = savedFrameFlow.cursorY;
      previousSpaceAfter = savedFrameFlow.previousSpaceAfter;
      firstParagraphOfSection = savedFrameFlow.firstParagraphOfSection;
    }
  }
  if (!converged) publishParagraphFrames('', cursorY);

  // A TERMINAL checkpoint, describing the flow after the last paragraph. Without it,
  // appending a paragraph gives `firstChanged === paragraphCount` — "resume after the end" —
  // for which nothing was stored, so the most ordinary edit there is, typing at the bottom of
  // a document and pressing Enter, re-placed everything.
  if (!converged) {
    checkpoints[prepared.length] = checkpointNow();
  }

  // Captured BEFORE the terminal flush, which zeroes the cursor. A converged pass stopped
  // early and never walked the tail, so its end state is the one the previous pass stored.
  // Floats on the last sheet do not move it: a section continuing there wraps around them.
  let endCursorY = converged && session ? session.endCursorY : cursorY;
  const endSpaceAfter = converged && session ? session.endSpaceAfter : previousSpaceAfter;
  // The terminal flush closes the page the flow was still filling. When it does NOT run,
  // the last page was already closed by a page break and the cursor sits at the top of a
  // sheet that was never opened — nothing may be appended to what is in `pages`.
  const flushesOpenPage =
    !converged && (pageFragments.length > 0 || floatSignals.length > 0 || pages.length === 0);
  const endsOpenPage = converged && session ? session.endsOpenPage : flushesOpenPage;

  if (flushesOpenPage) {
    flushPage();
    endCursorY = Math.max(
      endCursorY,
      positionedFrameBottom(pages.at(-1)!.fragments, pages.at(-1)!.contentBox.height)
    );
  }
  while (!converged && (textCarry.pending || pageFragments.length > 0)) flushPage();
  let terminalFlushAttempts = 0;
  const maxTerminalFlushAttempts = MAX_ANCHOR_PAGE_DEFERRALS * 4 + 8;
  while (
    (pendingAnchoredDrawings.length > 0 || deferredAnchoredDrawings.length > 0) &&
    terminalFlushAttempts < maxTerminalFlushAttempts
  ) {
    terminalFlushAttempts += 1;
    if (pendingAnchoredDrawings.length === 0) carryDeferredToNextPage();
    flushPage();
  }
  if (deferredAnchoredDrawings.length > 0) {
    pendingAnchoredDrawings.push(
      ...deferredAnchoredDrawings.map((drawing) =>
        withAnchoredDrawingLayoutFallback(drawing, 'page-defer-exhausted')
      )
    );
    deferredAnchoredDrawings = [];
    flushPage();
  }
  // Entries this pass never asked for are gone from the document or changed context; holding
  // them would let the cache grow with the session rather than with the document.
  // Retain by the keys of every paragraph in the DOCUMENT, not just those this pass
  // re-placed: a resumed pass never visits the prefix, and evicting its entries would make
  // the next full pass measure the whole document again.
  publishRetainedKeys();
  const layout: SemanticLayout = {
    revision,
    pages,
    ...(options.displayMode ? { displayMode: options.displayMode } : {}),
  };
  if (session) {
    session.previous = layout;
    session.checkpoints = converged
      ? convergedCheckpoints(checkpoints, session.checkpoints, {
          at: convergedAt,
          removedBlocks: session.keys.length - prepared.length,
          pageDelta: convergedPageDelta,
        })
      : checkpoints;
    session.keys = flowKeys;
    reserveResume.publish(session, pages.length);
    session.producer = producer;
    session.parityDependent = nextParityDependent(
      session.parityDependent,
      usedPageParity || furniture?.evenAndOddHeaders === true,
      startIndex === 0 && !converged
    );
    session.startPageParity = startPageParity;
    session.startLineCounter = lineCounterStart;
    session.endLineCounter = lineCounter;
    session.endCursorY = endCursorY;
    session.endSpaceAfter = endSpaceAfter;
    session.endsOpenPage = endsOpenPage;
    session.stats = {
      placed,
      total: prepared.length,
      reusedPages,
      fullPasses: session.stats.fullPasses + (startIndex === 0 ? 1 : 0),
    };
  }
  return {
    layout,
    pages,
    lineCounter,
    endCursorY,
    endSpaceAfter,
    endsOpenPage,
    overflowShellAt,
  };
}

function layoutBlocksWithGeometrySteps(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions
): LayoutSteps<BlockLayoutResult> {
  return layoutWithFurnitureRetry(bodies, revision, options, layoutBlocksPass);
}

export * from './semantic-layout-exports.ts';
