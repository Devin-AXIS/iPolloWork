// The surface's revision filter with the records the review queue leaves out.

import { hiddenReviewSitesOf } from '../binding/review-item-filter.ts';
import type { ReviewDisplayMode } from '../contracts/editor.ts';
import { withHiddenRevisionSites } from '../layout/revision-hidden-sites.ts';
import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

/**
 * `base` leaving out the records `session`'s queue has no card for, in the views that paint
 * markup. Other views paint none, so they keep `base` and its fast paths.
 */
export function withUnlistedRecords(
  base: RevisionAuthorFilter | undefined,
  view: ReviewDisplayMode,
  session: { reviewItems(): readonly ReviewItem[] }
): RevisionAuthorFilter | undefined {
  return view === 'all-markup' || view === 'simple-markup'
    ? withHiddenRevisionSites(
        base,
        hiddenReviewSitesOf(session.reviewItems()),
        view === 'simple-markup'
      )
    : base;
}

/**
 * The surface's revision filter: the reviewer filter for `session`, without the records its
 * queue leaves out, under the review view's own settings. Those records paint no markup, so
 * nothing on the page marks a change that has no card.
 */
export function surfaceRevisionFilter(
  reviewView: {
    filter(filter: RevisionAuthorFilter | undefined): RevisionAuthorFilter | undefined;
    view(): ReviewDisplayMode;
  },
  visibility: {
    filterForSession(session: {
      reviewItems(): readonly ReviewItem[];
    }): RevisionAuthorFilter | undefined;
  },
  session: { reviewItems(): readonly ReviewItem[] }
): RevisionAuthorFilter | undefined {
  return reviewView.filter(
    withUnlistedRecords(visibility.filterForSession(session), reviewView.view(), session)
  );
}
