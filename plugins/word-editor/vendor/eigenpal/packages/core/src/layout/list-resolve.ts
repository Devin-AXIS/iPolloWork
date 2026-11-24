import { registerListGeometry, rememberListItemShape } from './list-marker-reuse.ts';
import { walkStoryParagraphs } from './story-paragraph-walk.ts';
import { mergeListIndent } from './list-indent-merge.ts';
import { markerMeasureToken } from './list-marker-measure-key.ts';
import {
  numberingParagraphProperties,
  numberingParagraphToken,
  withNumberingParagraphProperties,
} from './numbering-paragraph-properties.ts';
// Resolve numbering into marker text, indentation, and font inputs for one story walk.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { framedTokenJoin } from './layout-cache.ts';
import {
  createListCounterState,
  expandCountersOf,
  loadListCounters,
  numberLevelsOf,
  saveListCounters,
  type FullContextNumberSource,
  type ListCounterSnapshot,
} from './list-counters.ts';
import { resolvePictureBullet, type ResolvedPictureBullet } from './numbering-picture-bullet.ts';
import {
  EMPTY_NUMBERING_INDEX,
  resolveNumberingStyleLinks,
  type ListMarkerAlign,
  type ListSuffix,
  type NumberingIndex,
  type NumberingLevelIndent,
} from './numbering-index.ts';
import {
  cascadeRunProperties,
  MAX_STYLE_BASED_ON_DEPTH,
  type StyleCascadeTable,
  type StyleDefinition,
} from './style-cascade.ts';
import { mapSymbolPuaText, mapSymbolBulletText } from './symbol-encoding.ts';
import { markerSymbolFontAvailability } from './marker-symbol-font.ts';
import { bulletMarkerStyle } from './marker-symbol-face.ts';
import { withListMarkerSource } from './cell-list-marker.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { DEPENDENCY_KEY_IDS } from '../store/registry/frozen-ids.ts';
import type { LayoutScope } from './layout-scheduler.ts';
import type { LayoutSession } from './layout-session.ts';
import { numberingFlowBlocks } from './hidden-paragraph-mark.ts';
import { numPrFieldsOf, paragraphListPrelude, readNumPr } from './list-paragraph-prelude.ts';
import {
  listNumFieldsOf,
  listNumSignatureOf,
  storyHasListNumFields,
} from './field-listnum-scan.ts';
import { copyListItemsWithListNum, createListNumWalker } from './list-resolve-listnum.ts';

export { readNumPr };

interface ListResolveChangeEvidence {
  readonly preservesNumberedSequence: boolean;
}

const listResolveEvidenceBySession = new WeakMap<LayoutSession, ListResolveChangeEvidence>();
let listResolveBlockVisits = 0;
let listResolveBlockScans = 0;

/** @internal Read session-scoped list resolve memo for tests. */
export function listResolveSessionMemoListItemsForTest(
  session: LayoutSession
): ReadonlyMap<string, ResolvedListItem> | undefined {
  return lastStoryResolvesBySession.get(session)?.listItems;
}

/** @internal Warm-path recorder for list resolve block walks. */
export function listResolveBlockVisitTestRecorder(): {
  readonly blockVisits: number;
  /** Blocks whose numbered paragraphs were read again rather than reused. */
  readonly blockScans: number;
  reset(): void;
} {
  return {
    get blockVisits() {
      return listResolveBlockVisits;
    },
    get blockScans() {
      return listResolveBlockScans;
    },
    reset() {
      listResolveBlockVisits = 0;
      listResolveBlockScans = 0;
    },
  };
}

/**
 * Attach one-use layout scope evidence before semantic layout runs.
 *
 * @internal
 */
export function attachListResolveChangeEvidence(session: LayoutSession, scope: LayoutScope): void {
  const storySafe =
    scope.dependencyKeys.size === 0 ||
    [...scope.dependencyKeys].every((key) => key === DEPENDENCY_KEY_IDS.story);
  listResolveEvidenceBySession.set(session, {
    preservesNumberedSequence:
      scope.impact === 'text-local' &&
      !scope.structural &&
      scope.created.size === 0 &&
      scope.deleted.size === 0 &&
      storySafe,
  });
}

function consumeListResolveChangeEvidence(
  session: LayoutSession
): ListResolveChangeEvidence | undefined {
  const evidence = listResolveEvidenceBySession.get(session);
  listResolveEvidenceBySession.delete(session);
  return evidence;
}

/**
 * A paragraph's list membership fully resolved: definition, level, marker text and geometry.
 *
 * `markerText` is already expanded through the counter state, so it is the string a reader sees
 * rather than the `w:lvlText` template.
 */
export interface ResolvedListItem {
  readonly numId: string;
  readonly ilvl: number;
  readonly abstractNumId: string;
  /** `w:numFmt` of the resolved level — `bullet` or a numbering format. */
  readonly numFmt: string;
  readonly markerText: string;
  /** Counter value at this item's own level; absent for bullets. */
  readonly ordinal?: number;
  readonly markerAlign: ListMarkerAlign;
  readonly suffix: ListSuffix;
  /** Effective indent after merging level + paragraph indents, in points. */
  readonly indent: NumberingLevelIndent;
  readonly markerStyle: ResolvedRunStyle;
  /**
   * The image marker a `w:lvlPicBulletId` level resolved to, absent on every other item.
   *
   * Present means the marker is an IMAGE: it occupies `width` x `height` points in the
   * hanging slot and `markerText` is only what a sink that cannot draw the image falls back
   * to. The extent is the AUTHORED `v:shape` size scaled by the marker font size — see
   * {@link resolvePictureBullet}, which also decides when the answer is no picture at all.
   * Absent means the level declared none, named one the part does not declare, declared one
   * this projection could not read, or resolved to a size nothing can paint.
   */
  readonly picBullet?: ResolvedPictureBullet;
  /** Fingerprint for layout cache keys (indent, marker text, marker face). */
  readonly cacheToken: string;
}

/**
 * What composing an item's full-context number needs, keyed on the item object itself.
 *
 * A side channel rather than a `ResolvedListItem` member because the item type is public API
 * and only cross-reference resolution reads this. Entries ride the item maps the memos above
 * reuse by identity, and die with them.
 */
const listItemNumberSources = new WeakMap<ResolvedListItem, FullContextNumberSource>();

/** The composition inputs captured when `item` was counted, or undefined off this resolver. */
export function listItemNumberSource(item: ResolvedListItem): FullContextNumberSource | undefined {
  return listItemNumberSources.get(item);
}

/**
 * The `w:numId` a style numbers with, following `w:basedOn` (§17.9.21 link target).
 *
 * A `w:numStyleLink` names a style, not a number: Word's own List Bullet / List Number are
 * paragraph styles whose `w:numPr` points at the `w:num` that owns the real levels. The walk
 * is depth-capped with a visited set because the `basedOn` chain comes from the file.
 */
function numIdForStyle(styleCascade: StyleCascadeTable, styleId: string): string | undefined {
  const seen = new Set<string>();
  let current: StyleDefinition | undefined = styleCascade.styles.get(styleId);
  for (let depth = 0; current !== undefined && depth < MAX_STYLE_BASED_ON_DEPTH; depth += 1) {
    if (seen.has(current.styleId)) return undefined;
    seen.add(current.styleId);
    const node = current.paragraphPropertiesNode;
    const fields = node ? numPrFieldsOf(node) : null;
    // The NEAREST style that states `w:numId` decides, exactly as the merged read above
    // does: a stated `w:val="0"` switches numbering off rather than deferring to the
    // base, and a level-only `w:numPr` keeps walking for the id it inherits.
    if (fields && fields.numId !== undefined) return fields.numId ?? undefined;
    current = current.basedOn === null ? undefined : styleCascade.styles.get(current.basedOn);
  }
  return undefined;
}

/**
 * Memo keyed on the index object, validated against the cascade. A WeakMap so a disposed
 * document's index releases its entry, and entered under the LINKED index too: layout
 * links the raw index once per flush, then hands the linked result back through this
 * function again, and without the self-entry that second call would clobber the memo
 * every flush. Level-object identity across edits is NOT this memo's doing —
 * `resolveNumberingStyleLinks` reuses the delegation target's `levels` maps by reference,
 * so the per-paragraph `perLevel` caches stay warm even on a miss here.
 */
const linkedIndexMemos = new WeakMap<
  NumberingIndex,
  { readonly styleCascade: StyleCascadeTable; readonly linked: NumberingIndex }
>();

/**
 * Resolve `w:numStyleLink` delegation using the document's styles (§17.9.21).
 *
 * Without a style table there is nothing to follow, so the index is returned unchanged —
 * and so it is when nothing delegates, which keeps layout cache identity.
 */
export function withNumberingStyleLinks(
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined
): NumberingIndex {
  if (!styleCascade) return index;
  const memo = linkedIndexMemos.get(index);
  if (memo && memo.styleCascade === styleCascade) return memo.linked;
  const linked = resolveNumberingStyleLinks(index, (styleId) =>
    numIdForStyle(styleCascade, styleId)
  );
  const entry = { styleCascade, linked };
  linkedIndexMemos.set(index, entry);
  linkedIndexMemos.set(linked, entry);
  return linked;
}

export { mergeListIndent } from './list-indent-merge.ts';

/**
 * Collect paragraphs of a block list in document order, descending into tables.
 *
 * Caps nesting so a hostile nested-table document cannot recurse without bound.
 */
export { walkStoryParagraphs } from './story-paragraph-walk.ts';

/**
 * Resolve every list paragraph in a story to a {@link ResolvedListItem}, keyed by node id.
 *
 * Non-list paragraphs are absent from the map. Hostile / missing numbering resolves inertly
 * (paragraph omitted — laid out as ordinary text).
 */
export function resolveStoryListItems(
  blocks: readonly OoxmlElement[],
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable?: (family: string) => boolean
): ReadonlyMap<string, ResolvedListItem> {
  if (index.nums.size === 0) return new Map();
  return resolveListSequence(
    walkStoryParagraphs(blocks, 8, true),
    index,
    styleCascade,
    isFontAvailable
  ).items;
}

/** Numbered paragraphs between two saved counter states of a {@link ListSequenceResolve}. */
const LIST_RESUME_STRIDE = 256;

/** One list walk, with the counter state saved every {@link LIST_RESUME_STRIDE} paragraphs. */
interface ListSequenceResolve {
  readonly items: ReadonlyMap<string, ResolvedListItem>;
  /** `states[k]` is the counter state before paragraph `k * LIST_RESUME_STRIDE`. */
  readonly states: readonly ListCounterSnapshot[];
  /** A LISTNUM field counted in the walk; a resume then cannot start mid-story. */
  readonly usesListNum: boolean;
}

/**
 * The list walk over `paragraphs` in story order. With `resume`, the walk starts from the last
 * saved state at or before paragraph `from`, and takes the items before it from the previous
 * walk: a number depends only on the paragraphs before it, and those are the same.
 */
function resolveListSequence(
  paragraphs: readonly OoxmlElement[],
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable: ((family: string) => boolean) | undefined,
  resume?: { readonly from: number; readonly previous: ListSequenceResolve },
  seed?: ListCounterSnapshot
): ListSequenceResolve {
  const map = new Map<string, ResolvedListItem>();
  // A definition that delegates through `w:numStyleLink` has no levels of its own; resolving
  // the link here is what keeps those paragraphs from losing their markers entirely.
  const linked = withNumberingStyleLinks(index, styleCascade);
  const counters = createListCounterState(linked);
  // A header or footer story continues the count the stories before it left.
  if (seed) loadListCounters(counters, seed);
  const listNum = createListNumWalker(linked, counters);
  const states: ListCounterSnapshot[] = [];
  // A LISTNUM field reads the paragraphs before it (the last numbered one, the last heading),
  // which a saved counter state does not hold: such a walk starts from the top.
  const usesListNum = paragraphs.some((paragraph) => listNumFieldsOf(paragraph).length > 0);
  let start = 0;
  if (resume && !usesListNum && !resume.previous.usesListNum) {
    const checkpoint = Math.min(
      Math.floor(resume.from / LIST_RESUME_STRIDE),
      resume.previous.states.length - 1
    );
    if (checkpoint > 0) {
      start = checkpoint * LIST_RESUME_STRIDE;
      states.push(...resume.previous.states.slice(0, checkpoint + 1));
      loadListCounters(counters, resume.previous.states[checkpoint]!);
      for (let position = 0; position < start; position += 1) {
        const id = paragraphs[position]!.id;
        const item = resume.previous.items.get(id);
        if (item) map.set(id, item);
      }
    }
  }
  for (let position = start; position < paragraphs.length; position += 1) {
    if (position % LIST_RESUME_STRIDE === 0 && states.length === position / LIST_RESUME_STRIDE)
      states.push(saveListCounters(counters));
    const paragraph = paragraphs[position]!;
    const prelude = paragraphListPrelude(paragraph, styleCascade);
    const numPr = prelude.numPr;
    const advanced = numPr ? counters.advance(numPr.numId, numPr.ilvl) : null;
    // The paragraph's own number counts before the fields inside it.
    if (usesListNum) listNum.visit(paragraph, advanced, prelude.outlineLevel);
    if (!advanced) continue;

    let levelDerived = prelude.perLevel.get(advanced.level);
    if (!levelDerived) {
      // Split, not flattened: the merge needs the tiers below and above the level apart.
      const indent = mergeListIndent(advanced.level.indent, prelude.belowLevel, prelude.aboveLevel);
      const markerProps = cascadeRunProperties(
        prelude.inheritedMarkProps,
        advanced.level.runProperties,
        styleCascade
      );
      // A marker never draws in small capitals; `w:caps` still applies.
      const resolved = {
        ...resolveRunStyle(markerProps, styleCascade?.themeFonts),
        smallCaps: false,
      };
      levelDerived = {
        indent,
        markerStyle:
          advanced.level.numFmt === 'bullet'
            ? bulletMarkerStyle(resolved, advanced.markerText)
            : resolved,
      };
      prelude.perLevel.set(advanced.level, levelDerived);
    }
    const { indent, markerStyle: authoredMarkerStyle } = levelDerived;
    // Word writes a Symbol/Wingdings bullet as font-byte + 0xF000 (`` = U+F0B7 in
    // Symbol), which is a private-use codepoint no other font can draw. Mapping it here —
    // where the marker's FAMILY is finally known — keeps measurement and paint on the same
    // string; doing it in the painter would size the marker box for a glyph nobody draws.
    const mapMarker = advanced.level.numFmt === 'bullet' ? mapSymbolBulletText : mapSymbolPuaText;
    const markerText = mapMarker(
      advanced.markerText,
      authoredMarkerStyle.fontFamily,
      isFontAvailable
    );
    // The marker keeps its authored face even when its glyph was translated to Unicode. An
    // unavailable symbol face still sizes the line and the marker by its own metrics
    // (`symbol-face-metrics.ts`), and paint draws the Unicode twin in a face that has it.
    // Never mutate the cached level style.
    const markerStyle = authoredMarkerStyle;
    // `w:lvlPicBulletId` names a `w:numPicBullet` of the SAME part. A level naming one the
    // part never declared, or one whose VML this projection could not read, keeps its
    // `w:lvlText` — a missing image must never cost the reader the marker entirely.
    const authoredPicBullet =
      advanced.level.picBulletId === undefined
        ? undefined
        : linked.pictureBullets?.get(advanced.level.picBulletId);
    const picBullet = authoredPicBullet
      ? (resolvePictureBullet(authoredPicBullet, markerStyle.fontSizePt) ?? undefined)
      : undefined;
    // Length-framed: `numFmt`, `lvlText`, and the marker are verbatim file text that can
    // carry any printable separator, so a separator join lets two different level
    // geometries serialize to one token and share a break-cache entry.
    const tokenParts = [
      advanced.numId,
      advanced.ilvl,
      advanced.level.numFmt,
      advanced.level.lvlText,
      indent.left,
      indent.right,
      indent.hanging,
      indent.firstLine,
      advanced.level.lvlJc,
      advanced.level.suff,
      advanced.level.vanish ? 1 : 0,
      numberingParagraphToken(advanced.level),
      // The MARKER ITSELF, not its length. The first line starts where the marker ends
      // whenever the marker overflows its hanging slot, so `9.` and `10.` break differently —
      // and so do `ii.` and `vi.`, which the length cannot tell apart. A warm cache then
      // served the previous marker's width to the new one, and the line wrapped a word late.
      markerText,
      // The FACE, not just the glyphs. `listFirstLineOffset` measures with `markerStyle`,
      // so a level `w:sz` or font change moves the wrap while the text and indent stay put.
      markerMeasureToken(markerStyle),
      // The picture marker's identity and DRAWN extent. It replaces the marker glyph, so
      // it decides both the first line's start and the first line's height.
      picBullet ? `${picBullet.relationshipId}:${picBullet.width}:${picBullet.height}` : '',
    ].map(String);
    const cacheToken = framedTokenJoin(tokenParts);

    const item: ResolvedListItem = {
      numId: advanced.numId,
      ilvl: advanced.ilvl,
      abstractNumId: advanced.abstractNumId,
      numFmt: advanced.level.numFmt,
      markerText,
      ...(advanced.level.numFmt === 'bullet'
        ? {}
        : { ordinal: advanced.counters[advanced.ilvl] ?? 1 }),
      markerAlign: advanced.level.lvlJc,
      suffix: advanced.level.suff,
      indent,
      markerStyle,
      ...(picBullet ? { picBullet } : {}),
      cacheToken,
    };
    withNumberingParagraphProperties(item, numberingParagraphProperties(advanced.level));
    // Everything but the marker text (part 12), for keys that read its geometry instead.
    rememberListItemShape(
      item,
      framedTokenJoin([...tokenParts.slice(0, 12), ...tokenParts.slice(13)])
    );
    withListMarkerSource(item, {
      level: advanced.level.runProperties,
      markerText: advanced.markerText,
    });
    listItemNumberSources.set(item, {
      levels: numberLevelsOf(linked, advanced.numId),
      ilvl: advanced.ilvl,
      expandCounters: expandCountersOf(advanced),
    });
    map.set(paragraph.id, item);
  }
  listNum.finish(map);
  return { items: map, states, usesListNum };
}

interface ResolvedListItemsMemoEntry {
  readonly rawIndex: NumberingIndex | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly isFontAvailable: ((family: string) => boolean) | undefined;
  readonly linkedIndex: NumberingIndex;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
}

/**
 * Memo for {@link withResolvedListItems}, keyed on the blocks array (stable per part via
 * the `storyBlocks` memo) and validated against the remaining RAW inputs by identity —
 * the unlinked numbering index, the style cascade, and the font oracle. A WeakMap on the
 * blocks array so a disposed document's entry dies with its part instead of pinning an
 * O(document) item map at module scope. A miss on any input recomputes the sequential
 * full-story counter walk exactly as before.
 */
const resolvedListItemsMemos = new WeakMap<readonly OoxmlElement[], ResolvedListItemsMemoEntry>();

/** Session-stable outer memo for semantic body layout. */
const resolvedListItemsMemosBySession = new WeakMap<LayoutSession, ResolvedListItemsMemoEntry>();

type WithResolvedListItemsOptions = {
  readonly numberingIndex?: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  readonly styleCascade?: StyleCascadeTable;
  readonly isFontAvailable?: (family: string) => boolean;
  /**
   * The pass's measurer, read ONLY to learn which legacy symbol faces were admitted.
   *
   * A caller may still pass {@link isFontAvailable} explicitly and it wins; absent one, the
   * measurer answers, because it is the only input that already knows the admitted faces and
   * is already folded into every layout cache key. A caller with no measurer (the REF-refresh
   * save path) keeps the pre-font-resolution answer: translate the private-use bullet.
   */
  readonly measurer?: TextMeasurer;
  /** The counters a header or footer story starts from (`furniture-list-seeds.ts`). */
  readonly listCounterSeed?: ListCounterSnapshot;
};

/** Seeded resolves per story, a few per blocks array: one part can start from several seeds. */
const seededResolves = new WeakMap<
  readonly OoxmlElement[],
  {
    readonly seed: ListCounterSnapshot;
    readonly rawIndex: NumberingIndex | undefined;
    readonly styleCascade: StyleCascadeTable | undefined;
    readonly isFontAvailable: ((family: string) => boolean) | undefined;
    readonly linkedIndex: NumberingIndex;
    readonly listItems: ReadonlyMap<string, ResolvedListItem>;
  }[]
>();
const MAX_SEEDED_RESOLVES_PER_STORY = 4;

/**
 * The list walk of a story that starts from `seed`. A header or footer part is short, so it
 * walks whole; the memo keeps one resolve per seed for the part's few occurrences.
 */
function seededListItems(
  options: WithResolvedListItemsOptions,
  blocks: readonly OoxmlElement[],
  seed: ListCounterSnapshot,
  isFontAvailable: ((family: string) => boolean) | undefined
): {
  readonly numberingIndex: NumberingIndex;
  readonly listItems: ReadonlyMap<string, ResolvedListItem>;
} {
  const entries = seededResolves.get(blocks) ?? [];
  const hit = entries.find(
    (entry) =>
      entry.seed === seed &&
      entry.rawIndex === options.numberingIndex &&
      entry.styleCascade === options.styleCascade &&
      entry.isFontAvailable === isFontAvailable
  );
  if (hit) return { numberingIndex: hit.linkedIndex, listItems: hit.listItems };
  const linkedIndex = withNumberingStyleLinks(
    options.numberingIndex ?? EMPTY_NUMBERING_INDEX,
    options.styleCascade
  );
  const listItems = resolveListSequence(
    walkStoryParagraphs(blocks, 8, true),
    linkedIndex,
    options.styleCascade,
    isFontAvailable,
    undefined,
    seed
  ).items;
  const entry = {
    seed,
    rawIndex: options.numberingIndex,
    styleCascade: options.styleCascade,
    isFontAvailable,
    linkedIndex,
    listItems,
  };
  seededResolves.set(blocks, [entry, ...entries].slice(0, MAX_SEEDED_RESOLVES_PER_STORY));
  return { numberingIndex: linkedIndex, listItems };
}

/** The oracle a pass actually resolves with: an explicit one, else the measurer's coverage. */
function listFontAvailability(
  options: WithResolvedListItemsOptions
): ((family: string) => boolean) | undefined {
  return options.isFontAvailable ?? markerSymbolFontAvailability(options.measurer);
}

function resolvedListItemsMemoHit(
  options: WithResolvedListItemsOptions,
  isFontAvailable: ((family: string) => boolean) | undefined,
  blocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined
): ResolvedListItemsMemoEntry | undefined {
  const memo = memoOwner
    ? resolvedListItemsMemosBySession.get(memoOwner)
    : resolvedListItemsMemos.get(blocks);
  if (
    memo &&
    memo.rawIndex === options.numberingIndex &&
    memo.styleCascade === options.styleCascade &&
    memo.isFontAvailable === isFontAvailable
  ) {
    return memo;
  }
  return undefined;
}

function rememberResolvedListItemsMemo(
  blocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined,
  entry: ResolvedListItemsMemoEntry
): void {
  if (memoOwner) resolvedListItemsMemosBySession.set(memoOwner, entry);
  else resolvedListItemsMemos.set(blocks, entry);
}

function withResolvedListItemsInternal<T extends WithResolvedListItemsOptions>(
  options: T,
  flowBlocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  // Paragraphs a hidden mark took out of the flow still count; see `hidden-paragraph-mark.ts`.
  const blocks = numberingFlowBlocks(flowBlocks);
  const isFontAvailable = listFontAvailability(options);
  if (options.listItems === undefined && options.listCounterSeed) {
    return {
      ...options,
      ...seededListItems(options, blocks, options.listCounterSeed, isFontAvailable),
    };
  }
  if (options.listItems === undefined) {
    const memo = resolvedListItemsMemoHit(options, isFontAvailable, blocks, memoOwner);
    if (memo && memoOwner === undefined) {
      return {
        ...options,
        numberingIndex: memo.linkedIndex,
        ...(memo.listItems ? { listItems: memo.listItems } : {}),
      };
    }
  }
  const memoBeforeResolve =
    options.listItems === undefined
      ? resolvedListItemsMemoHit(options, isFontAvailable, blocks, memoOwner)
      : undefined;
  const numberingIndex =
    memoBeforeResolve &&
    memoBeforeResolve.rawIndex === options.numberingIndex &&
    memoBeforeResolve.styleCascade === options.styleCascade &&
    memoBeforeResolve.isFontAvailable === isFontAvailable
      ? memoBeforeResolve.linkedIndex
      : withNumberingStyleLinks(
          options.numberingIndex ?? EMPTY_NUMBERING_INDEX,
          options.styleCascade
        );
  const listItems =
    options.listItems ??
    // A LISTNUM field counts on a built-in list even when the document defines none.
    (numberingIndex.nums.size > 0 || storyHasListNumFields(blocks)
      ? resolveStoryListItemsStable(
          blocks,
          options.numberingIndex,
          numberingIndex,
          options.styleCascade,
          isFontAvailable,
          memoOwner
        )
      : undefined);
  if (options.listItems === undefined) {
    rememberResolvedListItemsMemo(blocks, memoOwner, {
      rawIndex: options.numberingIndex,
      styleCascade: options.styleCascade,
      isFontAvailable,
      linkedIndex: numberingIndex,
      listItems,
    });
  }
  return {
    ...options,
    numberingIndex,
    ...(listItems ? { listItems } : {}),
  };
}

/**
 * Attach a full-story list-item map to layout options.
 *
 * Resolves once over `blocks` (body story including table cells) so counters continue across
 * section boundaries. No-ops when numbering is absent.
 */
export function withResolvedListItems<
  T extends {
    readonly numberingIndex?: NumberingIndex;
    readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
    readonly styleCascade?: StyleCascadeTable;
    readonly isFontAvailable?: (family: string) => boolean;
    readonly measurer?: TextMeasurer;
  },
>(
  options: T,
  blocks: readonly OoxmlElement[]
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  return withResolvedListItemsInternal(options, blocks, undefined);
}

/**
 * Session-stable list resolve for semantic body layout.
 *
 * @internal
 */
export function withResolvedListItemsForSession<T extends WithResolvedListItemsOptions>(
  options: T,
  blocks: readonly OoxmlElement[],
  session: LayoutSession
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  const resolved = withResolvedListItemsInternal(options, blocks, session);
  registerListGeometry(resolved.listItems, options.measurer);
  return resolved;
}

/** Numbered paragraphs of one top-level block, memoized per (immutable block, cascade). */
interface NumberedBlockMemo {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numbered: readonly OoxmlElement[];
  /** Numbered paragraphs plus headings and paragraphs with LISTNUM fields: what the walk reads. */
  readonly walked: readonly OoxmlElement[];
}
const numberedBlockMemos = new WeakMap<OoxmlElement, NumberedBlockMemo>();
const NO_NUMBERED_PARAGRAPHS: readonly OoxmlElement[] = Object.freeze([]);

/**
 * Whether any paragraph in `block` can carry a list item under `styleCascade`. Both list
 * resolves give items only to these paragraphs, so a block without one has no list token.
 */
export function blockHasNumberedParagraphs(
  block: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): boolean {
  return numberedBlockMemo(block, styleCascade).numbered.length > 0;
}

function numberedBlockMemo(
  block: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): NumberedBlockMemo {
  const cached = numberedBlockMemos.get(block);
  if (cached && cached.styleCascade === styleCascade) return cached;
  const numbered: OoxmlElement[] = [];
  const walked: OoxmlElement[] = [];
  for (const paragraph of walkStoryParagraphs([block], 8, true)) {
    const prelude = paragraphListPrelude(paragraph, styleCascade);
    if (prelude.numPr !== null) numbered.push(paragraph);
    if (
      prelude.numPr !== null ||
      prelude.outlineLevel !== null ||
      listNumFieldsOf(paragraph).length > 0
    )
      walked.push(paragraph);
  }
  const memo = {
    styleCascade,
    numbered: numbered.length > 0 ? numbered : NO_NUMBERED_PARAGRAPHS,
    walked: walked.length > 0 ? walked : NO_NUMBERED_PARAGRAPHS,
  };
  numberedBlockMemos.set(block, memo);
  return memo;
}

/** The paragraphs of one block the list walk reads. */
function numberedParagraphsOfBlock(
  block: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): readonly OoxmlElement[] {
  return numberedBlockMemo(block, styleCascade).walked;
}

/**
 * The previous full-story resolve, for reuse BY IDENTITY across keystrokes.
 *
 * The resolved item map is a pure function of the SEQUENCE of numbered paragraph nodes
 * (the counter walk skips everything else), the linked numbering index, the cascade, and
 * the font oracle. A text edit republishes the whole blocks array — which is what the
 * per-array memo above keys on — while replacing one non-list paragraph node, so the
 * numbered sequence is unchanged and the previous map still answers. Handing back the SAME
 * map object is also what lets a section-level prepass memo validate list inputs with one
 * identity compare.
 *
 * Keyed on the story's FIRST block node in a WeakMap rather than held in a module slot, so
 * a closed document's resolve — its numbered subtrees, item map, cascade and index — dies
 * with its tree instead of being pinned until some other document lays out. An edit to the
 * first block itself only misses (one extra resolve), never mixes: the numbered sequence is
 * still compared node-for-node.
 */
interface LastStoryResolve {
  readonly rawIndex: NumberingIndex | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly isFontAvailable: ((family: string) => boolean) | undefined;
  readonly blocks: readonly OoxmlElement[];
  readonly numberedByBlock: readonly (readonly OoxmlElement[])[];
  readonly listItems: ReadonlyMap<string, ResolvedListItem>;
  /** The walk behind `listItems` and the numbered paragraphs it walked, for a resume. */
  readonly walk?: {
    readonly paragraphs: readonly OoxmlElement[];
    readonly resolve: ListSequenceResolve;
  };
}
const lastStoryResolvesByAnchor = new WeakMap<OoxmlElement, LastStoryResolve>();
const lastStoryResolvesBySession = new WeakMap<LayoutSession, LastStoryResolve>();
/**
 * The last session resolve per block list. A session with none of its own starts from another
 * session's resolve of the same blocks: the result is a function of its inputs alone, and a
 * background pass in a fresh session otherwise resolved every list of the story in one task.
 */
const lastStoryResolvesByBlocks = new WeakMap<readonly OoxmlElement[], LastStoryResolve>();

function rememberSessionResolve(
  memoOwner: LayoutSession,
  blocks: readonly OoxmlElement[],
  next: LastStoryResolve
): void {
  lastStoryResolvesBySession.set(memoOwner, next);
  lastStoryResolvesByBlocks.set(blocks, next);
}

function sameNumberedParagraph(paragraph: OoxmlElement, previous: OoxmlElement | undefined) {
  if (!previous || paragraph.id !== previous.id) return false;
  if (listNumSignatureOf(paragraph) !== listNumSignatureOf(previous)) return false;
  const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const previousProperties = previous.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
  return properties === previousProperties;
}

function sameNumberingSequence(a: readonly OoxmlElement[], b: readonly OoxmlElement[]): boolean {
  return (
    a.length === b.length &&
    a.every((paragraph, index) => sameNumberedParagraph(paragraph, b[index]))
  );
}

function resolveStoryListItemsStable(
  blocks: readonly OoxmlElement[],
  rawIndex: NumberingIndex | undefined,
  linkedIndex: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable: ((family: string) => boolean) | undefined,
  memoOwner: LayoutSession | undefined
): ReadonlyMap<string, ResolvedListItem> {
  const first = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  // A session never shares another session's map; a seeded one starts from a copy of it.
  const seed =
    memoOwner && !lastStoryResolvesBySession.has(memoOwner)
      ? lastStoryResolvesByBlocks.get(blocks)
      : undefined;
  const last = memoOwner
    ? (lastStoryResolvesBySession.get(memoOwner) ??
      (seed && { ...seed, listItems: copyListItemsWithListNum(seed.listItems) }))
    : ((first ? lastStoryResolvesByAnchor.get(first) : undefined) ??
      (lastBlock ? lastStoryResolvesByAnchor.get(lastBlock) : undefined));
  const evidence = memoOwner ? consumeListResolveChangeEvidence(memoOwner) : undefined;
  if (
    evidence?.preservesNumberedSequence &&
    last &&
    // A text edit can change a LISTNUM field's instruction; compare the walked paragraphs.
    !last.walk?.resolve.usesListNum &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable
  ) {
    // Its blocks are an earlier list's, which a seeded session compares block by block.
    lastStoryResolvesByBlocks.set(blocks, last);
    return last.listItems;
  }

  const numberedByBlock = new Array<readonly OoxmlElement[]>(blocks.length);
  let numberedSequenceUnchanged =
    last !== undefined &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable &&
    last.blocks.length === blocks.length;
  // A paragraph added or removed shifts every block after it: match the unchanged tail from the
  // end, so those blocks keep their scans instead of each being read again.
  const shift = last ? last.blocks.length - blocks.length : 0;
  let tail = 0;
  if (last && shift !== 0) {
    const shorter = Math.min(blocks.length, last.blocks.length);
    while (
      tail < shorter &&
      blocks[blocks.length - 1 - tail] === last.blocks[last.blocks.length - 1 - tail]
    )
      tail += 1;
  }
  for (let index = 0; index < blocks.length; index += 1) {
    listResolveBlockVisits += 1;
    const block = blocks[index]!;
    const previousIndex = index >= blocks.length - tail ? index + shift : index;
    // A style can number a paragraph, so a block's list holds only under the same cascade.
    const numbered =
      last && last.blocks[previousIndex] === block && last.styleCascade === styleCascade
        ? last.numberedByBlock[previousIndex]!
        : (listResolveBlockScans++, numberedParagraphsOfBlock(block, styleCascade));
    numberedByBlock[index] = numbered;
    if (
      numberedSequenceUnchanged &&
      !sameNumberingSequence(numbered, last!.numberedByBlock[index]!)
    ) {
      numberedSequenceUnchanged = false;
    }
  }
  if (last && numberedSequenceUnchanged) {
    const next = { ...last, blocks, numberedByBlock };
    if (memoOwner) rememberSessionResolve(memoOwner, blocks, next);
    else {
      if (first) lastStoryResolvesByAnchor.set(first, next);
      if (lastBlock && lastBlock !== first) lastStoryResolvesByAnchor.set(lastBlock, next);
    }
    return last.listItems;
  }
  // Resume from the first numbered paragraph that changed: an Enter in a long numbered
  // document otherwise renumbered every list item before it as well.
  const paragraphs = numberedByBlock.flat();
  const previous =
    last?.walk &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable
      ? last.walk
      : undefined;
  let from = 0;
  while (
    previous &&
    from < paragraphs.length &&
    sameNumberedParagraph(paragraphs[from]!, previous.paragraphs[from])
  )
    from += 1;
  const resolve = resolveListSequence(
    paragraphs,
    linkedIndex,
    styleCascade,
    isFontAvailable,
    previous ? { from, previous: previous.resolve } : undefined
  );
  const listItems = resolve.items;
  const walk = { paragraphs, resolve };
  const next = {
    rawIndex,
    styleCascade,
    isFontAvailable,
    blocks,
    numberedByBlock,
    listItems,
    walk,
  };
  if (memoOwner) rememberSessionResolve(memoOwner, blocks, next);
  else {
    if (first) lastStoryResolvesByAnchor.set(first, next);
    if (lastBlock && lastBlock !== first) lastStoryResolvesByAnchor.set(lastBlock, next);
  }
  return listItems;
}

export {
  firstLineShift,
  listFirstLineOffset,
  listMarkerBox,
  listMarkerWidth,
} from './list-marker-geometry.ts';
