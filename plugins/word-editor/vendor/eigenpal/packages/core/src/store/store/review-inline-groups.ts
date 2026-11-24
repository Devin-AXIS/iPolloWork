// Inline review grouping retains the source sites for independent resolution.
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewPosition,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { RevisionAddress } from './tree-op-types.ts';

/**
 * Fold chains of ADJACENT items of one kind by one author into single cards.
 *
 * A word struck in several gestures — or re-struck around something a `w:del` cannot
 * contain — lands in the file as several sibling elements under distinct ids. They are one
 * decision to the reviewer. Adjacency uses the same exact
 * end-to-start test, so an untracked character between two
 * deletions keeps them apart.
 *
 * ZERO-WIDTH members are why this is a sweep rather than a lookup keyed by start position.
 * Tracking the removal of a field wraps each `w:fldChar` and each `w:instrText` run in a
 * `w:del` of its own, so a struck form field arrives as several revisions that cover no
 * characters and share one offset with the struck text beside them. They are not separate
 * decisions. A map from start position to item can hold
 * only one of them, which stranded every other one as a blank `Deleted` card. A member
 * covering no characters therefore joins the chain WITHOUT moving its frontier: the
 * revision it sits against still begins where the wrapper does.
 */
export function mergeAdjacentSameKindEdits(
  items: readonly ReviewRevisionItem[],
  order: ReadonlyMap<string, number>,
  /** The content control an item sits in: a control's edge ends a change. */
  containerOf: (item: ReviewRevisionItem) => string = () => ''
): readonly ReviewRevisionItem[] {
  const mergeable = items.filter(
    (item) =>
      (item.revisionKind === 'insert' || item.revisionKind === 'delete') &&
      !item.readOnly &&
      item.ranges.length > 0
  );
  if (mergeable.length < 2) return items;

  const keyOf = (position: ReviewPosition): string =>
    `${position.paragraphId}\u0000${position.offset}`;
  // A chain never crosses kinds or authors, so each pair sweeps on its own. The sweep needs
  // each bucket in document order, and `mergeable` almost always already is: the site walk
  // that built the items runs in document order. It is only ALMOST, because an item is
  // positioned by its first LOCATED site, and a site inside a drawing or a text box has no
  // location at all — so a group that starts in one carries a later range than its place in
  // the list claims. Checking costs one pass and sorting is skipped whenever it holds.
  const buckets = new Map<string, ReviewRevisionItem[]>();
  for (const item of mergeable) {
    const key = JSON.stringify([item.revisionKind, item.author, item.nesting, containerOf(item)]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  // Position as a PAIR, not the packed rank the queue itself sorts by: that one folds the
  // offset into a fixed stride and clamps it, so every offset past the clamp in one
  // paragraph scores the same — and a bucket ordered by it would report itself sorted in
  // exactly the paragraph long enough to reach it. Coincident members compare EQUAL, and the
  // sort is stable, so wrappers sharing one offset keep the order the file wrote them in;
  // the sort fixes where a decision SITS, never how two at one offset are stacked. `order`
  // is total over the paragraphs a located site can name, so the fallback below asserts that
  // rather than guarding it: it would rank an unmapped paragraph FIRST, not last.
  const compare = (a: ReviewRevisionItem, b: ReviewRevisionItem): number => {
    const first = a.ranges[0]!.start;
    const second = b.ranges[0]!.start;
    const paragraph = (order.get(first.paragraphId) ?? 0) - (order.get(second.paragraphId) ?? 0);
    return paragraph !== 0 ? paragraph : first.offset - second.offset;
  };
  for (const bucket of buckets.values()) {
    let sorted = true;
    for (let index = 1; index < bucket.length && sorted; index += 1) {
      sorted = compare(bucket[index - 1]!, bucket[index]!) <= 0;
    }
    if (!sorted) bucket.sort(compare);
  }

  const consumed = new Set<string>();
  const merged = new Map<string, ReviewRevisionItem>();
  for (const bucket of buckets.values()) {
    let chain: ReviewRevisionItem[] = [];
    let frontier = '';
    const close = (): void => {
      if (chain.length > 1) {
        merged.set(chain[0]!.id, foldChain(chain));
        for (let index = 1; index < chain.length; index += 1) consumed.add(chain[index]!.id);
      }
      chain = [];
    };
    for (const item of bucket) {
      const start = keyOf(item.ranges[0]!.start);
      if (chain.length > 0 && start !== frontier) close();
      const opening = chain.length === 0;
      chain.push(item);
      // Covering no characters leaves the frontier where it is, so the next member is still
      // measured against the text this wrapper sits in front of. An opening member sets the
      // frontier either way: there is nothing yet for it to sit in front of.
      if (opening || coversCharacters(item)) {
        frontier = keyOf(item.ranges[item.ranges.length - 1]!.end);
      }
    }
    close();
  }
  if (merged.size === 0) return items;

  const out: ReviewRevisionItem[] = [];
  for (const item of items) {
    if (consumed.has(item.id)) continue;
    out.push(merged.get(item.id) ?? item);
  }
  return out;
}

/**
 * Whether a revision covers any text at all.
 *
 * Asked per RANGE rather than of the whole span, because a group's outermost start and end
 * can differ while every range in it is a point: the wrappers a tracked field is made of are
 * empty, and a group that reuses one id across two paragraphs holds two of them.
 */
function coversCharacters(item: ReviewRevisionItem): boolean {
  return item.ranges.some(
    (range) =>
      range.start.paragraphId !== range.end.paragraphId || range.start.offset !== range.end.offset
  );
}

/** One card from a chain of adjacent same-kind halves, in document order. */
function foldChain(chain: readonly ReviewRevisionItem[]): ReviewRevisionItem {
  const first = chain[0]!;
  const addresses = [...first.addresses];
  const ranges = [...first.ranges];
  const siteNodeIds = [...revisionSiteNodeIdsOf(first)];
  let text = first.text;
  let date = first.date;
  for (const next of chain.slice(1)) {
    for (const address of next.addresses) {
      if (!addresses.some((known) => sameAddress(known, address))) addresses.push(address);
    }
    for (const range of next.ranges) ranges.push(range);
    for (const nodeId of revisionSiteNodeIdsOf(next)) siteNodeIds.push(nodeId);
    text += next.text;
    date = laterStamp(date, next.date);
  }
  return registerRevisionSiteNodeIds(
    {
      ...first,
      id: chain.map((item) => item.id).join('+'),
      addresses,
      ranges,
      text,
      ...(date === undefined ? {} : { date }),
    },
    siteNodeIds
  );
}

/** The later of two stamps; the first one when they cannot be compared. */
function laterStamp(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return a;
  return second > first ? b : a;
}

/** Two addresses naming one revision. */
function sameAddress(a: RevisionAddress, b: RevisionAddress): boolean {
  return a.id === b.id && a.author === b.author && (a.date ?? '') === (b.date ?? '');
}
