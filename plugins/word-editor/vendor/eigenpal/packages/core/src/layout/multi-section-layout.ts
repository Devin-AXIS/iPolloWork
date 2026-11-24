import { sectionProgress } from './section-progress.ts';
import { characterHeaderPageToken } from './character-header-pages.ts';
// Per-section incremental layout for multi-section documents.
//
// A single LayoutSession cannot resume across section boundaries: each section has its own
// geometry and furniture, so a checkpoint from another geometry is not sound. Instead the
// orchestrator keeps one child session per section, keyed by section structure (bounds,
// geometry, break type, furniture), and reuses remapped page records by identity when the
// section-local layout and the stacked sheet offset both hold. Document-level PAGE/NUMPAGES
// finalize still runs once the total page count is known; when that count is unchanged,
// finalized page identities from the previous pass are restored for untouched sheets.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import { recordMovedSeedReserves } from './note-reserves.ts';
import { sectionReadCollector } from './note-reserve-resume.ts';
import {
  rememberSectionRound,
  replayedSectionRound,
  sectionRoundInputs,
} from './note-round-section-replay.ts';
import { pageRefAssignmentToken } from './field-page-furniture.ts';
import { currentFinal } from './published-story-projections.ts';
import { framedTokenJoin } from './layout-cache.ts';
import { drainLayoutSteps, type LayoutSteps } from './layout-steps.ts';
import type { ContinuedPageHost } from './continued-page-zones.ts';
import { framedStoryEntry, remapPage, type HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  createLayoutSession,
  replaceLayoutSession,
  type LayoutSession,
  type MultiSectionLayoutState,
  type SectionStackSpan,
} from './layout-session.ts';
import {
  DEFAULT_SECTION_PROPERTIES,
  geometryOfSection,
  type DocumentSection,
  sectionLineGridPt,
  type SectionColumns,
} from './section-properties.ts';
import { pageBordersFingerprint } from './page-borders.ts';
import { sectionMarksJoiningBreakSheet } from './section-mark-break.ts';
import type { LayoutBox, PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { PageFurniture, SemanticLayoutOptions } from './semantic-layout.ts';
import {
  registerOverflowPageShell,
  type OverflowPageShell,
  type PageContentInsets,
} from './page-furniture-insets.ts';
import { SHEET_GUTTER_PT } from './section-page-furniture.ts';
import {
  paritySheetAt,
  registerParityPlan,
  sectionNeedsParitySheet,
  type SectionSheetStart,
} from './page-parity-sheet.ts';

type MultiSectionLayoutFieldRole = 'constructed' | 'post-processed';

// A multi-section pass is a true layout constructor. Every new top-level field must be assigned
// here or explicitly delegated to the common post-processors run by semantic-layout.ts.
const MULTI_SECTION_LAYOUT_FIELD_ROLES = {
  revision: 'constructed',
  pages: 'constructed',
  displayMode: 'post-processed',
  reviewArtifacts: 'post-processed',
  contentControls: 'post-processed',
  controlContextToken: 'post-processed',
  sectionBreaks: 'post-processed',
} as const satisfies Record<keyof SemanticLayout, MultiSectionLayoutFieldRole>;

void MULTI_SECTION_LAYOUT_FIELD_ROLES;

export interface SectionLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the last page's content column, for a section continuing onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /** Whether the last page is still open, or was closed by a trailing page break. */
  readonly endsOpenPage: boolean;
  /** The shell a sheet minted at a DOCUMENT index resolves to under this section's variants. */
  readonly overflowShellAt: (
    documentPageIndex: number,
    box: LayoutBox,
    pageNumberShift?: number
  ) => OverflowPageShell;
}

/** {@link LayoutSectionFn} as steps that may pause between pages. */
export type LayoutSectionStepsFn = (
  ...args: Parameters<LayoutSectionFn>
) => LayoutSteps<SectionLayoutResult>;

export type LayoutSectionFn = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: SemanticLayoutOptions & {
    readonly geometry: PageGeometry;
    readonly sectionColumns?: SectionColumns;
    readonly paragraphLineUnitPt?: number;
    readonly lineCounterStart?: number;
    readonly flowStartY?: number;
    readonly spaceBeforeCarry?: number;
    readonly pageIndexStart?: number;
    readonly furniturePageNumberStart?: number;
    readonly balanceColumns?: boolean;
    readonly sectionMarkCollapses?: boolean;
    readonly markJoinsBreakSheet?: boolean;
    readonly continuedPageInsets?: PageContentInsets;
    readonly continuedPageFurniture?: ContinuedPageHost;
    readonly bodyPageNumberFormat?: string;
  }
) => SectionLayoutResult;

function furnitureStoryEntries(
  stories: ReadonlyMap<string, HeaderFooterStoryLayout>,
  includeContent: boolean,
  prefix: string
): string {
  // Length-framed like `furnitureLayoutContext`, with the header/footer role INSIDE the
  // framed label: the marker and resource tokens embed file-controlled text, so a
  // printable entry join or a printable section marker is a forgeable boundary.
  return framedTokenJoin(
    [...stories]
      .map(([variant, story]) =>
        includeContent
          ? framedStoryEntry(`${prefix}${variant}`, story)
          : `${prefix}${variant}=${story.flowHeight}`
      )
      .sort()
  );
}

/**
 * Furniture identity that changes the section content area (flags + flow heights only).
 *
 * Used by the multi-section structure key so a content-only A→B edit at equal height does
 * not reset every child session — story content invalidates through per-section layout
 * context instead ({@link furnitureFingerprint} / semantic-layout furniture context).
 */
function furnitureGeometryFingerprint(furniture: PageFurniture | undefined): string {
  if (!furniture) return '';
  return `hf:${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};h:${furnitureStoryEntries(furniture.headers, false, 'h')};f:${furnitureStoryEntries(furniture.footers, false, 'f')};cs:${characterHeaderPageToken(furniture)}`;
}

/**
 * Full furniture cache identity: geometry flags/heights plus bounded story content keys.
 *
 * Equal-height header/footer text changes must not collide with prior furniture.
 */
export function furnitureFingerprint(furniture: PageFurniture | undefined): string {
  if (!furniture) return '';
  return `hf:${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};h:${furnitureStoryEntries(furniture.headers, true, 'h')};f:${furnitureStoryEntries(furniture.footers, true, 'f')};cs:${characterHeaderPageToken(furniture)}`;
}

export function furnitureForSection(
  options: SemanticLayoutOptions,
  sectionIndex: number,
  sectionCount: number
): PageFurniture | undefined {
  if (options.sectionFurniture) return options.sectionFurniture[sectionIndex];
  if (sectionIndex === sectionCount - 1) return options.furniture;
  return undefined;
}

/**
 * Stable key for section page geometry + furniture geometry (not story text).
 *
 * Deliberately EXCLUDES each section's block bounds: a split or join anywhere shifts the
 * absolute block indices of every section after it while changing none of them, and keying
 * on the bounds reset every child session — one Enter in a 100-section document re-laid all
 * 100 sections. Content changes are what the child sessions' own per-block keys detect;
 * this key only answers whether section COUNT, geometry, furniture, numbering and columns
 * still line up positionally.
 */
export function multiSectionStructureKey(
  sections: readonly DocumentSection[],
  options: SemanticLayoutOptions
): string {
  return framedTokenJoin(multiSectionKeys(sections, options));
}

/** Each section's part of {@link multiSectionStructureKey}, in section order. */
function multiSectionKeys(
  sections: readonly DocumentSection[],
  options: SemanticLayoutOptions
): string[] {
  return sections.map((section, index) => {
    const geometry = geometryOfSection(section.properties);
    const furniture = furnitureForSection(options, index, sections.length);
    const pn = section.properties.pageNumbering;
    // A bare `<w:pgNumType/>` keys its empty attributes while an ABSENT element keys
    // `pn:` — a conservative split (extra rebuild, never a stale reuse); attribute edits
    // must bust incremental reuse so PAGE start/fmt / SECTIONPAGES stay correct.
    // Length-framed: `w:fmt` and the chapter fields are free file text, so a printable
    // separator would let two different section lists alias one structure key.
    const pnKey = pn
      ? `pn:${framedTokenJoin([pn.start ?? '', pn.fmt ?? '', pn.chapStyle ?? '', pn.chapSep ?? ''].map(String))}`
      : 'pn:';
    const columns = section.properties.columns;
    // The frame is not in `geometry`, and no per-block key moves when it changes, so without
    // this a `w:pgBorders` edit reuses every section's previous sheets with the old frame.
    const bordersKey = `pgb:${pageBordersFingerprint(section.properties.pageBorders)}`;
    const columnsKey = `cols:${columns.count},${columns.gapTwips},${columns.equalWidth === false ? 0 : 1},${columns.separator ? 1 : 0};${(columns.definitions ?? []).map((column) => `${column.widthTwips}/${column.gapTwips}`).join(',')}`;
    return framedTokenJoin(
      [
        section.properties.breakType,
        geometry.width,
        geometry.height,
        geometry.margin.top,
        geometry.margin.right,
        geometry.margin.bottom,
        geometry.margin.left,
        geometry.headerDistance ?? 36,
        geometry.footerDistance ?? 36,
        furnitureGeometryFingerprint(furniture),
        pnKey,
        columnsKey,
        bordersKey,
      ].map(String)
    );
  });
}

function ensureMultiState(
  session: LayoutSession | undefined,
  sectionKeys: readonly string[]
): MultiSectionLayoutState | null {
  if (!session) return null;
  const structureKey = framedTokenJoin(sectionKeys);
  const existing = session.multi;
  if (
    existing &&
    existing.structureKey === structureKey &&
    existing.sections.length === sectionKeys.length
  ) {
    return existing;
  }
  const fresh: MultiSectionLayoutState = {
    structureKey,
    sectionKeys,
    sections: sectionKeys.map((key, index) => carriedSectionSession(session, existing, key, index)),
    spans: [],
    previousRemapped: [],
    previousFinalized: null,
    previousPageCount: -1,
    previousPageRefToken: '',
  };
  session.multi = fresh;
  return fresh;
}

/**
 * The child session section `index` starts from when the section list changes.
 *
 * A sliced open reveals sections one slice at a time, and an edit can add or remove one: in
 * both cases the sections before the change keep their geometry, so their previous sessions
 * still answer. A section whose own key moved starts fresh. Before the first multi-section
 * pass, section 0 adopts the single-section session it was laid out with. Every reused
 * session is still checked by its own per-block keys and context, so a stale one only misses.
 */
function carriedSectionSession(
  session: LayoutSession,
  existing: MultiSectionLayoutState | null,
  key: string,
  index: number
): LayoutSession {
  if (existing) {
    const previous = existing.sections[index];
    return previous && existing.sectionKeys[index] === key ? previous : createLayoutSession();
  }
  const fresh = createLayoutSession();
  if (index === 0 && session.prepass !== null) {
    replaceLayoutSession(fresh, session);
    fresh.multi = null;
  }
  return fresh;
}

/**
 * Whether an empty section still needs its own sheet.
 *
 * Default/`nextPage`/`evenPage`/`oddPage` start on a new page even with no body blocks: that
 * sheet carries the section's geometry and furniture, after any parity sheet in front of it.
 * `continuous` shares the previous sheet, so an empty continuous section must not manufacture
 * a page.
 */
export function emptySectionNeedsBlankPage(
  breakType: DocumentSection['properties']['breakType']
): boolean {
  return breakType !== 'continuous';
}

/**
 * Whether two sections could occupy one sheet: identical page box (size / orientation).
 *
 * A sheet has ONE size. Word honours `continuous` by continuing the column on the current
 * page; a continuous break that also changes paper size or orientation starts a new page.
 * Mid-page margin / header-distance changes stay on the sheet — Word applies the new
 * content column below the resumed cursor, and the host sheet keeps its furniture.
 */
function samePageSize(a: PageGeometry, b: PageGeometry): boolean {
  return a.width === b.width && a.height === b.height;
}

/** One sheet's content box, as the insets a section pass flows against. */
function contentInsetsOf(page: PageRecord): PageContentInsets {
  const top = page.contentBox.y - page.box.y;
  return {
    top,
    bottom: page.box.height - top - page.contentBox.height,
    height: page.contentBox.height,
  };
}

/**
 * Append a continued section's first-page fragments to the sheet it continues.
 *
 * The fragments already carry content-relative offsets past the host page's used height
 * (the section was laid out with `flowStartY` and, since per-page insets, the host's own
 * content box through {@link contentInsetsOf}), so this is a concatenation, not a shift.
 * The host page keeps its own furniture: the header/footer belong to the sheet, and the
 * continued section contributes content to it, not chrome.
 */
function withAppendedFragments(page: PageRecord, continued: PageRecord): PageRecord {
  if (
    continued.fragments.length === 0 &&
    !continued.columnSeparators?.length &&
    !continued.anchoredDrawings?.length
  ) {
    return page;
  }
  const anchoredDrawings =
    page.anchoredDrawings || continued.anchoredDrawings
      ? Object.freeze([...(page.anchoredDrawings ?? []), ...(continued.anchoredDrawings ?? [])])
      : undefined;
  return {
    ...page,
    fragments:
      continued.fragments.length > 0 ? [...page.fragments, ...continued.fragments] : page.fragments,
    ...((page.columnSeparators?.length || continued.columnSeparators?.length) && {
      columnSeparators: [...(page.columnSeparators ?? []), ...(continued.columnSeparators ?? [])],
    }),
    ...(anchoredDrawings ? { anchoredDrawings } : {}),
  };
}

/**
 * Publish a multi-section result onto the parent session, clearing the SINGLE-section
 * resume state it does not own.
 *
 * `previous` is shared by both paths, but `keys` / `checkpoints` / `context` describe one
 * flow over the whole body — meaningless once the document is sectioned. Leaving them
 * behind let a document go single -> multi -> single and match the ORIGINAL single-section
 * context on the way back, so the "nothing changed" early exit returned the multi-section
 * pages: undoing a section break repainted the pre-undo pagination.
 */
function adoptMultiSectionResult(
  session: LayoutSession,
  finalized: SemanticLayout,
  lineCounter: number
): void {
  session.previous = finalized;
  session.startLineCounter = 0;
  session.endLineCounter = lineCounter;
  session.keys = [];
  session.checkpoints = [];
  session.context = '';
  session.producer = '';
}

/**
 * The published (remapped + PAGE-field-stamped) sheet a section-local page last produced.
 *
 * A rebuilt section remaps EVERY page it laid, including the ones its own incremental pass
 * carried over by reference — and `remapPage` mints fresh box and furniture wrappers even
 * when nothing moved. Paint skips a page only by record identity, so a one-character edit
 * repainted every sheet of its section. Keyed on the section-local record: an edit replaces
 * it, and any changed publish parameter misses, so the memo can only return a twin the same
 * inputs would rebuild.
 */
interface PublishedPageMemo {
  readonly globalIndex: number;
  readonly sheetY: number;
  readonly pageNumber: number;
  readonly sectionPageCount: number;
  readonly format: string | undefined;
  readonly published: PageRecord;
}
// A few per page: a footnote reserve search can publish a page at alternating places in its
// rounds, and one entry made each round remap the page again.
const publishedPageMemos = new WeakMap<PageRecord, PublishedPageMemo[]>();
const PUBLISHED_PER_PAGE = 3;

function publishSectionPage(
  page: PageRecord,
  globalIndex: number,
  sheetY: number,
  pageNumber: number,
  sectionPageCount: number,
  format: string | undefined
): PageRecord {
  const memos = publishedPageMemos.get(page);
  const memo = memos?.find(
    (entry) =>
      entry.globalIndex === globalIndex &&
      entry.sheetY === sheetY &&
      entry.pageNumber === pageNumber &&
      entry.sectionPageCount === sectionPageCount &&
      entry.format === format
  );
  if (memo) return memo.published;
  const remapped = remapPage(page, globalIndex, sheetY);
  const published = withPageFieldSources([remapped], pageNumber, sectionPageCount, format)[0]!;
  const entry = { globalIndex, sheetY, pageNumber, sectionPageCount, format, published };
  if (!memos) publishedPageMemos.set(page, [entry]);
  else {
    if (memos.length >= PUBLISHED_PER_PAGE) memos.shift();
    memos.push(entry);
  }
  return published;
}

/**
 * Lay a multi-section part out section by section, with per-section incremental sessions.
 *
 * `w:type` on a section (default `nextPage`) controls whether that section starts on a new
 * sheet relative to the previous one. Continuous sections keep flowing on the current sheet
 * only when the previous section left no open page — after a normal flush they still start
 * cleanly. A section that needs a page parity gets one blank sheet in front of it first
 * (`page-parity-sheet.ts`).
 *
 * An empty final section is still laid out when its break type requires a new sheet: that
 * materializes the blank page Word keeps for the section's geometry and furniture.
 */
export function layoutMultiSectionDocument(
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  revision: number,
  options: SemanticLayoutOptions,
  layoutSection: LayoutSectionFn
): SemanticLayout {
  return drainLayoutSteps(
    layoutMultiSectionDocumentSteps(
      blocks,
      sections,
      revision,
      options,
      function* (bodies, sectionRevision, sectionOptions) {
        return layoutSection(bodies, sectionRevision, sectionOptions);
      }
    )
  );
}

/** {@link layoutMultiSectionDocument} as steps that report the pages completed so far. */
export function* layoutMultiSectionDocumentSteps(
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  revision: number,
  options: SemanticLayoutOptions,
  layoutSectionSteps: LayoutSectionStepsFn
): LayoutSteps<SemanticLayout> {
  const { session, ...rest } = options;
  // A prefix pass of a sliced open, or a round of the footnote reserve walk: page fields
  // finalize again when the full pass runs.
  const provisional =
    options.bodyBlockLimit !== undefined || options.noteRoundBlockLimit !== undefined;
  const multi = ensureMultiState(session, multiSectionKeys(sections, options));
  // One retention pass over the UNION of every section's live keys. Retaining inside each
  // section's pass evicted every other section's entries — the multi-section break cache
  // was empty on every pass. The sweep runs on the retention stride; skipped passes hand
  // every section `false` so none of them retains alone.
  const retainKeys =
    rest.cache && rest.retainKeys !== false
      ? (rest.retainKeys ?? ((rest.cache.retentionPassDue?.() ?? true) ? new Set<string>() : false))
      : false;
  const retainOnce = (): void => {
    if (retainKeys && !rest.retainKeys) rest.cache?.retain(retainKeys);
  };

  // A notes pass seeds its first run with the reserves of the previous pass. When an edit
  // added or removed pages, every later section starts at another page index, and the seed
  // then gave each of those sections reserves at the wrong pages: they laid out again under
  // a new context, and again on every round of the reserve search. Each section reads its
  // own entries moved by how far its first page moved; with a section added or removed the
  // seed stays as it is.
  const seed =
    options.pageBottomReservesFromPreviousPass &&
    options.pageBottomReserves &&
    multi &&
    multi.spans.length > 0 &&
    multi.spans.length === sections.length
      ? options.pageBottomReserves
      : undefined;
  const movedSeed = seed ? new Map<number, number>() : undefined;
  /** What each seeded section read, where it differs from what it was given. */
  const sectionReads = sectionReadCollector();
  const pages: PageRecord[] = [];
  const remappedAll: PageRecord[] = [];
  const newSpans: SectionStackSpan[] = [];
  let sheetY = 0;
  let lineCounter = 0;
  let placed = 0;
  let total = 0;
  let reusedPages = 0;
  // The open column at the end of the last section, for a `continuous` section to resume.
  let flowCursorY = 0;
  let flowSpaceAfter = 0;
  let flowOpenPage = true;
  /** Each section's shell resolver, for a sheet minted after layout. */
  const sectionShells: {
    readonly startIndex: number;
    readonly at: (index: number, box: LayoutBox, pageNumberShift?: number) => OverflowPageShell;
  }[] = [];
  let previousGeometry: PageGeometry | null = null;
  /**
   * The running displayed number: the PAGE value the next new sheet gets when its section
   * does not author `w:start`. A continuous section shares its host sheet, so this can move
   * past the host's own stamped number (a restart that ends on the shared sheet). The parity
   * rules for unrestarted breaks and the notes pass read this value, never a stamp.
   */
  let nextDisplayed = 1;
  // Shared-sheet restarts change displayed numbers, but not the sheet sequence.
  let nextParity = 1;
  /** Each section's first own sheet, for the notes pass to decide parity again. */
  const sheetStarts: SectionSheetStart[] = [];
  /** The running number after a sheet, where it is not that sheet's stamped number + 1. */
  const runningAfter = new Map<number, number>();
  // A settings.xml flag. Without the document value, every section's furniture carries it.
  const evenAndOddHeaders =
    options.evenAndOddHeaders ??
    sections.some(
      (_, index) => furnitureForSection(options, index, sections.length)?.evenAndOddHeaders === true
    );

  const geometries = sections.map((section) => geometryOfSection(section.properties));
  const marksJoinBreakSheet = sectionMarksJoiningBreakSheet(
    sections,
    blocks,
    (index) =>
      sections[index]!.properties.breakType === 'continuous' &&
      samePageSize(geometries[index - 1]!, geometries[index]!)
  );

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const slice = blocks.slice(section.blockStart, section.blockEndExclusive);
    const geometry = geometries[sectionIndex]!;
    const furniture = furnitureForSection(options, sectionIndex, sections.length);
    const prevSpan = multi?.spans[sectionIndex];

    const restart = section.properties.pageNumbering?.start;
    const runningBefore = nextDisplayed;
    const paritySheet = sectionNeedsParitySheet({
      breakType: section.properties.breakType,
      restart,
      nextDisplayed,
      nextParity,
      sheetIndex: pages.length,
      evenAndOddHeaders,
    })
      ? paritySheetAt(pages.length, sheetY, geometry, prevSpan?.paritySheet)
      : undefined;
    if (paritySheet) {
      pages.push(paritySheet);
      remappedAll.push(paritySheet);
      sheetY = paritySheet.box.y + paritySheet.box.height + SHEET_GUTTER_PT;
      // An unrestarted number counts the blank sheet, which is how it reaches the parity.
      if (restart === undefined) nextDisplayed += 1;
    }
    const startIndex = pages.length;
    const startSheetY = sheetY;

    // Empty continuous: share/continue — record a zero-page span so section indices stay
    // aligned for incremental reuse, and do not invent a blank sheet.
    if (slice.length === 0 && !emptySectionNeedsBlankPage(section.properties.breakType)) {
      newSpans.push({
        startIndex,
        pageCount: 0,
        sheetY: startSheetY,
        remappedPages: [],
        sourcePages: [],
      });
      continue;
    }

    // CONTINUOUS: `w:type` on THIS section's trailing `w:sectPr` says how the section starts
    // relative to the previous one (ECMA-376 §17.6.22 / ST_SectionMark). Absent type is
    // nextPage. When continuous, Word keeps the section on the page the last one ended,
    // resuming the column immediately below its final paragraph, when the sheet size is
    // unchanged. Header and footer furniture belongs to the host sheet: a different height or
    // `w:titlePg` does not start a new sheet. The host keeps its furniture and content box
    // (`continuedPageInsets`), and the section's own furniture starts on its next sheet.
    const continues =
      sectionIndex > 0 &&
      section.properties.breakType === 'continuous' &&
      pages.length > 0 &&
      // A trailing page break already ended the previous sheet. Word puts the continued
      // section after that break, not on top of the page it closed. A break that kept its
      // empty mark (`markJoinsBreakSheet`) leaves the sheet open for mark-only sections only.
      flowOpenPage &&
      previousGeometry !== null &&
      samePageSize(previousGeometry, geometry);

    // Empty nextPage/even/odd: lay out zero blocks so the section still flushes one blank
    // page under its own geometry and furniture (Word-compatible trailing section break).
    const sectionSession = multi?.sections[sectionIndex];

    // A multi-column section that ends in a continuous section break balances its columns
    // (ECMA-376 §17.6.4). The break that ENDS this section is the next section's `w:type`;
    // the document's last section has no such break, so it keeps the fill-first shape.
    const endsContinuous = sections[sectionIndex + 1]?.properties.breakType === 'continuous';
    const balanceColumns =
      section.properties.columns.count > 1 &&
      endsContinuous &&
      options.styleCascade?.noColumnBalance !== true;
    // A page break and the empty mark after it advance one sheet when a later section opens
    // the next sheet. Mark-only sections in between then continue on the break's sheet. A
    // balanced section is left as it was: the balance search needs one open page.
    const markJoinsBreakSheet = !balanceColumns && marksJoinBreakSheet[sectionIndex]!;

    // A continued section's local page 0 IS the host sheet, so it must flow against the box
    // that sheet already has. Its own variants describe a page it never opens: with `w:titlePg`
    // on both sections the host resolves `default` and this section would resolve `first`, and
    // the taller box packs content past the host's content bottom.
    const continuedPageInsets = continues ? contentInsetsOf(pages[pages.length - 1]!) : undefined;
    // For the same reason its text wraps around the drawings the host sheet paints, and around
    // the floating tables and wrapping pictures earlier sections left there
    // (`continued-page-zones.ts`). So the section starts below the host's last text line, not
    // below those floats.
    const continuedPageFurniture = continues ? pages[pages.length - 1] : undefined;

    // The section's own page-number format, for the body flow's page-field context. A
    // placeholder measures through the field's own switches, which render the same on every
    // section, so a continued section that merges onto its host sheet needs no special case.
    const measuredPageNumberFormat = section.properties.pageNumbering?.fmt;

    const sectionReserves =
      seed && movedSeed && prevSpan
        ? movedSectionSeed(
            seed,
            prevSpan,
            startIndex,
            continues ? startIndex - 1 : startIndex,
            movedSeed
          )
        : undefined;
    const progressStart = section.properties.pageNumbering?.start ?? nextDisplayed;
    // Only a round of the footnote search reads these. A closure here instead would make the
    // engine keep every value it names in a heap context on each section of every pass.
    const roundInputs = options.noteRoundContext
      ? sectionRoundInputs(options, retainKeys, continues, sectionSession, {
          blocks: slice,
          pageIndexStart: startIndex,
          entry: [
            multi?.sectionKeys[sectionIndex],
            furniture === undefined ? 'n' : furniture === options.furniture ? 'd' : 's',
            sectionLineGridPt(section.properties),
            lineCounter,
            flowSpaceAfter,
            nextDisplayed,
            balanceColumns,
            endsContinuous,
            markJoinsBreakSheet,
            provisional,
          ],
        })
      : undefined;
    const replayed = roundInputs && replayedSectionRound<SectionLayoutResult>(roundInputs);
    const laid: SectionLayoutResult =
      replayed ??
      (yield* sectionProgress(
        layoutSectionSteps(slice, revision, {
          ...rest,
          ...(sectionReserves ? { pageBottomReserves: sectionReserves } : {}),
          retainKeys,
          geometry,
          furniture,
          sectionColumns: section.properties.columns,
          paragraphLineUnitPt: sectionLineGridPt(section.properties),
          ...(section.properties.pageBorders
            ? { sectionPageBorders: section.properties.pageBorders }
            : {}),
          ...(balanceColumns ? { balanceColumns } : {}),
          // The empty paragraph that carries this section's mark takes no flow height when the
          // next section is continuous: the next section starts where the content ended.
          ...(endsContinuous ? { sectionMarkCollapses: true } : {}),
          ...(markJoinsBreakSheet ? { markJoinsBreakSheet } : {}),
          lineCounterStart: lineCounter,
          // A continued section's local page 0 IS the host sheet, so its document page index
          // is one behind the stack; every other section starts a fresh sheet at `startIndex`.
          pageIndexStart: continues ? startIndex - 1 : startIndex,
          furniturePageNumberStart:
            section.properties.pageNumbering?.start ?? nextDisplayed - (continues ? 1 : 0),
          // Paragraph spacing still collapses across a section boundary on a new sheet.
          // Carry only the after-spacing budget there, never the prior sheet's cursor.
          spaceBeforeCarry: flowSpaceAfter,
          ...(continues ? { flowStartY: flowCursorY } : {}),
          ...(continuedPageInsets ? { continuedPageInsets } : {}),
          ...(continuedPageFurniture ? { continuedPageFurniture } : {}),
          ...(measuredPageNumberFormat !== undefined
            ? { bodyPageNumberFormat: measuredPageNumberFormat }
            : {}),
          ...(sectionSession ? { session: sectionSession } : {}),
        }),
        continues ? null : [...pages],
        sheetY,
        progressStart,
        section.properties.pageNumbering?.fmt,
        revision
      ));
    if (roundInputs && !replayed) rememberSectionRound(roundInputs, laid);
    sectionShells.push({ startIndex, at: laid.overflowShellAt });
    sectionReads.take(sectionSession);
    lineCounter = laid.lineCounter;
    flowCursorY = laid.endCursorY;
    flowSpaceAfter = laid.endSpaceAfter;
    flowOpenPage = laid.endsOpenPage;
    previousGeometry = geometry;

    if (sectionSession) {
      placed += sectionSession.stats.placed;
      total += sectionSession.stats.total;
    } else {
      placed += slice.length;
      total += slice.length;
    }

    const localUnchanged =
      sectionSession !== undefined &&
      sectionSession.stats.placed === 0 &&
      sectionSession.stats.reusedPages === laid.pages.length &&
      prevSpan !== undefined &&
      prevSpan.pageCount === laid.pages.length &&
      // IDENTITY, not counts: the section may have laid out more than once inside this
      // document pass (a reserve re-run, a balancing probe), and the final run then reports
      // "nothing placed" against its own session even though an earlier run this pass
      // rebuilt the pages. Reusing the previous pass's sheets on stats alone republished a
      // resize's pre-edit geometry — the image repainted, the frame the span carried did not.
      prevSpan.sourcePages.length === laid.pages.length &&
      prevSpan.sourcePages.every((page, index) => page === laid.pages[index]);

    const stackUnchanged =
      prevSpan !== undefined &&
      prevSpan.startIndex === startIndex &&
      prevSpan.sheetY === startSheetY &&
      prevSpan.remappedPages.length === laid.pages.length;

    const numbering = section.properties.pageNumbering;
    const displayedStart = numbering?.start !== undefined ? numbering.start : nextDisplayed;
    const format = numbering?.fmt;

    // The stack checks prove the sheets did not MOVE; this proves their displayed numbering
    // did not either. `displayedStart` is inherited through every section before this one, so
    // a continuous section merging into its host (indices and counts unchanged here) can still
    // shift a later span's PAGE values. The published pages carry what they were stamped with,
    // so the first one answers for the whole span.
    const firstPrevious = prevSpan?.remappedPages[0];
    const numberingUnchanged =
      prevSpan === undefined ||
      prevSpan.remappedPages.length === 0 ||
      (firstPrevious?.pageFieldSource !== undefined &&
        firstPrevious.pageFieldSource.pageNumber === displayedStart &&
        firstPrevious.pageFieldSource.sectionPageCount === prevSpan.remappedPages.length &&
        firstPrevious.pageFieldSource.format === format);

    let remapped: readonly PageRecord[];
    if (continues) {
      // The section's first page is not a sheet: it is the tail of the one before it. Its
      // fragments join that sheet and the shell is dropped; anything that overflowed onto
      // a second page stacks normally from there. Identity reuse is skipped — the host
      // sheet is rebuilt this pass, so no prior page record describes it.
      const hostIndex = pages.length - 1;
      const host = pages[hostIndex]!;
      const merged = withAppendedFragments(host, laid.pages[0]!);
      if (merged !== host) {
        pages[hostIndex] = merged;
        const remappedIndex = remappedAll.lastIndexOf(host);
        if (remappedIndex !== -1) remappedAll[remappedIndex] = merged;
      }
      // The host section's span deliberately keeps the PRE-MERGE page. It records what
      // that section alone produced, and a later pass republishes it verbatim through the
      // identity-reuse path — so writing the merged page back there would re-append this
      // section's fragments to a sheet that already carries them, once per pass, forever.
      const built: PageRecord[] = [];
      for (const page of laid.pages.slice(1)) {
        const next = remapPage(page, pages.length + built.length, sheetY);
        built.push(next);
        sheetY = next.box.y + next.box.height + SHEET_GUTTER_PT;
      }
      // Local page 0 lived on the host. Its running number is the restart, or the running
      // number of the host sheet, which is one before the next new sheet's. The host's stamp
      // is not used: an earlier restarted continuous section can have moved the running
      // number past it. Overflow pages count on from the host's running number.
      // SECTIONPAGES counts the host contribution plus overflow sheets.
      const hostNumber = numbering?.start ?? nextDisplayed - 1;
      const sectionPageCount = built.length + 1;
      remapped = withPageFieldSources(built, hostNumber + 1, sectionPageCount, format);
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
      }
      nextDisplayed = hostNumber + sectionPageCount;
    } else if (localUnchanged && stackUnchanged && numberingUnchanged) {
      remapped = prevSpan.remappedPages;
      reusedPages += remapped.length;
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
        sheetY = page.box.y + page.box.height + SHEET_GUTTER_PT;
      }
      nextDisplayed = displayedStart + remapped.length;
    } else {
      const built: PageRecord[] = [];
      for (const page of laid.pages) {
        const next = publishSectionPage(
          page,
          pages.length + built.length,
          sheetY,
          displayedStart + built.length,
          laid.pages.length,
          format
        );
        built.push(next);
        sheetY = next.box.y + next.box.height + SHEET_GUTTER_PT;
      }
      remapped = built;
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
      }
      nextDisplayed = displayedStart + remapped.length;
    }

    nextParity =
      !continues && restart !== undefined
        ? nextDisplayed
        : nextParity + remapped.length + (paritySheet ? 1 : 0);

    newSpans.push({
      startIndex,
      pageCount: remapped.length,
      sheetY: startSheetY,
      remappedPages: remapped,
      sourcePages: laid.pages,
      ...(paritySheet ? { paritySheet } : {}),
    });
    if (remapped.length > 0) {
      sheetStarts.push({
        pageIndex: startIndex,
        breakType: section.properties.breakType,
        restart,
        runningBefore,
        continuesPreviousSheet: continues,
        geometry,
      });
    }
    const lastStamp = pages[pages.length - 1]?.pageFieldSource?.pageNumber;
    if (lastStamp !== undefined && lastStamp + 1 !== nextDisplayed) {
      runningAfter.set(pages.length - 1, nextDisplayed);
    } else {
      runningAfter.delete(pages.length - 1);
    }
  }

  if (pages.length === 0) {
    const geometry = geometryOfSection(sections[0]?.properties ?? DEFAULT_SECTION_PROPERTIES);
    const laid: SectionLayoutResult = yield* layoutSectionSteps([], revision, {
      ...rest,
      retainKeys,
      geometry,
      paragraphLineUnitPt: sectionLineGridPt(sections[0]?.properties),
      sectionColumns: sections[0]?.properties.columns ?? DEFAULT_SECTION_PROPERTIES.columns,
      ...(sections[0]?.properties.pageBorders
        ? { sectionPageBorders: sections[0].properties.pageBorders }
        : {}),
    });
    retainOnce();
    const finalized = finalizePageFieldProjection({ revision, pages: laid.pages }, { provisional });
    registerOverflowPageShell(finalized, (_sectionAnchorIndex, documentPageIndex, box, shift) =>
      laid.overflowShellAt(documentPageIndex, box, shift)
    );
    if (multi) {
      multi.spans = [];
      multi.previousRemapped = laid.pages;
      multi.previousFinalized = finalized;
      multi.previousPageCount = finalized.pages.length;
      multi.previousPageRefToken = pageRefAssignmentToken(laid.pages);
    }
    if (session) {
      adoptMultiSectionResult(session, finalized, lineCounter);
      session.stats = {
        placed: 0,
        total: 0,
        reusedPages: 0,
        fullPasses: session.stats.fullPasses + 1,
      };
    }
    return finalized;
  }

  const freshlyFinalized = finalizePageFieldProjection({ revision, pages }, { provisional });
  let finalized = freshlyFinalized;
  const pageRefToken = pageRefAssignmentToken(pages);

  // Restore prior finalized page identities when the remapped source and total count hold —
  // and the PAGEREF assignments too: a target that changed sheets leaves the TOC page's raw
  // record identity-unchanged, so without the token the restore hands back its stale numbers.
  if (
    multi?.previousFinalized &&
    multi.previousPageCount === freshlyFinalized.pages.length &&
    multi.previousRemapped.length === remappedAll.length &&
    multi.previousPageRefToken === pageRefToken
  ) {
    const prevFinal = multi.previousFinalized.pages;
    const prevRemapped = multi.previousRemapped;
    const merged = freshlyFinalized.pages.map((page, index) =>
      remappedAll[index] === prevRemapped[index] ? (currentFinal(prevFinal, index) ?? page) : page
    );
    finalized = { ...freshlyFinalized, pages: merged };
  }

  if (multi) {
    multi.spans = newSpans;
    multi.previousRemapped = remappedAll;
    multi.previousFinalized = finalized;
    // A provisional page may still show an earlier page count; never restore it as final.
    multi.previousPageCount = provisional ? -1 : finalized.pages.length;
    multi.previousPageRefToken = pageRefToken;
  }

  if (session) {
    adoptMultiSectionResult(session, finalized, lineCounter);
    session.stats = {
      placed,
      total: total || 1,
      reusedPages,
      fullPasses: session.stats.fullPasses + (placed === total && reusedPages === 0 ? 1 : 0),
    };
  }

  // Dispatch on the ANCHOR, never on where the sheet lands. A sectEnd overflow sheet is
  // inserted at the first page of the NEXT section, so the landing index selects the section
  // after the one the sheet belongs to — which would pair the previous section's sheet box
  // with the next section's content box. The anchor is a page of the owning section, and the
  // offset walks that section's own resolver past its last page.
  registerOverflowPageShell(finalized, (sectionAnchorIndex, documentPageIndex, box, shift) => {
    let chosen = sectionShells[0];
    for (const span of sectionShells) {
      if (span.startIndex <= sectionAnchorIndex) chosen = span;
    }
    const owner = chosen ?? sectionShells[sectionShells.length - 1];
    return owner?.at(documentPageIndex, box, shift);
  });
  registerParityPlan(finalized, evenAndOddHeaders, sheetStarts, runningAfter);
  if (movedSeed && session) recordMovedSeedReserves(session, movedSeed);
  sectionReads.report(session, movedSeed ?? options.pageBottomReserves);

  retainOnce();
  return finalized;
}

/**
 * One section's seed entries: the reserves of the pages it had in the previous pass, moved to
 * where its pages start now. Also adds them to `moved`, the map the whole pass used.
 */
function movedSectionSeed(
  seed: ReadonlyMap<number, number>,
  previous: SectionStackSpan,
  startIndex: number,
  pageIndexStart: number,
  moved: Map<number, number>
): ReadonlyMap<number, number> {
  const shift = startIndex - previous.startIndex;
  const previousStart = pageIndexStart - shift;
  const previousEnd = previousStart + previous.sourcePages.length;
  const own = new Map<number, number>();
  for (const [pageIndex, height] of seed) {
    if (pageIndex < previousStart || pageIndex >= previousEnd) continue;
    own.set(pageIndex + shift, height);
    moved.set(pageIndex + shift, height);
  }
  return own;
}
