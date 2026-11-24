// The review rail's view of one review item, reused while nothing it shows has changed.

import type { ReviewItemPlacement } from '../contracts/editor.ts';
import {
  commentBodyText,
  commentInitials,
  reviewItemKey,
  type ReviewItem,
} from '../layout/index.ts';
import { withDisplayedHyphens } from '../store/package/hyphen-text.ts';
import { initialsOfAuthor } from './docx-editor-author.ts';
import { dateOfReviewItem } from './docx-editor-review-commands.ts';

/** What a placement reads besides the item itself. */
export interface ReviewPlacementInputs {
  readonly anchorY: number | null;
  readonly pageIndex: number | null;
  /**
   * Derived from the two facts activation itself checks, so the flag and the verb cannot
   * disagree. Not from the geometry, which is null for a whole page that has not been laid out
   * yet: an item is addressable long before it has a Y.
   */
  readonly activatable: boolean;
  /** A pair is active when either half is; an open replacement makes both halves active. */
  readonly isActive: boolean;
  /** Whether document protection locks every review decision. */
  readonly locked: boolean;
}

type CachedPlacement = {
  readonly inputs: ReviewPlacementInputs;
  readonly placement: ReviewItemPlacement;
};

const placements = new WeakMap<ReviewItem, CachedPlacement>();
/**
 * Placements without geometry, kept apart. Commands read the queue with `placement: false`
 * between the rail's reads; sharing one slot made each read evict the other, so every
 * keystroke rebuilt every card twice.
 */
const unplacedPlacements = new WeakMap<ReviewItem, CachedPlacement>();

function sameInputs(a: ReviewPlacementInputs, b: ReviewPlacementInputs): boolean {
  return (
    a.anchorY === b.anchorY &&
    a.pageIndex === b.pageIndex &&
    a.activatable === b.activatable &&
    a.isActive === b.isActive &&
    a.locked === b.locked
  );
}

/**
 * The placement of `item`. Review items are stable between revisions, so a selection change,
 * which moves only the active card, hands every other card back as the same object instead of
 * building thousands of them again.
 */
export function reviewItemPlacement(
  item: ReviewItem,
  inputs: ReviewPlacementInputs
): ReviewItemPlacement {
  const slot =
    inputs.anchorY === null && inputs.pageIndex === null ? unplacedPlacements : placements;
  const cached = slot.get(item);
  if (cached && sameInputs(cached.inputs, inputs)) return cached.placement;
  const placement = buildPlacement(item, inputs);
  slot.set(item, { inputs, placement });
  return placement;
}

function buildPlacement(item: ReviewItem, inputs: ReviewPlacementInputs): ReviewItemPlacement {
  const date = dateOfReviewItem(item);
  const shared = {
    key: reviewItemKey(item),
    id: item.id,
    ...(date !== undefined ? { date } : {}),
    activatable: inputs.activatable,
    anchorY: inputs.anchorY,
    pageIndex: inputs.pageIndex,
    isActive: inputs.isActive,
  };
  if (item.kind === 'comment') {
    return {
      ...shared,
      kind: 'comment',
      author: item.comment.author,
      initials: commentInitials(item.comment),
      text: commentBodyText(item.comment),
      resolved: item.resolved,
      ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
      ...(item.parentRevisionId !== undefined ? { parentRevisionId: item.parentRevisionId } : {}),
      replyIds: item.replyIds,
      readOnly: false,
      item,
    };
  }
  if (item.kind === 'revision') {
    return {
      ...shared,
      kind: 'revision',
      revisionKind: item.revisionKind,
      author: item.author,
      initials: initialsOfAuthor(item.author),
      text: withDisplayedHyphens(item.text),
      ...(item.replacedText ? { replacedText: withDisplayedHyphens(item.replacedText) } : {}),
      replyIds: item.replyIds,
      readOnly: item.readOnly || inputs.locked,
      item,
    };
  }
  // A custom card is informational: nothing to accept, reject, or reply to.
  return {
    ...shared,
    kind: 'custom',
    author: '',
    initials: '',
    text: item.detail ?? item.text,
    replyIds: [],
    readOnly: true,
    item,
  };
}
