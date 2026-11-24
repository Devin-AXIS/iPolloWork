import type { ReviewItem, SemanticLayout } from '../layout/index.ts';
import {
  authorSlotsOf,
  reviewAuthorsOf,
  type ReviewAuthorInfo,
  type RevisionStyles,
  type StableReviewAuthorSlots,
} from '../output/revision-presentation.ts';

interface ReviewAuthorRoster {
  layout: SemanticLayout | null;
  items: readonly ReviewItem[] | null;
  styles: RevisionStyles | undefined;
  value: ReadonlyMap<string, number>;
  resolved: ReadonlyMap<string, ReviewAuthorInfo>;
}

export function reviewItemAuthor(item: ReviewItem): string | null {
  if (item.kind === 'comment') return item.comment.author;
  if (item.kind === 'revision') return item.author;
  return null;
}

/** Keeps the review roster stable while releasing superseded layout graphs. */
export function createSurfaceReviewAuthors(input: {
  readonly layout: () => SemanticLayout;
  readonly items: () => readonly ReviewItem[];
  readonly styles: () => RevisionStyles | undefined;
  readonly slots: StableReviewAuthorSlots;
}): { get(): ReviewAuthorRoster; releaseLayout(): void } {
  let roster: ReviewAuthorRoster | null = null;
  return {
    get() {
      const layout = input.layout();
      const items = input.items();
      const styles = input.styles();
      const prior = roster;
      if (prior?.layout === layout && prior.items === items && prior.styles === styles)
        return prior;
      const next = input.slots.resolve(
        authorSlotsOf(layout),
        (function* authors() {
          for (const item of items) {
            const author = reviewItemAuthor(item);
            if (author !== null) yield author;
          }
        })()
      );
      const previous = prior?.value;
      const unchanged =
        previous !== undefined &&
        previous.size === next.size &&
        [...next].every(([author, slot]) => previous.get(author) === slot);
      const value = unchanged ? previous : next;
      const resolved =
        prior !== null && unchanged && prior.styles === styles
          ? prior.resolved
          : new Map(reviewAuthorsOf(value, styles).map((item) => [item.author, item]));
      roster = { layout, items, styles, value, resolved };
      return roster;
    },
    releaseLayout() {
      if (roster !== null) roster = { ...roster, layout: null, items: null };
    },
  };
}
