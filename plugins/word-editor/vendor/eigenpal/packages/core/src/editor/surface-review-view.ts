// The review VIEW a surface shows, kept apart from the projection its layout performs.
//
// Word offers four views; the layout knows three projections. Simple Markup is the fourth:
// it lays out the proposal and paints a red change bar where the view answered a change.
// The surface names the view, the layout gets the projection, and paint gets the bars.

import {
  DEFAULT_REVISION_DISPLAY_MODE,
  layoutProjectionOf,
  withPlainResolvedMarkup,
  type ReviewDisplayMode,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from '../layout/revision-projection.ts';
import type { ChangeBarsMode } from '../output/semantic-paint-change-bars.ts';

export interface ReviewViewState {
  /** The view the reader chose, as the chrome names it. */
  readonly view: () => ReviewDisplayMode;
  /** The projection the layout performs for it: Simple Markup lays out the proposal. */
  readonly projection: () => RevisionDisplayMode;
  /** Which change bars paint draws: the view's own, not the projection's. */
  readonly changeBars: () => ChangeBarsMode;
  /** Adopt a view. */
  readonly set: (mode: ReviewDisplayMode) => void;
  /**
   * The reviewer filter the layout gets. With a review module the resolved views are Word's:
   * kept content paints plain. The free engine keeps its own reading of the proposal —
   * insertions in the author's ink — so its filter passes through untouched, as does every
   * All Markup filter.
   */
  readonly filter: (base: RevisionAuthorFilter | undefined) => RevisionAuthorFilter | undefined;
  /**
   * Word's toggle: a click on a change bar swaps Simple and All Markup through the surface's
   * own setter, whose change notification the host already mirrors. Nothing without a review
   * module: the free engine's bars are not a toggle into views it cannot name.
   */
  readonly toggleByChangeBar: () => void;
}

export function createReviewViewState(
  initial: ReviewDisplayMode | undefined,
  reviewEnabled: boolean,
  apply: (mode: ReviewDisplayMode) => void
): ReviewViewState {
  let view: ReviewDisplayMode = initial ?? DEFAULT_REVISION_DISPLAY_MODE;
  return {
    view: () => view,
    projection: () => layoutProjectionOf(view),
    changeBars: () => {
      // The free engine paints the proposal WITH its insertions attributed, so it keeps the
      // bars beside them too; the review views draw theirs, and the resolved ones none.
      if (!reviewEnabled) return 'all-markup';
      return view === 'all-markup' || view === 'simple-markup' ? view : 'none';
    },
    set: (mode) => {
      view = mode;
    },
    // Only where it changes anything: All Markup keeps every attribution whatever the policy,
    // and a defined filter there would cost every `!authorFilter` fast path in the layout.
    filter: (base) =>
      reviewEnabled && layoutProjectionOf(view) !== 'all-markup'
        ? withPlainResolvedMarkup(base)
        : base,
    toggleByChangeBar: () => {
      if (!reviewEnabled) return;
      apply(view === 'simple-markup' ? 'all-markup' : 'simple-markup');
    },
  };
}
