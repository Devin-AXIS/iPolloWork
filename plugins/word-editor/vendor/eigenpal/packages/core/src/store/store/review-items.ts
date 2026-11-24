// The review-item VOCABULARY and its pure helpers: the typed item shapes, stable keys, and
// position resolution over the paragraph order.
//
// It lives in the STORE lane because every lane has to speak it. The queue derivation
// (`review-reads.ts`) builds these items from the tree; the binding lane patches a cached
// queue locally after a keystroke; the layout lane resolves card geometry over layout
// records; the editor surfaces activate and cycle them. Binding and layout may not import
// each other, and the store is the one lane both may import — a vocabulary declared in
// either of them forces the other to copy it, and two copies of a reviewer's queue shapes
// drift eventually.
//
// Everything here is pure over the types; none of it can produce a queue, measure a line,
// or touch a part. Deriving items is `review-reads.ts` (and, for custom cards, the pro
// review module); geometry over layout records is `layout/review-support.ts`.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import type { CommentRecord } from './comment-reads.ts';

// ── Review item vocabulary ─────────────────────────────────────────────────────

/** A position in the model offset space of one story. */
export interface ReviewPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** Where an item is anchored: a range in one story. */
export interface ReviewRange {
  readonly partName: string;
  readonly start: ReviewPosition;
  readonly end: ReviewPosition;
}

/**
 * What kind of decision a revision card represents.
 *
 * Wider than the four content wrappers, because a reviewer has to be shown every pending
 * decision, including the ones that decorate no characters. A card the surface cannot show is
 * a change the reviewer never learns about — and `acceptAllRevisions` refuses if ANY revision
 * in the document is one the engine cannot resolve, so an invisible one makes Accept All fail
 * for a reason nothing on screen explains.
 */
export type ReviewRevisionKind =
  | 'insert'
  | 'delete'
  /**
   * A combined deletion and insertion decision. The built-in reader lists them separately,
   * unless a review query asks to pair replacements or a custom review provider combines them.
   */
  | 'replace'
  | 'moveFrom'
  | 'moveTo'
  /** `w:rPrChange` / `w:pPrChange` — the words are unchanged, their formatting is not. */
  | 'format'
  /** `w:pPr/w:rPr/w:ins|w:del` — a paragraph split or merge. */
  | 'paragraphMark'
  /** A row, cell, section or grid revision. Supported row revisions are resolvable. */
  | 'structural';

/**
 * One tracked change as a review card.
 *
 * Keyed per DECISION rather than per site: a revision spanning three ranges is one card, because
 * accepting it accepts all three.
 */
export interface ReviewRevisionItem {
  readonly kind: 'revision';
  /** Stable across renders and unique per decision within this editor instance. */
  readonly id: string;
  /** The payload `acceptRevision` / `rejectRevision` take. */
  readonly address: RevisionAddress;
  /**
   * EVERY address this decision covers, `address` first.
   *
   * Adjacent text fragments, table fragments, and formatting changes can combine multiple
   * original revisions into one decision. Review commands resolve the complete decision
   * in one transaction while preserving independent changes outside the group.
   */
  readonly addresses: readonly RevisionAddress[];
  /** The words a replacement removes. Empty for every other kind. */
  readonly replacedText: string;
  readonly revisionKind: ReviewRevisionKind;
  /** OOXML property-change element, used to resolve independently numbered formatting kinds. */
  readonly formattingKind?: string;
  /** Distinct structural operations covered by this decision, in document order. */
  readonly structuralChanges?: readonly (
    'rowInsert' | 'rowDelete' | 'cellInsert' | 'cellDelete' | 'cellMerge' | 'numberingInsert'
  )[];
  /** Changed direct formatting values, ready for localized review summaries. */
  readonly formattingChanges?: readonly {
    readonly property:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strike'
      | 'fontFamily'
      | 'fontSize'
      | 'color'
      | 'highlight'
      | 'alignment'
      | 'leftIndent'
      | 'rightIndent'
      | 'firstLineIndent'
      | 'hangingIndent'
      | 'spaceBefore'
      | 'spaceAfter'
      | 'direction';
    /**
     * New direct value; null means inherit. Sizes and distances are in points. A direction is
     * `rtl` or `ltr`. A highlight is the `w:highlight` color name, such as `yellow`.
     */
    readonly value: string | null;
  }[];
  /** Newly applied proofing language codes in a tracked formatting change. */
  readonly formattingLanguages?: readonly string[];
  /**
   * WHICH decision a `paragraphMark` records, absent for every other kind.
   *
   * `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`, and the four say opposite
   * things about one break. Without this a card called a deleted break an inserted one, which
   * is the reverse of what Accept on that card does.
   */
  readonly markDirection?: 'insert' | 'delete' | 'moveFrom' | 'moveTo';
  readonly author: string;
  readonly date?: string;
  /** Text the revision covers, for the card summary. Empty for changes with no characters. */
  readonly text: string;
  /** Every site this decision touches, in document order. */
  readonly ranges: readonly ReviewRange[];
  /**
   * How deeply this change is NESTED inside other changes, 0 for an unenclosed one.
   *
   * `w:ins` wrapping `w:del` is content one reviewer added and another struck. Both stay
   * pending, so both are cards, over one identical range — and a range then cannot say which
   * change a caret is in. Word treats the innermost as the operative one, so it wins the caret
   * and the change enclosing it stays listed and reachable.
   */
  readonly nesting: number;
  /**
   * How many leading `ranges` are the STRUCK half of a replacement.
   *
   * A replacement's card is one decision but its ranges are two colours — red over what is
   * going, green over what takes its place. ABSENT when the halves do not split at a single
   * point, which is what a file recording both under one revision id can produce; a surface
   * then has no basis for two colours and should paint one neutral band rather than guess.
   */
  readonly replacedRangeCount?: number;
  /**
   * True when the engine cannot resolve this kind, so accept and reject must not be offered.
   *
   * Derived by the DERIVATION rather than from a caller-supplied predicate: the refusal list
   * is internal, and a surface asked to compute it would have to guess. A card that offers a
   * button the engine will refuse is worse than one that explains why it cannot.
   */
  readonly readOnly: boolean;
  /** The other half of a move, or the other side of a delete/insert replacement. */
  readonly pairedWith?: string;
  /**
   * Comments answering this change, in document order.
   *
   * A reply to a tracked change IS a comment: `w:ins` and `w:del` carry no body, so the text
   * is written as a comment over the revision's own range and the range is what links them.
   */
  readonly replyIds: readonly string[];
}

/**
 * One comment as a review card. A reply carries `parentId`; OOXML gives replies no separate
 * element, so threads are reconstructed from that link.
 */
export interface ReviewCommentItem {
  readonly kind: 'comment';
  readonly id: string;
  readonly comment: CommentRecord;
  readonly range: ReviewRange | null;
  readonly resolved: boolean;
  /** The comment this replies to, absent for a top-level comment. */
  readonly parentId?: string;
  /** The REVISION this comment answers, when it covers exactly that change's characters. */
  readonly parentRevisionId?: string;
  /** Replies to this comment, in document order. Empty for a reply or a childless comment. */
  readonly replyIds: readonly string[];
  /** True when the file gave this comment no usable range. */
  readonly orphaned: boolean;
}

/**
 * A card contributed by a recognized custom node (`defineCustomNode` with a `reviewCard`
 * hook), anchored at the node's range.
 *
 * Informational, never resolvable: there is nothing to accept or reject, so the engine
 * refuses those verbs on it. `title` and `detail` are HOST-authored (the definition's hook
 * produced them), but `attrs` and `text` originate in a file an attacker controls — a
 * surface renders every one of these as text, never markup.
 */
export interface ReviewCustomItem {
  readonly kind: 'custom';
  /** The SDT node's stable id in the canonical tree. */
  readonly id: string;
  /** The definition's `name`. */
  readonly name: string;
  /** The raw `w:tag` the node was recognized from. Untrusted input. */
  readonly tag: string;
  /** Attrs decoded from the tag, after the definition's recognition hook. Untrusted input. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The SDT's literal content text. Untrusted input. */
  readonly text: string;
  /**
   * The payload the node's control binds to, after the definition validated it.
   *
   * Undefined when the node carries none or the payload did not match — see the pro package's
   * `RecognizedCustomNode.data`, which this is carried from.
   */
  readonly data?: unknown;
  /**
   * Whether this node asked for a sidebar card.
   *
   * False for a definition with no `reviewCard`: the item exists so the chip's own surfaces can
   * read `attrs`, `text` and `data` off it, and the rail leaves it out. A surface listing cards
   * filters on this rather than on an empty `title`. An uncarded node never becomes the active
   * review item, so it never shows the active highlight.
   */
  readonly carded: boolean;
  /** Card title, from the definition's `reviewCard` hook. Empty when `carded` is false. */
  readonly title: string;
  /** Card body, from the definition's `reviewCard` hook. */
  readonly detail?: string;
  /**
   * Glyph for this node in the collapsed rail, as an SVG path in a `0 -960 960 960` viewBox.
   *
   * A PATH rather than a rendered node because this item crosses core, which is DOM-free and
   * React-free — the same reason `title` and `detail` are strings. A host that wants arbitrary
   * markup overrides the `Markers` part's `icon` instead, which lives in the adapter where JSX
   * belongs. Absent falls back to the generic custom-node glyph.
   *
   * HOST-AUTHORED, never file data: it is interpolated into an SVG `d` attribute, and a path
   * taken from a document would be attacker-controlled markup.
   */
  readonly icon?: string;
  readonly range: ReviewRange | null;
}

/**
 * One pending decision in the review queue: a tracked change, a comment thread, or a pro
 * custom-node card. Discriminate on `kind`.
 *
 * The store's own derivation (`collectReviewItems`) only ever produces the first two; the
 * `kind: 'custom'` card is contributed by the pro review module, which recognizes the node.
 */
export type ReviewItem = ReviewRevisionItem | ReviewCommentItem | ReviewCustomItem;

const revisionSiteNodeIds = new WeakMap<object, readonly string[]>();

/** Attach engine-only canonical site identities to one immutable review item. */
export function registerRevisionSiteNodeIds<T extends object>(
  item: T,
  nodeIds: readonly string[]
): T {
  revisionSiteNodeIds.set(item, nodeIds);
  return item;
}

/** Exact canonical sites that contribute to one revision decision. */
export function revisionSiteNodeIdsOf(item: object): readonly string[] {
  return revisionSiteNodeIds.get(item) ?? [];
}

/** What the review queue derivation reads: one story part plus its comment parts. */
export interface ReviewModelInput {
  /** The story the ranges live in — the main document, a header, a note. */
  readonly storyPart: OoxmlPart;
  /**
   * Header/footer story parts, in section order. Their revisions and comment anchors join
   * the queue: a tracked change in a header is a pending decision like any other, and a
   * queue that only walked the body silently hid it from the rail AND from Accept All.
   */
  readonly furnitureParts?: readonly OoxmlPart[] | undefined;
  /** Shared style definitions. Their revisions have no paragraph range. */
  readonly stylesPart?: OoxmlPart | undefined;
  /** `word/comments.xml`, absent when the package has none. */
  readonly commentsPart?: OoxmlPart | undefined;
  /** `word/commentsExtended.xml`, absent when the package has none. */
  readonly commentsExtendedPart?: OoxmlPart | undefined;
  /**
   * Custom node definitions from the module registry, forwarded OPAQUELY.
   *
   * Core carries them the way the registry does — as unknowns — so the definition shape
   * stays a capability-package concern. The pro derivation narrows them and contributes
   * `kind: 'custom'` cards for definitions that opted in.
   */
  readonly customNodes?: readonly unknown[] | undefined;
  /**
   * Where a capability package reports a node it could not read. Supplied per editor, so a page
   * with two of them keeps their diagnostics apart.
   */
  readonly reportCustomNodeDiagnostic?: ((diagnostic: unknown) => void) | undefined;
  /**
   * The payload each of the story's controls binds to, keyed by the control's node id.
   *
   * Resolved by the ENGINE and handed over, because a payload lives in a customXml data part
   * and a derivation that only receives story parts has no way to reach one. Untrusted file
   * input on both members; a capability package validates it against whatever shape it
   * declared before handing it to a host.
   */
  readonly customNodePayloads?:
    | ReadonlyMap<
        string,
        { readonly nodeId: string; readonly label: string; readonly data: string }
      >
    | undefined;
}

// ── Pure helpers over the vocabulary ───────────────────────────────────────────

/** The stable key a surface uses for the active item and for a React list. */
export function reviewItemKey(item: ReviewItem): string {
  return `${item.kind}-${item.id}`;
}

/** Store revision ids start with their kind and a dash, so this prefix cannot collide. */
export const REPLACEMENT_PAIR_ID_PREFIX = 'replace:';

/** The id a paired replacement item carries for its deletion and insertion halves. */
export function replacementPairId(deletionId: string, insertionId: string): string {
  return `${REPLACEMENT_PAIR_ID_PREFIX}${deletionId}+${insertionId}`;
}

/**
 * Whether a deletion and the insertion after it read as one replacement: the same author,
 * review state and nesting, and the deletion ends exactly where the insertion starts.
 */
export function isReplacementPair(
  deletion: ReviewRevisionItem,
  insertion: ReviewRevisionItem
): boolean {
  return (
    deletion.revisionKind === 'delete' &&
    insertion.revisionKind === 'insert' &&
    deletion.author === insertion.author &&
    deletion.readOnly === insertion.readOnly &&
    deletion.nesting === insertion.nesting &&
    // Typing over a selection writes the deletion first; a document compare writes the
    // insertion first. Either way the two touch, and they are one replacement.
    (touches(deletion, insertion) || touches(insertion, deletion))
  );
}

/** Whether `after` starts exactly where `before` ends. */
function touches(before: ReviewRevisionItem, after: ReviewRevisionItem): boolean {
  const end = before.ranges[before.ranges.length - 1];
  const start = after.ranges[0];
  return (
    end !== undefined &&
    start !== undefined &&
    end.partName === start.partName &&
    end.end.paragraphId === start.start.paragraphId &&
    end.end.offset === start.start.offset
  );
}

/** What a review key names, or null for text no review queue produces. */
export type ParsedReviewItemKey =
  | { readonly kind: 'revision' | 'comment' | 'custom'; readonly id: string }
  | { readonly kind: 'replacement'; readonly id: string; readonly halves: string };

/**
 * Split a key from {@link reviewItemKey} into its kind and id. A paired replacement keeps its
 * joined halves, because the store ids on either side of `+` can themselves contain `+`.
 */
export function parseReviewItemKey(key: string): ParsedReviewItemKey | null {
  const dash = key.indexOf('-');
  if (dash <= 0) return null;
  const kind = key.slice(0, dash);
  const id = key.slice(dash + 1);
  if (id.length === 0) return null;
  if (kind === 'revision' && id.startsWith(REPLACEMENT_PAIR_ID_PREFIX))
    return { kind: 'replacement', id, halves: id.slice(REPLACEMENT_PAIR_ID_PREFIX.length) };
  return kind === 'revision' || kind === 'comment' || kind === 'custom' ? { kind, id } : null;
}

/** Every range a decision touches. One card can cover several, in different paragraphs. */
export function reviewItemRanges(item: ReviewItem): readonly ReviewRange[] {
  if (item.kind === 'revision') return item.ranges;
  return item.range ? [item.range] : [];
}

/** The first range of an item, in authored order, or null when it has none. */
export function firstReviewRange(item: ReviewItem): ReviewRange | null {
  return reviewItemRanges(item)[0] ?? null;
}

/**
 * A single comparable number for document order.
 *
 * Paragraph index dominates offset, so a revision spanning paragraphs still sorts by where it
 * STARTS. An item with no resolvable range sorts last rather than to position zero, which is
 * where an orphan used to land — tearing an orphaned reply out of its own thread.
 */
export function reviewItemPositionRank(
  item: ReviewItem,
  order: ReadonlyMap<string, number>
): number {
  const range = firstReviewRange(item);
  if (!range) return Number.MAX_SAFE_INTEGER;
  const paragraph = order.get(range.start.paragraphId);
  if (paragraph === undefined) return Number.MAX_SAFE_INTEGER;
  return paragraph * 1_000_000 + Math.min(range.start.offset, 999_999);
}

/** Width of one range in document-order units, for the innermost-wins tie-break. */
function rangeWidth(range: ReviewRange, order: ReadonlyMap<string, number>): number {
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (start === undefined || end === undefined) return Number.MAX_SAFE_INTEGER;
  // A real distance, not a sentinel: a cross-paragraph range used to score MAX_SAFE_INTEGER,
  // which lost every comparison, so placing the caret in a multi-paragraph insertion activated
  // nothing at all.
  return (end - start) * 1_000_000 + (range.end.offset - range.start.offset);
}

/**
 * How firmly a range holds a position. A lower grip holds harder.
 *
 * Three grips rather than a boolean, because "covers" on its own cannot order two ranges that
 * MEET at the caret. Both boundaries of a range count — a caret resting past a range's last
 * character is visually still on that character, and requiring it to be strictly inside makes
 * the last character feel dead. But a range that holds the caret properly inside it holds the
 * same caret harder, and its characters are the ones the reader is looking at.
 *
 * Width alone got that backwards. Adjacent tracked edits meet end-to-start by construction, so
 * a one-character insertion ending at offset 30 covered every click at 30 and WON on width
 * against the six-character insertion that starts there. A document of neighbouring revisions
 * therefore activated its earliest narrow card for clicks all over its later ones.
 */
/**
 * A range that covers no characters, sitting exactly at the position: the hardest grip there is.
 *
 * FIRST, not last. A zero-width range is a deliberate point anchor, not a degenerate one — a
 * tracked paragraph mark is anchored at the paragraph end precisely so its card opens when the
 * caret is at the break that made it (`review-site-locations.ts`), and a comment can be written
 * over no characters too. Width alone put these first, because zero is the narrowest width
 * there is. Ranking them behind a toucher took the tracked-Enter card away from the one caret
 * position that can reach it, and shadowed a point comment with whatever revision surrounds it.
 */
const GRIP_POINT = 0;
const GRIP_INSIDE = 1;
/** The caret sits at the far end: on the range's last character, not among them. */
const GRIP_TOUCHING = 2;

function rangeGrip(
  range: ReviewRange,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): number | null {
  const target = order.get(position.paragraphId);
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (target === undefined || start === undefined || end === undefined) return null;
  if (target < start || target > end) return null;
  if (target === start && position.offset < range.start.offset) return null;
  if (target === end && position.offset > range.end.offset) return null;
  // A format change, a paragraph mark, or a marker pair a producer wrote empty decorates no
  // characters at all. It covers its own offset and nothing else, which is what makes it the
  // most specific thing a caret at that offset can be pointing at.
  if (start === end && range.start.offset === range.end.offset) return GRIP_POINT;
  if (target === end && position.offset === range.end.offset) return GRIP_TOUCHING;
  return GRIP_INSIDE;
}

/**
 * The grip and width of the range of this item that holds the position hardest, or null.
 *
 * EVERY range is asked, not just the first. Sites sharing a triple coalesce into one card, so a
 * revision that touches two paragraphs carries two ranges — checking only the first left the
 * caret in the second paragraph activating nothing. A card can also both contain the caret in
 * one range and merely touch it with another (a replacement's two halves meet at the caret),
 * and the harder grip is the one that speaks for the card.
 */
function coveringGrip(
  item: ReviewItem,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): { readonly grip: number; readonly width: number } | null {
  let best: { readonly grip: number; readonly width: number } | null = null;
  for (const range of reviewItemRanges(item)) {
    const grip = rangeGrip(range, position, order);
    if (grip === null) continue;
    const width = rangeWidth(range, order);
    if (best === null || grip < best.grip || (grip === best.grip && width < best.width)) {
      best = { grip, width };
    }
  }
  return best;
}

/** Tie-break order between kinds covering the same caret at equal range width. */
const REVIEW_KIND_RANK: Readonly<Record<ReviewItem['kind'], number>> = {
  comment: 0,
  custom: 1,
  revision: 2,
};

/**
 * Every item covering a position, innermost first.
 *
 * Returning the whole stack rather than one winner is what lets a surface offer cycling, a
 * stacked card, or a "1 of 3" affordance. A comment wrapping a revision used to be unreachable
 * because only the tightest range was ever returned.
 */
export function reviewItemsAt(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  const covering: { item: ReviewItem; grip: number; width: number }[] = [];
  for (const item of items) {
    const held = coveringGrip(item, position, order);
    if (held !== null) covering.push({ item, grip: held.grip, width: held.width });
  }
  return covering
    .sort((a, b) => {
      // GRIP before width. A point anchor at exactly this offset is the most specific thing
      // there is, and a range holding the caret inside it outranks one that merely ends there
      // however narrow the toucher is.
      if (a.grip !== b.grip) return a.grip - b.grip;
      if (a.width !== b.width) return a.width - b.width;
      // At equal width a comment outranks everything (it is a question waiting on the
      // reader), and a custom node outranks a revision (it is the more specific thing
      // under the caret). A total order — the old two-way comparison was not antisymmetric
      // once a third kind existed, leaving custom-vs-revision ties implementation-defined.
      if (a.item.kind !== b.item.kind) {
        return REVIEW_KIND_RANK[a.item.kind] - REVIEW_KIND_RANK[b.item.kind];
      }
      // NESTING is the last word, and the only one that separates two changes whose ranges are
      // identical: `w:ins` wrapping `w:del`, content one reviewer added and another struck.
      // Word reads the innermost as the operative change — the words are struck on the page
      // because of the deletion, and accepting the change under them deletes them — so the
      // deepest wins. Without it the order fell out of the tree walk and sort stability, which
      // put the WRAPPER first: a click on struck text opened an "Added" card, and the deletion
      // doing the striking was unreachable from the document.
      if (a.item.kind === 'revision' && b.item.kind === 'revision') {
        return b.item.nesting - a.item.nesting;
      }
      return 0;
    })
    .map((entry) => entry.item);
}

/**
 * Every item a SELECTION is in, innermost first: {@link reviewItemsAt} at the head, keeping only
 * the items the selection shares characters with.
 *
 * The head alone is the caret rule, and a caret counts both ends of a range. A range selection
 * is not a caret: its head sits on the selection's own boundary. Selecting a word that ends
 * where an insertion starts put the head at the insertion's first offset, and the insertion
 * lit up as active although none of its characters were selected. A collapsed selection keeps
 * the caret rule unchanged.
 */
export function reviewItemsAtSelection(
  items: readonly ReviewItem[],
  anchor: ReviewPosition,
  head: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  // One render asks this twice for the same caret (the active key, then the highlights), and
  // each answer walks every range of every item.
  const last = selectionAnswers.get(items);
  if (
    last !== undefined &&
    last.order === order &&
    // The surface's index moves in place across a paragraph split or join.
    last.orderSize === order.size &&
    samePosition(last.anchor, anchor) &&
    samePosition(last.head, head)
  ) {
    return [...last.answer];
  }
  const answer = itemsAtSelection(items, anchor, head, order);
  selectionAnswers.set(items, { order, orderSize: order.size, anchor, head, answer });
  return [...answer];
}

/** The last answer per queue; weak, so a closed document's queue takes its answer with it. */
const selectionAnswers = new WeakMap<
  readonly ReviewItem[],
  {
    readonly order: ReadonlyMap<string, number>;
    readonly orderSize: number;
    readonly anchor: ReviewPosition;
    readonly head: ReviewPosition;
    readonly answer: readonly ReviewItem[];
  }
>();

function samePosition(a: ReviewPosition, b: ReviewPosition): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}

function itemsAtSelection(
  items: readonly ReviewItem[],
  anchor: ReviewPosition,
  head: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  const covering = reviewItemsAt(items, head, order);
  const direction = comparePositions(anchor, head, order);
  if (direction === null || direction === 0) return covering;
  const [from, to] = direction < 0 ? [anchor, head] : [head, anchor];
  return covering.filter((item) =>
    reviewItemRanges(item).some((range) => rangeSharesSelection(range, from, to, order))
  );
}

/** Document order of two positions, or null when either paragraph is outside `order`. */
function comparePositions(
  a: ReviewPosition,
  b: ReviewPosition,
  order: ReadonlyMap<string, number>
): number | null {
  const first = order.get(a.paragraphId);
  const second = order.get(b.paragraphId);
  if (first === undefined || second === undefined) return null;
  return first !== second ? first - second : a.offset - b.offset;
}

/**
 * Whether a range and the selection `[from, to)` share at least one character.
 *
 * A point anchor counts when it sits inside the selection or at its start. The point decorates
 * the position after it, such as a tracked paragraph mark at the paragraph end, so a selection
 * that stops at that offset does not include it.
 */
function rangeSharesSelection(
  range: ReviewRange,
  from: ReviewPosition,
  to: ReviewPosition,
  order: ReadonlyMap<string, number>
): boolean {
  const startVsTo = comparePositions(range.start, to, order);
  const endVsFrom = comparePositions(range.end, from, order);
  if (startVsTo === null || endVsFrom === null) return false;
  if (comparePositions(range.start, range.end, order) === 0) {
    return startVsTo < 0 && endVsFrom >= 0;
  }
  return startVsTo < 0 && endVsFrom > 0;
}

/**
 * The item the caret is in, or null.
 *
 * A resolved comment never activates: a settled thread must not reopen itself as the reviewer
 * types near it.
 *
 * A REPLY resolves to the thread it belongs to. A reply is anchored over its parent's range,
 * so both cover the caret — and the reply, being newer, wins the innermost test. It is not a
 * card of its own (it renders inside its parent's), so the thread would have gone active with
 * nothing on screen showing it: the reply box vanished from a comment the moment somebody
 * replied to it.
 */
export function activeReviewItem(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem | null {
  const covering = reviewItemsAt(items, position, order).filter(
    (item) => !(item.kind === 'comment' && item.resolved)
  );
  const found = covering[0];
  if (!found) return null;
  return found.kind === 'comment' ? threadRootOf(items, found) : found;
}

/**
 * Walk a reply up to the card that heads its thread. Guarded against a cyclic file.
 *
 * The head is not always a comment. A reply to a tracked change renders inside the REVISION's
 * card, so resolving it to itself opened an item nothing on screen was drawing — the reply box
 * vanished the moment somebody answered a change.
 *
 * EXPORTED because the paginated surface answers "which card is open" itself, against its own
 * dismissed-key state, rather than through {@link activeReviewItem}. Two copies of the
 * innermost-wins rule was survivable while a reply could only be a comment — the parent came
 * first in `comments.xml` order and won the tie by accident. It stopped being survivable the
 * moment a reply could answer a revision, which outranks it outright.
 */
export function reviewThreadRootOf(
  items: readonly ReviewItem[],
  comment: ReviewCommentItem
): ReviewItem {
  return threadRootOf(items, comment);
}

function threadRootOf(items: readonly ReviewItem[], comment: ReviewCommentItem): ReviewItem {
  const byId = new Map<string, ReviewCommentItem>();
  const revisionById = new Map<string, ReviewRevisionItem>();
  for (const item of items) {
    if (item.kind === 'comment') byId.set(item.id, item);
    else if (item.kind === 'revision') revisionById.set(item.id, item);
  }
  const seen = new Set<string>([comment.id]);
  let current = comment;
  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  if (current.parentRevisionId !== undefined) {
    const revision = revisionById.get(current.parentRevisionId);
    if (revision) return revision;
  }
  return current;
}
