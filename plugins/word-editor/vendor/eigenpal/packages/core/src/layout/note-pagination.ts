/* eslint-disable max-lines -- note pagination seam: reservation, continuation, overflow pages */

// Footnote / endnote pagination: reservation, split/continuation, sect/doc end collection.
// Body flow places references; this module lays referenced notes at content width, reserves
// separator+note area (pageBottom / beneathText), bounds the reflow loop, and attaches
// layout-owned note records. Endnotes reserve nothing on reference pages — they collect at
// sectEnd / docEnd. Hostile counts and oscillation fail closed with named reasons.

import { noteStoryOptions } from './note-story-options.ts';
import {
  createNoteSeparatorCache,
  separatorLayoutOf,
  noteStoryCacheFor,
} from './note-pagination-cache.ts';
import {
  noteReferenceOpeningBottom,
  paragraphNoteSplitsAllowed,
  splitNotePageEndPt,
} from './note-reference-opening.ts';
import type { FootnoteAreaOptions, NoteSeparatorCache } from './note-footnote-area-options.ts';
import {
  footnoteContinuationNotice,
  hasContinuingNote,
  placeContinuationNotice,
} from './note-continuation-notice.ts';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { fragmentOwnsPosition, fragmentParagraphs } from './line-segments.ts';
import type { DocumentSection } from './section-properties.ts';
import { paragraphSectionIndexOf } from './note-paragraph-section-index.ts';
import {
  customMarkFollows,
  formatNoteScopeId,
  noteIdOf,
  noteReferenceKindOf,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  type FootnotePosition,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';
import { formatNumFmt } from './numbering-format.ts';
import {
  deriveNoteDisplayMarksResolved,
  noteDisplayMarkMap,
  type NoteReferenceSite,
} from './note-numbering.ts';
import {
  layoutNoteCached,
  noteSeparatorAreaBox,
  MAX_NOTES_LAID_OUT,
  type NoteStoryLayoutCache,
  type NoteLayoutFallbackReason,
  type NoteSeparatorLayout,
  type NoteStoryDrawings,
} from './note-layout.ts';
import { noteMarkKey, type NoteMarkContext } from './note-projection.ts';
import { noteBodyGeometryChanged } from './note-body-geometry.ts';
import {
  compactFootnoteReserves,
  takeMovedSeedReserves,
  notesReserveContextKey,
  MIN_FOOTNOTE_BODY_BAND_PT,
  noteColumnBudgetPt,
  recordFootnoteReserve,
  RESERVE_BOUNDARY_BACKOFF_PT,
} from './note-reserves.ts';
export { notesReserveContextKey };
import {
  bodyFitBottomPt,
  anyOrphanPairBand,
  bodyOnlyPage,
  firstBodyContentTopPt,
  fragmentFlowBottom,
  noteReferenceLineBandPt,
} from './note-fragment-geometry.ts';
import { splitNoteFragments } from './note-splitting.ts';
import { evictsReferenceLine } from './note-eviction-guard.ts';
import { continuedRowId } from './note-table-reference-band.ts';
import { holdOutReserveNeed } from './note-reserve-holdout.ts';
import { searchFootnoteReserves, type ReserveSearchState } from './note-reserve-search.ts';
export { noteRoundBlocks } from './note-reserve-search.ts';
import type { ReserveComputeRange, ReserveComputeResult } from './note-reserve-walk.ts';
import { takeReadReserves, withReadReserves } from './note-reserve-resume.ts';
import type { LayoutSession } from './layout-session.ts';
import { fingerprintNotesInput } from './note-input-fingerprint.ts';
import { reindexAndRestackPages } from './page-restacking.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  NoteAreaRecord,
  NoteStoryRecord,
  PageNoteStream,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { cascadeRunProperties, type StyleCascadeTable } from './style-cascade.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { finalizePageFieldProjection } from './field-projection.ts';
import type { LayoutSteps } from './layout-steps.ts';
import { withNoteAreasOnProgress, type NotesBodyOptions } from './note-progress.ts';
import { overflowRowNote, referenceRowOverflowsPage } from './note-overflow-row.ts';
import { overflowPageShellAt, type OverflowPageShell } from './page-furniture-insets.ts';
import { resettleParitySheets } from './page-parity-sheet.ts';
import {
  bodyPageNumbers,
  resettleBodyFurniture,
  resettleMintedSheets,
} from './note-sheet-resettle.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { collectBodyNoteReferences } from './note-reference-visibility.ts';
import {
  fingerprintHits,
  fingerprintHitsIdentity,
  pageRefsEqual,
  type PageRefHit,
} from './note-ref-hit.ts';
export type { PageRefHit } from './note-ref-hit.ts';

/**
 * Former bound on whole-document footnote reserve rounds. The reserve search decides one page
 * at a time and bounds each page instead, so it no longer reads this value.
 *
 * @deprecated The footnote reserve search has no whole-document round bound.
 */
export const MAX_NOTE_REFLOW_ATTEMPTS = 64;

/** Cap on total note story fragments attached across the document. */
export const MAX_NOTE_AREA_FRAGMENTS = 4_096;

/** Cap on empty pages created solely to drain footnote/endnote overflow. */
export const MAX_NOTE_OVERFLOW_PAGES = 256;

/** One document-wide allowance shared by every footnote/endnote overflow stream. */
interface NoteOverflowBudget {
  remaining: number;
}
/**
 * Cap on synthetic eachPage mark candidates measured per section (plus actual marks).
 *
 * eachPage sequences restart every page, so a page almost never carries more than a
 * handful of auto-numbered notes. Measuring `numStart .. numStart + N - 1` covers
 * single→double digit decimal growth and typical roman width peaks (e.g. `viii` vs `ix`)
 * without scanning hostile `numStart` ranges unboundedly. Derived marks already assigned
 * for the pass are always included in addition to this window.
 */
export const MAX_EACH_PAGE_MARK_CANDIDATES = 12;

/**
 * Why note PAGINATION fell back, widening {@link NoteLayoutFallbackReason} with the reasons that
 * only arise while distributing notes across pages.
 */
export type NotePaginationFallbackReason =
  | NoteLayoutFallbackReason
  | 'note-reflow-exhausted'
  | 'note-area-fragment-limit'
  | 'note-overflow-page-limit'
  /**
   * Overflow/drain iteration placed zero note stories while carry/pending remained —
   * abort rather than minting blank separator-only sheets up to the page budget.
   */
  | 'note-overflow-stalled'
  /** A single note line exceeds the full content column; content is not placed overflowing. */
  | 'note-line-exceeds-page';

/**
 * Everything note pagination needs: the note parts, and the per-section properties governing
 * them.
 *
 * Per-SECTION because numbering, restart rules and placement are all section properties — one
 * document can restart footnote numbering at every section and end notes at the document end.
 */
export interface NotesLayoutInput {
  readonly footnotesPart: OoxmlPart | null;
  readonly endnotesPart: OoxmlPart | null;
  /** Per-section resolved footnote properties (index-aligned with document sections). */
  readonly footnotePropsBySection: readonly ResolvedFootnoteProperties[];
  /** Per-section resolved endnote properties. */
  readonly endnotePropsBySection: readonly ResolvedEndnoteProperties[];
  /**
   * Properties of a section with none of its own: the defaults, plus the settings.xml endnote
   * position. The fallback when the document has no enumerated sections.
   */
  readonly documentFootnoteProps: ResolvedFootnoteProperties;
  readonly documentEndnoteProps: ResolvedEndnoteProperties;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  /** `numbering.xml`, so a `w:numPr` paragraph inside a note resolves a marker. */
  readonly numberingIndex?: import('./numbering-index.ts').NumberingIndex;
  /** Per-section active line-grid pitch in points; note lines snap to their section's grid. */
  readonly lineGridPitchBySection?: readonly (number | undefined)[];
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /**
   * Link projector seams, same as the body walk's. Normally injected by `semantic-layout`
   * from its own options, so a note's `w:hyperlink` / HYPERLINK field carries the same
   * sanitized record a body one does instead of painting dead text.
   */
  readonly projectLink?: import('./field-pieces.ts').HyperlinkProjector;
  /**
   * Per notes-part link projector, preferred over `projectLink`: a `w:hyperlink` inside
   * `/word/footnotes.xml` or `/word/endnotes.xml` declares its `r:id` in that part's own
   * `.rels`, not the body part's. The surface supplies this; the inherited body projector
   * remains only a fallback for callers without per-part resolution.
   */
  readonly projectLinkForPart?: (
    ownerPartName: string
  ) => import('./field-pieces.ts').HyperlinkProjector | undefined;
  /**
   * Content token over the notes parts' relationship records, standing in for
   * {@link projectLinkForPart}'s closure in the notes-pass memo. The projector reads
   * relationship state the pinned part identity cannot see move: a replicated rels-only
   * change lands without splicing the notes part, so only a content token catches it.
   * Required whenever `projectLinkForPart` is supplied — without it the memo is disabled,
   * the same fail-closed rule `drawingsForPart` follows through `drawingLayoutEpoch`.
   */
  readonly linkRelsEpoch?: string;
  /** Per-notes-part paragraph identity for projected links and metadata fields. */
  readonly projectionTokenForParagraphForPart?: (
    ownerPartName: string,
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
  /** Memoized table aggregate counterpart to `projectionTokenForParagraphForPart`. */
  readonly projectionTokenForTableForPart?: (
    ownerPartName: string,
    table: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
  /** Combined notes-part freshness signal; outer memo only, never a paragraph producer. */
  readonly projectionEpoch?: string;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  /** Document properties for a document-property field inside a note story. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /**
   * The document's resolved REF inputs, so a footnote's cross-reference paints the live
   * value the body paints. Normally injected by `semantic-layout` from the context it built
   * over the body and note stories; its values token joins the notes-pass fingerprint so a
   * renumbering edit repaints the notes that cite the renumbered target.
   */
  readonly refFields?: import('./field-ref.ts').RefFieldContext;
  /**
   * Inline drawing support per notes part. Absent means note paragraphs flow without
   * drawing records, which is what a headless caller with no image port wants.
   */
  readonly drawingsForPart?: (ownerPartName: string) => NoteStoryDrawings | undefined;
  /**
   * Part-level drawing epoch covering the notes parts, standing in for
   * {@link drawingsForPart}'s closure in the notes-pass memo (the closure is rebuilt per
   * pass, so only an epoch can say "the drawing state did not move"). A caller that
   * supplies `drawingsForPart` without this keeps the rebuild path.
   */
  readonly drawingLayoutEpoch?: string;
}

// ---------------------------------------------------------------------------------------
// Notes-pass memo (session-carried)
// ---------------------------------------------------------------------------------------

interface NotesPageAttachEntry {
  /** The page's own footnote refs at compute time (content-compared on reuse). */
  readonly pageRefs: readonly PageRefHit[];
  readonly marks: NoteMarkContext;
  readonly attached: PageRecord;
  readonly reserve: number;
  readonly reasons: readonly NotePaginationFallbackReason[];
}

/**
 * Incremental state for the notes pass, carried on the layout session's opaque `notes`
 * slot. Validity is layered: the memo object is replaced whenever the reference IDENTITY
 * fingerprint (which notes exist, where, in what order — but not their character offsets)
 * or the notes-input fingerprint moves, so the mark contexts read through a live memo are
 * current by construction. Offsets shift on every keystroke in a referencing paragraph
 * without changing any note, mark or story; per-page entries therefore revalidate against
 * the page's OWN reference list (offsets included) rather than the whole hit array — a
 * page whose refs moved re-laid its paragraph anyway, so its page identity is new too.
 */
interface NotesPassMemo {
  hitsFingerprint: string;
  /** {@link fingerprintHitsIdentity} of {@link allHits} — offsets excluded. */
  readonly identityFingerprint: string;
  readonly inputFingerprint: string;
  allHits: readonly PageRefHit[];
  readonly provisionalMarks: NoteMarkContext;
  finalMarks: { readonly sitesFingerprint: string; readonly marks: NoteMarkContext } | null;
  /**
   * The reserve walk of the pass that published the session's layout. A fresh memo inherits
   * it; the walk compares the inputs it was made under before it keeps any of it.
   */
  walk: ReserveSearchState | null;
  readonly pageAttach: WeakMap<PageRecord, NotesPageAttachEntry>;
  /**
   * PAGE-LOCAL reserve results only (area stack + eviction). The neighbour-reading
   * hold-out is deliberately not memoized here: an entry that must enumerate foreign
   * inputs (the next page's fragments, the reserve the page was laid under) by hand is
   * how stale reserves happen, and the hold-out is cheap to recompute.
   */
  readonly pageReserve: WeakMap<
    PageRecord,
    {
      /** The page's own footnote refs at compute time (content-compared on reuse). */
      readonly pageRefs: readonly PageRefHit[];
      readonly marks: NoteMarkContext;
      readonly allowOrphanDeferral: boolean;
      /** Whether the next page opens with a split row's rest ({@link continuedRowId}). */
      readonly nextOpening: string | null;
      /**
       * The next page's content box, which decides whether a reference line may move there.
       * A resumed body pass keeps this page while the next page's reserve, and so its box,
       * changed.
       */
      readonly nextBox: string;
      readonly reserve: number;
      /** The raw note-area height (hold-out's `existingAreaHeight` input). */
      readonly areaHeight: number;
      readonly reasons: readonly NotePaginationFallbackReason[];
    }
  >;
}

function contentBoxToken(page: PageRecord | undefined): string {
  return page ? `${page.contentBox.width}x${page.contentBox.height}` : '';
}

/** Identity fields the fingerprint cannot express; compared against the previous input. */
const notesInputIdentities = new WeakMap<
  NotesPassMemo,
  {
    readonly footnotesPart: OoxmlPart | null;
    readonly endnotesPart: OoxmlPart | null;
    readonly measurer: TextMeasurer;
    readonly cache: unknown;
    readonly styleCascade: unknown;
    readonly numberingIndex: unknown;
  }
>();

function notesMemoFor(
  session: { notes: unknown } | undefined,
  allHits: readonly PageRefHit[],
  input: NotesLayoutInput
): { memo: NotesPassMemo | null; allHits: readonly PageRefHit[]; reused: boolean } {
  if (!session) return { memo: null, allHits, reused: false };
  const inputFingerprint = fingerprintNotesInput(input);
  if (inputFingerprint === null) {
    session.notes = null;
    return { memo: null, allHits, reused: false };
  }
  const hitsFingerprint = fingerprintHits(allHits);
  let identityFingerprint: string | null = null;
  const existing = session.notes as NotesPassMemo | null;
  if (existing) {
    const identity = notesInputIdentities.get(existing);
    const inputUnchanged =
      existing.inputFingerprint === inputFingerprint &&
      identity !== undefined &&
      identity.footnotesPart === input.footnotesPart &&
      identity.endnotesPart === input.endnotesPart &&
      identity.measurer === input.measurer &&
      identity.cache === input.cache &&
      identity.styleCascade === input.styleCascade &&
      // By identity, like the cascade beside it. `numbering.xml` is a different part from the
      // notes part, so an edit to it moves nothing else this fingerprint compares.
      identity.numberingIndex === input.numberingIndex;
    if (inputUnchanged && existing.hitsFingerprint === hitsFingerprint) {
      return { memo: existing, allHits: existing.allHits, reused: true };
    }
    identityFingerprint = inputUnchanged ? fingerprintHitsIdentity(allHits) : null;
    if (identityFingerprint !== null && existing.identityFingerprint === identityFingerprint) {
      // Only offsets moved (typing in a referencing paragraph): the reference set, marks
      // and note stories are unchanged, so the memo — and every cache hanging off its
      // mark contexts — survives. The fresh hit array replaces the stale one; per-page
      // entries revalidate against each page's own refs, and any page whose refs moved
      // re-laid its paragraph and carries a new page identity anyway.
      existing.hitsFingerprint = hitsFingerprint;
      existing.allHits = allHits;
      return { memo: existing, allHits, reused: true };
    }
  }
  const fresh: NotesPassMemo = {
    hitsFingerprint,
    identityFingerprint: identityFingerprint ?? fingerprintHitsIdentity(allHits),
    inputFingerprint,
    allHits,
    provisionalMarks: provisionalNoteMarks(allHits, input),
    finalMarks: null,
    walk: existing?.walk ?? null,
    pageAttach: new WeakMap(),
    pageReserve: new WeakMap(),
  };
  notesInputIdentities.set(fresh, {
    footnotesPart: input.footnotesPart,
    endnotesPart: input.endnotesPart,
    measurer: input.measurer,
    cache: input.cache,
    styleCascade: input.styleCascade,
    numberingIndex: input.numberingIndex,
  });
  session.notes = fresh;
  return { memo: fresh, allHits, reused: false };
}

/**
 * The layout with notes attached, plus any fallbacks taken and the mark context used.
 *
 * The marks come back because they feed the body's incremental cache tokens: a note number that
 * changed must invalidate the paragraph that references it.
 */
export interface NotesAttachResult {
  readonly layout: SemanticLayout;
  readonly fallbackReasons: readonly NotePaginationFallbackReason[];
  /** Mark context used for the final body projection (for incremental cache tokens). */
  readonly noteMarks: NoteMarkContext;
}

type NoteCarryMap = Map<
  string,
  { fragments: readonly BlockFragmentRecord[]; height: number; mark: string | null }
>;

/** The notes a carry continues and how much of each is left, as a comparable string. */
function noteCarryKey(carry: NoteCarryMap): string {
  let key = '';
  for (const [scope, { fragments, height, mark }] of carry) {
    key += `${scope}:${height}:${fragments.length}:${mark ?? ''};`;
  }
  return key;
}

/**
 * Whether a paragraph fragment owns a note atom at `atomOffset`.
 *
 * Fragment ranges are half-open for content ownership: `[start, end)`. The shared
 * boundary offset belongs to the later fragment (downstream affinity), matching line
 * splits where `fragmentStart = previous.range.end`.
 */
export function fragmentOwnsAtomOffset(
  fragment: ParagraphFragmentRecord,
  atomOffset: number
): boolean {
  return atomOffset >= fragment.range.start && atomOffset < fragment.range.end;
}

/**
 * Memoized by the fragments array's identity: pages reuse their fragment arrays across
 * incremental passes, and this flatten runs per page per pass on the ref-collection path.
 */
const paragraphFragmentsMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  ParagraphFragmentRecord[]
>();

function paragraphFragmentsOfBlocks(
  blocks: readonly BlockFragmentRecord[]
): ParagraphFragmentRecord[] {
  const cached = paragraphFragmentsMemos.get(blocks);
  if (cached) return cached;
  const found: ParagraphFragmentRecord[] = [];
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  paragraphFragmentsMemos.set(blocks, found);
  return found;
}

/** Paragraph-id → refs index for linear {@link filterRefsOnPage} over a layout pass. */
export type PageRefIndex = ReadonlyMap<string, readonly PageRefHit[]>;

/**
 * Memoized on the hit array's identity: the session memo hands the previous pass's hit array
 * back by identity when its content is unchanged, so the reserve compute and the attach pass
 * of every keystroke rebuilt an identical index.
 */
const pageRefIndexMemos = new WeakMap<readonly PageRefHit[], PageRefIndex>();

/** Build a reusable paragraph-id index (document order preserved per paragraph). */
export function buildPageRefIndex(allRefs: readonly PageRefHit[]): PageRefIndex {
  const cached = pageRefIndexMemos.get(allRefs);
  if (cached) return cached;
  const map = new Map<string, PageRefHit[]>();
  for (const ref of allRefs) {
    const list = map.get(ref.paragraphId);
    if (list) list.push(ref);
    else map.set(ref.paragraphId, [ref]);
  }
  pageRefIndexMemos.set(allRefs, map);
  return map;
}

/**
 * Per-page answers, memoized on the page's fragments array: a page an incremental pass
 * carried over keeps its fragments by identity, and one settle walks every page THREE times
 * (mark sites, reserve compute, attach). Keyed on the index too — a changed hit set publishes
 * a new index object, which invalidates every entry at once.
 */
const pageRefFilterMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  { readonly refIndex: PageRefIndex; readonly result: readonly PageRefHit[] }
>();

/**
 * Collect note references that appear in laid-out body fragments on a page.
 * Matches {@link ParagraphFragmentRecord.range} ownership (half-open + boundary affinity).
 *
 * Pass {@link buildPageRefIndex} result as `refIndex` for O(fragments + matching refs)
 * instead of scanning every document ref against every page fragment.
 */
export function filterRefsOnPage(
  page: PageRecord,
  allRefs: readonly PageRefHit[],
  refIndex?: PageRefIndex
): readonly PageRefHit[] {
  const fragments = paragraphFragmentsOfBlocks(page.fragments);
  if (!refIndex) {
    return allRefs.filter((ref) =>
      fragments.some((fragment) => fragmentOwnsPosition(fragment, ref.paragraphId, ref.atomOffset))
    );
  }
  const cached = pageRefFilterMemos.get(page.fragments);
  if (cached && cached.refIndex === refIndex) return cached.result;
  const out: PageRefHit[] = [];
  const claimed = new Set<PageRefHit>();
  for (const fragment of fragments) {
    // Asked per paragraph the fragment DRAWS. A resolved display mode publishes a merged run
    // under the survivor's name, so a reference in an absorbed member matched no fragment at
    // all: the note it calls never reached the page, and the reader saw a mark with no note.
    for (const paragraphId of fragmentParagraphs(fragment)) {
      const candidates = refIndex.get(paragraphId);
      if (!candidates) continue;
      for (const ref of candidates) {
        if (claimed.has(ref)) continue;
        if (!fragmentOwnsPosition(fragment, paragraphId, ref.atomOffset)) continue;
        claimed.add(ref);
        out.push(ref);
      }
    }
  }
  pageRefFilterMemos.set(page.fragments, { refIndex, result: out });
  return out;
}

/** Whether a footnote position collects at a section or document end (no per-page area). */
function collectsAtEnd(pos: FootnotePosition): boolean {
  return pos === 'sectEnd' || pos === 'docEnd';
}

/** Scan an OOXML part's laid-out paragraph ids → refs already collected from the package. */
export function buildPageRefHits(
  refs: readonly {
    readonly noteKind: NoteKind;
    readonly noteId: number;
    readonly paragraphId: string;
    readonly atomOffset: number;
    readonly customMarkFollows: boolean;
  }[],
  paragraphSectionIndex: ReadonlyMap<string, number>
): readonly PageRefHit[] {
  const hits: PageRefHit[] = [];
  for (const ref of refs) {
    if (hits.length >= MAX_NOTES_LAID_OUT) break;
    hits.push({
      ...ref,
      sectionIndex: paragraphSectionIndex.get(ref.paragraphId) ?? 0,
    });
  }
  return hits;
}

function footnotePropsFor(
  input: NotesLayoutInput,
  sectionIndex: number
): ResolvedFootnoteProperties {
  return (
    input.footnotePropsBySection[sectionIndex] ??
    input.footnotePropsBySection[0] ??
    input.documentFootnoteProps
  );
}

function endnotePropsFor(input: NotesLayoutInput, sectionIndex: number): ResolvedEndnoteProperties {
  return (
    input.endnotePropsBySection[sectionIndex] ??
    input.endnotePropsBySection[0] ??
    input.documentEndnoteProps
  );
}
function effectiveNoteMarkStyle(
  noteKind: NoteKind,
  styleCascade: StyleCascadeTable | undefined
): ResolvedRunStyle {
  const styleId = noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  if (!styleCascade) {
    return { ...DEFAULT_RUN_STYLE, verticalAlign: 'superscript' };
  }
  const props = cascadeRunProperties(
    [],
    [{ localName: 'rStyle', attributes: { val: styleId } }],
    styleCascade
  );
  return resolveRunStyle(props, styleCascade.themeFonts);
}

/**
 * Pick the widest-measuring eachPage reservation string across actual marks and a bounded
 * window of per-section candidate values/formats. Selection is by measured width under the
 * effective mark style — not string length — so proportional fonts where a shorter glyph
 * run is wider (e.g. `ii` vs `10`) reserve correctly.
 */
function selectEachPageReservedMarkText(
  marks: ReadonlyMap<string, string | null>,
  input: NotesLayoutInput,
  footnoteSites: readonly NoteReferenceSite[],
  endnoteSites: readonly NoteReferenceSite[]
): string | undefined {
  const candidates = new Set<string>();
  for (const mark of marks.values()) {
    if (mark && mark.length > 0) candidates.add(mark);
  }

  const sectionCount = Math.max(
    input.footnotePropsBySection.length,
    input.endnotePropsBySection.length,
    1,
    ...footnoteSites.map((site) => site.sectionIndex + 1),
    ...endnoteSites.map((site) => site.sectionIndex + 1)
  );

  let usesEachPage = false;
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const fn = footnotePropsFor(input, sectionIndex);
    if (fn.numRestart === 'eachPage') {
      usesEachPage = true;
      for (let i = 0; i < MAX_EACH_PAGE_MARK_CANDIDATES; i += 1) {
        const text = formatNumFmt(fn.numFmt, fn.numStart + i);
        if (text.length > 0) candidates.add(text);
      }
    }
    const en = endnotePropsFor(input, sectionIndex);
    if (en.numRestart === 'eachPage') {
      usesEachPage = true;
      for (let i = 0; i < MAX_EACH_PAGE_MARK_CANDIDATES; i += 1) {
        const text = formatNumFmt(en.numFmt, en.numStart + i);
        if (text.length > 0) candidates.add(text);
      }
    }
  }
  if (!usesEachPage || candidates.size === 0) return undefined;

  const style = effectiveNoteMarkStyle('footnote', input.styleCascade);
  let best: string | undefined;
  let bestWidth = -1;
  for (const text of candidates) {
    const width = input.measurer.measure(text, style);
    if (
      width > bestWidth + 0.001 ||
      (Math.abs(width - bestWidth) <= 0.001 && text.length > (best?.length ?? 0))
    ) {
      best = text;
      bestWidth = width;
    }
  }
  return best;
}

function buildMarkContext(
  footnoteSites: readonly NoteReferenceSite[],
  endnoteSites: readonly NoteReferenceSite[],
  input: NotesLayoutInput
): NoteMarkContext {
  const fnMarks = deriveNoteDisplayMarksResolved('footnote', footnoteSites, (sectionIndex) =>
    footnotePropsFor(input, sectionIndex)
  );
  const enMarks = deriveNoteDisplayMarksResolved('endnote', endnoteSites, (sectionIndex) =>
    endnotePropsFor(input, sectionIndex)
  );
  const marks = new Map<string, string | null>();
  for (const entry of fnMarks) {
    marks.set(noteMarkKey('footnote', entry.noteId), entry.mark);
  }
  for (const entry of enMarks) {
    marks.set(noteMarkKey('endnote', entry.noteId), entry.mark);
  }

  const reservedMarkText = selectEachPageReservedMarkText(
    marks,
    input,
    footnoteSites,
    endnoteSites
  );
  return {
    marks,
    ...(reservedMarkText ? { reservedMarkText } : {}),
  };
}

/**
 * Replace provisional body citation digits with page-aware marks after attach.
 *
 * Body layout runs with {@link provisionalNoteMarks} (no `pageIndex`, so `eachPage`
 * behaves like continuous). {@link attachNotesToLayout} then derives final marks with
 * page assignment. This walk updates only `to-note` projected span *display* text —
 * source ranges, box geometry (reserved width), and note areas stay untouched — so
 * digit refinement cannot reflow or corrupt interaction offsets.
 *
 * Structural sharing: unchanged spans/lines/fragments/pages keep identity.
 */
export function reprojectBodyNoteMarks(
  layout: SemanticLayout,
  noteMarks: NoteMarkContext
): SemanticLayout {
  if (noteMarks.marks.size === 0) return layout;

  let anyPageChanged = false;
  const pages = layout.pages.map((page) => {
    // Most pages of a long document carry no note reference at all; their fragment trees
    // are identity-stable across passes, so the answer memoizes and the reprojection walk
    // skips them in O(1) instead of visiting every span per keystroke.
    if (!blocksCarryNoteNav(page.fragments)) return page;
    const fragments = reprojectBodyBlocks(page.fragments, noteMarks);
    if (fragments === page.fragments) return page;
    anyPageChanged = true;
    return { ...page, fragments };
  });
  return anyPageChanged ? { ...layout, pages } : layout;
}

/** Whether any span under `blocks` is a projected to-note citation, memoized by identity. */
const blocksNoteNavMemos = new WeakMap<readonly BlockFragmentRecord[], boolean>();

function blocksCarryNoteNav(blocks: readonly BlockFragmentRecord[]): boolean {
  const cached = blocksNoteNavMemos.get(blocks);
  if (cached !== undefined) return cached;
  let found = false;
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (found) return;
      if (block.kind === 'paragraph') {
        for (const line of block.lines) {
          for (const span of line.spans) {
            if (span.projected && span.noteNav?.direction === 'to-note') {
              found = true;
              return;
            }
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  blocksNoteNavMemos.set(blocks, found);
  return found;
}

function reprojectBodyBlocks(
  blocks: readonly BlockFragmentRecord[],
  noteMarks: NoteMarkContext
): readonly BlockFragmentRecord[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === 'paragraph') {
      const updated = reprojectParagraphFragment(block, noteMarks);
      if (updated !== block) changed = true;
      return updated;
    }
    let rowsChanged = false;
    const rows = block.rows.map((row) => {
      let cellsChanged = false;
      const cells = row.cells.map((cell) => {
        const nested = reprojectBodyBlocks(cell.blocks, noteMarks);
        if (nested === cell.blocks) return cell;
        cellsChanged = true;
        return { ...cell, blocks: nested };
      });
      if (!cellsChanged) return row;
      rowsChanged = true;
      return { ...row, cells };
    });
    if (!rowsChanged) return block;
    changed = true;
    return { ...block, rows };
  });
  return changed ? next : blocks;
}

function reprojectParagraphFragment(
  fragment: ParagraphFragmentRecord,
  noteMarks: NoteMarkContext
): ParagraphFragmentRecord {
  let linesChanged = false;
  const lines = fragment.lines.map((line) => {
    const updated = reprojectLine(line, noteMarks);
    if (updated !== line) linesChanged = true;
    return updated;
  });
  return linesChanged ? { ...fragment, lines } : fragment;
}

function reprojectLine(line: LineRecord, noteMarks: NoteMarkContext): LineRecord {
  let spansChanged = false;
  const spans = line.spans.map((span) => {
    const updated = reprojectBodyCitationSpan(span, noteMarks);
    if (updated !== span) spansChanged = true;
    return updated;
  });
  return spansChanged ? { ...line, spans } : line;
}

function reprojectBodyCitationSpan(
  span: StyleSpanRecord,
  noteMarks: NoteMarkContext
): StyleSpanRecord {
  if (!span.projected || span.noteNav?.direction !== 'to-note') return span;
  const mark = noteMarks.marks.get(span.noteNav.scopeId);
  // Absent key: leave provisional text (dangling / unknown). null = customMarkFollows.
  if (mark === undefined) return span;
  const text = mark ?? '';
  if (span.text === text) return span;
  // Keep box.width — eachPage reserved measurement already sized for the widest mark.
  return { ...span, text };
}

/**
 * Content-column y (relative to contentBox.y) at which footnotes begin, or the column
 * bottom when the page has no footnote area. Endnotes must stay strictly above this.
 */
function footnoteReservedTop(page: PageRecord): number {
  if (!page.footnotes) return page.contentBox.height;
  return Math.max(0, Math.min(page.contentBox.height, page.footnotes.box.y - page.contentBox.y));
}

/**
 * Whether a page may host sectEnd/docEnd endnotes in leftover body room.
 *
 * Footnote-only continuation/drain sheets are never free endnote hosts — even when their
 * body fragments are empty and look like unused column space.
 */
export function isEndnoteHostEligible(page: PageRecord): boolean {
  if (page.noteStream === 'footnote-drain' || page.parityBlank) return false;
  // Untagged safety net: empty body + footnote stories is a drain/continuation sheet.
  if (page.fragments.length === 0 && (page.footnotes?.notes.length ?? 0) > 0) return false;
  return true;
}

/** Last page index that may share endnotes with body (or an empty endnote overflow sheet). */
function lastEndnoteHostIndex(pages: readonly PageRecord[]): number {
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    if (isEndnoteHostEligible(pages[i]!)) return i;
  }
  return Math.max(0, pages.length - 1);
}

function buildFootnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: FootnotePosition,
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[],
  options?: FootnoteAreaOptions
): {
  area: NoteAreaRecord | undefined;
  nextCarry: NoteCarryMap;
  /**
   * Content-relative top the page's reserve must reach to push an unplaceable reference's
   * line to the next page (reserve mode only; undefined when nothing needs evicting).
   */
  evictionTopPt?: number;
  /** The page holds a whole row taller than the page; its area needs no body room. */
  overRow?: boolean;
  /** Reserve mode: the body ends here, because a note that starts on the page splits. */
  splitEndPt?: number;
} {
  const nextCarry: NoteCarryMap = new Map(continuationCarry);
  const pageRefs = refs.filter((ref) => ref.noteKind === 'footnote');
  const contentWidth = page.contentBox.width;
  const opts = noteStoryOptions(input, noteMarks, pageRefs[0]?.sectionIndex ?? 0);

  const notes: NoteStoryRecord[] = [];
  let stackHeight = 0;
  let fragmentBudget = MAX_NOTE_AREA_FRAGMENTS;
  const separatorKind =
    continuationCarry.size > 0 ? ('continuationSeparator' as const) : ('separator' as const);
  const maxSepHeight = Math.max(0, page.contentBox.height);
  const fetchSeparator = (kind: 'separator' | 'continuationSeparator'): NoteSeparatorLayout =>
    separatorLayoutOf(
      options?.separatorCache,
      input.footnotesPart,
      kind,
      contentWidth,
      'footnote',
      maxSepHeight,
      opts,
      reasons
    );
  const separator = fetchSeparator(separatorKind);

  const noticeHeight = options?.continuationNotice?.flowHeight ?? 0;
  const paragraphSplitAllowed = paragraphNoteSplitsAllowed(page);
  const textBottom = bodyFitBottomPt(page);
  const slackBudget = Math.max(0, page.contentBox.height - textBottom - separator.flowHeight);
  const columnBudget = noteColumnBudgetPt(page.contentBox.height, separator.flowHeight);
  const availableForNotes = Math.max(
    0,
    (options?.reserveColumnBudget ? columnBudget : slackBudget) - noticeHeight
  );
  const fullNoteColumn = Math.max(0, page.contentBox.height - separator.flowHeight - noticeHeight);
  const splitOpts = { fullContentHeight: fullNoteColumn, reasons };
  // The keep-whole guard's budget is carry-INDEPENDENT: the hold-out on the previous page
  // re-derives the same test without knowing this page's carry state, and the two must be
  // exact complements or a note is neither evicted nor held out and the loop orbits. Only
  // reserve mode evicts, so only reserve mode pays the plain-separator fetch.
  const keepWholeBudget = !options?.reserveBandOf
    ? 0
    : separatorKind === 'separator'
      ? columnBudget
      : noteColumnBudgetPt(page.contentBox.height, fetchSeparator('separator').flowHeight);
  const firstContentTop = options?.reserveBandOf ? firstBodyContentTopPt(page) : 0;

  // Continuations from the previous page place first.
  for (const [scopeId, carry] of continuationCarry) {
    const parsed = scopeId.match(/^(footnote|endnote):(-?\d+)$/);
    if (!parsed || parsed[1] !== 'footnote') continue;
    const noteId = Number(parsed[2]);
    const room = Math.max(0, availableForNotes - stackHeight);
    if (carry.height <= room + 0.001) {
      notes.push({
        noteKind: 'footnote',
        noteId,
        scopeId,
        // A note carried whole keeps its mark: this page opens it.
        mark: carry.mark,
        ...(carry.mark === null ? { continuation: true } : {}),
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: carry.height,
        },
        fragments: carry.fragments,
      });
      stackHeight += carry.height;
      nextCarry.delete(scopeId);
    } else {
      const split = splitNoteFragments(
        {
          noteKind: 'footnote',
          noteId,
          scopeId,
          noteType: undefined,
          fragments: carry.fragments,
          flowHeight: carry.height,
        },
        room,
        splitOpts
      );
      if (split.head.length > 0) {
        notes.push({
          noteKind: 'footnote',
          noteId,
          scopeId,
          mark: carry.mark,
          ...(carry.mark === null ? { continuation: true } : {}),
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        // A note that places nothing here still opens later, with its mark.
        nextCarry.set(scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: split.head.length > 0 ? null : carry.mark,
        });
      } else {
        nextCarry.delete(scopeId);
      }
    }
  }

  let evictionTopPt: number | undefined;
  let splitEndPt: number | undefined;
  let placedBudget = Number.POSITIVE_INFINITY;
  // The page holds a whole row taller than the page: no reserve can make room below it.
  let overRow = false;
  for (const ref of pageRefs) {
    if (notes.length >= MAX_NOTES_LAID_OUT) {
      reasons.push('note-count-limit');
      break;
    }
    // Each note's budget ends at ITS reference's floor. Reserve mode sizes by that floor
    // alone: a reserve reaching an earlier (lower, other-column) reference line pushes it on.
    // Attach mode cannot move the body, so it also caps the room by every placed note's
    // budget: the stack never enters the full box of a reference line whose note starts here.
    const band =
      options?.reserveBandOf?.(ref) ?? noteReferenceLineBandPt(page, ref, input.compatibilityMode);
    // A reference at or below an eviction point moves with the evicted line; its note lays
    // out with it on the destination page. References ABOVE the point (document order is
    // not y order beside a float exclusion zone, or across columns) stay put and keep
    // their notes in this page's reserve. Only an evictable line or row band may skip: a
    // fallback table band is the whole table box, whose bottom clears the eviction point
    // even when the referencing row stays on this page — its note must keep reserving here.
    // Strictly BELOW the point: an edge-to-edge line whose bottom equals the eviction top
    // is the line directly above it, which stays on the page and must keep its reserve.
    if (
      evictionTopPt !== undefined &&
      band &&
      band.evictable &&
      band.bottom > evictionTopPt + 0.001
    ) {
      continue;
    }
    const laid = layoutNoteCached(
      input.footnotesPart,
      ref.noteId,
      contentWidth,
      opts,
      options?.noteLayoutCache
    );
    if (!laid) {
      reasons.push('missing-note-body');
      continue;
    }
    const mark = noteMarks.marks.get(noteMarkKey('footnote', ref.noteId)) ?? null;
    // A whole row past the bottom margin keeps only the first line of its first note
    // (`note-overflow-row.ts`). The area then rides over the row and reserves nothing.
    if (band && referenceRowOverflowsPage(band, input.compatibilityMode)) {
      const shown = ref.customMarkFollows ? null : mark;
      // Only the page's first note keeps a line, and only when no carried note waits for room.
      const first = notes.length === 0 && continuationCarry.size === 0;
      const { note, carry } = overflowRowNote(laid, shown, first, page, reasons);
      if (note) notes.push(note);
      if (carry) nextCarry.set(laid.scopeId, carry);
      stackHeight += note?.box.height ?? 0;
      overRow = true;
      continue;
    }
    const refBudget = band
      ? Math.min(
          availableForNotes,
          Math.max(
            0,
            page.contentBox.height -
              Math.max(MIN_FOOTNOTE_BODY_BAND_PT, band.bottom) -
              separator.flowHeight -
              noticeHeight
          )
        )
      : availableForNotes;
    const cap = options?.reserveBandOf ? refBudget : Math.min(refBudget, placedBudget);
    const room = Math.max(0, cap - stackHeight);
    const splitRoom =
      paragraphSplitAllowed && band && laid.flowHeight > room + 0.001 && !band.tableRow
        ? Math.max(
            0,
            Math.min(
              room,
              page.contentBox.height -
                noteReferenceOpeningBottom(page, ref, band) -
                separator.flowHeight -
                noticeHeight -
                stackHeight
            )
          )
        : room;
    if (
      band &&
      evictsReferenceLine(band, laid, splitRoom, {
        keepWholeBudget,
        paragraphSplitAllowed,
        firstContentTop,
        fullNoteColumn,
        evictionAllowed: options?.evictionAllowed,
        allowOrphanDeferral: options?.allowOrphanDeferral,
        nextPage: options?.nextPage,
      })
    ) {
      evictionTopPt = evictionTopPt === undefined ? band.top : Math.min(evictionTopPt, band.top);
      continue;
    }
    fragmentBudget -= laid.fragments.length;
    if (fragmentBudget < 0) {
      reasons.push('note-area-fragment-limit');
      break;
    }
    if (laid.flowHeight <= room + 0.001) {
      notes.push({
        noteKind: 'footnote',
        noteId: ref.noteId,
        scopeId: laid.scopeId,
        mark: ref.customMarkFollows ? null : mark,
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
      });
      stackHeight += laid.flowHeight;
      placedBudget = Math.min(placedBudget, refBudget);
    } else {
      const split = splitNoteFragments(laid, splitRoom, splitOpts);
      if (split.head.length > 0) {
        notes.push({
          noteKind: 'footnote',
          noteId: ref.noteId,
          scopeId: laid.scopeId,
          mark: ref.customMarkFollows ? null : mark,
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
        placedBudget = Math.min(placedBudget, refBudget);
      }
      if (split.tail.length > 0 && split.head.length > 0 && options?.reserveBandOf && band) {
        const end = splitNotePageEndPt(page, ref, band);
        if (end !== undefined) splitEndPt = Math.min(splitEndPt ?? end, end);
      }
      if (split.tail.length > 0) {
        // A note that places nothing here opens on a later page, with its mark.
        nextCarry.set(laid.scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: split.head.length > 0 || ref.customMarkFollows ? null : mark,
        });
      }
    }
  }

  const continues = hasContinuingNote(notes, nextCarry);
  let noticeRefused = false;
  if (continues && !options?.continuationNotice) {
    const reasonCount = reasons.length;
    const notice = footnoteContinuationNotice(
      input.footnotesPart,
      contentWidth,
      page.contentBox.height,
      opts,
      options?.noteLayoutCache,
      reasons
    );
    noticeRefused =
      reasons.length > reasonCount && reasons.at(-1) === 'note-continuation-notice-height-cap';
    if (notice) {
      const withNotice = buildFootnoteArea(
        page,
        refs,
        input,
        noteMarks,
        placement,
        continuationCarry,
        reasons,
        { ...options, continuationNotice: notice }
      );
      if ((withNotice.area?.notes.length ?? 0) > 0 || withNotice.nextCarry.size === 0)
        return withNotice;
      // A notice must not turn a progressing continuation into an empty drain page.
      reasons.push('note-continuation-notice-height-cap');
      noticeRefused = true;
    }
  }

  // Over a whole tall row, a waiting continuation paints no separator without notes.
  if (notes.length === 0 && (continuationCarry.size === 0 || overRow)) {
    return { area: undefined, nextCarry, evictionTopPt, overRow, splitEndPt };
  }

  const sepHeight = separator.flowHeight;
  const activeNotice = continues ? options?.continuationNotice : undefined;
  const totalHeight = sepHeight + stackHeight + (activeNotice?.flowHeight ?? 0);
  // Budgets measure without trailing after-spacing ({@link bodyFitBottomPt}); PLACEMENT
  // keeps the painted flow bottom and rises into the after-spacing band only when the
  // stack needs the room, which is also where Word draws the separator in that case.
  const flowBottom = fragmentFlowBottom(page.fragments);
  let areaTop: number;
  if (placement === 'beneathText') {
    areaTop =
      page.contentBox.y +
      Math.max(textBottom, Math.min(flowBottom, page.contentBox.height - totalHeight));
  } else {
    // pageBottom — pin to bottom of content column.
    areaTop = page.contentBox.y + page.contentBox.height - totalHeight;
    // Never overlap body text, except a whole row past the bottom margin.
    if (!overRow) areaTop = Math.max(areaTop, page.contentBox.y + textBottom);
  }

  let cursorY = areaTop + sepHeight;
  const placedNotes: NoteStoryRecord[] = notes.map((note) => {
    const placed = {
      ...note,
      box: { ...note.box, y: cursorY },
    };
    cursorY += note.box.height;
    return placed;
  });

  const sepBox = noteSeparatorAreaBox(separator, page.contentBox.x, contentWidth, areaTop);

  const area: NoteAreaRecord = {
    kind: 'footnotes',
    placement: placement === 'beneathText' ? 'beneathText' : 'pageBottom',
    box: {
      x: page.contentBox.x,
      y: areaTop,
      width: contentWidth,
      height: totalHeight,
    },
    separator: {
      kind: separatorKind,
      box: sepBox,
      fragments: separator.fragments,
      synthetic: separator.synthetic,
      ...(separator.ruleStyle !== undefined ? { ruleStyle: separator.ruleStyle } : {}),
      ...(separator.ruleColor !== undefined ? { ruleColor: separator.ruleColor } : {}),
    },
    notes: placedNotes,
    ...placeContinuationNotice(activeNotice, page.contentBox.x, cursorY, contentWidth),
    ...(noticeRefused ? { fallbackReason: 'note-continuation-notice-height-cap' } : {}),
  };
  return { area, nextCarry, evictionTopPt, overRow, splitEndPt };
}

/**
 * The last page at or before `position` that the BODY pass produced.
 *
 * Only such a page carries an index in the layout's original space, which is what a section
 * lookup needs. `lastEndnoteHostIndex` and `lastPageIndexForSection` both hand back a page that
 * can HOST notes, and an endnote overflow sheet qualifies — `isEndnoteHostEligible` turns away
 * only footnote drain sheets — so the run's starting page is not itself a guarantee. Position 0
 * is always a body-pass page: minting needs a template, so nothing can be inserted before it.
 */
function originalPageAtOrBefore(pages: readonly PageRecord[], position: number): number {
  let at = Math.min(Math.max(position, 0), pages.length - 1);
  while (at > 0 && pages[at]!.noteStream !== undefined) at -= 1;
  return at;
}

/**
 * Mints the blank sheets a note run needs, each resolving its OWN shell.
 *
 * Both indices come from the caller, and each answers a different question in its own space.
 *
 * The SECTION ANCHOR must read in the layout's ORIGINAL index space, so it comes from a page the
 * body pass produced — {@link originalPageAtOrBefore} finds one. A sheet this pass minted cannot
 * serve: `insertOverflowPageAt` stamps it with an insertion POSITION, and the section spans it
 * would be looked up against are in original space.
 *
 * The LANDING INDEX is the array position the sheet occupies, which is the document index it
 * keeps once the pass reindexes — inserts only ever move forward, so nothing displaces it
 * afterwards. It decides the variant, and through it the content box, because
 * `w:evenAndOddHeaders` alternates on the page's number in the document: the drain sheets and
 * earlier overflow sheets in front of this one all count towards it.
 */
function createOverflowSheetMinter(layout: SemanticLayout): OverflowSheetMinter {
  return (args) => {
    const shell = overflowPageShellAt(
      layout,
      args.sectionAnchorIndex,
      args.landingIndex,
      args.template.box
    );
    return cloneEmptyOverflowPage(args.template, args.landingIndex, args.noteStream, shell);
  };
}

type OverflowSheetMinter = (args: {
  readonly template: PageRecord;
  /** Array position the sheet is inserted at, which is also its final document index. */
  readonly landingIndex: number;
  readonly noteStream?: PageNoteStream;
  /** Original-space index of a body-pass page in the section the new sheet belongs to. */
  readonly sectionAnchorIndex: number;
}) => PageRecord;

/**
 * A blank sheet minted after body layout, for notes that ran off the page.
 *
 * `shell` is the content box AND the furniture the NEW index resolves to. Neither is the
 * template's: a sheet cloned from a title page inherits a content box that page 0's variant
 * resolved and its own never does — 20 pt of a header's worth on the shape this fixture class
 * uses — and the furniture page 0 shows, which for a `w:titlePg` section with no `first`
 * reference is no header at all. Taking one without the other is worse than taking neither: a
 * default-variant inset over a title page's absent header paints an empty band exactly a
 * header high. Absent shell keeps the template's, which is what a layout assembled outside the
 * body pass can offer.
 */
function cloneEmptyOverflowPage(
  template: PageRecord,
  index: number,
  noteStream?: PageNoteStream,
  shell?: OverflowPageShell
): PageRecord {
  const contentBox = shell
    ? {
        x: template.contentBox.x,
        y: template.box.y + shell.insets.top,
        width: template.contentBox.width,
        height: shell.insets.height,
      }
    : template.contentBox;
  const header = shell ? shell.header : template.header;
  const footer = shell ? shell.footer : template.footer;
  // The frame belongs to the sheet's place in its section, so the shell resolves it. A template
  // that is the section's first page has no `notFirstPage` frame, and copying its (absent) one
  // left every sheet minted after it bare. Without a shell the template's frame is the best
  // guess, minus a `firstPage` frame, which the template holds only because it IS page 0.
  const pageBorders = shell
    ? shell.pageBorders
    : template.pageBorders?.display !== 'firstPage'
      ? template.pageBorders
      : undefined;
  return {
    id: `page-${index}`,
    index,
    box: template.box,
    contentBox,
    fragments: [],
    ...(pageBorders ? { pageBorders } : {}),
    ...(noteStream ? { noteStream } : {}),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(template.pageFieldSource
      ? {
          pageFieldSource: {
            ...template.pageFieldSource,
            // ONE PAGE after its template, stated rather than derived. `index` is an array
            // position and `template.index` is the layout index the body pass gave it, and the
            // notes pass reindexes only at the end — so once anything has been inserted in
            // front of the template the two spaces differ, and their difference is a count of
            // insertions, not a page distance. Every minted sheet sits directly after the page
            // it was cloned from, which is what this number means.
            pageNumber: template.pageFieldSource.pageNumber + 1,
          },
        }
      : {}),
  };
}

/** Section indexes represented by body paragraph fragments on a page. */
function pageBodySectionIndexes(
  page: PageRecord,
  paragraphSectionIndex: ReadonlyMap<string, number>
): readonly number[] {
  const found = new Set<number>();
  for (const fragment of paragraphFragmentsOfBlocks(page.fragments)) {
    found.add(paragraphSectionIndex.get(fragment.paragraphId) ?? 0);
  }
  return [...found].sort((a, b) => a - b);
}

/** Last page index that carries any body content owned by `sectionIndex`. */
function lastPageIndexForSection(
  pages: readonly PageRecord[],
  sectionIndex: number,
  paragraphSectionIndex: ReadonlyMap<string, number>
): number {
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    if (pageBodySectionIndexes(pages[i]!, paragraphSectionIndex).includes(sectionIndex)) {
      return i;
    }
  }
  return Math.max(0, pages.length - 1);
}

/**
 * Exclusive upper bound for advancing into existing pages while placing section-end notes:
 * the first page after this section's body + footnote-drain run that belongs to a later
 * section. Overflow sheets are inserted at this boundary so notes never land on a later
 * section's body pages, and stay after this section's footnote drain pages.
 */
function sectionEndInsertBound(
  pages: readonly PageRecord[],
  sectionIndex: number,
  paragraphSectionIndex: ReadonlyMap<string, number>
): number {
  const last = lastPageIndexForSection(pages, sectionIndex, paragraphSectionIndex);
  for (let i = last + 1; i < pages.length; i += 1) {
    const page = pages[i]!;
    // A blank parity sheet opens the next section: section-end notes stay in front of it.
    if (page.parityBlank) return i;
    // Footnote drain / endnote overflow sheets still belong to the preceding note stream.
    if (page.noteStream === 'footnote-drain' || page.noteStream === 'endnote-overflow') {
      continue;
    }
    // Untagged empty-body footnote continuation (pre-tag safety).
    if (page.fragments.length === 0 && (page.footnotes?.notes.length ?? 0) > 0) {
      continue;
    }
    const sections = pageBodySectionIndexes(page, paragraphSectionIndex);
    if (sections.length === 0) continue;
    if (!sections.includes(sectionIndex)) return i;
  }
  return pages.length;
}

/**
 * After note overflow insertion, reindex sheets and re-project allowlisted PAGE fields.
 * Inserted overflow pages already carry a `pageFieldSource` cloned from the section template;
 * document-level NUMPAGES and furniture text need finalize against the new page count.
 */
function reindexAndFinalizeFields(pages: readonly PageRecord[], revision: number): PageRecord[] {
  const reindexed = reindexAndRestackPages(pages);
  // The REAL revision, not a sentinel: PAGEREF calibration may revoke a live latch only when
  // a re-finalize of the SAME revision moved a target (overflow sheets shifting body pages),
  // so this finalize has to identify itself as the body pass's own second word.
  return [...finalizePageFieldProjection({ revision, pages: reindexed }).pages];
}

/**
 * Place endnotes (or sect/doc-end footnotes) onto `page`, splitting under a continuation
 * separator when they do not fit. Returns unplaced carry for further pages.
 *
 * Room accounting reserves any existing footnote area: endnotes stack below body text and
 * stay strictly above footnotes so the two geometries cannot overlap.
 */
function buildEndnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[],
  options?: {
    readonly separatorKind?: 'separator' | 'continuationSeparator';
    readonly separatorCache?: NoteSeparatorCache;
    /** Pass-local note story layouts (see the footnote twin). */
    readonly noteLayoutCache?: NoteStoryLayoutCache;
  }
): { area: NoteAreaRecord | undefined; nextCarry: NoteCarryMap; remainingRefs: PageRefHit[] } {
  const nextCarry: NoteCarryMap = new Map(continuationCarry);
  const remainingRefs: PageRefHit[] = [];
  if (refs.length === 0 && continuationCarry.size === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }

  const contentWidth = page.contentBox.width;
  const opts = noteStoryOptions(
    input,
    noteMarks,
    refs[0]?.sectionIndex ?? Math.max(0, input.endnotePropsBySection.length - 1)
  );
  const separatorKind = options?.separatorKind ?? 'separator';
  const notesPartFor = (kind: NoteKind) =>
    kind === 'footnote' ? input.footnotesPart : input.endnotesPart;
  // Separator drawn from endnotes part when placing endnote area; footnotes at sect/doc end
  // still use the endnotes-area chrome (Word draws the endnote separator for doc-end notes).
  const sepPart = input.endnotesPart ?? input.footnotesPart;
  const maxSepHeight = Math.max(0, page.contentBox.height);
  const separator = separatorLayoutOf(
    options?.separatorCache,
    sepPart,
    separatorKind,
    contentWidth,
    'endnote',
    maxSepHeight,
    opts,
    reasons
  );
  const sepHeight = separator.flowHeight;
  // Endnotes anchor beneath the PAINTED flow (full boxes, trailing after-spacing kept):
  // they hang off the body in leftover room rather than joining the footnote reserve's
  // fit arithmetic, so the after-less measure has nothing to reconcile here.
  const bodyBottom = fragmentFlowBottom(page.fragments);
  // Existing endnotes already consume room below body (merged on re-entry).
  const existingEndnoteBottom = page.endnotes
    ? Math.max(bodyBottom, page.endnotes.box.y - page.contentBox.y + page.endnotes.box.height)
    : bodyBottom;
  const usableBottom = footnoteReservedTop(page);
  const availableForNotes = Math.max(0, usableBottom - existingEndnoteBottom - sepHeight);
  // Full-column split budget also excludes the footnote reservation.
  const fullNoteColumn = Math.max(0, usableBottom - sepHeight);
  const splitOpts = { fullContentHeight: fullNoteColumn, reasons };

  const notes: NoteStoryRecord[] = [];
  let stackHeight = 0;
  let fragmentBudget = MAX_NOTE_AREA_FRAGMENTS;

  for (const [scopeId, carry] of continuationCarry) {
    const parsed = scopeId.match(/^(footnote|endnote):(-?\d+)$/);
    if (!parsed) continue;
    const noteKind = parsed[1] as NoteKind;
    const noteId = Number(parsed[2]);
    const room = Math.max(0, availableForNotes - stackHeight);
    if (carry.height <= room + 0.001) {
      notes.push({
        noteKind,
        noteId,
        scopeId,
        mark: null,
        continuation: true,
        box: { x: page.contentBox.x, y: 0, width: contentWidth, height: carry.height },
        fragments: carry.fragments,
      });
      stackHeight += carry.height;
      nextCarry.delete(scopeId);
    } else {
      const split = splitNoteFragments(
        {
          noteKind,
          noteId,
          scopeId,
          noteType: undefined,
          fragments: carry.fragments,
          flowHeight: carry.height,
        },
        room,
        splitOpts
      );
      if (split.head.length > 0) {
        notes.push({
          noteKind,
          noteId,
          scopeId,
          mark: null,
          continuation: true,
          box: { x: page.contentBox.x, y: 0, width: contentWidth, height: split.headHeight },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: null,
        });
      } else {
        nextCarry.delete(scopeId);
      }
    }
  }

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]!;
    if (notes.length >= MAX_NOTES_LAID_OUT) {
      reasons.push('note-count-limit');
      remainingRefs.push(...refs.slice(i));
      break;
    }
    const part = notesPartFor(ref.noteKind);
    const laid = layoutNoteCached(part, ref.noteId, contentWidth, opts, options?.noteLayoutCache);
    if (!laid) {
      reasons.push('missing-note-body');
      continue;
    }
    const mark = noteMarks.marks.get(noteMarkKey(ref.noteKind, ref.noteId)) ?? null;
    const room = Math.max(0, availableForNotes - stackHeight);
    fragmentBudget -= laid.fragments.length;
    if (fragmentBudget < 0) {
      reasons.push('note-area-fragment-limit');
      remainingRefs.push(...refs.slice(i));
      break;
    }
    if (laid.flowHeight <= room + 0.001) {
      notes.push({
        noteKind: ref.noteKind,
        noteId: ref.noteId,
        scopeId: laid.scopeId,
        mark: ref.customMarkFollows ? null : mark,
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
      });
      stackHeight += laid.flowHeight;
    } else {
      const split = splitNoteFragments(laid, room, splitOpts);
      if (split.head.length > 0) {
        notes.push({
          noteKind: ref.noteKind,
          noteId: ref.noteId,
          scopeId: laid.scopeId,
          mark: ref.customMarkFollows ? null : mark,
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(laid.scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: null,
        });
      }
      remainingRefs.push(...refs.slice(i + 1));
      break;
    }
  }

  if (notes.length === 0 && continuationCarry.size === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }
  if (notes.length === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }

  const areaTop = page.contentBox.y + existingEndnoteBottom;
  let cursorY = areaTop + sepHeight;
  const placedNotes = notes.map((note) => {
    const placed = { ...note, box: { ...note.box, y: cursorY } };
    cursorY += note.box.height;
    return placed;
  });

  const sepBox = noteSeparatorAreaBox(separator, page.contentBox.x, contentWidth, areaTop);
  const areaHeight = sepHeight + stackHeight;
  // Hard clip: never extend into the footnote reservation.
  const maxHeight = Math.max(0, usableBottom - existingEndnoteBottom);
  const clippedHeight = Math.min(areaHeight, maxHeight);

  return {
    area: {
      kind: 'endnotes',
      placement,
      box: {
        x: page.contentBox.x,
        y: areaTop,
        width: contentWidth,
        height: clippedHeight,
      },
      separator: {
        kind: separatorKind,
        box: sepBox,
        fragments: separator.fragments,
        synthetic: separator.synthetic,
        ...(separator.ruleStyle !== undefined ? { ruleStyle: separator.ruleStyle } : {}),
        ...(separator.ruleColor !== undefined ? { ruleColor: separator.ruleColor } : {}),
      },
      notes: placedNotes,
    },
    nextCarry,
    remainingRefs,
  };
}

/** Append empty pages until footnote continuation carry is drained (bounded). */
function drainFootnoteCarryPages(
  pages: PageRecord[],
  carry: NoteCarryMap,
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  reasons: NotePaginationFallbackReason[],
  overflowBudget: NoteOverflowBudget,
  separatorCache: NoteSeparatorCache,
  noteLayoutCache: NoteStoryLayoutCache,
  mint: OverflowSheetMinter
): { pages: PageRecord[]; carry: NoteCarryMap } {
  let nextPages = pages;
  let nextCarry = carry;
  // This run appends after the last page and goes before any endnote insertion, so that page
  // is a body-pass one — the walk-back is belt and braces, and states the requirement.
  const sectionAnchorIndex = pages[originalPageAtOrBefore(pages, pages.length - 1)]!.index;
  while (nextCarry.size > 0 && overflowBudget.remaining > 0) {
    const template = nextPages[nextPages.length - 1]!;
    const page = mint({
      template,
      landingIndex: nextPages.length,
      noteStream: 'footnote-drain',
      sectionAnchorIndex,
    });
    const built = buildFootnoteArea(page, [], input, noteMarks, 'pageBottom', nextCarry, reasons, {
      separatorCache,
      noteLayoutCache,
    });
    const notesPlaced = built.area?.notes.length ?? 0;
    nextCarry = built.nextCarry;
    // Zero-progress: separator-only / empty area while carry remains — do not mint up to
    // MAX_NOTE_OVERFLOW_PAGES blank sheets (tall-separator amplifier).
    if (notesPlaced === 0) {
      reasons.push('note-overflow-stalled');
      if (built.area) {
        nextPages = [...nextPages, { ...page, footnotes: built.area }];
        overflowBudget.remaining -= 1;
      }
      break;
    }
    nextPages = [...nextPages, { ...page, footnotes: built.area! }];
    overflowBudget.remaining -= 1;
  }
  if (nextCarry.size > 0 && !reasons.includes('note-overflow-stalled')) {
    reasons.push('note-overflow-page-limit');
  }
  return { pages: nextPages, carry: nextCarry };
}

function insertOverflowPageAt(
  pages: PageRecord[],
  insertAt: number,
  template: PageRecord,
  mint: OverflowSheetMinter,
  sectionAnchorIndex: number,
  noteStream: PageNoteStream = 'endnote-overflow'
): { pages: PageRecord[]; pageIndex: number } {
  const page = mint({ template, landingIndex: insertAt, noteStream, sectionAnchorIndex });
  const next = [...pages.slice(0, insertAt), page, ...pages.slice(insertAt)];
  // Defer reindex to attachNotesToLayout — per-insert reindex is O(overflow²).
  return { pages: next, pageIndex: insertAt };
}

/**
 * Patch section-local PAGE/SECTIONPAGES sources for pages `[start, endExclusive)` after
 * overflow sheets were inserted into that section.
 */
function patchSectionFieldSources(
  pages: PageRecord[],
  start: number,
  endExclusive: number
): PageRecord[] {
  if (endExclusive <= start || start >= pages.length) return pages;
  const end = Math.min(endExclusive, pages.length);
  const anchor = pages[start]!;
  const displayedStart = anchor.pageFieldSource?.pageNumber ?? start + 1;
  const format = anchor.pageFieldSource?.format;
  const count = end - start;
  const next = [...pages];
  for (let i = start; i < end; i += 1) {
    const page = next[i]!;
    // A body sheet keeps the number layout gave it: a continuous section's first sheet is a
    // host that carries an earlier section's number. Inserted sheets count on from the sheet
    // in front of them.
    const own = page.noteStream === undefined ? page.pageFieldSource?.pageNumber : undefined;
    const previous = i > start ? next[i - 1]!.pageFieldSource?.pageNumber : undefined;
    next[i] = {
      ...page,
      pageFieldSource: {
        pageNumber: own ?? (previous !== undefined ? previous + 1 : displayedStart + (i - start)),
        sectionPageCount: count,
        ...(format ? { format } : {}),
      },
    };
  }
  return next;
}

/** Place collected endnotes starting at `startIndex`, creating overflow pages as needed. */
function placeEndnotesFromPage(
  pages: PageRecord[],
  startIndex: number,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  reasons: NotePaginationFallbackReason[],
  overflowBudget: NoteOverflowBudget,
  options: {
    /**
     * Exclusive index of the first page that belongs to a later section. Overflow sheets are
     * inserted here rather than advancing into subsequent-section body pages.
     */
    readonly stopBeforeIndex?: number;
    /** First page index of the owning section (for SECTIONPAGES patching). */
    readonly sectionStartIndex?: number;
    readonly separatorCache?: NoteSeparatorCache;
    /** Pass-local note story layouts (see the footnote twin). */
    readonly noteLayoutCache?: NoteStoryLayoutCache;
    /** Mints an overflow sheet with the shell its own index resolves to. */
    readonly mint: OverflowSheetMinter;
  }
): PageRecord[] {
  if (refs.length === 0 || pages.length === 0) return pages;
  // The section comes from the nearest BODY-PASS page at or before the run's start. The start
  // itself may be a sheet an earlier run minted: `lastEndnoteHostIndex` accepts an endnote
  // overflow sheet, and that sheet's `index` is an insertion position, not a layout index.
  const sectionAnchorIndex = pages[originalPageAtOrBefore(pages, startIndex)]!.index;
  let nextPages = [...pages];
  let pending = [...refs];
  let carry: NoteCarryMap = new Map();
  let index = startIndex;
  let created = 0;
  let separatorKind: 'separator' | 'continuationSeparator' = 'separator';
  // Tracks the first later-section page as overflow sheets are inserted before it.
  let stopBefore = options?.stopBeforeIndex ?? Number.POSITIVE_INFINITY;
  const sectionStart = options?.sectionStartIndex ?? startIndex;
  const boundToSection = options?.stopBeforeIndex !== undefined;
  const separatorCache = options?.separatorCache;

  while (pending.length > 0 || carry.size > 0) {
    if (index >= nextPages.length || index >= stopBefore) {
      if (overflowBudget.remaining <= 0) {
        reasons.push('note-overflow-page-limit');
        break;
      }
      const template =
        nextPages[Math.min(Math.max(index, 1), nextPages.length) - 1] ??
        nextPages[nextPages.length - 1]!;
      const insertAt = Math.min(index, stopBefore, nextPages.length);
      const inserted = insertOverflowPageAt(
        nextPages,
        insertAt,
        template,
        options.mint,
        sectionAnchorIndex,
        'endnote-overflow'
      );
      nextPages = inserted.pages;
      index = inserted.pageIndex;
      // Later-section pages shifted right by one; keep the boundary after the new sheet.
      if (boundToSection) stopBefore = insertAt + 1;
      created += 1;
      overflowBudget.remaining -= 1;
    }
    const page = nextPages[index]!;
    // Footnote-only drain pages are never free endnote hosts — skip past the drain run
    // (still before later-section body) so overflow inserts after it.
    if (!isEndnoteHostEligible(page)) {
      index += 1;
      continue;
    }
    const built = buildEndnoteArea(page, pending, input, noteMarks, placement, carry, reasons, {
      separatorKind,
      ...(separatorCache ? { separatorCache } : {}),
      ...(options.noteLayoutCache ? { noteLayoutCache: options.noteLayoutCache } : {}),
    });
    carry = built.nextCarry;
    pending = built.remainingRefs;
    const notesPlaced = built.area?.notes.length ?? 0;
    if (built.area) {
      const prev = nextPages[index]!;
      nextPages[index] = {
        ...prev,
        endnotes: prev.endnotes
          ? {
              ...built.area,
              notes: [...prev.endnotes.notes, ...built.area.notes],
              box: {
                ...built.area.box,
                y: prev.endnotes.box.y,
                height: prev.endnotes.box.height + built.area.box.height,
              },
            }
          : built.area,
      };
    } else if (carry.size === 0 && pending.length === 0) {
      break;
    } else if (!built.area && carry.size === 0 && pending.length > 0) {
      // No room on this page — advance / create the next (still before later sections).
      index += 1;
      separatorKind = 'separator';
      continue;
    }
    // Empty overflow sheet that placed nothing while work remains: stall (tall separator).
    if (
      notesPlaced === 0 &&
      (carry.size > 0 || pending.length > 0) &&
      page.fragments.length === 0 &&
      page.noteStream === 'endnote-overflow'
    ) {
      reasons.push('note-overflow-stalled');
      break;
    }
    if (carry.size > 0 || pending.length > 0) {
      separatorKind = 'continuationSeparator';
      index += 1;
      continue;
    }
    break;
  }
  if (pending.length > 0 || carry.size > 0) {
    if (!reasons.includes('note-overflow-stalled')) {
      reasons.push('note-overflow-page-limit');
    }
  }

  if (boundToSection) {
    nextPages = patchSectionFieldSources(
      nextPages,
      sectionStart,
      Math.min(stopBefore, nextPages.length)
    );
  } else if (created > 0) {
    nextPages = patchSectionFieldSources(nextPages, sectionStart, nextPages.length);
  }
  return nextPages;
}

/**
 * Compute per-page bottom reserves (points) needed for footnotes given a provisional layout.
 * Used by the bounded reflow loop before final attach.
 *
 * Height is measured against a column-derived note budget (not leftover body slack). Measuring
 * from slack makes `stable` true on the first pass and never shrinks the body — references and
 * notes then compete for the same band. Oversized notes still split/continue within the budget;
 * {@link MIN_FOOTNOTE_BODY_BAND_PT} keeps a body band so reflow cannot chase blank sheets.
 *
 * Answers under the STRICT co-location policy: every footnote starts on the page that
 * references it. The bounded orphan-pair refinement is a second phase of the internal
 * reflow loop, which owns the strict fixed point the refinement needs as its starting
 * point and as its fallback, so a single call from outside that loop cannot reach it.
 */
export function computeFootnoteReserves(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  /** Session-carried notes memo (opaque; owned by this module). */
  passMemo?: unknown,
  /**
   * The reserve map `layout` was laid under. Feeds the hold-out's observed-refusal test
   * (a block the body pass declined to split under a known budget only moves whole);
   * absent, the hold-out releases the ambiguous cases — a caller outside the reflow loop
   * must not manufacture holds the loop never observed.
   */
  previousReserves?: ReadonlyMap<number, number>
): {
  readonly reserves: ReadonlyMap<number, number>;
  readonly stable: boolean;
  readonly reasons: readonly NotePaginationFallbackReason[];
} {
  return computeFootnoteReservesWithPolicy(
    layout,
    allRefs,
    input,
    noteMarks,
    passMemo,
    previousReserves,
    false
  );
}

function computeFootnoteReservesWithPolicy(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  passMemo: unknown,
  previousReserves: ReadonlyMap<number, number> | undefined,
  allowOrphanDeferral: boolean,
  range?: ReserveComputeRange
): ReserveComputeResult {
  const memo = (passMemo ?? null) as NotesPassMemo | null;
  const reserves = new Map<number, number>();
  const reasons: NotePaginationFallbackReason[] = [];
  let orphanCandidates = false;
  const orphanPages = new Set<number>();
  let carry = (range?.carry as NoteCarryMap | undefined) ?? new Map();
  const carryBefore: NoteCarryMap[] = [];
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();
  // Keyed on the mark-context object, which the memo keeps across keystrokes: unchanged
  // notes reuse their story layouts until the memo (which pins the parts and inputs the
  // key omits) is replaced. See {@link NoteStoryLayoutCache}.
  const noteLayoutCache = noteStoryCacheFor(noteMarks);
  const isPageBottomFootnoteRef = (ref: PageRefHit): boolean =>
    ref.noteKind === 'footnote' && !collectsAtEnd(footnotePropsFor(input, ref.sectionIndex).pos);
  // A document with no page-bottom footnote reference at all (footnote-free, or every
  // section collects at sectEnd/docEnd) has nothing for the hold-out to pull, so the
  // per-page scan is skipped wholesale.
  const anyPageBottomFootnoteRefs = allRefs.some(isPageBottomFootnoteRef);
  const pageBottomRefsOf = (page: PageRecord): readonly PageRefHit[] =>
    filterRefsOnPage(page, allRefs, refIndex).filter(isPageBottomFootnoteRef);
  const recordReserve = (pageIndex: number, needed: number, cap: number): void =>
    recordFootnoteReserve(reserves, pageIndex, Math.min(needed, cap));

  // A range with an end stops there; the pages before it read only what is carried into them.
  const end = Math.min(layout.pages.length, range?.to ?? layout.pages.length);
  for (let pageAt = range?.from ?? 0; pageAt < end; pageAt += 1) {
    const page = layout.pages[pageAt]!;
    carryBefore[pageAt] = carry;
    // A blank parity sheet holds no notes; a continuation carries on past it.
    if (page.parityBlank) continue;
    // Strip any prior note-pass output so reserve height is body-only.
    const bodyPage = bodyOnlyPage(page);
    const pageRefs = filterRefsOnPage(bodyPage, allRefs, refIndex);
    const fnRefs = pageRefs.filter((r) => r.noteKind === 'footnote');
    const pageBottomRefs = fnRefs.filter(isPageBottomFootnoteRef);
    // BEFORE the page-local cache short-circuit below, so a cached page still answers it.
    // Every reference the refinement can reach is some page's own page-bottom ref (the
    // hold-out's frontier is the next page's, and that page is visited here too).
    if (anyOrphanPairBand(bodyPage, pageBottomRefs, input.compatibilityMode)) {
      orphanCandidates = true;
      orphanPages.add(page.index);
    }
    // Position from the first page-local ref's section; sect/doc-end refs do not govern it.
    const sectionIndex = pageBottomRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    const holdOutOpts = noteStoryOptions(input, noteMarks, sectionIndex);
    const nextPage = layout.pages[pageAt + (layout.pages[pageAt + 1]?.parityBlank ? 2 : 1)];
    const usedReservePt = previousReserves ? (previousReserves.get(page.index) ?? 0) : undefined;
    // The reserve ceiling: the note column beside the minimum body band.
    const maxArea = noteColumnBudgetPt(bodyPage.contentBox.height, 0);
    // The eviction's fixed point ({@link holdOutReserveNeed}). Deliberately NOT memoized:
    // it reads the NEIGHBOUR page, and a memo entry that must enumerate foreign inputs by
    // hand is how stale reserves happen; the scan starts from a memoized page-refs answer
    // and lays notes through the pass cache.
    const holdOutFor = (
      existingAreaHeight: number,
      ownReservePt: number,
      existingNoticeHeight = 0
    ): number =>
      anyPageBottomFootnoteRefs
        ? holdOutReserveNeed({
            bodyPage,
            nextPage,
            allowOrphanDeferral,
            existingAreaHeight,
            existingNoticeHeight,
            ownReservePt,
            usedReservePt,
            pageBottomRefsOf,
            footnotesPart: input.footnotesPart,
            opts: holdOutOpts,
            plainSeparatorHeight: separatorCache.get(
              input.footnotesPart,
              'separator',
              bodyPage.contentBox.width,
              'footnote',
              Math.max(0, bodyPage.contentBox.height),
              holdOutOpts,
              reasons
            ).flowHeight,
            noteLayoutCache,
          })
        : 0;
    if (pageBottomRefs.length === 0 && carry.size === 0) {
      // No per-page reservation for THIS page's refs — collected later. The hold-out
      // still runs: a ref-free page in a mixed-position document (or one whose only
      // reference was evicted) answers section 0 here, and skipping it would let the
      // next page's opening reference pull back and reopen the eviction orbit. The
      // hold-out filters pulled refs by their OWN section's position.
      recordReserve(page.index, holdOutFor(0, 0), maxArea);
      continue;
    }

    // An unchanged page whose own refs and marks match the previous pass, sized to the
    // same PAGE-LOCAL reserve; carry chains are the exception and rebuild. The
    // neighbour-reading hold-out is recomputed below either way.
    if (memo && carry.size === 0) {
      const cached = memo.pageReserve.get(page);
      if (
        cached &&
        cached.marks === noteMarks &&
        cached.allowOrphanDeferral === allowOrphanDeferral &&
        cached.nextOpening === continuedRowId(nextPage) &&
        cached.nextBox === contentBoxToken(nextPage) &&
        pageRefsEqual(fnRefs, cached.pageRefs)
      ) {
        for (const reason of cached.reasons) reasons.push(reason);
        const held = holdOutFor(cached.areaHeight, cached.reserve);
        recordReserve(page.index, Math.max(cached.reserve, held), maxArea);
        continue;
      }
    }

    // Column budget for the note stack (separator is added inside buildFootnoteArea).
    // Each reference keeps the body band down to ITS OWN line (Word starts a footnote on
    // the page that references it): a reserve that ignores the reference evicts its own
    // line to the next page, and the reflow loop then oscillates between the two
    // placements — reference pages with zero note height, later pages holding a
    // reservation nothing fills. Per reference and never the page's lowest one, whose
    // floor would stably strangle every note above it on a multi-reference page.
    const carryWasEmpty = carry.size === 0;
    const reasonsBefore = reasons.length;
    const { area, nextCarry, evictionTopPt, overRow, splitEndPt } = buildFootnoteArea(
      bodyPage,
      pageBottomRefs,
      input,
      noteMarks,
      props.pos,
      carry,
      reasons,
      {
        reserveColumnBudget: true,
        allowOrphanDeferral,
        reserveBandOf: (ref) => noteReferenceLineBandPt(bodyPage, ref, input.compatibilityMode),
        separatorCache,
        noteLayoutCache,
        evictionAllowed:
          !nextPage ||
          (nextPage.contentBox.width === bodyPage.contentBox.width &&
            nextPage.contentBox.height === bodyPage.contentBox.height),
        nextPage,
      }
    );
    carry = nextCarry;
    // An eviction reaches past the note stack to the unplaceable reference's own line, so
    // the body pass pushes that line — and the reference — to the next page. The eviction
    // guard admits only lines at or below the minimum body band, so the maxArea cap never
    // clips the eviction into not evicting. Backed off by half a point so the body budget
    // lands MID-line: edge-to-edge the previous line's bottom equals the budget exactly,
    // the body pass's strict compare flips on float drift, and an extra evicted line
    // rewraps the tail into geometry the next round cannot reproduce.
    const evictionNeed =
      evictionTopPt !== undefined
        ? Math.max(0, bodyPage.contentBox.height - evictionTopPt - RESERVE_BOUNDARY_BACKOFF_PT)
        : 0;
    // An area over a whole row past the bottom margin cannot gain room from the body.
    const areaHeight = overRow ? 0 : (area?.box.height ?? 0);
    // A note that starts here and splits ends the body at its reference: the reserve takes
    // every point below it, and the note fills that room.
    const splitNeed =
      splitEndPt !== undefined
        ? Math.max(0, bodyPage.contentBox.height - splitEndPt - RESERVE_BOUNDARY_BACKOFF_PT)
        : 0;
    const localNeeded = Math.min(Math.max(areaHeight, evictionNeed, splitNeed), maxArea);
    if (memo && carryWasEmpty && carry.size === 0) {
      memo.pageReserve.set(page, {
        allowOrphanDeferral,
        nextOpening: continuedRowId(nextPage),
        nextBox: contentBoxToken(nextPage),
        pageRefs: fnRefs,
        marks: noteMarks,
        reserve: localNeeded,
        areaHeight,
        reasons: reasons.slice(reasonsBefore),
      });
    }
    recordReserve(
      page.index,
      Math.max(
        localNeeded,
        holdOutFor(areaHeight, localNeeded, area?.continuationNotice?.box.height)
      ),
      maxArea
    );
  }

  // Stable only when the body has already left enough room for the measured reserve.
  // (Needed heights are no longer slack-clipped, so a full-body first pass is unstable.)
  let stable = true;
  carryBefore[end] = carry;
  for (const page of layout.pages.slice(range?.from ?? 0, end)) {
    const needed = reserves.get(page.index) ?? 0;
    if (needed <= 0) continue;
    const used = bodyFitBottomPt(page);
    if (used + needed > page.contentBox.height + 0.5) {
      stable = false;
      break;
    }
  }
  return { reserves, stable, reasons, orphanCandidates, orphanPages, carryBefore };
}

/**
 * Attach footnote/endnote areas onto a body layout. Does not re-paginate — callers that
 * need reservation must re-run body layout with {@link pageBottomReserves} first.
 */
export function attachNotesToLayout(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  options?: {
    readonly fallbackReasons?: readonly NotePaginationFallbackReason[];
    readonly paragraphSectionIndex?: ReadonlyMap<string, number>;
    /**
     * Session-carried notes memo, already validated against `allRefs` and `input`.
     * Opaque at this boundary; the shape is owned by this module.
     */
    readonly memo?: unknown;
    /**
     * The pages are a completed prefix of a pass, shown before it ends: attach page-bottom
     * footnotes only. Section- and document-end notes, continuation sheets and the final marks
     * wait for the whole document, or they would land at the end of the prefix.
     */
    readonly partial?: boolean;
  }
): NotesAttachResult {
  const memo = (options?.memo ?? null) as NotesPassMemo | null;
  const partial = options?.partial === true;
  const reasons: NotePaginationFallbackReason[] = [...(options?.fallbackReasons ?? [])];
  const paragraphSectionIndex = options?.paragraphSectionIndex ?? new Map<string, number>();
  const overflowBudget: NoteOverflowBudget = { remaining: MAX_NOTE_OVERFLOW_PAGES };
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();
  // An overflow sheet resolves the shell its OWN index gets, not the one it was cloned from.
  const mint = createOverflowSheetMinter(layout);

  // Build sites for mark derivation (page index from layout).
  const footnoteSites: NoteReferenceSite[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  for (const page of layout.pages) {
    for (const ref of filterRefsOnPage(page, allRefs, refIndex)) {
      const site: NoteReferenceSite = {
        noteId: ref.noteId,
        sectionIndex: ref.sectionIndex,
        pageIndex: page.index,
        customMarkFollows: ref.customMarkFollows,
      };
      if (ref.noteKind === 'footnote') footnoteSites.push(site);
      else endnoteSites.push(site);
    }
  }

  // FINAL marks reuse by identity: the sites fingerprint covers note ids, sections, page
  // assignment and custom-mark flags, so an equal fingerprint under a live memo (whose
  // lifetime already pins the input) means an identical context.
  const sitesFingerprint = memo
    ? [...footnoteSites, ...endnoteSites]
        .map(
          (site) =>
            `${site.noteId}|${site.sectionIndex}|${site.pageIndex ?? ''}|${site.customMarkFollows ? 1 : 0}`
        )
        .join(';')
    : '';
  let noteMarks: NoteMarkContext;
  if (memo && memo.finalMarks && memo.finalMarks.sitesFingerprint === sitesFingerprint) {
    noteMarks = memo.finalMarks.marks;
  } else {
    noteMarks = buildMarkContext(footnoteSites, endnoteSites, input);
    if (memo && !partial) memo.finalMarks = { sitesFingerprint, marks: noteMarks };
  }
  // Keyed on the FINAL mark context, whose identity the memo keeps while the sites
  // fingerprint stands, so unchanged notes reuse their story layouts across passes.
  const noteLayoutCache = noteStoryCacheFor(noteMarks);

  let carry: NoteCarryMap = new Map();
  const endnotesBySection = new Map<number, PageRefHit[]>();
  const endnotesDoc: PageRefHit[] = [];

  let pages: PageRecord[] = layout.pages.map((page) => {
    if (page.parityBlank) return page;
    const pageRefs = filterRefsOnPage(page, allRefs, refIndex);
    const fnRefs = pageRefs.filter((r) => r.noteKind === 'footnote');
    const enRefs = pageRefs.filter((r) => r.noteKind === 'endnote');

    for (const ref of enRefs) {
      const props = endnotePropsFor(input, ref.sectionIndex);
      if (props.pos === 'sectEnd') {
        const list = endnotesBySection.get(ref.sectionIndex) ?? [];
        list.push(ref);
        endnotesBySection.set(ref.sectionIndex, list);
      } else {
        endnotesDoc.push(ref);
      }
    }

    // Footnotes that collect at sect/doc end join the endnote-style collectors.
    for (const ref of fnRefs) {
      const props = footnotePropsFor(input, ref.sectionIndex);
      if (props.pos === 'sectEnd') {
        const list = endnotesBySection.get(ref.sectionIndex) ?? [];
        list.push(ref);
        endnotesBySection.set(ref.sectionIndex, list);
      } else if (props.pos === 'docEnd') {
        endnotesDoc.push(ref);
      }
    }

    // An unchanged page attaches to the same result as last pass when its OWN refs match
    // by content, the mark context is the previous pass's exact object, and no
    // continuation chains in or out of it. The endnote collectors above already ran, so
    // skipping the build here loses nothing.
    if (memo && carry.size === 0) {
      const cached = memo.pageAttach.get(page);
      if (cached && cached.marks === noteMarks && pageRefsEqual(fnRefs, cached.pageRefs)) {
        for (const reason of cached.reasons) reasons.push(reason);
        return cached.attached;
      }
    }

    const bodyPage = bodyOnlyPage(page);
    const pageBottomRefs = fnRefs.filter((ref) => {
      const pos = footnotePropsFor(input, ref.sectionIndex).pos;
      return pos === 'pageBottom' || pos === 'beneathText';
    });
    const sectionIndex = pageBottomRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    let footnotes: NoteAreaRecord | undefined;
    const carryWasEmpty = carry.size === 0;
    const reasonsBefore = reasons.length;
    if (
      pageBottomRefs.length > 0 ||
      carry.size > 0 ||
      (fnRefs.length === 0 && !collectsAtEnd(props.pos))
    ) {
      const built = buildFootnoteArea(
        bodyPage,
        pageBottomRefs,
        input,
        noteMarks,
        props.pos,
        carry,
        reasons,
        { separatorCache, noteLayoutCache }
      );
      footnotes = built.area;
      carry = built.nextCarry;
    }

    // Same rule one level up: a page with no footnote area and nothing to strip is the page
    // it came in as, and saying so is what lets the painter keep its DOM.
    const attached = footnotes ? { ...bodyPage, footnotes } : bodyPage;
    if (memo && carryWasEmpty && carry.size === 0) {
      const entry: NotesPageAttachEntry = {
        pageRefs: fnRefs,
        marks: noteMarks,
        attached,
        reserve: 0,
        reasons: reasons.slice(reasonsBefore),
      };
      // Both owners can return on the next pass: body layout can retain its input,
      // while a resumed session can retain the attached output. Keep both identities
      // so unchanged footnote pages do not invalidate downstream page caches.
      // The marks and reference checks above still guard each reuse.
      memo.pageAttach.set(page, entry);
      memo.pageAttach.set(attached, entry);
      if (attached !== page) {
        const reserveEntry = memo.pageReserve.get(page);
        if (reserveEntry) memo.pageReserve.set(attached, reserveEntry);
      }
    }
    return attached;
  });

  if (partial) {
    const shown = reprojectBodyNoteMarks({ ...layout, pages }, noteMarks);
    return { layout: shown, fallbackReasons: reasons, noteMarks };
  }
  const pageCountBeforeOverflow = pages.length;

  // Drain footnote continuations that outlive the final body page.
  //
  // BEFORE the section loop, because that is the document order: footnote continuation belongs
  // to the section's running content, and its `sectEnd` endnotes come after all of it. Moving
  // this after the loop put a last section's endnote sheets in front of its own continuation.
  //
  // The cost is that an earlier section's insertion slides these sheets along after they were
  // minted, so the shell each resolved no longer describes where it sits. `resettleMintedSheets`
  // below re-resolves them once every insertion is done.
  if (carry.size > 0) {
    const drained = drainFootnoteCarryPages(
      pages,
      carry,
      input,
      noteMarks,
      reasons,
      overflowBudget,
      separatorCache,
      noteLayoutCache,
      mint
    );
    pages = drained.pages;
    carry = drained.carry;
  }

  // Place sectEnd notes on the true last page of each section (body fragment ownership),
  // inserting overflow sheets before the next section rather than advancing into it.
  if (endnotesBySection.size > 0 && pages.length > 0) {
    // Process sections in ascending order so later stopBefore indexes stay valid as we insert.
    const sectionIndexes = [...endnotesBySection.keys()].sort((a, b) => a - b);
    for (const sectionIndex of sectionIndexes) {
      const refs = endnotesBySection.get(sectionIndex)!;
      const lastIdx = lastPageIndexForSection(pages, sectionIndex, paragraphSectionIndex);
      const stopBefore = sectionEndInsertBound(pages, sectionIndex, paragraphSectionIndex);
      let sectionStart = lastIdx;
      for (let i = 0; i <= lastIdx; i += 1) {
        if (pageBodySectionIndexes(pages[i]!, paragraphSectionIndex).includes(sectionIndex)) {
          sectionStart = i;
          break;
        }
      }
      pages = placeEndnotesFromPage(
        pages,
        lastIdx,
        refs,
        input,
        noteMarks,
        'sectEnd',
        reasons,
        overflowBudget,
        {
          stopBeforeIndex: stopBefore,
          sectionStartIndex: sectionStart,
          separatorCache,
          noteLayoutCache,
          mint,
        }
      );
    }
  }

  if (endnotesDoc.length > 0 && pages.length > 0) {
    // Start on the last eligible host (body / endnote overflow), never the final
    // footnote-drain sheet — room above footnotes on the last body page is fair game.
    pages = placeEndnotesFromPage(
      pages,
      lastEndnoteHostIndex(pages),
      endnotesDoc,
      input,
      noteMarks,
      'docEnd',
      reasons,
      overflowBudget,
      { separatorCache, noteLayoutCache, mint }
    );
  }

  if (pages.length !== pageCountBeforeOverflow) {
    const numbersBefore = bodyPageNumbers(pages);
    // Inserted sheets move the sections after them: decide their parity sheets again first.
    pages = [...resettleParitySheets(pages, layout)];
    // Every insertion is done, so a minted sheet's array position is the page index it keeps.
    pages = resettleMintedSheets(pages, layout);
    pages = resettleBodyFurniture(pages, numbersBefore, layout);
    pages = reindexAndFinalizeFields(pages, layout.revision);
  }

  // Body was laid with provisional marks; publish page-aware citation digits without reflow.
  const withBodyMarks = reprojectBodyNoteMarks({ ...layout, pages }, noteMarks);

  return {
    layout: withBodyMarks,
    fallbackReasons: reasons,
    noteMarks,
  };
}

// Reserve-map algebra (context key, compact/equal/grow/fingerprint) lives in
// note-reserves.ts; the context key re-exports below so existing import sites hold.

/**
 * Notes path: provisional marks → body layout → page-by-page reserve search → attach.
 * `runBodySteps` is the coordinator's body layout pass (single- or multi-section), and
 * `blocks` are the body blocks it lays out.
 *
 * The reserves come from {@link searchFootnoteReserves}, which decides them one page at a
 * time, so a pass after an edit publishes the same pages as a fresh layout of the same
 * document. Each body run reports the pages it has completed, with their footnote areas, so an
 * edit can show the pages on screen before the search ends.
 */
export function* layoutSemanticDocumentWithNotesSteps<Opts extends NotesBodyOptions>(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  optionsWithLists: Opts,
  notesInput: NotesLayoutInput,
  runBodySteps: (opts: Opts) => LayoutSteps<SemanticLayout>,
  blocks: readonly OoxmlNode[] = []
): LayoutSteps<SemanticLayout> {
  const displayMode =
    (optionsWithLists as { displayMode?: RevisionDisplayMode }).displayMode ??
    DEFAULT_REVISION_DISPLAY_MODE;
  const authorFilter = (optionsWithLists as { revisionAuthorFilter?: RevisionAuthorFilter })
    .revisionAuthorFilter;
  const packageRefs = collectBodyNoteReferences(part, displayMode, authorFilter);
  if (packageRefs.length === 0) {
    if (optionsWithLists.session) {
      optionsWithLists.session.notes = null;
      optionsWithLists.session.notePageBottomReserves = null;
    }
    return yield* runBodySteps({
      ...optionsWithLists,
      noteMarks: undefined,
      pageBottomReserves: undefined,
    });
  }
  const paragraphSectionIndex = paragraphSectionIndexOf(
    part,
    sections,
    displayMode,
    authorFilter,
    optionsWithLists.session,
    optionsWithLists.styleCascade,
    optionsWithLists.numberingIndex
  );
  const builtHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
  // The session memo hands back the previous pass's hit array by identity when nothing
  // moved, and KEEPS its mark contexts when only offsets moved (a keystroke in a
  // referencing paragraph). Per-page results below validate on the marks identity plus a
  // content compare of the page's own refs — never on the hit array's identity, which is
  // fresh whenever any offset moved.
  const notesMemoState = notesMemoFor(optionsWithLists.session, builtHits, notesInput);
  const notesMemo = notesMemoState.memo;
  const allHits = notesMemoState.allHits;
  const noteMarks = notesMemo?.provisionalMarks ?? provisionalNoteMarks(allHits, notesInput);
  // Set when a newer edit replaces this pass: the search stops after its current round.
  let wrappedUp = false;
  const bodySteps = (opts: Opts): LayoutSteps<SemanticLayout> =>
    withNoteAreasOnProgress(
      runBodySteps(opts),
      (layout) =>
        attachNotesToLayout(layout, allHits, notesInput, {
          fallbackReasons: [],
          paragraphSectionIndex,
          memo: notesMemo,
          partial: true,
        }).layout,
      () => {
        wrappedUp = true;
      }
    );
  const session = optionsWithLists.session as LayoutSession | undefined;
  // The rounds of this walk share it; see `SemanticLayoutOptions.noteRoundContext`.
  const noteRoundContext = {};
  const search = yield* searchFootnoteReserves({
    session,
    state: (notesMemo?.walk ?? null) as ReserveSearchState | null,
    part,
    blocks,
    inputs: {
      footnotesPart: notesInput.footnotesPart,
      others: [
        notesMemo?.inputFingerprint,
        notesInput.endnotesPart,
        notesInput.styleCascade,
        notesInput.numberingIndex,
        displayMode,
        authorFilter,
      ],
    },
    limit: (optionsWithLists as { bodyBlockLimit?: number }).bodyBlockLimit ?? -1,
    sectionEnds: sections.map((section) => section.blockEndExclusive),
    parityStarts: sections.some(
      ({ properties }) => properties.breakType === 'oddPage' || properties.breakType === 'evenPage'
    ),
    citingParagraphs: (noteId) =>
      allHits.flatMap((hit) =>
        hit.noteKind === 'footnote' && hit.noteId === noteId ? [hit.paragraphId] : []
      ),
    body: (reserves, blockLimit, follow) =>
      bodySteps({
        ...optionsWithLists,
        noteMarks,
        pageBottomReserves: reserves,
        ...(follow
          ? { pageBottomReservesFromPreviousPass: true, pageBottomReservesFollowFlow: true }
          : {}),
        // A round cut short knows only the blocks it lays out: a cache sweep from it would
        // drop the entries of every block after the cut, which the next rounds lay out again.
        ...(blockLimit !== undefined
          ? { noteRoundBlockLimit: blockLimit, retainKeys: false, noteRoundContext }
          : {}),
      }),
    followedReserves: (given) => {
      const moved = takeMovedSeedReserves(session);
      const laid = compactFootnoteReserves(moved ?? given);
      const read = takeReadReserves(session);
      return read ? compactFootnoteReserves(withReadReserves(laid, read)) : laid;
    },
    compute: (layout, used, deferral, range) =>
      computeFootnoteReservesWithPolicy(
        layout,
        allHits,
        notesInput,
        noteMarks,
        notesMemo,
        used,
        deferral,
        range
      ),
    carryKey: (carry) => noteCarryKey(carry as NoteCarryMap),
    stopped: () => wrappedUp,
  });
  const bodyLayout = search.layout;
  const usedReserves = search.reserves;
  if (notesMemo) notesMemo.walk = search.state;
  const fallbackReasons: NotePaginationFallbackReason[] = [
    ...computeFootnoteReservesWithPolicy(
      bodyLayout,
      allHits,
      notesInput,
      noteMarks,
      notesMemo,
      usedReserves,
      false
    ).reasons,
  ];
  if (search.exhausted) fallbackReasons.push('note-reflow-exhausted');

  noteBodyGeometryChanged(optionsWithLists.session, bodyLayout, part);
  const attached = attachNotesToLayout(bodyLayout, allHits, notesInput, {
    fallbackReasons,
    paragraphSectionIndex,
    memo: notesMemo,
  });
  if (optionsWithLists.session) {
    optionsWithLists.session.previous = attached.layout;
    optionsWithLists.session.notePageBottomReserves = compactFootnoteReserves(usedReserves);
    // A body runner without notes clears the memo; the published layout is this pass's.
    if (notesMemo) optionsWithLists.session.notes = notesMemo;
  }
  return attached.layout;
}

/**
 * Build a continuous (pre-page) mark context for the first body layout pass.
 * eachPage reserves digit width; {@link reprojectBodyNoteMarks} publishes final marks
 * onto body citations after page assignment in {@link attachNotesToLayout}.
 */
export function provisionalNoteMarks(
  refs: readonly PageRefHit[],
  input: NotesLayoutInput
): NoteMarkContext {
  const footnoteSites: NoteReferenceSite[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  for (const ref of refs) {
    const site: NoteReferenceSite = {
      noteId: ref.noteId,
      sectionIndex: ref.sectionIndex,
      customMarkFollows: ref.customMarkFollows,
    };
    if (ref.noteKind === 'footnote') footnoteSites.push(site);
    else endnoteSites.push(site);
  }
  return buildMarkContext(footnoteSites, endnoteSites, input);
}

export { inheritNotesLayoutInput } from './note-layout-input.ts';

export {
  resolveFootnoteProperties,
  resolveEndnoteProperties,
  formatNoteScopeId,
  noteReferenceKindOf,
  noteIdOf,
  customMarkFollows,
  noteDisplayMarkMap,
};
