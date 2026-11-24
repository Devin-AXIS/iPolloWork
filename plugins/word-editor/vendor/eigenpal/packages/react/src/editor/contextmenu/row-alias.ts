// Deprecated context-menu row ids, still read in this release.
//
// The Add comment row was `review.comments` before it became `review.addComment`. The old id
// is read ONLY on the context menu, where it always named this row. On the toolbar,
// `review.comments` stays the review pane toggle, so the two never collide.

import { menuDevWarning } from '../menu/menu-warnings';

/** The deprecated id of the Add comment row. */
const DEPRECATED_ADD_COMMENT_ROW = 'review.comments';
/** The Add comment row's id. */
const ADD_COMMENT_ROW = 'review.addComment';

/**
 * The packaged row an override names, reading the deprecated `review.comments` as
 * `review.addComment` with a one-time development warning.
 */
export function contextMenuRowId(id: string | null): string | null {
  if (id !== DEPRECATED_ADD_COMMENT_ROW) return id;
  menuDevWarning(
    `The context-menu row "${DEPRECATED_ADD_COMMENT_ROW}" is now "${ADD_COMMENT_ROW}". ` +
      `The old id still works in this release; write "${ADD_COMMENT_ROW}".`
  );
  return ADD_COMMENT_ROW;
}
