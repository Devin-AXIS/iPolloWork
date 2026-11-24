// Review card placements, split out of `editor.ts` to keep that
// file under its line cap. `editor.ts` re-exports every name here.

import type {
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '../store/store/review-items.ts';

/**
 * What every review card carries, whatever kind of decision it represents.
 *
 * Presentation-ready by design: author, initials, date and text are derived by the ENGINE,
 * because deriving them means walking runs and reading `w15:commentsEx`. An adapter doing that
 * walk would put document derivation in the host and would have to be written once per
 * framework.
 */
export interface ReviewItemPlacementBase {
  /** Stable and unique per decision within this editor instance. */
  readonly key: string;
  /** The engine's own id for the comment, the revision, or the custom node. */
  readonly id: string;
  readonly author: string;
  /** Initials for an avatar: `@w:initials` when the file carries one, else from the name. */
  readonly initials: string;
  /** `@w:date`, absent when the file omits it — Word does when date stamping is off. */
  readonly date?: string;
  /**
   * The comment's body, the words the revision covers, or the custom card's detail.
   *
   * PLAIN TEXT, and it must be rendered as text: a `.docx` is a zip of XML an attacker
   * controls end to end, so this string is untrusted and never markup.
   */
  readonly text: string;
  /**
   * Replies to this item, in document order.
   *
   * Comments AND revisions carry them: OOXML gives `w:ins` and `w:del` no body, so replying
   * to a tracked change writes a comment over the change's own range, and the reply belongs
   * inside the card for the change rather than beside it.
   */
  readonly replyIds: readonly string[];
  /**
   * True when the engine cannot resolve this kind structurally, so accept and reject must
   * not be offered. A card offering a button the engine will refuse is worse than one that
   * explains why it cannot.
   */
  readonly readOnly: boolean;
  /**
   * Whether {@link Editor.setActiveReviewItem} would take this key.
   *
   * False for an item with no resolvable range, for a custom node without `reviewCard`
   * (`carded: false`), and for a revision kind the host's rail excluded through
   * {@link Editor.setReviewActivationExclusions} — the queue still LISTS
   * those, because `getReviewItems` answers "what does this document hold" rather than "what
   * may be clicked", and a host filtering the two apart needs to be told which is which. A
   * card drawn for an item that cannot be activated is a card that does nothing when clicked.
   */
  readonly activatable: boolean;
  /** Document-space Y of the anchor, or null when the item has no resolvable range. */
  readonly anchorY: number | null;
  readonly pageIndex: number | null;
  readonly isActive: boolean;
}

/** A comment thread's card. @public */
export interface ReviewCommentPlacement extends ReviewItemPlacementBase {
  readonly kind: 'comment';
  /** Whether `w15:commentsEx` marks the thread done. */
  readonly resolved: boolean;
  /** The comment this replies to, absent at the top of a thread. */
  readonly parentId?: string;
  /**
   * The REVISION this comment answers, absent unless it does.
   *
   * A surface listing top-level cards must skip these as well as the ones with a
   * {@link parentId}: the card is rendered inside the change it answers, and a rail that
   * only checked `parentId` drew the reply twice.
   */
  readonly parentRevisionId?: string;
  readonly item: ReviewCommentItem;
}

/** A tracked change's card. @public */
export interface ReviewRevisionPlacement extends ReviewItemPlacementBase {
  readonly kind: 'revision';
  /** Which decision this is. */
  readonly revisionKind: ReviewRevisionKind;
  /**
   * The words a replacement decision removes when {@link revisionKind} is `'replace'`.
   * The built-in reader lists separate deletion and insertion cards when the query sets
   * {@link ReviewItemQuery.pairReplacements} to false.
   */
  readonly replacedText?: string;
  readonly item: ReviewRevisionItem;
}

/** A custom node's card (`defineCustomNode` with a `reviewCard` hook). @public */
export interface ReviewCustomPlacement extends ReviewItemPlacementBase {
  readonly kind: 'custom';
  readonly item: ReviewCustomItem;
}

/**
 * A DISCRIMINATED union on {@link ReviewItemPlacementBase.kind}: narrowing the kind
 * narrows `item` and the kind-specific fields with it, so a consumer never writes the
 * `placement.kind === 'custom' && placement.item.kind === 'custom'` double check.
 */
export type ReviewItemPlacement =
  ReviewCommentPlacement | ReviewRevisionPlacement | ReviewCustomPlacement;
