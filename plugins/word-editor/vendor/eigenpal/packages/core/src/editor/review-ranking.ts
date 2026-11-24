// The review rail's order: cards by the page they sit beside, then by story, then by queue.

import {
  reviewItemGeometry,
  type ReviewItem,
  type ReviewParagraphAnchor,
} from '../layout/index.ts';

type Geometry = { readonly pageIndex: number; readonly y: number } | null;

/** One queue's geometry and order under one layout and package revision. */
export interface ReviewRanking {
  readonly anchors: ReadonlyMap<string, ReviewParagraphAnchor> | null;
  readonly revision: number;
  readonly geometries: readonly Geometry[];
  readonly groups: readonly number[];
  readonly order: readonly number[];
}

/**
 * Rank a queue, per narrowed queue and weakly: the rail's and the commands' queries keep
 * separate ranks, and so do a placed and an unplaced read of one queue. Geometry and rank depend on the queue, the layout and the package alone, so a
 * commit's several reads (rail, commands, highlights) share them instead of sorting every card.
 *
 * A keystroke brings a new layout and revision for the same queue. When every card keeps its
 * page and its story group, the order stands, and the sort of thousands of cards is skipped.
 */
export function createReviewRanker(): (
  items: readonly ReviewItem[],
  anchors: ReadonlyMap<string, ReviewParagraphAnchor> | null,
  revision: number,
  groupOf: (item: ReviewItem) => number
) => ReviewRanking {
  const placed = new WeakMap<readonly ReviewItem[], ReviewRanking>();
  const unplaced = new WeakMap<readonly ReviewItem[], ReviewRanking>();
  return (items, anchors, revision, groupOf) => {
    const rankings = anchors ? placed : unplaced;
    const previous = rankings.get(items);
    if (previous && previous.anchors === anchors && previous.revision === revision) return previous;
    const geometries = items.map((item) => (anchors ? reviewItemGeometry(item, anchors) : null));
    const groups = items.map(groupOf);
    const pageOf = (position: number) => geometries[position]?.pageIndex ?? null;
    const kept =
      previous !== undefined &&
      items.every(
        (_, position) =>
          pageOf(position) === (previous.geometries[position]?.pageIndex ?? null) &&
          groups[position] === previous.groups[position]
      );
    let order = previous?.order;
    if (!kept || !order) {
      const ranked = items.map((_, position) => position);
      ranked.sort((a, b) => {
        const aPage = pageOf(a) ?? Number.MAX_SAFE_INTEGER;
        const bPage = pageOf(b) ?? Number.MAX_SAFE_INTEGER;
        if (aPage !== bPage) return aPage - bPage;
        if (groups[a] !== groups[b]) return groups[a]! - groups[b]!;
        return a - b;
      });
      order = ranked;
    }
    const ranking = { anchors, revision, geometries, groups, order };
    rankings.set(items, ranking);
    return ranking;
  };
}

/**
 * Hand back the previous placement list when every placement in `next` is the object it was.
 * A keystroke that moves no card then gives the rail the same list, and its memos skip the
 * work that compares thousands of cards. A placed and an unplaced read of one queue keep
 * separate lists.
 */
export function createPlacementKeeper<T>(): (
  items: readonly ReviewItem[],
  placed: boolean,
  next: readonly T[]
) => readonly T[] {
  const placedLists = new WeakMap<readonly ReviewItem[], readonly T[]>();
  const unplacedLists = new WeakMap<readonly ReviewItem[], readonly T[]>();
  return (items, placed, next) => {
    const previous = placed ? placedLists : unplacedLists;
    const last = previous.get(items);
    if (
      last &&
      last.length === next.length &&
      last.every((placement, index) => placement === next[index])
    )
      return last;
    previous.set(items, next);
    return next;
  };
}
