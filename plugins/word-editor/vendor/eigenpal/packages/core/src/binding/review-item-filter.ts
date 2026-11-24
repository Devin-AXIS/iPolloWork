// A last pass over the review queue, supplied by the lane that mounts the session.
//
// Some questions about a review item need the style hierarchy, which this lane cannot import.
// The editor attaches the pass to the review model it hands the session, and the session runs
// it on the final queue of every derivation path (full, memoized and locally patched), so
// every reader of `reviewItems()` sees the same queue.

import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { ReviewItem } from '../store/store/review-items.ts';
import {
  paragraphsTouchedBy,
  stylesAndNumberingKey,
  unlistedSitesOf,
} from '../store/store/review-unlisted-sites.ts';

/** What the pass reads besides the queue. */
export interface ReviewItemFilterInputs {
  readonly pkg: OoxmlPackage;
  readonly stylesRoot: OoxmlElement | null;
  readonly numberingRoot: OoxmlElement | null;
}

/**
 * Returns the queue it was given when it removes nothing. A function of the items and the
 * inputs alone, so the session runs it on new items only and keeps what it already filtered
 * while the inputs stay the same.
 */
export type ReviewItemFilter = <T extends ReviewItem>(
  items: readonly T[],
  inputs: ReviewItemFilterInputs
) => readonly T[];

const filters = new WeakMap<ReviewModuleContribution, ReviewItemFilter>();

/** Attach `filter` to `model`, and return `model`. */
export function withReviewItemFilter<T extends ReviewModuleContribution>(
  model: T,
  filter: ReviewItemFilter
): T {
  filters.set(model, filter);
  return model;
}

/** The pass attached to `model`, if any. */
export function reviewItemFilterOf(
  model: ReviewModuleContribution | undefined
): ReviewItemFilter | undefined {
  return model ? filters.get(model) : undefined;
}

/** The filter inputs a queue was derived with, as the session keeps them. */
interface FilteredWith {
  readonly stylesPart: OoxmlPart | undefined;
  readonly numberingRoot: OoxmlElement | null;
}

/** Records with no card, by change-element node id, and the paragraphs that hold them. */
export interface HiddenReviewSites {
  readonly sites: ReadonlySet<string>;
  /**
   * Each paragraph a left-out item touches, keyed by the sorted site ids of those items. A
   * paragraph whose key changes lays its markup out again, even when the paragraph did not.
   */
  readonly paragraphs: ReadonlyMap<string, string>;
  /** Names the styles and numbering the records were decided against. */
  readonly key: string;
  /**
   * Paragraphs a left-out item touches together with another paragraph. A paragraph walk sees
   * only its own part of such an item, so an edit there has to derive the whole queue.
   */
  readonly spanning: ReadonlySet<string>;
}

/** The records each published queue leaves out, keyed by the queue itself. */
const hiddenSites = new WeakMap<readonly ReviewItem[], HiddenReviewSites>();
const NO_SITES: HiddenReviewSites = {
  sites: new Set(),
  paragraphs: new Map(),
  key: '',
  spanning: new Set(),
};

/**
 * The records `items` leaves out: still in the document, with no card. Paint leaves them
 * unmarked, so no change bar or format mark points at a missing card. Empty for a queue this
 * lane did not publish.
 */
export function hiddenReviewSitesOf(items: readonly ReviewItem[]): HiddenReviewSites {
  return hiddenSites.get(items) ?? NO_SITES;
}

/** Whether a filter could leave `item` out: only property changes are ever left out. */
function couldHide(item: ReviewItem): boolean {
  return (
    item.kind === 'revision' &&
    item.revisionKind === 'format' &&
    (item.formattingKind === 'pPrChange' || item.formattingKind === 'rPrChange')
  );
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
}

function sameMap(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, value] of right) if (left.get(id) !== value) return false;
  return true;
}

/** `next` when its contents differ from `before`, else `before`, so identity means content. */
function settled(before: HiddenReviewSites, next: HiddenReviewSites): HiddenReviewSites {
  return before.key === next.key &&
    sameSet(before.sites, next.sites) &&
    sameMap(before.paragraphs, next.paragraphs) &&
    sameSet(before.spanning, next.spanning)
    ? before
    : next;
}

/**
 * The session's pass for one derivation.
 *
 * `filtered` runs `model`'s filter, or hands the list back when it has none. `sameFilter` says
 * whether `previous` was filtered against the same inputs; the fast paths reuse filtered items,
 * so they hold only while it is true. A numbering change alone keeps them when the previous
 * queue holds no property change the filter could have decided differently. `publish` records
 * which sites the final queue leaves out: a full derivation's own, or, for a queue patched from
 * `previous.items`, the earlier ones updated by each list `filtered` saw. A set with the
 * same contents keeps its identity, so filters built from it stay cached.
 */
export function reviewItemFiltering(
  model: ReviewModuleContribution,
  pkg: OoxmlPackage,
  current: FilteredWith,
  previous: (FilteredWith & { readonly items: readonly ReviewItem[] }) | null
): {
  readonly filtered: <T extends ReviewItem>(list: readonly T[]) => readonly T[];
  readonly sameFilter: boolean;
  /** Whether the local patch of `paragraphId` holds: the filter's inputs are the same, and no
   * left-out item spans that paragraph and another. */
  readonly patchable: (paragraphId: string) => boolean;
  readonly publish: (items: readonly ReviewItem[]) => readonly ReviewItem[];
} {
  const filter = reviewItemFilterOf(model);
  const inputs = {
    pkg,
    stylesRoot: current.stylesPart?.root ?? null,
    numberingRoot: current.numberingRoot,
  };
  const before = previous ? hiddenReviewSitesOf(previous.items) : NO_SITES;
  const key = stylesAndNumberingKey(inputs.stylesRoot, inputs.numberingRoot);
  type Pass = {
    result: object;
    removed: string[];
    paragraphs: Map<string, string>;
    spanning: string[];
    touched: string[];
    kept: string[];
  };
  // Every list `filtered` saw: a decision patches several paragraphs, one pass each.
  const passes: Pass[] = [];
  const sameFilter =
    previous !== null &&
    previous.stylesPart === current.stylesPart &&
    (previous.numberingRoot === current.numberingRoot ||
      (before.sites.size === 0 && !previous.items.some(couldHide)));
  return {
    filtered: (list) => {
      if (!filter) return list;
      const kept = filter(list, inputs);
      // By id: relinking replies after the filter gives kept items new objects.
      const keptIds = new Set(kept.map((item) => item.id));
      const removed = unlistedSitesOf(list.filter((item) => !keptIds.has(item.id)));
      passes.push({
        result: kept,
        removed: removed.sites,
        paragraphs: removed.paragraphs,
        spanning: removed.spanning,
        touched: paragraphsTouchedBy(list),
        kept: unlistedSitesOf(kept).sites,
      });
      return kept;
    },
    sameFilter,
    patchable: (paragraphId) => sameFilter && !before.spanning.has(paragraphId),
    publish: (items) => {
      if (!filter) return items;
      // A patch that changes no card hands back the queue it started from; its passes can
      // still have changed which records that queue leaves out.
      // A queue published before, other than the one patched, already holds its own record.
      if (hiddenSites.has(items) && (passes.length === 0 || items !== previous?.items))
        return items;
      const local = passes.at(-1);
      if (local?.result === items) {
        const fresh = {
          sites: new Set(local.removed),
          paragraphs: local.paragraphs,
          key,
          spanning: new Set(local.spanning),
        };
        hiddenSites.set(items, settled(before, fresh));
        return items;
      }
      if (!local) {
        hiddenSites.set(items, before.key === key ? before : { ...before, key });
        return items;
      }
      if (
        before.key === key &&
        passes.every(
          (pass) => pass.removed.length === 0 && !pass.kept.some((id) => before.sites.has(id))
        )
      ) {
        hiddenSites.set(items, before);
        return items;
      }
      const sites = new Set(before.sites);
      const paragraphs = new Map(before.paragraphs);
      const spanning = new Set(before.spanning);
      for (const pass of passes) {
        for (const id of pass.kept) sites.delete(id);
        for (const id of pass.removed) sites.add(id);
        // The patched paragraph's entries are its own walk's answer now.
        for (const id of pass.touched) paragraphs.delete(id);
        for (const [id, value] of pass.paragraphs) paragraphs.set(id, value);
        for (const id of pass.touched) spanning.delete(id);
        for (const id of pass.spanning) spanning.add(id);
      }
      hiddenSites.set(items, settled(before, { sites, paragraphs, key, spanning }));
      return items;
    },
  };
}
