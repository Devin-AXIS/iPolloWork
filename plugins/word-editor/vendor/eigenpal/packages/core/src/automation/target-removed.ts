/**
 * The refusal detail for a handle whose object the document no longer holds.
 *
 * An edit, a peer, or an undo removed or merged the object after the handle was issued. A
 * caller can read the document again and find a fresh target. A handle that never named a valid
 * target, such as one of the wrong kind or from another story, uses a different detail, because
 * reading again does not help it.
 */
export const TARGET_REMOVED = 'target-removed';
