import type { ReviewRevisionKind } from './editor.ts';

/**
 * Narrows what `getReviewItems` returns.
 *
 * Filtering revision kinds is how a host hides structural cards it has no UI for,
 * `placement: false` skips the layout pass entirely when only metadata is wanted, and
 * `pairReplacements: false` lists a typed-over selection as its two halves.
 */
export interface ReviewItemQuery {
  /**
   * Revision kinds to leave out of the returned items, for example structural kinds that the
   * host has no card for. Default: none. Comments and custom items are never removed. This
   * filters only the returned data; to stop the caret from activating the same kinds, call
   * `setReviewActivationExclusions`.
   */
  readonly excludeRevisionKinds?: readonly ReviewRevisionKind[];
  /** When false, skip layout geometry; metadata is unchanged and anchors are null. Default true. */
  readonly placement?: boolean;
  /**
   * Whether to list a deletion and the insertion that touches it as one `'replace'` item.
   * Typing over a selection writes the deletion first; a document compare writes the
   * insertion first. Both pair. Default true. Set it to false to list the deletion and the insertion as
   * separate items, for example to accept or reject each half on its own.
   *
   * A host that steps through the list with `setActiveReviewItem` stops once on
   * each replacement with the default, as Next Change does.
   *
   * Two revisions pair when they are next to each other among the queue's revisions, in
   * either order, both have the same author, nesting level and `readOnly` value, and the
   * first one's last range ends at the same paragraph and offset where the second one's first
   * range starts. The pair takes the first one's place in the list. The pair's `text` is the inserted words and `replacedText` the
   * deleted words. The two halves are not listed separately.
   *
   * Kinds in {@link excludeRevisionKinds} are removed before pairing, so an excluded deletion
   * or insertion never pairs. Excluding `'replace'` removes the pairs too.
   *
   * The pair's `key` is stable while both halves are pending, and every key-addressed verb
   * accepts it whatever query you read it with. Accepting or rejecting it resolves both
   * halves in one transaction and one undo step. Activating it opens the deletion; the pair
   * reports `isActive` while either half is active. A reply anchors over the inserted words,
   * and replies to either half are listed under the pair.
   */
  readonly pairReplacements?: boolean;
}
