// The CONSERVATIVE local review patch: how a one-paragraph local edit updates the
// review queue without re-deriving it from the whole story.
//
// Split out of `tree-session.ts`, which owns the cache and calls these; the rules
// themselves are pure over the queue and read no session state. The bar is deliberately
// high — every predicate here answers "is the fast path still TRUE", and the fallback is
// the full derivation, which is always correct. A patch that keeps a stale card, or drops
// a live one, is worse than a slower keystroke.

import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  reviewItemKey,
  reviewItemPositionRank,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import { commentMarkersOfParagraph } from '../store/store/comment-reads.ts';
import { isInertMarker } from '../store/store/revision-marker-content.ts';
import {
  findNode,
  parentNodeOf,
  collectRevisionSites,
  contentControlsIn,
  linkRevisionReplies,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';

/** What the queue cache carries that the fast-path decision has to compare against. */
export interface LocalReviewPatchCache {
  readonly bodyRevision: number;
  readonly packageRevision: number;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
  /** The package the queue was derived or patched from. */
  readonly pkg: OoxmlPackage;
}

/**
 * Turning a paragraph into a list item first writes its list definition here, outside the
 * edit's own transaction. The review queue never reads this part.
 */
const NUMBERING_PART = '/word/numbering.xml';

/**
 * Whether every package input of the queue except the edited story is the same object as
 * before: every part but `storyPartName` and the numbering part, and the relationships and
 * content types that resolve headers, footers, notes, and comments.
 */
export function reviewInputsUnchanged(
  before: OoxmlPackage,
  after: OoxmlPackage,
  storyPartName: string
): boolean {
  if (
    before.relationships !== after.relationships ||
    before.contentTypes !== after.contentTypes ||
    before.parts.size !== after.parts.size
  ) {
    return false;
  }
  for (const [name, part] of after.parts) {
    if (name === storyPartName || name === NUMBERING_PART) continue;
    if (before.parts.get(name) !== part) return false;
  }
  return true;
}

function itemStartParagraphRank(
  item: ReviewItem,
  order: ReadonlyMap<string, number>
): number | null {
  const range = item.kind === 'revision' ? (item.ranges[0] ?? null) : item.range;
  if (!range) return null;
  const rank = order.get(range.start.paragraphId);
  return rank === undefined ? null : rank;
}

export function canApplyLocalReviewPatch(
  cached: readonly ReviewItem[],
  localRevisions: readonly ReviewRevisionItem[],
  dirtyParagraphId: string,
  part: OoxmlPart
): boolean {
  for (const local of localRevisions) {
    if (local.ranges.length === 0) return false;
  }
  const keptRangelessKeys = new Set<string>();
  for (const item of cached) {
    if (item.kind !== 'revision' || item.ranges.length > 0) continue;
    if (isRevisionWhollyInParagraph(item, dirtyParagraphId)) continue;
    keptRangelessKeys.add(reviewItemKey(item));
  }
  for (const local of localRevisions) {
    if (keptRangelessKeys.has(reviewItemKey(local))) return false;
  }
  // A change whose record also sits outside this paragraph (one id shared with a text box, say)
  // is one decision over all its sites, which a walk of the paragraph cannot see. A site the edit
  // removed is simply gone; one that still exists elsewhere needs the whole derivation.
  const localSites = new Set(localRevisions.flatMap((item) => revisionSiteNodeIdsOf(item)));
  for (const item of cached) {
    if (
      item.kind === 'revision' &&
      isRevisionWhollyInParagraph(item, dirtyParagraphId) &&
      revisionSiteNodeIdsOf(item).some((id) => !localSites.has(id) && findNode(part, id))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * `cached` with the dirty paragraph's revisions replaced by `localRevisions`, or null when the
 * paragraph has no place in `paragraphOrder` and holds a revision. Pieces of a cached
 * group are taken into the group first; `filterLocal` then decides over the rest, so a piece
 * whose group is listed is never decided on its own.
 */
export function patchLocalReviewItems(
  cached: readonly ReviewItem[],
  paragraphOrder: ReadonlyMap<string, number>,
  dirtyParagraphId: string,
  localRevisions: readonly ReviewRevisionItem[],
  filterLocal: (items: readonly ReviewRevisionItem[]) => readonly ReviewRevisionItem[] = (items) =>
    items,
  part?: OoxmlPart
): readonly ReviewItem[] | null {
  // Comments anchored in the paragraph keep their cards, at the offsets its markers now hold.
  const comments = part ? remappedComments(cached, part, dirtyParagraphId) : new Map();
  if (!comments) return null;
  // A paragraph outside the story's own order (one in a text box) has no place to splice into.
  // With no revision of its own the cached queue still holds; with one, the caller derives the
  // whole queue instead.
  const dirtyRank = paragraphOrder.get(dirtyParagraphId);
  if (dirtyRank === undefined) return localRevisions.length === 0 ? cached : null;

  const patched: ReviewItem[] = [];
  let insertAt: number | null = null;
  const { groups, absorbed } = absorbedIntoGroups(
    cached,
    paragraphOrder,
    dirtyParagraphId,
    localRevisions
  );
  const local = filterLocal(
    absorbed.size > 0 ? localRevisions.filter((item) => !absorbed.has(item)) : localRevisions
  );

  for (const cachedItem of cached) {
    const item =
      (cachedItem.kind === 'revision' && groups.get(cachedItem)) ||
      (cachedItem.kind === 'comment' && comments.get(cachedItem)) ||
      cachedItem;
    if (item.kind === 'revision' && isRevisionWhollyInParagraph(item, dirtyParagraphId)) {
      if (insertAt === null) insertAt = patched.length;
      continue;
    }
    if (insertAt === null) {
      const rank = itemStartParagraphRank(item, paragraphOrder);
      if (rank !== null && rank > dirtyRank) insertAt = patched.length;
    }
    patched.push(item);
  }

  if (insertAt === null) insertAt = patched.length;
  if (local.length > 0) {
    const orderedLocalRevisions =
      local.length < 2
        ? [...local]
        : [...local].sort(
            (a, b) =>
              reviewItemPositionRank(a, paragraphOrder) - reviewItemPositionRank(b, paragraphOrder)
          );
    patched.splice(insertAt, 0, ...orderedLocalRevisions);
  }
  // A group that starts in the dirty paragraph sits where the derivation puts it among that
  // paragraph's own items: by position, as the full derivation orders them.
  if (groups.size > 0 || comments.size > 0) {
    const slots: number[] = [];
    patched.forEach((item, index) => {
      // Comments too: the derivation orders comments and revisions together by position.
      const start = item.kind === 'revision' ? item.ranges[0]?.start : item.range?.start;
      if (start?.paragraphId === dirtyParagraphId) slots.push(index);
    });
    const ordered = slots
      .map((index) => patched[index]!)
      .sort(
        (a, b) =>
          reviewItemPositionRank(a, paragraphOrder) - reviewItemPositionRank(b, paragraphOrder)
      );
    slots.forEach((index, at) => (patched[index] = ordered[at]!));
  }
  // RE-LINKED, because the local revisions were derived from one paragraph and carry no
  // replies. Splicing them in as-is dropped the link between a tracked change and the comment
  // answering it, so a keystroke in that paragraph tore the reply out into a card of its own —
  // and the next full re-derive put it back. The pass is over the patched list and costs
  // nothing when no comment answers a change.
  const linked = linkRevisionReplies(patched);
  // The same cards in the same order are the same queue: every cache keyed on the queue (rail
  // order, placements, highlights) then holds across a keystroke that changed no card.
  return linked.length === cached.length && linked.every((item, index) => item === cached[index])
    ? cached
    : linked;
}

/**
 * The cached comments anchored in `paragraphId`, each with the ends that sit there read again
 * from the paragraph's markers; null when one cannot be: it has no proper range, or a marker it
 * needs is no longer in the paragraph, and the caller derives the whole queue.
 */
function remappedComments(
  cached: readonly ReviewItem[],
  part: OoxmlPart,
  paragraphId: string
): Map<ReviewCommentItem, ReviewCommentItem> | null {
  const remapped = new Map<ReviewCommentItem, ReviewCommentItem>();
  let markers: ReturnType<typeof commentMarkersOfParagraph> | undefined;
  for (const item of cached) {
    if (item.kind !== 'comment' || !commentTouchesParagraph(item, paragraphId)) continue;
    const range = item.range;
    if (!range || item.orphaned) return null;
    if (!markers) {
      const paragraph = findNode(part, paragraphId);
      if (!paragraph || paragraph.kind !== 'paragraph') return null;
      markers = commentMarkersOfParagraph(paragraph);
    }
    const offsetOf = (kind: 'start' | 'end'): number | undefined => {
      const found = markers!.filter((point) => point.commentId === item.id && point.kind === kind);
      return found.length === 1 ? found[0]!.offset : undefined;
    };
    const start = range.start.paragraphId === paragraphId ? offsetOf('start') : range.start.offset;
    const end = range.end.paragraphId === paragraphId ? offsetOf('end') : range.end.offset;
    if (start === undefined || end === undefined) return null;
    if (start === range.start.offset && end === range.end.offset) continue;
    remapped.set(item, {
      ...item,
      range: {
        ...range,
        start: { ...range.start, offset: start },
        end: { ...range.end, offset: end },
      },
    });
  }
  return remapped;
}

function isRevisionWhollyInParagraph(item: ReviewRevisionItem, paragraphId: string): boolean {
  return (
    item.ranges.length > 0 &&
    item.ranges.every(
      (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
    )
  );
}

/**
 * A paragraph-property change that spans paragraphs, as one review decision. A text-local edit
 * leaves every paragraph's properties as they were, so the group still holds.
 */
function isParagraphPropertyGroup(item: ReviewRevisionItem): boolean {
  return item.revisionKind === 'format' && item.formattingKind === 'pPrChange';
}

/**
 * The cached paragraph-property groups that cross the dirty paragraph, each rebuilt with that
 * paragraph's fresh ranges, and the local items they take in. A paragraph walk sees only its
 * own part of such a group, as an item of its own; the cached group already holds it.
 */
function absorbedIntoGroups(
  cached: readonly ReviewItem[],
  paragraphOrder: ReadonlyMap<string, number>,
  dirtyParagraphId: string,
  localRevisions: readonly ReviewRevisionItem[]
): {
  readonly groups: ReadonlyMap<ReviewRevisionItem, ReviewRevisionItem>;
  readonly absorbed: ReadonlySet<ReviewRevisionItem>;
} {
  const groups = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  const absorbed = new Set<ReviewRevisionItem>();
  const groupOfSite = new Map<string, ReviewRevisionItem>();
  for (const item of cached) {
    if (
      item.kind === 'revision' &&
      isParagraphPropertyGroup(item) &&
      revisionCrossesParagraphBoundary(item, dirtyParagraphId)
    ) {
      for (const id of revisionSiteNodeIdsOf(item)) groupOfSite.set(id, item);
    }
  }
  if (groupOfSite.size === 0) return { groups, absorbed };
  for (const local of localRevisions) {
    const ids = revisionSiteNodeIdsOf(local);
    const group = ids.length > 0 ? groupOfSite.get(ids[0]!) : undefined;
    if (!group || !ids.every((id) => groupOfSite.get(id) === group)) continue;
    absorbed.add(local);
    const base = groups.get(group) ?? group;
    const ranges = [
      ...base.ranges.filter((range) => range.start.paragraphId !== dirtyParagraphId),
      ...local.ranges,
    ].sort(
      (a, b) =>
        (paragraphOrder.get(a.start.paragraphId) ?? 0) -
          (paragraphOrder.get(b.start.paragraphId) ?? 0) || a.start.offset - b.start.offset
    );
    groups.set(
      group,
      registerRevisionSiteNodeIds({ ...base, ranges }, revisionSiteNodeIdsOf(group))
    );
  }
  return { groups, absorbed };
}

export function commentTouchesParagraph(item: ReviewCommentItem, paragraphId: string): boolean {
  if (!item.range) return false;
  return item.range.start.paragraphId === paragraphId || item.range.end.paragraphId === paragraphId;
}

/**
 * True for a revision ANCHORED to this paragraph whose markup lives outside it.
 *
 * A tracked ROW is the case: `w:trPr/w:ins` and the `w:cellIns` beside it sit on the row and
 * its cells, and the site index anchors all of them to the row's FIRST paragraph so the card
 * has somewhere to point. The patch replaces every cached revision "wholly inside" the dirty
 * paragraph with what a walk of that paragraph's SUBTREE finds — which holds none of those
 * markers. So typing in that first cell dropped the row's card while the row stayed painted
 * as a proposal: a change on screen with nothing left to accept it by.
 */
export function revisionAnchoredOutsideParagraph(
  item: ReviewRevisionItem,
  paragraphId: string
): boolean {
  return (
    item.revisionKind === 'structural' &&
    item.ranges.some(
      (range) => range.start.paragraphId === paragraphId || range.end.paragraphId === paragraphId
    )
  );
}

export function revisionCrossesParagraphBoundary(
  item: ReviewRevisionItem,
  paragraphId: string
): boolean {
  if (item.ranges.length === 0) return false;
  const touches = item.ranges.some(
    (range) => range.start.paragraphId === paragraphId || range.end.paragraphId === paragraphId
  );
  if (!touches) return false;
  return !item.ranges.every(
    (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
  );
}

/** The inputs a carried queue depends on, at the time of `change`. */
export interface ReviewPatchInputs {
  readonly part: OoxmlPart;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
  readonly currentPackageRevision: number;
  readonly currentPackage: OoxmlPackage;
  readonly changePackage: OoxmlPackage | null;
}

/** Whether `change` is one body commit after `cache`, with every other queue input unchanged. */
export function onlyBodyChanged(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  inputs: ReviewPatchInputs
): boolean {
  if (change.fromRevision !== cache.bodyRevision) return false;
  // Body text-local edits bump package revision by exactly one. A header/footer or package
  // write can move package revision without moving the body revision — patching against a
  // queue derived before that would keep stale furniture cards by reference. A list
  // definition written just before the edit moves it too; that write is allowed only when
  // the edit was the last write and every other input is the same object.
  if (
    inputs.currentPackageRevision !== cache.packageRevision + 1 &&
    (inputs.changePackage !== inputs.currentPackage ||
      !reviewInputsUnchanged(cache.pkg, inputs.currentPackage, inputs.part.name))
  ) {
    return false;
  }
  if (change.story !== undefined && change.story.kind !== 'body') return false;
  if (change.impact === 'global') return false;
  return (
    cache.commentsPart === inputs.commentsPart &&
    cache.commentsExtendedPart === inputs.commentsExtendedPart
  );
}

/**
 * The paragraph whose mark a formatting change in `paragraphId` can continue from: the previous
 * sibling, or for a cell's first paragraph the previous cell's last one, or for the first cell
 * of a table the paragraph just before the table.
 */
function formattingPredecessor(part: OoxmlPart, paragraphId: string): OoxmlNode | undefined {
  const owner = parentNodeOf(part, paragraphId);
  if (!owner) return undefined;
  const index = owner.children.findIndex((child) => child.id === paragraphId);
  if (owner.kind !== 'tableCell' || owner.children.slice(0, index).some(isBlockChild)) {
    const previous = previousContent(owner.children, index);
    return previous?.kind === 'paragraph' ? previous : undefined;
  }
  const row = parentNodeOf(part, owner.id);
  if (!row) return undefined;
  const cells = row.children.filter((child) => child.kind === 'tableCell');
  const at = cells.indexOf(owner);
  if (at > 0) {
    const cell = cells[at - 1]!;
    const last = cell.kind === 'textValue' ? undefined : cell.children.filter(isBlockChild).at(-1);
    return last?.kind === 'paragraph' ? last : undefined;
  }
  const table = parentNodeOf(part, row.id);
  if (!table || table.children.find((child) => child.kind === 'tableRow') !== row) return undefined;
  const outer = parentNodeOf(part, table.id);
  if (!outer) return undefined;
  const before = previousContent(
    outer.children,
    outer.children.findIndex((child) => child.id === table.id)
  );
  return before?.kind === 'paragraph' ? before : undefined;
}
/** The child before `index`, past position markers such as bookmarks, as the grouping reads it. */
function previousContent(children: readonly OoxmlNode[], index: number): OoxmlNode | undefined {
  for (let at = index - 1; at >= 0; at -= 1) {
    const child = children[at]!;
    if (child.kind !== 'textValue' && !isInertMarker(child)) return child;
  }
  return undefined;
}
const isBlockChild = (node: OoxmlNode): boolean =>
  node.kind === 'paragraph' ||
  node.kind === 'table' ||
  (node.kind === 'generic' && (node.localName === 'sdt' || node.localName === 'customXml'));

/** Whether the paragraph a formatting change in `paragraphId` continues from holds a mark revision. */
export function previousHoldsMarkRevision(part: OoxmlPart, paragraphId: string): boolean {
  const previous = formattingPredecessor(part, paragraphId);
  return (
    previous !== undefined &&
    previous.kind !== 'textValue' &&
    collectRevisionSites({ ...part, root: previous }).some((site) => site.paragraphMark)
  );
}

/**
 * Whether a paragraph split or join leaves the cached queue exactly as it is.
 *
 * Enter and a join move no review markup when neither paragraph holds any and no card starts
 * or ends in them: every card keeps its paragraphs and offsets. A tracked split writes a
 * paragraph-mark revision into the first paragraph, so it fails this check.
 */
export function reviewQueueKeptByStructure(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  items: readonly ReviewItem[],
  inputs: ReviewPatchInputs
): boolean {
  if (!onlyBodyChanged(change, cache, inputs)) return false;
  if (change.splitJoin.length !== 1) return false;
  const entry = change.splitJoin[0]!;
  let involved: readonly string[];
  let survivors: readonly string[];
  if ('split' in entry) {
    if (change.deleted.length > 0) return false;
    if (change.created.length !== 1 || change.created[0] !== entry.split.tail) return false;
    involved = survivors = [entry.split.from, entry.split.tail];
  } else {
    if (change.created.length > 0) return false;
    if (change.deleted.length !== 1 || change.deleted[0] !== entry.join.removed) return false;
    involved = [entry.join.kept, entry.join.removed];
    survivors = [entry.join.kept];
  }
  for (const id of survivors) {
    const paragraph = findNode(inputs.part, id);
    if (!paragraph || paragraph.kind !== 'paragraph') return false;
    if (collectRevisionSites({ ...inputs.part, root: paragraph }).length > 0) return false;
  }
  if (previousHoldsMarkRevision(inputs.part, survivors[0]!)) return false;
  const touches = (paragraphId: string | undefined) =>
    paragraphId !== undefined && involved.includes(paragraphId);
  for (const item of items) {
    const ranges = item.kind === 'revision' ? item.ranges : item.range ? [item.range] : [];
    for (const range of ranges) {
      if (touches(range.start.paragraphId) || touches(range.end.paragraphId)) return false;
    }
  }
  return true;
}

/** Whether the paragraph holds a control that is not the same object it was in `before`. */
export function controlsChangedIn(
  before: OoxmlPackage,
  part: OoxmlPart,
  paragraph: OoxmlNode
): boolean {
  const now = contentControlsIn(paragraph);
  if (now.length === 0) return false;
  const previousPart = before.parts.get(part.name);
  const previous = previousPart ? findNode(previousPart, paragraph.id) : null;
  if (!previous) return true;
  const kept = new Set(contentControlsIn(previous).map((entry) => entry.node));
  return now.some((entry) => !kept.has(entry.node));
}

/** Whether a control the queue lists as a custom node encloses the paragraph. */
export function insideCustomNode(
  part: OoxmlPart,
  paragraphId: string,
  items: readonly ReviewItem[]
): boolean {
  const custom = new Set(items.flatMap((item) => (item.kind === 'custom' ? [item.id] : [])));
  if (custom.size === 0) return false;
  for (let node = parentNodeOf(part, paragraphId); node; node = parentNodeOf(part, node.id)) {
    if (node.kind === 'contentControl' && custom.has(node.id)) return true;
  }
  return false;
}

/** The one paragraph a patch may rebuild, or null to fall back to the full derivation. */
export function localReviewPatchParagraphId(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  items: readonly ReviewItem[],
  inputs: ReviewPatchInputs
): string | null {
  if (!onlyBodyChanged(change, cache, inputs)) return null;
  if (change.dirty.length !== 1) return null;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return null;
  }
  const { part } = inputs;
  const paragraphId = change.dirty[0]!;
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  if (change.impact !== 'text-local') {
    // A property or list edit can add a formatting change that folds into a neighbor's card.
    // Only a paragraph left with no revision markup at all is sure to need no card of its own.
    if (collectRevisionSites({ ...part, root: paragraph }).length > 0) return null;
    // A list edit moves the flow, and a paragraph in a table has row and cell markup outside
    // it. Only a paragraph directly in the body has nothing above it to hold a card.
    if (
      change.impact === 'flow-structural' &&
      parentNodeOf(part, paragraphId)?.localName !== 'body'
    ) {
      return null;
    }
  }

  // The patch re-derives revisions only, so a control the edit added or changed would keep the
  // custom-node item it had before, or stay without one. Typing beside a control leaves it the
  // same object, and keeps the fast path.
  if (controlsChangedIn(cache.pkg, part, paragraph)) return null;
  // A BLOCK custom node around the paragraph changes with every edit inside it, and its item has
  // no range to match below. Only a control the queue lists as a custom node is asked about.
  if (insideCustomNode(part, paragraphId, items)) return null;

  // A local edit can CREATE a cross-paragraph group. The cached queue cannot prove
  // that boundary safe: before typing after Enter, only the preceding mark exists.
  if (previousHoldsMarkRevision(part, paragraphId)) return null;

  for (const item of items) {
    if (item.kind === 'comment') {
      // Typing moves a comment's ends within the paragraph; the patch reads them again from
      // its markers (`remappedComments`). Any other edit can move markers between paragraphs.
      if (commentTouchesParagraph(item, paragraphId) && change.impact !== 'text-local') return null;
      continue;
    }
    // A custom node's item is refreshed by the FULL derivation only; a local revision
    // patch on its paragraph could go stale, so refuse the fast path when one touches it.
    if (item.kind === 'custom') {
      if (item.range?.start.paragraphId === paragraphId) return null;
      continue;
    }
    // Full derivation, not the fast path: the paragraph walk cannot see this item's markup,
    // so patching would delete a decision the document still holds.
    if (revisionAnchoredOutsideParagraph(item, paragraphId)) return null;
    if (
      revisionCrossesParagraphBoundary(item, paragraphId) &&
      !(change.impact === 'text-local' && isParagraphPropertyGroup(item))
    )
      return null;
  }
  return paragraphId;
}
