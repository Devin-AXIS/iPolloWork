import type { TrackedChangeFilterMode, TrackedChangePredicate } from '../contracts/editor.ts';
import {
  revisionSiteNodeIdsOf,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import { linkRevisionReplies } from '../store/store/review-reads.ts';
import {
  EMPTY_REVISION_AUTHOR_SET,
  revisionAuthorFilter,
  type RevisionAttribution,
  type RevisionAuthorFilter,
} from '../layout/revision-projection.ts';

interface RevisionFilterSession {
  reviewItems(): readonly ReviewItem[];
}

/** Mutable view state shared by the facade and its currently mounted surface. */
export interface RevisionAuthorVisibility {
  readonly hiddenAuthors: ReadonlySet<string>;
  readonly hiddenAuthorList: readonly string[];
  readonly stateKey: string;
  readonly hasFilter: boolean;
  /** Whether a tracked change predicate is set, whatever the author filter does. */
  readonly hasPredicate: boolean;
  filterFor(items: readonly ReviewItem[]): RevisionAuthorFilter | undefined;
  filterForSession(session: RevisionFilterSession): RevisionAuthorFilter | undefined;
  filterItems(items: readonly ReviewItem[]): readonly ReviewItem[];
  includesRevisionItem(item: ReviewRevisionItem): boolean;
  setPredicate(predicate: TrackedChangePredicate | null, mode?: TrackedChangeFilterMode): boolean;
  isVisible(author: string): boolean;
  setVisible(author: string, visible: boolean): boolean;
  setAllVisible(authors: Iterable<string>, visible: boolean): boolean;
  showAll(): boolean;
}

interface ReviewAuthorCommands {
  isReviewAuthorVisible(author: string): boolean;
  setReviewAuthorVisible(author: string, visible: boolean): void;
  setAllReviewAuthorsVisible(visible: boolean): void;
  showAllReviewAuthors(): void;
}

interface ReviewAuthorSurface {
  revisionAuthors(): ReadonlyMap<string, number>;
  setRevisionAuthorVisible(author: string, visible: boolean): void;
  setAllRevisionAuthorsVisible(visible: boolean): void;
}

interface ReviewRevisionSurface {
  readonly session: {
    packageRevision(): number;
    revision(): number;
  };
}

/**
 * A monotonic signal that moves exactly when the review queue or its chrome inputs can move.
 * Kept outside the facade composition root so preserving this explanation never competes
 * with that file's hard line cap.
 */
export function createReviewRevisionTicker(input: {
  readonly surface: () => ReviewRevisionSurface | null;
  readonly activeKey: () => string | null;
  readonly paneOpen: () => boolean;
  readonly selectionAnchor: () => number | null;
  readonly authorFilterKey: () => string;
}): () => number {
  let tick = 0;
  let seenSurface: ReviewRevisionSurface | null = null;
  let seenRevision = '';
  let seenActive: string | null = null;
  let seenPaneOpen = true;
  let seenSelectionAnchor: number | null = null;
  let seenAuthorFilter = '';
  return () => {
    const surface = input.surface();
    // Both revisions matter: a furniture edit moves only the package revision. Surface
    // identity covers a fresh load, while the active key and selection cover caret-only UI.
    const revision = `${surface?.session.packageRevision() ?? -1}:${surface?.session.revision() ?? -1}`;
    const active = input.activeKey();
    const paneOpen = input.paneOpen();
    const selectionAnchor = input.selectionAnchor();
    const authorFilter = input.authorFilterKey();
    if (
      surface !== seenSurface ||
      revision !== seenRevision ||
      active !== seenActive ||
      paneOpen !== seenPaneOpen ||
      selectionAnchor !== seenSelectionAnchor ||
      authorFilter !== seenAuthorFilter
    ) {
      seenSurface = surface;
      seenRevision = revision;
      seenActive = active;
      seenPaneOpen = paneOpen;
      seenSelectionAnchor = selectionAnchor;
      seenAuthorFilter = authorFilter;
      tick += 1;
    }
    return tick;
  };
}

export function createRevisionAuthorVisibility(
  initial: Iterable<string> = []
): RevisionAuthorVisibility {
  let hidden = new Set(initial);
  let hiddenList: readonly string[] = Object.freeze([...hidden]);
  let authorOnlyFilter = revisionAuthorFilter(hidden);
  let predicate: TrackedChangePredicate | null = null;
  let predicateMode: TrackedChangeFilterMode = 'accept';
  let predicateBeforePending: TrackedChangePredicate | null = null;
  let predicateModeBeforePending: TrackedChangeFilterMode = 'accept';
  let predicateDecisionsBeforePending = new WeakMap<ReviewRevisionItem, boolean>();
  let seenItemsBeforePending: readonly ReviewItem[] | null = null;
  let predicatePending = false;
  let stateVersion = 0;
  let authorSeenItems: readonly ReviewItem[] | null = null;
  let authorFilteredItems: readonly ReviewItem[] = [];
  let seenItems: readonly ReviewItem[] | null = null;
  let filteredItems: readonly ReviewItem[] = [];
  let filter: RevisionAuthorFilter | undefined = authorOnlyFilter;
  let filterHiddenAuthors: ReadonlySet<string> = hidden;
  let filterExcludedNodeIds: ReadonlySet<string> = new Set();
  let filterPredicateMode: TrackedChangeFilterMode = 'accept';
  let excludedRevisions = new WeakSet<ReviewRevisionItem>();
  let predicateDecisions = new WeakMap<ReviewRevisionItem, boolean>();
  let completedDecisions = new Map<string, boolean>();

  const invalidate = (): void => {
    stateVersion += 1;
    authorSeenItems = null;
    authorFilteredItems = [];
    seenItems = null;
  };

  const decisionKey = (item: ReviewRevisionItem): string =>
    JSON.stringify([item.id, revisionSiteNodeIdsOf(item)]);

  const commitProjection = (
    items: readonly ReviewItem[],
    nextExcludedRevisions: WeakSet<ReviewRevisionItem>,
    predicateExcluded: readonly ReviewRevisionItem[]
  ): void => {
    const excludedNodeIds = excludedRevisionNodeIds(predicateExcluded);
    const hiddenSnapshot = hidden;
    const publicHiddenSnapshot = authorOnlyFilter?.hiddenAuthors ?? EMPTY_REVISION_AUTHOR_SET;
    const modeSnapshot = predicateMode;
    let nextFilter: RevisionAuthorFilter | undefined;
    if (
      hiddenSnapshot === filterHiddenAuthors &&
      sameStringSet(excludedNodeIds, filterExcludedNodeIds) &&
      (excludedNodeIds.size === 0 || modeSnapshot === filterPredicateMode)
    ) {
      nextFilter = filter;
    } else if (excludedNodeIds.size === 0 && hiddenSnapshot.size === 0) {
      nextFilter = undefined;
    } else {
      nextFilter = Object.freeze({
        hiddenAuthors: publicHiddenSnapshot,
        includes: (revision: RevisionAttribution) =>
          !hiddenSnapshot.has(revision.author) && !excludedNodeIds.has(revision.nodeId),
        includesNode: (nodeId: string, author: string) =>
          !hiddenSnapshot.has(author) && !excludedNodeIds.has(nodeId),
        excludedNodeMode: (nodeId: string, author: string) =>
          hiddenSnapshot.has(author)
            ? 'proposed'
            : excludedNodeIds.has(nodeId) && modeSnapshot === 'reject'
              ? 'original'
              : 'proposed',
        cacheKey: revisionFilterCacheKey(hiddenSnapshot, excludedNodeIds, modeSnapshot),
      });
    }
    const keptItems: ReviewItem[] = [];
    for (const item of items) {
      const author = reviewItemAuthorOrNull(item);
      if (author !== null && hiddenSnapshot.has(author)) continue;
      if (item.kind === 'revision' && nextExcludedRevisions.has(item)) continue;
      keptItems.push(item);
    }
    filteredItems =
      keptItems.length === items.length ? items : linkRevisionReplies<ReviewItem>(keptItems);
    seenItems = items;
    excludedRevisions = nextExcludedRevisions;
    filter = nextFilter;
    filterHiddenAuthors = hiddenSnapshot;
    filterExcludedNodeIds = excludedNodeIds;
    filterPredicateMode = modeSnapshot;
    predicatePending = false;
    predicateBeforePending = null;
    predicateModeBeforePending = 'accept';
    predicateDecisionsBeforePending = new WeakMap<ReviewRevisionItem, boolean>();
    seenItemsBeforePending = null;
  };

  const sync = (items: readonly ReviewItem[]): void => {
    if (items === seenItems) return;
    const nextExcludedRevisions = new WeakSet<ReviewRevisionItem>();
    const predicateExcluded: ReviewRevisionItem[] = [];
    const pendingPredicateDecisions: Array<readonly [ReviewRevisionItem, boolean]> = [];
    try {
      for (const item of items) {
        if (item.kind !== 'revision') continue;
        const includedByAuthor = !hidden.has(item.author);
        let includedByPredicate = predicateDecisions.get(item);
        if (includedByPredicate === undefined) {
          includedByPredicate = predicate?.(item) ?? true;
          pendingPredicateDecisions.push([item, includedByPredicate]);
        }
        if (includedByAuthor && includedByPredicate) continue;
        nextExcludedRevisions.add(item);
        if (!includedByPredicate) predicateExcluded.push(item);
      }
    } catch (error) {
      if (predicatePending) {
        predicate = predicateBeforePending;
        predicateMode = predicateModeBeforePending;
        predicateDecisions = predicateDecisionsBeforePending;
        seenItems = seenItemsBeforePending;
        predicateBeforePending = null;
        predicateModeBeforePending = 'accept';
        predicateDecisionsBeforePending = new WeakMap<ReviewRevisionItem, boolean>();
        seenItemsBeforePending = null;
        stateVersion += 1;
      } else {
        const fallbackExcluded = new WeakSet<ReviewRevisionItem>();
        const fallbackPredicateExcluded: ReviewRevisionItem[] = [];
        for (const item of items) {
          if (item.kind !== 'revision') continue;
          const includedByPredicate = completedDecisions.get(decisionKey(item)) ?? true;
          if (hidden.has(item.author) || !includedByPredicate) fallbackExcluded.add(item);
          if (!includedByPredicate) fallbackPredicateExcluded.push(item);
        }
        commitProjection(items, fallbackExcluded, fallbackPredicateExcluded);
      }
      predicatePending = false;
      throw error;
    }
    for (const [item, decision] of pendingPredicateDecisions) {
      predicateDecisions.set(item, decision);
    }
    const nextCompletedDecisions = new Map<string, boolean>();
    for (const item of items) {
      if (item.kind !== 'revision') continue;
      nextCompletedDecisions.set(decisionKey(item), predicateDecisions.get(item) ?? true);
    }
    completedDecisions = nextCompletedDecisions;
    commitProjection(items, nextExcludedRevisions, predicateExcluded);
  };

  return {
    get hiddenAuthors() {
      return authorOnlyFilter?.hiddenAuthors ?? EMPTY_REVISION_AUTHOR_SET;
    },
    get hiddenAuthorList() {
      return hiddenList;
    },
    get stateKey() {
      return String(stateVersion);
    },
    get hasFilter() {
      return hidden.size > 0 || predicate !== null;
    },
    get hasPredicate() {
      return predicate !== null;
    },
    filterFor(items) {
      if (!predicate) return authorOnlyFilter;
      sync(items);
      return filter;
    },
    filterForSession(session) {
      if (!predicate) return authorOnlyFilter;
      sync(session.reviewItems());
      return filter;
    },
    filterItems(items) {
      if (!predicate) {
        if (hidden.size === 0) return items;
        if (items === authorSeenItems) return authorFilteredItems;
        const keptItems = items.filter((item) => {
          const author = reviewItemAuthorOrNull(item);
          return author === null || !hidden.has(author);
        });
        authorSeenItems = items;
        authorFilteredItems =
          keptItems.length === items.length ? items : linkRevisionReplies<ReviewItem>(keptItems);
        return authorFilteredItems;
      }
      sync(items);
      return filteredItems;
    },
    includesRevisionItem(item) {
      return !excludedRevisions.has(item);
    },
    setPredicate(next, mode = 'accept') {
      if (predicate === null && next === null) return false;
      if (next === null) {
        predicate = null;
        predicateMode = 'accept';
        predicateBeforePending = null;
        predicateModeBeforePending = 'accept';
        predicatePending = false;
        predicateDecisions = new WeakMap<ReviewRevisionItem, boolean>();
        predicateDecisionsBeforePending = new WeakMap<ReviewRevisionItem, boolean>();
        completedDecisions = new Map<string, boolean>();
        seenItemsBeforePending = null;
        filteredItems = [];
        excludedRevisions = new WeakSet<ReviewRevisionItem>();
        filter = authorOnlyFilter;
        filterHiddenAuthors = hidden;
        filterExcludedNodeIds = new Set<string>();
        filterPredicateMode = 'accept';
        invalidate();
        return true;
      }
      predicateBeforePending = predicate;
      predicateModeBeforePending = predicateMode;
      predicateDecisionsBeforePending = predicateDecisions;
      seenItemsBeforePending = seenItems;
      predicatePending = true;
      predicate = next;
      predicateMode = mode;
      predicateDecisions = new WeakMap<ReviewRevisionItem, boolean>();
      invalidate();
      return true;
    },
    isVisible: (author) => !hidden.has(author),
    setVisible(author, visible) {
      if (visible === !hidden.has(author)) return false;
      const next = new Set(hidden);
      if (visible) next.delete(author);
      else next.add(author);
      hidden = next;
      hiddenList = Object.freeze([...next]);
      authorOnlyFilter = revisionAuthorFilter(next);
      invalidate();
      return true;
    },
    setAllVisible(authors, visible) {
      const next = visible ? new Set<string>() : new Set(authors);
      if (next.size === hidden.size && [...next].every((author) => hidden.has(author)))
        return false;
      hidden = next;
      hiddenList = Object.freeze([...next]);
      authorOnlyFilter = revisionAuthorFilter(next);
      invalidate();
      return true;
    },
    showAll() {
      if (hidden.size === 0) return false;
      hidden = new Set();
      hiddenList = Object.freeze([]);
      authorOnlyFilter = undefined;
      invalidate();
      return true;
    },
  };
}

export function filterReviewItemsByAuthor(
  items: readonly ReviewItem[],
  visibility: RevisionAuthorVisibility
): readonly ReviewItem[] {
  return visibility.filterItems(items);
}

function excludedRevisionNodeIds(items: readonly ReviewRevisionItem[]): ReadonlySet<string> {
  const nodeIds = new Set<string>();
  for (const item of items) {
    for (const nodeId of revisionSiteNodeIdsOf(item)) nodeIds.add(nodeId);
  }
  return nodeIds;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function revisionFilterCacheKey(
  hiddenAuthors: ReadonlySet<string>,
  excludedNodeIds: ReadonlySet<string>,
  mode: TrackedChangeFilterMode
): string {
  return JSON.stringify({
    hiddenAuthors: [...hiddenAuthors].sort(),
    excludedNodeIds: [...excludedNodeIds].sort(),
    mode: excludedNodeIds.size === 0 ? 'accept' : mode,
  });
}

export function reviewItemAuthorOrNull(item: {
  readonly kind: string;
  readonly author?: string;
  readonly comment?: { readonly author: string };
}): string | null {
  return item.kind === 'comment' ? (item.comment?.author ?? '') : (item.author ?? null);
}

export function createReviewAuthorCommands(
  visibility: RevisionAuthorVisibility,
  options: {
    readonly enabled: boolean;
    readonly surface: () => ReviewAuthorSurface | null;
    readonly notify: () => void;
  }
): ReviewAuthorCommands {
  const setAll = (visible: boolean): void => {
    if (!options.enabled) return;
    const surface = options.surface();
    if (surface) return surface.setAllRevisionAuthorsVisible(visible);
    // Detached has no reviewer roster. Showing all is knowable; hiding all is not, and an
    // empty roster would invert the command by clearing the authors already hidden.
    if (!visible || !visibility.showAll()) return;
    options.notify();
  };
  return {
    isReviewAuthorVisible: visibility.isVisible,
    setReviewAuthorVisible(author, visible) {
      if (!options.enabled) return;
      const surface = options.surface();
      if (surface) return surface.setRevisionAuthorVisible(author, visible);
      if (!visibility.setVisible(author, visible)) return;
      options.notify();
    },
    setAllReviewAuthorsVisible: setAll,
    showAllReviewAuthors: () => setAll(true),
  };
}
