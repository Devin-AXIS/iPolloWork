// REF cross-reference fields (§17.16.5.45): live results from the bookmark target and the
// resolved numbering, so a reference tracks its section instead of painting a stale cache.
//
// The instruction is attacker-controlled and NEVER executes. Recognition is one bounded,
// quote-aware tokenize pass over a length-capped string; anything outside the supported
// grammar — an unknown switch (`\p`, `\f`, `\d`, `\#`, …), a missing bookmark argument, an
// over-long name — resolves to null and the field keeps painting its cached result exactly as
// before. `\* MERGEFORMAT` is inert; `\h` only parses (navigation is not wired here). `\t`
// suppresses the number's literal text (the template filter in `list-counters.ts` states the
// delimiter rule). The same tokenizer also recognizes `NOTEREF <bookmark> [\h]` — the number
// of the note whose reference mark sits inside the bookmark, resolved by `field-noteref.ts`
// through the painter's own numbering; its `\p` / `\f` switches stay out of the grammar on
// purpose, so such fields keep their cache.
//
// Resolution reads three story-derived inputs, all bounded:
//   - bookmark name → target paragraph, indexed ONLY for referenced names (the index can never
//     outgrow the capped reference count), first declaration in document order wins;
//   - `\r` / `\w` → the target's number in FULL CONTEXT, composed from the counter path by
//     `composeFullContextNumber` — a deep legal level like `(%3)` states only its own
//     placeholder, so its marker (`(c)`) is not the number a reader cites; `\n` → the
//     target's OWN level expansion (`(c)`, `(ii)`), which is what Word's cached values show
//     for that switch;
//   - a plain REF → the bookmarked text inside the target paragraph, length-capped.
//
// CALIBRATION — the document's own cached results are the oracle. Word's full-context join is
// scheme-dependent in ways the composition cannot reproduce across every real numbering shape
// (a mixed ordinalText/letter/decimal chain whose level texts never chain concatenates every
// ancestor into garbage). So each field is gated ONCE: when its authored cache is non-empty,
// the computed value must reproduce it (whitespace-collapsed, NBSP = space) or the field stays
// on its cache permanently. The verdict is sticky per field and cache — keyed by the begin /
// `w:fldSimple` node id, which survives edits, and the cached text, which only a result write
// changes — and carried across passes on the story's first/last block —
// because after a renumbering edit the live value DIVERGES from the cache by design, and
// re-comparing would flip every calibrated field back to stale. A field with an empty cache
// has nothing to regress against and stays eligible. Net: live updating everywhere composition
// is provably right, and no document ever renders worse than its cache.
//
// DEVIATION: `\r` (relative context) paints the full-context number. Deriving Word's relative
// form would need the referencing paragraph's own list position and is out of scope. All three
// number switches share Word's trailing-period trim (`1.2` stays `1.2`, a bare `1.` becomes
// `1`). When one instruction states several number switches, `\n` outranks `\r` outranks `\w`
// — the cached evidence for `\w \n` instructions shows the `\n`-shaped value — and calibration
// guards the rest.
//
// DEVIATION: plain-REF extraction stays inside the target paragraph. A bookmark whose end
// marker sits outside that paragraph contributes the start paragraph's tail only — the cap
// that keeps a hostile range from inflating layout keys and painted spans.
//
// Every per-paragraph scan is memoized on the immutable paragraph node and every per-block
// aggregate on the block node, so an incremental pass pays pointer lookups for unchanged
// content. `resolveStoryRefFields` returns null for the common no-REF story, which costs
// callers nothing downstream.

import { visibleHyphenText } from '../store/package/hyphen-text.ts';
import {
  flattenContentControls,
  fldSimpleInstr,
  isFldSimple,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  bookmarkRangeText,
  fldSimpleCachedText,
  isDrawingHost,
  MAX_REF_TEXT_CHARS,
  wmlAttribute,
} from './field-ref-text.ts';
import {
  MAX_REF_BOOKMARK_NAME_CHARS,
  parseRefInstruction,
  refSpecModifiersOf,
  type RefFieldSpec,
} from './field-ref-parse.ts';

// Re-exported so every existing importer keeps its one `field-ref.ts` import site.
export { parseRefInstruction, type RefFieldSpec } from './field-ref-parse.ts';
import { isNormalNote, notesOf, MAX_NOTES_PER_PART } from '../store/package/note-nodes.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import { noteStoryBlocks } from './story-roots.ts';
import {
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  effectiveFieldInstruction,
  ingestInstrTextBounded,
  isFldChar,
  isInstrText,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
} from './field-instruction.ts';
import {
  firstNoteReferenceIdInBookmark,
  noteRefMarkIndex,
  type NoteRefNumberingInput,
} from './field-noteref.ts';
import {
  autonumDisplayText,
  parseAutonumInstruction,
  type AutonumFieldKind,
  type AutonumFieldSpec,
} from './field-autonum.ts';
import { composeFullContextNumber } from './list-counters.ts';
import { framedTokenJoin } from './layout-cache.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  NO_REVISIONS,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { cacheProjection } from './bounded-projection-cache.ts';
import { storyRowParagraphs } from './story-paragraph-walk.ts';
import {
  listItemNumberSource,
  walkStoryParagraphs,
  type ResolvedListItem,
} from './list-resolve.ts';
import { listNumValuesOf } from './list-resolve-listnum.ts';

/** Ceiling on live-resolved REF fields per story; fields past it keep their cached results. */
const MAX_REF_FIELDS_PER_STORY = 512;
/** Ceiling on bookmark names remembered per top-level block (hostile declaration spam). */
const MAX_REF_BOOKMARKS_PER_BLOCK = 2048;
/** Ceiling on sticky calibration verdicts carried for one story across a session. */
const MAX_REF_VERDICTS = 4096;

/**
 * The story's resolved REF inputs for one layout pass.
 *
 * Threaded as a runtime rider on the layout options (see `layoutSemanticDocument`) rather
 * than a `SemanticLayoutOptions` member, so the public options surface stays put. Absent
 * means every REF field paints its cached result — the pre-existing degradation, and the one
 * header/footer and text-box stories still take. Note stories receive the body's context
 * through `NotesLayoutInput.refFields`.
 */
export interface RefFieldContext {
  /**
   * Content token over each paragraph ID and its PAINTED REF outputs in the story, for the
   * section prepass memo. IDs keep structural edits from moving an identical sequence of
   * outputs between paragraphs while the aggregate falsely reports unchanged dependencies.
   * A renumbering edit can move a REF value in a section whose own blocks and list map are
   * identity-unchanged, and this token is the only validator that sees it. A field that
   * failed calibration contributes its (session-constant) cached text, so the token still
   * moves when painted output or its owning paragraph changes.
   */
  readonly valuesToken: string;
  /** The paragraph's REF outputs folded for its block cache key; `''` when it holds none. */
  tokenForParagraph(paragraphId: string): string;
  /**
   * The live value ONE field paints, keyed by its begin / `w:fldSimple` node id, or null to
   * keep the cached result (failed calibration, unresolvable, or an anchor this scan never
   * saw). Anchor-keyed so the projection's paint and this context's token fold read the SAME
   * calibration verdict, however each walk collected the field's cached text.
   */
  liveValueOf(anchorId: string, spec: RefFieldSpec): string | null;
  /**
   * The synthesized display of ONE AUTONUM-family field, keyed by its begin / `w:fldSimple`
   * node id, or null to paint nothing (unsupported switches, or an anchor this scan never
   * saw — both the field's historical rendering). These fields carry no cached result at
   * all, so there is no calibration: the sequential value is the only display they have.
   * Optional so hand-built contexts predating it stay valid.
   */
  autonumValueOf?(anchorId: string): string | null;
  /**
   * The deferred projection of ONE `PAGEREF` field, or null to keep the cached result
   * (missing bookmark, unsupported switches, or an anchor this scan never saw).
   *
   * A `PAGEREF` value is a property of pagination, so the scan cannot compute it — it hands
   * the projection the resolved TARGET and the calibration inputs instead, and document
   * finalize (`finalizePageFieldProjection`) substitutes the page number the target's first
   * fragment lands on. Optional so hand-built contexts predating it stay valid.
   */
  pageRefProjectionOf?(anchorId: string, spec: RefFieldSpec): PageRefFieldProjection | null;
}

/**
 * Sticky calibration identity for one `PAGEREF` field.
 *
 * An opaque frozen object rather than a mutable verdict holder because span markers are
 * serialized into fragment signatures — a verdict written into the marker would move a
 * signature that no painted output moved. The verdict itself lives beside the finalize pass
 * (`field-page-furniture.ts`), keyed weakly on this object; the registry below carries the
 * object across passes the same way REF verdicts are carried.
 */
export type PageRefCalibrationCell = Readonly<Record<never, never>>;

/**
 * What a `PAGEREF` span carries to document finalize: the resolved target, the normalized
 * authored cache (the calibration oracle), and the sticky calibration identity.
 */
export interface PageRefFieldProjection {
  /** Canonical id of the paragraph the bookmark names — first declaration wins. */
  readonly targetParagraphId: string;
  /** The authored cached result, whitespace-collapsed — what the computed number must reproduce. */
  readonly cached: string;
  readonly calibration: PageRefCalibrationCell;
}

/** One scanned REF or AUTONUM-family field: instruction, anchor node id, NORMALIZED cache. */
interface ScannedRefField {
  /** The recognized REF/NOTEREF instruction, or null when {@link autonum} answers instead. */
  readonly spec: RefFieldSpec | null;
  /** The recognized AUTONUM-family instruction; such fields have no cache and no bookmark. */
  readonly autonum: AutonumFieldSpec | null;
  /** Begin `w:fldChar` / `w:fldSimple` node id — stable across edits, the calibration key. */
  readonly anchorId: string;
  /** The authored cached result, whitespace-collapsed (NBSP = space) — the oracle. */
  readonly cached: string;
  /**
   * The revision wrappers enclosing the field's begin marker, outermost first.
   *
   * Recorded raw (the scan is memoized per paragraph node, shared across display modes) and
   * resolved against the mode in the AUTONUM prepass: a `w:del`-wrapped field does not exist
   * in the proposed view, so it must not advance the counter there — Word after accepting
   * the deletion renumbers the survivors.
   */
  readonly revisions: readonly RevisionAttribution[];
}

/** REF fields and bookmark names one paragraph carries; shared empty for the common case. */
interface ParagraphRefScan {
  readonly fields: readonly ScannedRefField[];
  readonly bookmarks: readonly string[];
}
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_FIELDS: readonly ScannedRefField[] = Object.freeze([]);
const EMPTY_REF_SCAN: ParagraphRefScan = Object.freeze({
  fields: EMPTY_FIELDS,
  bookmarks: EMPTY_STRINGS,
});

/** The calibration comparison's vocabulary: collapsed whitespace, NBSP as space, trimmed. */
function normalizeResultText(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Memoized per immutable paragraph node — an edit republishes only touched paragraphs. */
const paragraphRefScans = new WeakMap<OoxmlElement, ParagraphRefScan>();

/**
 * Bounded scan of one paragraph: level-1 complex REF fields (the only ones projection
 * live-paints) with their anchor ids and cached results, `w:fldSimple` REF fields, and
 * declared bookmark names.
 *
 * Mirrors the projection walk's capture sites — the outermost `separate`, the no-separate
 * outermost `end` — so this is a superset of what synthesis will ask to resolve; a field seen
 * here and never painted only widens a cache token, which can cost a re-measure but never
 * leave one stale. An anchor the scan misses paints its cache (`liveValueOf` answers null).
 */
function scanParagraphRefs(paragraph: OoxmlElement): ParagraphRefScan {
  const memo = paragraphRefScans.get(paragraph);
  if (memo) return memo;
  let fields: ScannedRefField[] | null = null;
  let bookmarks: string[] | null = null;
  const budget = createScanBudget();
  const field = createFieldParseState();

  /** The open level-1 REF / AUTONUM field being collected, if its instruction parsed. */
  let pending: {
    spec: RefFieldSpec | null;
    autonum: AutonumFieldSpec | null;
    anchorId: string;
    cached: string;
    revisions: readonly RevisionAttribution[];
  } | null = null;
  let levelOneBeginId: string | null = null;
  /** The revision wrappers the walk is currently inside — captured at the field's begin. */
  let revisions: readonly RevisionAttribution[] = NO_REVISIONS;
  /** The stack at the level-1 begin, so the capture at separate/end reads the field's own. */
  let levelOneRevisions: readonly RevisionAttribution[] = NO_REVISIONS;

  const captureLevelOne = (): void => {
    if (field.nesting !== 1 || field.phase !== 'instruction' || field.nestingOverflow) return;
    const effective = effectiveFieldInstruction(field);
    if (effective.overflow || levelOneBeginId === null) return;
    const spec = parseRefInstruction(effective.instruction);
    if (spec) {
      pending = {
        spec,
        autonum: null,
        anchorId: levelOneBeginId,
        cached: '',
        revisions: levelOneRevisions,
      };
      return;
    }
    // AUTONUM-family fields ride the same scan: begin/instrText/end with NO separator and no
    // cached result, so this capture (which fires at the outermost end too) is the one place
    // that sees them.
    const autonum = parseAutonumInstruction(effective.instruction);
    if (autonum) {
      pending = {
        spec: null,
        autonum,
        anchorId: levelOneBeginId,
        cached: '',
        revisions: levelOneRevisions,
      };
    }
  };
  const finalizePending = (): void => {
    if (!pending) return;
    (fields ??= []).push({
      spec: pending.spec,
      autonum: pending.autonum,
      anchorId: pending.anchorId,
      cached: normalizeResultText(pending.cached),
      revisions: pending.revisions,
    });
    pending = null;
  };

  const visit = (node: OoxmlNode, depth: number, containerDepth: number): void => {
    if (node.kind === 'textValue') return;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'bookmarkStart') {
      const name = wmlAttribute(node, 'name');
      if (name !== undefined && name.length > 0 && name.length <= MAX_REF_BOOKMARK_NAME_CHARS) {
        (bookmarks ??= []).push(name);
      }
      return;
    }
    if (node.kind === 'run') {
      for (const grand of node.children) {
        if (!consumeScanNode(budget)) return;
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin')) {
          onFldCharBegin(field);
          if (field.nesting === 1) {
            levelOneBeginId = grand.id;
            levelOneRevisions = revisions;
            pending = null;
          }
          continue;
        }
        if (isInstrText(grand)) {
          ingestInstrTextBounded(field, grand, budget, depth + 1);
          continue;
        }
        if (isFldChar(grand, 'separate')) {
          captureLevelOne();
          onFldCharSeparate(field);
          continue;
        }
        if (isFldChar(grand, 'end')) {
          const outermost = field.nesting === 1;
          captureLevelOne();
          onFldCharEnd(field);
          if (outermost) finalizePending();
          continue;
        }
        // Level-1 result text is the field's authored cache — the calibration oracle. Nested
        // fields sit at deeper nesting and never join it; deleted text never joins a result.
        if (pending && field.nesting === 1 && field.phase === 'result') {
          if (grand.kind === 'text') {
            for (const value of grand.children) {
              if (value.kind === 'textValue' && pending.cached.length < MAX_REF_TEXT_CHARS) {
                pending.cached += value.value.slice(0, MAX_REF_TEXT_CHARS - pending.cached.length);
              }
            }
          } else if (grand.kind === 'tab' && pending.cached.length < MAX_REF_TEXT_CHARS) {
            pending.cached += ' ';
          } else if (pending.cached.length < MAX_REF_TEXT_CHARS) {
            // A hyphen joins the cache exactly when the text around it does: never in a real
            // deletion, and never beside `w:delText`, which the cache leaves out.
            const hyphen = visibleHyphenText(grand);
            if (
              hyphen &&
              !revisions.some((revision) => revision.kind === 'delete') &&
              !node.children.some((sibling) => sibling.kind === 'deletedText')
            ) {
              pending.cached += hyphen;
            }
          }
        }
      }
      return;
    }
    if (isFldSimple(node)) {
      // The outer instruction only: a field nested in a simple field's cached result is never
      // live-projected as a REF, so descending would key on values nothing paints.
      const instr = fldSimpleInstr(node) ?? '';
      const spec = parseRefInstruction(instr);
      const autonum = spec === null ? parseAutonumInstruction(instr) : null;
      if (spec || autonum) {
        (fields ??= []).push({
          spec,
          autonum,
          anchorId: node.id,
          cached: normalizeResultText(fldSimpleCachedText(node, budget)),
          revisions,
        });
      }
      return;
    }
    if (isDrawingHost(node)) return;
    if (!consumeScanNode(budget)) return;
    // A revision wrapper decides whether its fields EXIST in a display mode, so the stack
    // rides the descent — the AUTONUM prepass reads it to keep a deleted field from
    // advancing the counter in the view that resolved the deletion away.
    if (isRevisionWrapper(node)) {
      const attribution = revisionAttributionOf(node);
      if (attribution) {
        const enclosing = revisions;
        revisions = withRevision(enclosing, attribution);
        const nextDepth = nextInlineContainerDepth(node, containerDepth);
        for (const child of node.children) visit(child, depth + 1, nextDepth);
        revisions = enclosing;
        return;
      }
    }
    const nextDepth = nextInlineContainerDepth(node, containerDepth);
    for (const child of node.children) visit(child, depth + 1, nextDepth);
  };
  for (const child of paragraph.children) {
    if (!consumeScanNode(budget)) break;
    visit(child, 1, 0);
  }

  const scan: ParagraphRefScan =
    fields === null && bookmarks === null
      ? EMPTY_REF_SCAN
      : Object.freeze({ fields: fields ?? EMPTY_FIELDS, bookmarks: bookmarks ?? EMPTY_STRINGS });
  paragraphRefScans.set(paragraph, scan);
  return scan;
}

/** One top-level block's aggregate, memoized on the block node (tables included). */
interface BlockRefScan {
  readonly fieldsByParagraph: ReadonlyMap<string, readonly ScannedRefField[]> | null;
  readonly bookmarkOwners: ReadonlyMap<string, OoxmlElement> | null;
}
const EMPTY_BLOCK_SCAN: BlockRefScan = Object.freeze({
  fieldsByParagraph: null,
  bookmarkOwners: null,
});
const blockRefScans = new WeakMap<OoxmlElement, BlockRefScan>();

function scanBlockRefs(block: OoxmlElement): BlockRefScan {
  const cached = blockRefScans.get(block);
  if (cached) return cached;
  let fieldsByParagraph: Map<string, readonly ScannedRefField[]> | null = null;
  let bookmarkOwners: Map<string, OoxmlElement> | null = null;
  for (const paragraph of walkStoryParagraphs([block])) {
    const scan = scanParagraphRefs(paragraph);
    if (scan.fields.length > 0) (fieldsByParagraph ??= new Map()).set(paragraph.id, scan.fields);
    for (const name of scan.bookmarks) {
      bookmarkOwners ??= new Map();
      // First declaration wins, the same rule the jump-target index applies: a duplicate name
      // must not make a reference move when an unrelated edit re-declares it later.
      if (!bookmarkOwners.has(name) && bookmarkOwners.size < MAX_REF_BOOKMARKS_PER_BLOCK) {
        bookmarkOwners.set(name, paragraph);
      }
    }
  }
  const scan: BlockRefScan =
    fieldsByParagraph === null && bookmarkOwners === null
      ? EMPTY_BLOCK_SCAN
      : Object.freeze({ fieldsByParagraph, bookmarkOwners });
  blockRefScans.set(block, scan);
  return scan;
}

/**
 * Sticky calibration verdicts for one story, keyed by field anchor id.
 *
 * Carried across passes on the story's FIRST or LAST block object — the same anchor idiom the
 * list resolver's story memo uses — because a keystroke republishes the blocks array while
 * usually keeping both ends. Losing the registry (both ends replaced in one commit) only
 * re-calibrates: a live field whose value has already diverged from its cache falls back to
 * that cache, which is the safe direction. Bounded; entries past the cap re-calibrate too.
 */
const refVerdictsByAnchorBlock = new WeakMap<OoxmlElement, Map<string, boolean>>();

function carriedVerdicts(blocks: readonly OoxmlElement[]): Map<string, boolean> {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const carried =
    (first ? refVerdictsByAnchorBlock.get(first) : undefined) ??
    (last ? refVerdictsByAnchorBlock.get(last) : undefined) ??
    new Map<string, boolean>();
  if (first) refVerdictsByAnchorBlock.set(first, carried);
  if (last) refVerdictsByAnchorBlock.set(last, carried);
  return carried;
}

/**
 * PAGEREF calibration cells for one story, keyed by field anchor id — the same carry idiom
 * as {@link refVerdictsByAnchorBlock}, and bounded the same way. The cell must survive the
 * pass, not the verdict: finalize compares the computed page number against the cache the
 * first time it meets a cell, and keying that verdict on a per-pass object would re-calibrate
 * after every keystroke — flipping every live TOC number back to its stale cache.
 */
const pageRefCellsByAnchorBlock = new WeakMap<OoxmlElement, Map<string, PageRefCalibrationCell>>();

function carriedPageRefCells(blocks: readonly OoxmlElement[]): Map<string, PageRefCalibrationCell> {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const carried =
    (first ? pageRefCellsByAnchorBlock.get(first) : undefined) ??
    (last ? pageRefCellsByAnchorBlock.get(last) : undefined) ??
    new Map<string, PageRefCalibrationCell>();
  if (first) pageRefCellsByAnchorBlock.set(first, carried);
  if (last) pageRefCellsByAnchorBlock.set(last, carried);
  return carried;
}

/** Word trims one trailing period off a referenced number: `1.` → `1`, `1.2` stays `1.2`. */
function trimTrailingPeriod(marker: string): string {
  return marker.length > 1 && marker.endsWith('.') ? marker.slice(0, -1) : marker;
}

/**
 * Note parts whose stories join the context: their REF fields resolve against the body's
 * bookmarks and numbering (a footnote citing "Section 1.2(c)" targets a body paragraph),
 * and their bookmark declarations become plain-REF targets. Number switches aimed AT a
 * note paragraph still fall back to the cached result — the list map is the body's.
 */
export interface RefNoteParts {
  readonly footnotesPart: OoxmlPart | null;
  readonly endnotesPart: OoxmlPart | null;
}

/** Normal-note story block arrays of one notes part, memoized on the immutable part. */
const notePartStories = new WeakMap<OoxmlPart, Map<string, readonly (readonly OoxmlElement[])[]>>();

/**
 * Normal-note stories of one notes part, in part order. Exported for the save-time refresh
 * planner: walking the SAME story arrays this context scanned keeps its anchor ids and the
 * planner's located fields aligned by construction.
 */
export function noteStoriesOfPart(
  part: OoxmlPart | null,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  authorFilter?: RevisionAuthorFilter
): readonly (readonly OoxmlElement[])[] {
  if (!part) return [];
  const key = `${displayMode}|${authorFilter?.cacheKey ?? ''}`;
  const perProjection = notePartStories.get(part);
  const cached = perProjection?.get(key);
  if (cached) return cached;
  const stories: (readonly OoxmlElement[])[] = [];
  for (const note of notesOf(part.root)) {
    if (stories.length >= MAX_NOTES_PER_PART) break;
    if (!isNormalNote(note)) continue;
    const blocks = noteStoryBlocks(note, displayMode, authorFilter);
    if (blocks.length > 0) stories.push(blocks);
  }
  if (perProjection) cacheProjection(perProjection, key, stories);
  else notePartStories.set(part, new Map([[key, stories]]));
  return stories;
}

interface RefContextMemoEntry {
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
  readonly footnotesPart: OoxmlPart | null;
  readonly endnotesPart: OoxmlPart | null;
  readonly noteNumbering: NoteRefNumberingInput | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilterKey: string;
  readonly context: RefFieldContext | null;
}
/**
 * Memo keyed on the story blocks array (stable per part and display mode via `storyBlocks`)
 * and validated against the list map by identity — the two inputs every resolved value
 * derives from. A keystroke publishes a new part, so a miss re-aggregates, but the per-block
 * memos above make that pointer lookups over unchanged blocks.
 */
const refContextMemos = new WeakMap<readonly OoxmlElement[], RefContextMemoEntry>();

function buildRefFieldContext(
  blocks: readonly OoxmlElement[],
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  notes: RefNoteParts | undefined,
  noteNumbering: NoteRefNumberingInput | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): RefFieldContext | null {
  const fieldsByParagraph = new Map<string, readonly ScannedRefField[]>();
  const blockScans: BlockRefScan[] = [];
  let totalFields = 0;
  const scanStory = (storyBlocks: readonly OoxmlElement[]): void => {
    for (const block of storyBlocks) {
      const scan = scanBlockRefs(block);
      blockScans.push(scan);
      if (!scan.fieldsByParagraph) continue;
      for (const [paragraphId, fields] of scan.fieldsByParagraph) {
        if (totalFields >= MAX_REF_FIELDS_PER_STORY) break;
        fieldsByParagraph.set(paragraphId, fields);
        totalFields += fields.length;
      }
    }
  };
  scanStory(blocks);
  // Note stories join AFTER the body, so the shared cap and the first-declaration rule
  // both prefer body content — the story a reference overwhelmingly lives in and targets.
  if (notes) {
    for (const story of noteStoriesOfPart(notes.footnotesPart, displayMode, authorFilter)) {
      scanStory(story);
    }
    for (const story of noteStoriesOfPart(notes.endnotesPart, displayMode, authorFilter)) {
      scanStory(story);
    }
  }
  const listNum = listNumValuesOf(listItems);
  if (fieldsByParagraph.size === 0 && !listNum) return null;

  // Index only referenced names, so the map is bounded by the capped reference count. A Map,
  // never an object: bookmark names are attacker-chosen keys.
  const referenced = new Set<string>();
  for (const fields of fieldsByParagraph.values()) {
    for (const field of fields) {
      if (field.spec) referenced.add(field.spec.bookmark);
    }
  }
  const targets = new Map<string, OoxmlElement>();
  for (const scan of blockScans) {
    if (!scan.bookmarkOwners) continue;
    for (const [name, paragraph] of scan.bookmarkOwners) {
      if (referenced.has(name) && !targets.has(name)) targets.set(name, paragraph);
    }
  }

  // AUTONUM prepass: one counter per kind, advanced in document order over the SAME scan (a
  // Map iterates in insertion order, and note stories joined after the body). Computed before
  // any REF resolves because a REF number switch aimed at an AUTONUM paragraph reads the
  // paragraph's first value — Word numbers those targets from the field, not from a list.
  const autonumByAnchor = new Map<string, string>();
  const autonumByParagraph = new Map<string, string>();
  const autonumCounters = new Map<AutonumFieldKind, number>();
  for (const [paragraphId, fields] of fieldsByParagraph) {
    for (const field of fields) {
      if (!field.autonum) continue;
      // A field the display mode resolves away does not exist in that view, so it must not
      // advance the counter: Word after accepting a deletion renumbers the survivors.
      if (!revisionsVisible(field.revisions, displayMode, authorFilter)) continue;
      const next = (autonumCounters.get(field.autonum.kind) ?? 0) + 1;
      autonumCounters.set(field.autonum.kind, next);
      const value = autonumDisplayText(field.autonum, next);
      if (value.length === 0) continue;
      autonumByAnchor.set(field.anchorId, value);
      if (!autonumByParagraph.has(paragraphId)) autonumByParagraph.set(paragraphId, value);
    }
  }

  const resolve = (spec: RefFieldSpec): string | null => {
    const mods = refSpecModifiersOf(spec);
    // A PAGEREF value is pagination's to compute — it must never resolve as bookmark text.
    if (mods.pageRef) return null;
    const target = targets.get(spec.bookmark);
    if (!target) return null;
    if (mods.noteRef) {
      // NOTEREF: the display number of the note whose reference mark sits inside the
      // bookmark. The index derives through the painter's own numbering path; a pass with
      // no numbering input (a story laid out without notes) keeps the cache.
      if (noteNumbering === undefined) return null;
      const referenceNodeId = firstNoteReferenceIdInBookmark(target, spec.bookmark);
      if (referenceNodeId === null) return null;
      return noteRefMarkIndex(blocks, noteNumbering).get(referenceNodeId) ?? null;
    }
    if (spec.numberSwitch !== null) {
      const item = listItems?.get(target.id);
      if (!item) {
        // The target's number can come from an AUTONUM-family field rather than a list —
        // the same documents use both, and the reference cites the synthesized value. `\t`
        // has no template to filter there, so that pairing keeps the cache.
        if (mods.suppressNonDelimiterText) return null;
        const autonum = autonumByParagraph.get(target.id);
        return autonum !== undefined ? trimTrailingPeriod(autonum) : null;
      }
      // `\r` / `\w`: full context — a deep level's marker states only its own placeholder,
      // and painting bare `(c)` for a `1.2(c)` target is worse than the stale cache. `\n`:
      // the target's own level only, per Word's cached values for that switch. Items built
      // outside `resolveStoryListItems` carry no counter source; their marker is the bounded
      // fallback — except under `\t`, whose filter runs on the level TEMPLATES and cannot
      // strip an already-expanded marker, so that pairing keeps the cache.
      const source = listItemNumberSource(item);
      const composed =
        source !== undefined
          ? composeFullContextNumber(
              source,
              spec.numberSwitch === 'n',
              mods.suppressNonDelimiterText
            )
          : null;
      // A bullet has a marker but no number a reader can cite — cached fallback, not a glyph.
      const fallback =
        !mods.suppressNonDelimiterText &&
        item.numFmt !== 'bullet' &&
        item.numFmt !== 'none' &&
        item.markerText.length > 0
          ? item.markerText
          : null;
      const value = composed ?? fallback;
      if (value === null) return null;
      return trimTrailingPeriod(value);
    }
    // `\t` on a plain REF would filter the bookmarked TEXT, which has no counter template to
    // filter against — cached fallback, the pre-existing degradation for that shape.
    if (mods.suppressNonDelimiterText) return null;
    const text = bookmarkRangeText(target, spec.bookmark);
    return text.length > 0 ? text : null;
  };

  const computedValues = new Map<string, string | null>();
  const computedOf = (spec: RefFieldSpec): string | null => {
    // The modifier singletons join the key, so `REF x \w`, `REF x \w \t` and `NOTEREF x`
    // never share a computed value.
    const mods = refSpecModifiersOf(spec);
    const modKey = `${mods.suppressNonDelimiterText ? 't' : ''}${mods.noteRef ? 'x' : ''}`;
    const key = `${spec.numberSwitch ?? '-'}${modKey}\u0000${spec.bookmark}`;
    if (computedValues.has(key)) return computedValues.get(key) ?? null;
    const value = resolve(spec);
    computedValues.set(key, value);
    return value;
  };

  // CALIBRATION, per field. A non-empty authored cache must be reproduced by the computed
  // value or the field stays on that cache; the verdict is STICKY (registry above), because
  // after an edit a live field's value diverges from its cache by design and re-comparing
  // would flip it back to stale. The token folds the PAINTED output — the live value when
  // calibrated, the session-constant cache otherwise — so it moves exactly when paint moves.
  const verdicts = carriedVerdicts(blocks);
  const pageRefCells = carriedPageRefCells(blocks);
  const liveByAnchor = new Map<
    string,
    { readonly spec: RefFieldSpec; readonly live: string | null }
  >();
  const pageRefByAnchor = new Map<
    string,
    { readonly spec: RefFieldSpec; readonly projection: PageRefFieldProjection }
  >();
  const tokens = new Map<string, string>();
  const storyParts: string[] = [];
  for (const [paragraphId, fields] of fieldsByParagraph) {
    const pieces: string[] = [];
    for (const field of fields) {
      // An AUTONUM-family field has no cache to calibrate against: its synthesized value is
      // the only display it has, and the token folds it so inserting or removing an earlier
      // field of the same kind repaints every later one.
      if (field.spec === null) {
        const value = field.autonum ? (autonumByAnchor.get(field.anchorId) ?? null) : null;
        pieces.push(value !== null ? `a\u0001${value}` : `c\u0002${field.cached}`);
        continue;
      }
      // A PAGEREF defers: the scan resolves the TARGET and finalize computes the number, so
      // its verdict is finalize's to take (against the pagination, not against this walk).
      // The token folds the cache — what this pass paints; the substituted number rides the
      // finalize memo keys, not the block keys, exactly like a body PAGE field — AND the
      // resolved target id. The target is what the marker carries, and a bookmark edit can
      // re-resolve the name while the field's own paragraph stays byte-identical: without
      // the id in the token, the cached fragment keeps its old marker and finalize
      // substitutes the OLD target's page forever.
      if (refSpecModifiersOf(field.spec).pageRef) {
        const target = targets.get(field.spec.bookmark);
        if (target) {
          let cell = pageRefCells.get(field.anchorId);
          if (cell === undefined && pageRefCells.size < MAX_REF_VERDICTS) {
            cell = Object.freeze({});
            pageRefCells.set(field.anchorId, cell);
          }
          if (cell !== undefined) {
            pageRefByAnchor.set(field.anchorId, {
              spec: field.spec,
              projection: { targetParagraphId: target.id, cached: field.cached, calibration: cell },
            });
          }
        }
        pieces.push(`c\u0002${field.cached}\u0002${target?.id ?? ''}`);
        continue;
      }
      const computed = computedOf(field.spec);
      // Keyed by the cache as well: a result written through the editing API is a new authored
      // cache, so it calibrates afresh and paints when the computed value does not reproduce it.
      const verdictKey = `${field.anchorId}\u0000${field.cached}`;
      let verdict = verdicts.get(verdictKey);
      if (verdict === undefined) {
        verdict =
          field.cached.length === 0 ||
          (computed !== null && normalizeResultText(computed) === field.cached);
        // An empty cache needs no sticky entry: it re-derives to "eligible" on every pass.
        if (field.cached.length > 0 && verdicts.size < MAX_REF_VERDICTS) {
          verdicts.set(verdictKey, verdict);
        }
      }
      const live = verdict ? computed : null;
      liveByAnchor.set(field.anchorId, { spec: field.spec, live });
      // `\u0002` marks "keeps the cache" so live-empty and cached-empty cannot collide.
      pieces.push(live !== null ? `l\u0001${live}` : `c\u0002${field.cached}`);
    }
    const token = pieces.join('\u0003');
    tokens.set(paragraphId, token);
    storyParts.push(paragraphId, token);
  }
  // LISTNUM values come from the list walk; a renumbering edit repaints every later field.
  for (const [paragraphId, token] of listNum?.tokenByParagraph ?? []) {
    tokens.set(paragraphId, `${tokens.get(paragraphId) ?? ''}\u0004${token}`);
    storyParts.push(paragraphId, `\u0004${token}`);
  }

  const context: RefFieldContext = {
    valuesToken: framedTokenJoin(storyParts),
    tokenForParagraph: (paragraphId) => tokens.get(paragraphId) ?? '',
    liveValueOf: (anchorId, spec) => {
      const entry = liveByAnchor.get(anchorId);
      if (!entry || entry.live === null) return null;
      // The projection parsed the same instruction this scan did; a disagreement means the
      // anchor id names some other field now — fail to the cache. Modifiers are frozen
      // singletons, so identity compares them.
      if (
        entry.spec.bookmark !== spec.bookmark ||
        entry.spec.numberSwitch !== spec.numberSwitch ||
        refSpecModifiersOf(entry.spec) !== refSpecModifiersOf(spec)
      ) {
        return null;
      }
      return entry.live;
    },
    autonumValueOf: (anchorId) => autonumByAnchor.get(anchorId) ?? null,
    pageRefProjectionOf: (anchorId, spec) => {
      const entry = pageRefByAnchor.get(anchorId);
      if (!entry) return null;
      // Same agreement rule as liveValueOf: the anchor must still name this instruction.
      if (
        entry.spec.bookmark !== spec.bookmark ||
        refSpecModifiersOf(entry.spec) !== refSpecModifiersOf(spec)
      ) {
        return null;
      }
      return entry.projection;
    },
  };
  if (listNum) listNumByContext.set(context, listNum.byAnchor);
  return context;
}

/** LISTNUM display text by field anchor id, per context, off the public interface. */
const listNumByContext = new WeakMap<RefFieldContext, ReadonlyMap<string, string>>();

/**
 * The number ONE LISTNUM field displays, keyed by its begin / `w:fldSimple` node id, or null
 * when the story's list walk gave it none (a story without a context, or a field this walk
 * never counted). The field then keeps its previous rendering.
 */
export function listNumFieldValue(
  context: RefFieldContext | undefined,
  anchorId: string
): string | null {
  return (context && listNumByContext.get(context)?.get(anchorId)) ?? null;
}

/**
 * Resolve the document's REF fields for one layout pass, or null when it has none.
 *
 * Bookmarks and REF fields resolve across the body story and (when `notes` is given) the
 * footnote/endnote stories, against ONE shared target index — a footnote REF finds the
 * body bookmark it cites. Header/footer and text-box stories are not given a context and
 * keep painting cached results.
 */
export function resolveStoryRefFields(
  blocks: readonly OoxmlElement[],
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  notes?: RefNoteParts
): RefFieldContext | null {
  return resolveStoryRefFieldsWithNoteNumbers(blocks, listItems, notes, undefined);
}

/**
 * {@link resolveStoryRefFields} plus the numbering input NOTEREF resolution needs. A separate
 * entry (not re-exported from the layout index) so the public signature stays put; callers
 * that cannot supply the input keep every NOTEREF field on its cached result. The input is
 * memoized by its producers (`noteRefNumberingFromNotes`), so the identity check below still
 * serves the no-change pass.
 */
export function resolveStoryRefFieldsWithNoteNumbers(
  blocks: readonly OoxmlElement[],
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  notes: RefNoteParts | undefined,
  noteNumbering: NoteRefNumberingInput | undefined,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  authorFilter?: RevisionAuthorFilter
): RefFieldContext | null {
  const footnotesPart = notes?.footnotesPart ?? null;
  const endnotesPart = notes?.endnotesPart ?? null;
  const memo = refContextMemos.get(blocks);
  if (
    memo &&
    memo.listItems === listItems &&
    memo.footnotesPart === footnotesPart &&
    memo.endnotesPart === endnotesPart &&
    memo.noteNumbering === noteNumbering &&
    memo.displayMode === displayMode &&
    memo.authorFilterKey === (authorFilter?.cacheKey ?? '')
  ) {
    return memo.context;
  }
  const context = buildRefFieldContext(
    blocks,
    listItems,
    notes,
    noteNumbering,
    displayMode,
    authorFilter
  );
  refContextMemos.set(blocks, {
    listItems,
    footnotesPart,
    endnotesPart,
    noteNumbering,
    displayMode,
    authorFilterKey: authorFilter?.cacheKey ?? '',
    context,
  });
  return context;
}

/**
 * Aggregate the REF tokens of every paragraph a table contains, for its prepared-block memo
 * and cache key — the same shape as the table's list-token aggregate, for the same reason: a
 * REF value change inside a cell moves nothing else in the table's key.
 *
 * Each row's joined tokens are reused while the row node and the context's values hold. A
 * context's `valuesToken` frames every paragraph id with its token, so two contexts with equal
 * `valuesToken` answer every paragraph alike and share one row scope. Joining the non-empty
 * row segments equals joining the non-empty paragraph tokens.
 */
export function refTokenForTableBlock(table: OoxmlElement, context: RefFieldContext): string {
  if (context.valuesToken === '') return '';
  const scope = refRowScope(context);
  const segments: string[] = [];
  for (const row of flattenContentControls(table.children)) {
    if (row.kind !== 'tableRow') continue;
    let known = refRowTokens.get(row);
    if (known?.scope !== scope) {
      const tokens: string[] = [];
      for (const paragraph of storyRowParagraphs(row, REF_TABLE_DEPTH)) {
        const token = context.tokenForParagraph(paragraph.id);
        if (token) tokens.push(token);
      }
      known = { scope, token: tokens.join(';') };
      if (known.token.length <= MAX_REF_ROW_TOKEN_LENGTH) refRowTokens.set(row, known);
    }
    if (known.token) segments.push(known.token);
  }
  return segments.join(';');
}

/** The table depth `walkStoryParagraphs` allows a top-level table. */
const REF_TABLE_DEPTH = 8;
const MAX_REF_ROW_TOKEN_LENGTH = 1 << 18;
const refRowTokens = new WeakMap<OoxmlNode, { readonly scope: object; readonly token: string }>();
const refRowScopes = new WeakMap<RefFieldContext, object>();
let lastRefContext: WeakRef<RefFieldContext> | null = null;

/** One row scope per distinct `valuesToken`, carried from the previous context when equal. */
function refRowScope(context: RefFieldContext): object {
  let scope = refRowScopes.get(context);
  if (scope) return scope;
  const previous = lastRefContext?.deref();
  scope =
    (previous && previous.valuesToken === context.valuesToken
      ? refRowScopes.get(previous)
      : undefined) ?? {};
  refRowScopes.set(context, scope);
  lastRefContext = new WeakRef(context);
  return scope;
}
