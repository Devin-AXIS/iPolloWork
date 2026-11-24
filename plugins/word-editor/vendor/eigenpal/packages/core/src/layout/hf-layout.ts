import {
  readPositionedHeaderFrames,
  placePositionedHeaderFrames,
} from './header-positioned-frames.ts';
import { withFieldResultsProducer } from './field-results-producer.ts';
import { characterStyleValuesToken } from './character-style-tokens.ts';
import { characterHeaderPageToken } from './character-header-pages.ts';
import { headerTopMarginOrigin } from './header-footer-drawing-origin.ts';
// Header/footer story layout (phase 2 of the legacy-lane retirement).
//
// A header or footer is a STORY laid out at the section's content width with no pagination:
// its height is whatever its blocks flow to. That flow height — never an anchored-object
// extent — is what sizes the box on every page (the #856 rule).
//
// Baseline stories are laid out once per variant for furniture height / content-area
// push-down. Allowlisted PAGE/NUMPAGES/SECTIONPAGES fields need context-sensitive projection
// because digit widths affect right-tab alignment. Callers obtain those via
// {@link HeaderFooterStoryLayout.withPageContext}:
//
//   - NUMPAGES only → one cached layout per page count
//   - SECTIONPAGES only → one cached layout per section page count
//   - PAGE (alone or combined) → bounded LRU over the distinct evaluated values
//

import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-tree.ts';
import {
  carryStrippedPageFieldProjection,
  detectStoryPageFields,
  fieldPageContextToken,
  storyNeedsPageFields,
  type FieldPageContext,
  type StoryPageFieldNeeds,
} from './field-projection.ts';
import { framedTokenJoin, type ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { drawingResourceLayoutToken } from './inline-drawing-source.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { DrawingAnchorFrameContext } from './drawing-layout.ts';
import { inlinePictureRoomOf, storyPageClip } from './drawing-page-clip.ts';
import {
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
  exclusionLayoutToken,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { sortStoryDrawingsForPaint } from './drawing-overlap.ts';
import { storyDrawingWrapZones } from './hf-cell-anchor-wrap.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import { noteUnsettledExclusionReflow } from './unsettled-exclusion-layout.ts';
import {
  forEachStoryDrawing,
  forEachStoryParagraphFragment,
  ownedTextboxStories,
} from './semantic-record-queries.ts';
import { withResolvedListItems, type ResolvedListItem } from './list-resolve.ts';
import type { ListCounterSnapshot } from './list-counters.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { hostedStoryFlowDeps, layoutTextboxStory } from './textbox-story-layout.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { storyBlocks } from './story-roots.ts';
import { positionLegacyFooterPageFrame } from './legacy-footer-page-frame.ts';
import {
  footerLiftAboveTables,
  placeFloatingStoryTables,
  splitFloatingStoryTables,
} from './hf-floating-tables.ts';
import { withoutFloatingTableZones } from './table-float-overlap.ts';
import { placeHeaderPageFrame, readHeaderPageFrame } from './header-page-frame.ts';
import { layoutStoryWithTextFrames } from './story-text-frames.ts';
import { createBoundedContextCache } from './bounded-context-cache.ts';

/**
 * How many times a footer grows upward when text wrapped beside a page-framed table runs past
 * the sheet. Each growth moves the top edge up by the overflow and wraps again; a narrower
 * passage can add a line each time, so the growth is bounded rather than iterated to a fixed
 * point. Three covers a wrap that adds a line per pass for the passages a footer table leaves;
 * past that, the text is lifted above every table it meets, which always fits the sheet.
 */
const FOOTER_GROWTH_PASSES = 3;

/**
 * Distinct PAGE-dependent contexts retained before LRU eviction.
 *
 * Finalize stores projected furniture on each page record, so eviction cannot drop published
 * geometry. The bound only prevents the per-story cache from retaining every historical
 * `(pageNumber, pageCount)` pair across edits.
 *
 * When the caller does not pass its own bound, this is the floor, and the bound grows with the
 * document: see {@link HF_PAGE_CONTEXTS_PER_PAGE}.
 */
export const DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES = 128;

/**
 * Contexts the default bound keeps per page of the highest page number the story has served.
 *
 * The cache must hold one pass's working set. A footer with PAGE and NUMPAGES asks for two
 * contexts per page it lands on (the provisional page count while the pass runs, then the final
 * one), and a shared footer lands on every page. At a fixed 128, a 500-page document evicted
 * each context before the next keystroke asked for it again, so every keystroke re-laid the
 * footer hundreds of times. Sizing by page number keeps a short document's cache as small as
 * before; the third slot per page leaves room for the previous page count after an edit.
 */
const HF_PAGE_CONTEXTS_PER_PAGE = 3;

/** The adaptive bound's ceiling, so a hostile page count cannot size the cache. */
const MAX_ADAPTIVE_HF_PAGE_CONTEXT_ENTRIES = 4096;

/** Page geometry for header/footer anchored frame resolution (story-relative layout space). */
export interface HeaderFooterPageContext {
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** `w:pgMar/@w:header` for a header, `@w:footer` for a footer: the story edge's distance. */
  readonly storyDistance?: number;
}

/** Per-sheet geometry needed to resolve header/footer anchors before wrap and clipping. */
export interface HeaderFooterLayoutPageContext extends FieldPageContext {
  /** Effective content-box inset after this page's header/footer reserves are applied. */
  readonly contentInsetTop?: number;
  /** Effective bottom content-box inset after footer reserve. */
  readonly contentInsetBottom?: number;
  /** Story-box top measured from the physical sheet top. */
  readonly storyTop?: number;
}

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /**
   * The part this story was laid out from.
   *
   * Carried because a derivation that runs over the finished layout cannot reach it otherwise:
   * the layout receives furniture as fragments plus a NAME, and a name is not a tree. The
   * content-control boundary pass needs the tree to know which controls exist at all.
   */
  readonly part?: OoxmlPart;
  /** Main-document relationship id when the furniture source knows it. */
  readonly rId?: string;
  /**
   * Bounded identity of the story's canonical OOXML content.
   *
   * Furniture cache keys must not rely on {@link flowHeight} alone: equal-height A→B edits
   * would otherwise reuse stale page furniture. Derived as a 16-hex FNV-1a over the part's
   * canonical fingerprint — never DOM identity or unbounded raw serialization in the key.
   * PAGE/NUMPAGES/SECTIONPAGES projection shares this key; page context is cached separately.
   */
  readonly contentKey: string;
  /** Snapshot identity for projected links and live document-property fields in this story. */
  readonly projectionEpoch?: string;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** The height the blocks actually flow to — what sizes the box on every page. */
  readonly flowHeight: number;
  /**
   * Allowlisted complex PAGE / NUMPAGES / SECTIONPAGES presence detected for this story.
   *
   * Callers use this to skip attaching a page-field projector when the baseline is enough.
   */
  readonly pageFieldNeeds: StoryPageFieldNeeds;
  /** Anchored drawings owned by this story, in story-relative coordinates. */
  readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  /**
   * Re-layout this story under page-field and optional attached-page geometry context.
   *
   * Field-free stories return `this`. Count-only stories cache by the counts they read.
   * PAGE stories cache by the distinct evaluated values (including format) with a bounded LRU.
   */
  readonly withPageContext: (ctx: HeaderFooterLayoutPageContext) => HeaderFooterStoryLayout;
}

/** Memoized per immutable part: the fingerprint+hash walk is pure and parts never mutate. */
const headerFooterContentKeys = new WeakMap<OoxmlPart, string>();

/** Bounded digest of a header/footer part's canonical tree for furniture cache identity. */
export function headerFooterContentKey(part: OoxmlPart): string {
  const cached = headerFooterContentKeys.get(part);
  if (cached !== undefined) return cached;
  const key = stableHash(canonicalOoxmlFingerprint(part));
  headerFooterContentKeys.set(part, key);
  return key;
}

/**
 * Story-level inputs the body path has always had and furniture never did.
 *
 * A BAG, not more positional parameters. The signature below already carries fifteen, and its
 * own doc comment used to tell new callers to "keep passing `undefined` for what they do not
 * set" — which is why `numberingIndex` was never added and a numbered paragraph in a header
 * painted no marker for as long as headers have been editable. Everything new goes here.
 */
export interface HeaderFooterStoryInputs {
  readonly compatibilityMode?: number;
  /**
   * `numbering.xml`, so a `w:numPr` paragraph in this story resolves a marker — directly or
   * inside an anchored text box, which lays out with its own per-box counters.
   *
   * Absent, the story lays out exactly as before: no marker record, and no numbering indent
   * merged into the paragraph's own.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * The list counters this story starts from. Header and footer stories continue one count
   * across the document (see `furniture-list-seeds.ts`); absent, the story counts from fresh
   * counters.
   *
   * @internal
   */
  readonly listCounterSeed?: ListCounterSnapshot;
  /** Sanitized hyperlink seams scoped to this header/footer part. */
  readonly projectLink?: import('./field-pieces.ts').HyperlinkProjector;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** @internal */
  readonly showFieldCodes?: boolean;
  /** Per-paragraph identity for links and live document-property projection. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Memoized aggregate projection identity for table subtrees. */
  readonly projectionTokenForTable?: (table: OoxmlNode) => string;
  /** Aggregate identity of link and live-field projections for furniture reuse keys. */
  readonly projectionEpoch?: string;
  /** Reviewers whose changes project as accepted in this story. */
  readonly revisionAuthorFilter?: import('./revision-projection.ts').RevisionAuthorFilter;
}

/**
 * Lay one header/footer part out at `contentWidth`.
 *
 * Line ids are namespaced by part so the body's `line-N` counter — which incremental
 * convergence compares — never moves because a header changed.
 *
 * When `pageContext` is set, allowlisted PAGE/NUMPAGES/SECTIONPAGES instructions project
 * live values; otherwise those fields contribute only cached result text (often empty).
 * Field-free stories ignore `pageContext` and share one baseline layout.
 *
 * `defaultTabStopPt` is the document's `w:settings/w:defaultTabStop` (ECMA-376 §17.15.1.25)
 * in points; absent keeps the 0.5" schema default. Furniture tabs on the SAME grid as the
 * body — a page-number tab in a metric-locale footer belongs on the document's interval, not
 * on a constant. It sits at the tail because the parameters ahead of it are already
 * positional; new callers should keep passing `undefined` for what they do not set.
 *
 * NEW inputs belong in {@link HeaderFooterStoryInputs}, the trailing bag, rather than as a
 * sixteenth position. Fifteen is what stopped `numberingIndex` being threaded here at all.
 */
export function layoutHeaderFooterStory(
  part: OoxmlPart,
  contentWidth: number,
  measurer: TextMeasurer,
  producer: string,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>,
  styleCascade?: StyleCascadeTable,
  pageContext?: FieldPageContext,
  maxPageContextEntries?: number,
  defaultTabStopPt?: number,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  drawingTokenForParagraph?: (paragraph: import('@docx-editor.dev/core/store').OoxmlNode) => string,
  drawingLayoutToken?: string,
  hfPageContext?: HeaderFooterPageContext,
  documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties,
  inputs?: HeaderFooterStoryInputs
): HeaderFooterStoryLayout {
  if (inputs?.showFieldCodes) producer += '|field-codes';
  producer = withFieldResultsProducer(producer);
  const revisionAuthorFilter = inputs?.revisionAuthorFilter;
  const pageFrame = readHeaderPageFrame(part);
  const positionedFrames = readPositionedHeaderFrames(part);
  const detected = detectStoryPageFields(part.root);
  // An `inside`/`outside` frame moves with the sheet's parity, so the story needs a page
  // context even when no page field is detected in it.
  const needs = pageFrame?.parity ? { ...detected, hasPageParity: true } : detected;
  const contextCache = createBoundedContextCache<HeaderFooterStoryLayout>(
    maxPageContextEntries ?? DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES
  );
  // WITH the display mode, like every other consumer of this list. The inline flow already
  // received it — a deleted run vanished from a header in `proposed` — while the block list
  // did not, so the paragraph a tracked mark merges away kept its own line, and a paragraph a
  // revision removed entirely kept a blank one. The cache is namespaced by mode below.
  const blocks = storyBlocks(part, displayMode, revisionAuthorFilter);
  const floatingSplit = splitFloatingStoryTables(blocks);
  // The story's own list-item map, resolved once per layout of this occurrence.
  //
  // Never continuing the body's counters. Header and footer stories share one count, so the
  // story starts from the counters the stories before it left (`listCounterSeed`). The
  // numbers do not depend on the page: a header shows the same numbers on page 3 as on page 1.
  const listItems: ReadonlyMap<string, ResolvedListItem> | undefined = withResolvedListItems(
    {
      numberingIndex: inputs?.numberingIndex,
      styleCascade,
      measurer,
      ...(inputs?.listCounterSeed ? { listCounterSeed: inputs.listCounterSeed } : {}),
    },
    blocks
  ).listItems;
  // Content identity is of the authored part, not of a page-field projection.
  const contentKey = headerFooterContentKey(part);
  let baseline: HeaderFooterStoryLayout | undefined;
  // Whether the header frame lane holds, decided once by the layout without a page context.
  let frameAdmitted: boolean | undefined;
  // Likewise for text-anchored story frames, so longer page numbers never move the story text.
  let storyFramesAdmitted: boolean | undefined;

  const layoutOnce = (ctx: HeaderFooterLayoutPageContext | undefined): HeaderFooterStoryLayout => {
    const effectiveCtx =
      storyNeedsPageFields(needs) ||
      positionedFrames ||
      inlineDrawingLayout ||
      ctx?.characterStyleValues
        ? ctx
        : undefined;
    const pageNumber = effectiveCtx?.pageNumber ?? hfPageContext?.pageNumber ?? 1;
    const topMarginOrigin = headerTopMarginOrigin(part, effectiveCtx, hfPageContext);
    const anchorPageToken =
      inlineDrawingLayout &&
      effectiveCtx?.contentInsetTop !== undefined &&
      effectiveCtx.contentInsetBottom !== undefined &&
      effectiveCtx.storyTop !== undefined
        ? `|hf:${effectiveCtx.contentInsetTop},${effectiveCtx.contentInsetBottom},${effectiveCtx.storyTop}`
        : '';
    const token =
      (positionedFrames
        ? `|frames:${effectiveCtx?.storyTop ?? hfPageContext?.storyDistance ?? ''}`
        : '') +
      fieldPageContextToken(effectiveCtx, needs) +
      (inlineDrawingLayout ? `|pn:${pageNumber}|tm:${topMarginOrigin ?? ''}` : '') +
      anchorPageToken +
      (effectiveCtx?.characterStyleValues
        ? `|cs:${characterStyleValuesToken(effectiveCtx.characterStyleValues)}`
        : '');

    if (token === '') {
      if (baseline) return baseline;
    } else {
      const cached = contextCache.get(token);
      if (cached) return cached;
      // Only a PAGE-field story needs a context per page. One whose sole page dependence is an
      // anchored drawing keys by page number too, but lays out the same on every page, so it
      // keeps the floor rather than holding one identical layout per page.
      if (maxPageContextEntries === undefined && storyNeedsPageFields(needs)) {
        contextCache.growTo(
          Math.min(MAX_ADAPTIVE_HF_PAGE_CONTEXT_ENTRIES, pageNumber * HF_PAGE_CONTEXTS_PER_PAGE)
        );
      }
    }

    let lineCounter = 0;
    const pendingAnchoredDrawings: AnchoredDrawingRecord[] = [];
    const anchorFrameBase = (): Omit<
      DrawingAnchorFrameContext,
      | 'paragraphBox'
      | 'anchorLineBox'
      | 'anchorCharacterX'
      | 'columnBox'
      | 'cellBox'
      | 'layoutInCell'
    > => {
      const pageNumber = effectiveCtx?.pageNumber ?? hfPageContext?.pageNumber ?? 1;
      const pageWidth = hfPageContext?.pageWidth ?? contentWidth;
      const pageHeight = hfPageContext?.pageHeight ?? Math.max(1, contentWidth);
      const marginLeft = hfPageContext?.marginLeft ?? 0;
      const marginRight = hfPageContext?.marginRight ?? 0;
      const marginTop = hfPageContext?.marginTop ?? 0;
      const marginBottom = hfPageContext?.marginBottom ?? 0;
      const hfContentHeight = Math.max(1, pageHeight - marginTop - marginBottom);
      const verticalMarginFrame =
        effectiveCtx?.contentInsetTop !== undefined &&
        effectiveCtx.contentInsetBottom !== undefined &&
        effectiveCtx.storyTop !== undefined
          ? Object.freeze({
              top: effectiveCtx.contentInsetTop - effectiveCtx.storyTop,
              height: Math.max(
                1,
                pageHeight - effectiveCtx.contentInsetTop - effectiveCtx.contentInsetBottom
              ),
            })
          : undefined;
      return Object.freeze({
        pageNumber,
        pageWidth,
        pageHeight,
        marginLeft,
        marginRight,
        marginBottom,
        // ON PURPOSE, unlike the body story: the established page/bottomMargin
        // frames keep the AUTHORED margin here. `hfAnchorOnPageSheet` re-bases page-frame
        // axes by subtracting `verticalFrameOrigin`, so this value cancels exactly. The
        // vertical margin frame above carries the effective content-box geometry separately.
        contentInsetTop: marginTop,
        contentInsetBottom: marginBottom,
        contentWidth,
        topMarginFrameOrigin: topMarginOrigin,
        ...(verticalMarginFrame ? { verticalMarginFrame } : {}),
        contentHeight: hfContentHeight,
        contentBandHeight: hfContentHeight,
        ownerPartName: part.name,
        storyKind: part.root.localName === 'ftr' ? 'footer' : 'header',
      });
    };

    // Textbox stories flow with the SAME page-field context as the host story, so a PAGE
    // field inside an anchored footer text box evaluates per page like a direct footer
    // field. The context token already keys this cache entry.
    const layoutTextboxStoryFor = (
      projection: import('../store/package/drawing-projection.ts').DrawingProjection
    ) =>
      layoutTextboxStory(projection, {
        measurer,
        producer:
          producer +
          token +
          (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
          (revisionAuthorFilter ? `|reviewers:${revisionAuthorFilter.cacheKey}` : ''),
        cache,
        styleCascade,
        ...(effectiveCtx ? { pageContext: effectiveCtx } : {}),
        ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
        compatibilityMode: inputs?.compatibilityMode,
        displayMode,
        ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
        ...(documentProperties ? { documentProperties } : {}),
        ...(inputs?.projectLink ? { projectLink: inputs.projectLink } : {}),
        ...(inputs?.projectFieldLink ? { projectFieldLink: inputs.projectFieldLink } : {}),
        showFieldCodes: inputs?.showFieldCodes,
        inlineDrawingLayout,
        ...(drawingTokenForParagraph ? { drawingTokenForParagraph } : {}),
        ...(inputs?.projectionTokenForParagraph
          ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
          : {}),
        ...(inputs?.projectionTokenForTable
          ? { projectionTokenForTable: inputs.projectionTokenForTable }
          : {}),
        ...(inputs?.numberingIndex ? { numberingIndex: inputs.numberingIndex } : {}),
      });
    // ONE capability for the whole projected story — every exclusion reflow pass uses the
    // same layout callback and list-token provider, structurally paired for table-cell flow.
    const hostedStory = inlineDrawingLayout
      ? hostedStoryFlowDeps(
          layoutTextboxStoryFor,
          inputs?.numberingIndex,
          styleCascade,
          displayMode,
          revisionAuthorFilter
        )
      : undefined;

    let exclusionZones: readonly ExclusionZone[] = Object.freeze([]);
    // The zones of the story's own floating tables, which every flow pass wraps around.
    let tableZones: readonly ExclusionZone[] = Object.freeze([]);
    let flow!: { readonly blocks: BlockFragmentRecord[]; readonly bottom: number };
    let plainStory = false;
    // A floating table needs the page geometry to find its anchor. Without it, it stays in flow.
    const floatingGeometry =
      floatingSplit.floating.length > 0 &&
      hfPageContext &&
      (effectiveCtx?.storyTop !== undefined || hfPageContext.storyDistance !== undefined)
        ? hfPageContext
        : undefined;
    const flowBlocks = floatingGeometry ? floatingSplit.flowBlocks : blocks;
    // Only the story's own flow keeps its last paragraph's automatic space after, not a frame.
    const plainDeps = (storyEnd = false) => ({
      measurer,
      cache,
      producer:
        producer +
        token +
        (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
        (revisionAuthorFilter ? `|reviewers:${revisionAuthorFilter.cacheKey}` : ''),
      nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
      styleCascade,
      ...(storyEnd ? { keepsStoryEndAutoSpacing: true as const } : {}),
      ...(listItems ? { listItems } : {}),
      pageContext: effectiveCtx,
      ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
      compatibilityMode: inputs?.compatibilityMode,
      tableNestingOffset: 1 as const,
      displayMode,
      ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
      ...(documentProperties ? { documentProperties } : {}),
      ...(inputs?.projectLink ? { projectLink: inputs.projectLink } : {}),
      ...(inputs?.projectFieldLink ? { projectFieldLink: inputs.projectFieldLink } : {}),
      showFieldCodes: inputs?.showFieldCodes,
      ...(inputs?.projectionTokenForParagraph
        ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
        : {}),
      ...(inputs?.projectionTokenForTable
        ? { projectionTokenForTable: inputs.projectionTokenForTable }
        : {}),
      ...(tableZones.length > 0 ? { pageExclusionZones: () => exclusionZones } : {}),
    });
    // Before mode 15 Word runs header and footer text outside tables under their own logos;
    // the cells read it through `CellAnchorScope.anchorsWrapText`.
    const anchorsWrapText = hasCompatibilityRule(
      inputs?.compatibilityMode,
      'headerFooterAnchorsWrapText'
    );
    const collect = (drawings: readonly AnchoredDrawingRecord[]) => {
      pendingAnchoredDrawings.push(...drawings);
    };
    const drawingDeps = (collectAnchoredDrawings: typeof collect, storyEnd = false) => ({
      ...plainDeps(storyEnd),
      hostedStory,
      anchorsWrapText,
      inlineDrawingLayout,
      anchorFrameBase,
      pageContentClip: () => storyPageClip(anchorFrameBase(), effectiveCtx?.storyTop),
      // An inline picture in header or footer text paints to the paper edge, as in the body.
      inlinePictureRoom: inlinePictureRoomOf(storyPageClip(anchorFrameBase(), undefined)),
      collectAnchoredDrawings,
      columnBoxForParagraph: (paragraphBox: LayoutBox) =>
        Object.freeze({
          x: 0,
          y: paragraphBox.y,
          width: contentWidth,
          height: paragraphBox.height,
        }),
      pageExclusionZones: () => exclusionZones,
      ...(drawingTokenForParagraph
        ? { drawingTokenForParagraph }
        : drawingLayoutToken
          ? { drawingLayoutToken }
          : {}),
    });

    const flowStory = (source: typeof flowBlocks, firstLine: number, storyEnd = true): void => {
      const width = Math.max(1, contentWidth);
      exclusionZones = tableZones;
      if (inlineDrawingLayout) {
        let converged = false;
        let laidUnder = exclusionZones;
        for (let pass = 0; pass < MAX_DRAWING_EXCLUSION_REFLOW_PASSES; pass += 1) {
          laidUnder = exclusionZones;
          pendingAnchoredDrawings.splice(0, pendingAnchoredDrawings.length);
          lineCounter = firstLine;
          flow = flowBlocksInBox(source, 0, width, 0, 0, drawingDeps(collect, storyEnd));
          const drawingZones = storyDrawingWrapZones(
            pendingAnchoredDrawings,
            inlineDrawingLayout,
            contentWidth,
            source
          );
          const nextZones = tableZones.length ? [...tableZones, ...drawingZones] : drawingZones;
          if (drawingZones.length === 0) {
            converged = true;
            exclusionZones = nextZones;
            break;
          }
          if (
            pass > 0 &&
            exclusionLayoutToken(exclusionZones) === exclusionLayoutToken(nextZones)
          ) {
            converged = true;
            exclusionZones = nextZones;
            break;
          }
          exclusionZones = nextZones;
        }
        // A story that does not settle keeps its last flow, so the page still opens, and the
        // zones that flow was laid under.
        if (!converged) {
          exclusionZones = laidUnder;
          noteUnsettledExclusionReflow(MAX_DRAWING_EXCLUSION_REFLOW_PASSES);
        }
      } else {
        lineCounter = firstLine;
        flow = flowBlocksInBox(source, 0, width, 0, 0, plainDeps(storyEnd));
      }
    };

    // The frame lays out alone, first, so its line keeps the first line id of the story.
    const frameBlock =
      floatingSplit.floating.length === 0 &&
      pageFrame &&
      flowBlocks[0]?.id === pageFrame.frameId &&
      flowBlocks[1]?.id === pageFrame.anchorId
        ? flowBlocks[0]
        : undefined;
    let placed: typeof flow | null = null;
    const decideFrame = effectiveCtx === undefined;
    if (frameBlock && !decideFrame && frameAdmitted === undefined) layoutOnce(undefined);
    if (pageFrame && frameBlock && (decideFrame || frameAdmitted)) {
      flowStory([frameBlock], 0, false);
      const framed = flow;
      flowStory(flowBlocks.slice(1), lineCounter);
      // An anchored drawing wraps the story around an exclusion the isolated frame never saw.
      // Only an empty frame can share that band without another collision check.
      placed =
        pageFrame.empty || pendingAnchoredDrawings.length === 0
          ? placeHeaderPageFrame(
              pageFrame,
              framed,
              flow,
              contentWidth,
              effectiveCtx?.sheetNumber ?? pageNumber,
              decideFrame
            )
          : null;
      if (decideFrame) frameAdmitted = placed !== null;
    }
    if (placed) flow = placed;
    else if (
      positionedFrames &&
      hfPageContext?.storyDistance !== undefined &&
      !floatingSplit.floating.length
    ) {
      const framedIds = new Set(
        positionedFrames.flatMap((group) => group.paragraphs.map((paragraph) => paragraph.id))
      );
      const ordinary = flowBlocks.filter((block) => !framedIds.has(block.id));
      // A normal paragraph owns the header story, even when it is empty.
      if (ordinary.some((block) => block.kind === 'paragraph')) {
        flowStory(ordinary, 0);
        if (pendingAnchoredDrawings.length === 0) {
          placed = placePositionedHeaderFrames(
            positionedFrames,
            flowBlocks,
            flow,
            (paragraphs, width) => flowBlocksInBox(paragraphs, 0, width, 0, 0, plainDeps()),
            hfPageContext,
            effectiveCtx?.storyTop ?? hfPageContext.storyDistance
          );
        }
      }
      if (placed) flow = placed;
      else flowStory(flowBlocks, 0);
    } else {
      flowStory(flowBlocks, 0);
      plainStory = !floatingGeometry;
    }

    if (floatingGeometry) {
      const anchors = flow;
      // A footer's bottom edge is fixed and its top rises with its height. The tables resolve
      // once, against the flow before wrapping, so they stay where the text wraps around them.
      // The page furniture hands a footer the top its last height implies (`sheet bottom -
      // distance - flowHeight`) and repeats until the height settles; without it, the top
      // follows the unwrapped flow. The height reported below is the distance from that top to
      // the fixed bottom edge, so a handed top that already holds a lift reproduces it.
      const footerBottom =
        part.root.localName === 'ftr' && floatingGeometry.storyDistance !== undefined
          ? floatingGeometry.pageHeight - floatingGeometry.storyDistance
          : undefined;
      let storyTop =
        footerBottom !== undefined
          ? (effectiveCtx?.storyTop ?? footerBottom - anchors.bottom)
          : (effectiveCtx?.storyTop ?? floatingGeometry.storyDistance!);
      const placeTables = () =>
        placeFloatingStoryTables(
          anchors.blocks,
          anchors.bottom,
          floatingSplit.floating,
          { ...floatingGeometry, contentWidth, storyTop },
          anchorsWrapText,
          // A table never wraps around its own zone, or another table's.
          (table, left, top, placed) =>
            flowBlocksInBox(
              [table],
              left,
              left + Math.max(1, contentWidth),
              top,
              0,
              withoutFloatingTableZones(
                inlineDrawingLayout ? drawingDeps(placed ? collect : () => {}) : plainDeps()
              )
            ).blocks
        );
      let tables = placeTables();
      // A page-framed footer table keeps its page position, so the footer's top edge is fixed
      // first: at its natural top, or raised so the text ends where the table starts. Text
      // the table pushes down may run past the footer's bottom edge, never past the sheet's.
      const framedFooter = footerBottom !== undefined && tables.pageFramed;
      const liftAbove = (pageBottom: number) => {
        const lift = footerLiftAboveTables(tables, anchors.bottom, pageBottom);
        if (lift <= 0) return false;
        storyTop -= lift;
        tables = placeTables();
        return true;
      };
      if (framedFooter) liftAbove(floatingGeometry.pageHeight - storyTop);
      // The placement reads only the unwrapped flow, so one wrapped pass settles it. Placing
      // again after that pass publishes the drawings inside the tables once.
      const wrapTables = () => {
        tableZones = tables.zones;
        flowStory(flowBlocks, 0);
        tables = placeTables();
      };
      if (tables.zones.length) wrapTables();
      // Text wrapped beside a narrow table can grow past its natural height and the sheet.
      // The footer then grows upward by that height, a bounded number of times, and as a last
      // resort its text rises above every table it meets.
      const offSheet = () => storyTop + flow.bottom > floatingGeometry.pageHeight + 0.01;
      for (let pass = 0; framedFooter && pass < FOOTER_GROWTH_PASSES && offSheet(); pass++) {
        storyTop = Math.min(storyTop, footerBottom - flow.bottom);
        tables = placeTables();
        wrapTables();
      }
      if (framedFooter && offSheet() && liftAbove(Number.NEGATIVE_INFINITY)) wrapTables();
      flow = {
        blocks: [...flow.blocks, ...tables.tables],
        bottom: framedFooter ? footerBottom - storyTop : flow.bottom,
      };
    }
    const unframed = flow;
    flow = positionLegacyFooterPageFrame(
      part,
      flow,
      contentWidth,
      hfPageContext,
      styleCascade?.fixedParagraphSpacing
    );
    // Text-anchored frames that no fixed lane describes take their place beside the story.
    if (plainStory && flow === unframed && storyFramesAdmitted !== false) {
      if (effectiveCtx && storyFramesAdmitted === undefined) layoutOnce(undefined);
      const placed = layoutStoryWithTextFrames(
        flowBlocks,
        (source) => (flowStory(source, 0), flow),
        (paragraphs, width) => flowBlocksInBox(paragraphs, 0, width, 0, 0, plainDeps()),
        { contentWidth, ...hfPageContext },
        (framed) => (flow = framed),
        effectiveCtx !== undefined && storyFramesAdmitted === true
      );
      if (!effectiveCtx) storyFramesAdmitted = placed ?? false;
    }
    const story: HeaderFooterStoryLayout = {
      partName: part.name,
      part,
      contentKey,
      ...(inputs?.projectionEpoch ? { projectionEpoch: inputs.projectionEpoch } : {}),
      fragments: flow.blocks,
      flowHeight: flow.bottom,
      pageFieldNeeds: needs,
      ...(pendingAnchoredDrawings.length > 0
        ? { anchoredDrawings: sortStoryDrawingsForPaint(pendingAnchoredDrawings) }
        : {}),
      withPageContext: (next) => {
        if (
          !storyNeedsPageFields(needs) &&
          !positionedFrames &&
          !story.anchoredDrawings?.length &&
          !next.characterStyleValues &&
          !effectiveCtx?.characterStyleValues
        ) {
          return baseline ?? story;
        }
        return layoutOnce({
          ...next,
          characterStyleValues: next.characterStyleValues ?? effectiveCtx?.characterStyleValues,
        });
      },
    };

    if (token === '') {
      baseline = story;
    } else {
      contextCache.set(token, story);
    }
    return story;
  };

  return layoutOnce(pageContext);
}

/**
 * Remap a section-local page onto the document sheet stack.
 *
 * Each section lays out with its own origin; the orchestrator assigns global indices and
 * cumulative Y so sheets of different heights still stack without gaps or overlaps.
 *
 * Furniture boxes must move with the sheet. The attach-time `pageFieldProjector` closes over
 * the section-local page box, so a bare shift of the current story box is not enough —
 * document-level page-field finalize would re-place at the pre-stack origin and paint
 * would compute `(story.box.y - page.box.y)` as a negative full-page offset onto the prior
 * sheet. Wrap the projector so projected furniture receives the same `dy`.
 */
export function remapPage(page: PageRecord, globalIndex: number, sheetY: number): PageRecord {
  const dy = sheetY - page.box.y;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  const shiftFurniture = (
    story: HeaderFooterStoryRecord | undefined
  ): HeaderFooterStoryRecord | undefined => {
    if (!story) return undefined;
    const shifted: HeaderFooterStoryRecord = {
      ...story,
      box: shiftBox(story.box),
      ...(story.anchoredDrawings ? { anchoredDrawings: story.anchoredDrawings } : {}),
    };
    if (!story.pageFieldProjector) {
      // A published (already-finalized) story keeps its projector on the side; carry it onto
      // the shifted twin so a moved reused sheet can still re-project at a new page count.
      carryStrippedPageFieldProjection(story, shifted, dy);
      return shifted;
    }
    const project = story.pageFieldProjector;
    return {
      ...shifted,
      pageFieldProjector: (context) => {
        const projected = project(context);
        return { ...projected, box: shiftBox(projected.box) };
      },
    };
  };
  const shiftNoteArea = (
    area: import('./semantic-records.ts').NoteAreaRecord | undefined
  ): import('./semantic-records.ts').NoteAreaRecord | undefined => {
    if (!area) return undefined;
    return {
      ...area,
      box: shiftBox(area.box),
      ...(area.separator
        ? { separator: { ...area.separator, box: shiftBox(area.separator.box) } }
        : {}),
      ...(area.continuationNotice
        ? {
            continuationNotice: {
              ...area.continuationNotice,
              box: shiftBox(area.continuationNotice.box),
            },
          }
        : {}),
      notes: area.notes.map((note) => ({ ...note, box: shiftBox(note.box) })),
    };
  };
  const header = shiftFurniture(page.header);
  const footer = shiftFurniture(page.footer);
  const footnotes = shiftNoteArea(page.footnotes);
  const endnotes = shiftNoteArea(page.endnotes);
  return {
    ...page,
    id: `page-${globalIndex}`,
    index: globalIndex,
    box: shiftBox(page.box),
    contentBox: shiftBox(page.contentBox),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(footnotes ? { footnotes } : {}),
    ...(endnotes ? { endnotes } : {}),
  };
}

/** Memoized per story object, exactly like {@link storyDrawingResourceTokens}. */
const storyListMarkerTokens = new WeakMap<HeaderFooterStoryLayout, string>();

/**
 * Marker identity of every list item a header/footer story paints.
 *
 * The exact sibling of {@link storyDrawingResourceToken}, and for the same reason. What
 * otherwise identifies a story — `contentKey` and `flowHeight` — describes the AUTHORED part,
 * and neither moves when `numbering.xml` changes: the definition lives in a different part, and
 * a marker sits in the hanging-indent slot, so the story is exactly as tall with `1.` as with
 * `vii.`. Without this the unchanged-pass early exit finds every key equal and returns the
 * previous pages BY IDENTITY, furniture included.
 *
 * Measured before this existed: a body edit that also changed the numbering left six reused
 * pages showing the old header marker and the one rebuilt page showing the new one — two
 * different numbers for the same header in one section.
 *
 * Walks with {@link forEachStoryParagraphFragment}, which descends into each anchored
 * drawing's text-box story exactly like {@link storyDrawingResourceToken}'s walk does: a
 * `w:numPr` paragraph inside a `wps:txbx` carries a marker record too, and a `numbering.xml`
 * edit moves neither `contentKey` nor `flowHeight`, so without the descent a reused page
 * kept showing the old number inside the box.
 */
export function storyListMarkerToken(story: HeaderFooterStoryLayout): string {
  const cached = storyListMarkerTokens.get(story);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  forEachStoryParagraphFragment(story, (fragment) => {
    const marker = fragment.marker;
    if (marker) {
      // Length-framed at both levels: `marker.text` is expanded `w:lvlText` and `numFmt`
      // is read verbatim from the file, so any separator the content can contain lets two
      // different marker states concatenate to one token and reuse a header page showing
      // the old numbers.
      tokens.push(
        framedTokenJoin([fragment.paragraphId, marker.text, marker.numFmt, String(marker.level)])
      );
    }
  });
  const token = tokens.length === 0 ? '' : `|list:${framedTokenJoin(tokens)}`;
  storyListMarkerTokens.set(story, token);
  return token;
}

/**
 * Memoized per story object: a story layout is immutable, and `hfStoryMemo` keeps the
 * object identity stable across passes, so the walk would otherwise repeat per section per
 * layout pass on the keystroke path.
 */
const storyDrawingResourceTokens = new WeakMap<HeaderFooterStoryLayout, string>();

/**
 * Resource identity of every image a header/footer story paints.
 *
 * Part of the session context, because the rest of what identifies a story — `contentKey`
 * and `flowHeight` — describes the AUTHORED part, and neither moves when an image finishes
 * decoding: the extent is authored, so the story is exactly as tall with a pending picture
 * as with a ready one. Without this the unchanged-pass early exit finds every key equal and
 * returns the previous pages BY IDENTITY, furniture included, so a header or footer image
 * stays a "loading" placeholder for the rest of the session — nothing will invalidate it
 * again. Body drawings have no such gap; they ride the per-paragraph flow keys.
 *
 * Walks with {@link forEachStoryDrawing}, which descends into each anchored drawing's
 * text-box story: a picture inside a `wps:txbx` in a header settles on the same
 * asynchronous clock as a direct one, so its resource has to move this token too.
 *
 * CLIPPED drawings ride along (#467). This token is computed from the BASELINE story, and
 * `layoutTextboxStory` drops fragments below the box's content height — while a
 * `withPageContext` projection of the same story can wrap differently (PAGE digits) and
 * paint a drawing the baseline clipped out. Painted plus clipped is the story's full source
 * set, a superset of what any projection paints, so a settle always moves this token no
 * matter which projection shows the picture.
 */
export function storyDrawingResourceToken(story: HeaderFooterStoryLayout): string {
  const cached = storyDrawingResourceTokens.get(story);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  forEachStoryDrawing(story, (drawing) => {
    tokens.push(drawingResourceLayoutToken(drawing.resource));
    for (const owned of ownedTextboxStories(drawing)) {
      const clipped = owned.story.clippedResourceToken;
      if (clipped) tokens.push(`clip:${clipped}`);
    }
  });
  // Empty for the overwhelmingly common story with no pictures, so the context string for a
  // plain header is byte-for-byte what it was. Length-framed: resource keys embed
  // relationship ids and part names read verbatim from the file, and the clip token is
  // itself a framed list, so no separator — printable or NUL — stays unforgeable.
  const token = tokens.length === 0 ? '' : `!${framedTokenJoin(tokens)}`;
  storyDrawingResourceTokens.set(story, token);
  return token;
}

/**
 * One framed furniture story entry — shared by `furnitureLayoutContext` here and the
 * multi-section `furnitureStoryEntries` fingerprint, so a rider token added to one reuse
 * key can never be forgotten by the other. `contentKey` describes the AUTHORED part, so the
 * drawing-resource and list-marker tokens ride along for everything a story resolves from
 * ANOTHER part; without them a reused section keeps a stale header.
 */
export function framedStoryEntry(label: string, story: HeaderFooterStoryLayout): string {
  return framedTokenJoin([
    label,
    String(story.flowHeight),
    // Published pages carry the story's relationship id, so a rewrite that only renames it
    // must not hand back pages showing the old one.
    story.rId ?? '',
    story.contentKey,
    story.projectionEpoch ?? '',
    storyDrawingResourceToken(story),
    storyListMarkerToken(story),
  ]);
}

/**
 * The furniture slice of a section's layout-session context: distances and flags, then each
 * variant's flow height, content key and drawing-resource token — everything a header or
 * footer edit can move that the body flow would not otherwise notice.
 */
export function furnitureLayoutContext(
  furniture:
    | {
        readonly titlePage?: boolean;
        readonly evenAndOddHeaders?: boolean;
        readonly headers: ReadonlyMap<string, HeaderFooterStoryLayout>;
        readonly footers: ReadonlyMap<string, HeaderFooterStoryLayout>;
      }
    | undefined,
  headerDistance: number,
  footerDistance: number
): string {
  if (!furniture) return '';
  // Length-framed fields, entries, and sections: the marker token embeds expanded
  // `w:lvlText` and the resource token embeds relationship-derived identity, so any
  // separator boundary the content can reproduce would let one variant's file-controlled
  // text forge another variant's entry and reuse pages showing the stale variant.
  const stories = (prefix: string, source: ReadonlyMap<string, HeaderFooterStoryLayout>) =>
    framedTokenJoin(
      [...source].map(([variant, story]) => framedStoryEntry(`${prefix}${variant}`, story)).sort()
    );
  return (
    `|hf:${headerDistance},${footerDistance},${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
    framedTokenJoin([
      stories('h', furniture.headers),
      stories('f', furniture.footers),
      characterHeaderPageToken(furniture),
    ])
  );
}
