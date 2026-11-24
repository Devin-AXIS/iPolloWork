// The comment writes of a tree session: add or reply, resolve, edit the text, delete.
//
// Each one is a package write (`comment-package-write.ts`), so the comments part and the story
// markers commit together.

import {
  addPackageComment,
  deletePackageComments,
  setPackageCommentResolved,
  setPackageCommentText,
  setPackageCommentTexts,
} from '../store/store/comment-package-write.ts';
import type { StoryScope, TreePackageStore } from '../store/store/tree-package-store.ts';
import type { TreeDocxSessionView } from './tree-session-contract.ts';

export type SessionCommentWrites = Pick<
  TreeDocxSessionView,
  | 'replyToComment'
  | 'setCommentResolved'
  | 'setCommentText'
  | 'setCommentTexts'
  | 'deleteComment'
  | 'deleteComments'
>;

/** The session's comment writes over `packageStore`; `bodyScope` is the default story. */
export function sessionCommentWrites(
  packageStore: TreePackageStore,
  bodyScope: StoryScope
): SessionCommentWrites {
  const deleteComments: SessionCommentWrites['deleteComments'] = (
    comments,
    scope = bodyScope,
    noteId,
    options = {}
  ) => deletePackageComments(packageStore, comments, scope, noteId, options.historyToken);

  return {
    replyToComment(
      parentCommentId,
      anchor,
      text,
      author,
      date,
      scope = bodyScope,
      actorId,
      options = {}
    ) {
      // The story that OWNS the anchor. Resolving a refused scope falls back to the body
      // rather than throwing: the caller's next check is the null return either way.
      const result = addPackageComment(
        packageStore,
        {
          anchor: {
            paragraphId: anchor.paragraphId,
            start: anchor.start,
            end: anchor.end,
            // A range that ends in a LATER paragraph is ordinary in OOXML: the start and end
            // markers are independent elements. Dropping the end paragraph would anchor the
            // comment to an offset in the wrong one.
            ...(anchor.endParagraphId === undefined
              ? {}
              : { endParagraphId: anchor.endParagraphId }),
          },
          author,
          text,
          ...(date === undefined ? {} : { date }),
          ...(parentCommentId === null ? {} : { replyToCommentId: parentCommentId }),
          ...(actorId === undefined ? {} : { actorId }),
        },
        scope,
        options.historyToken
      );
      return result.ok ? result.commentId : null;
    },

    setCommentResolved(commentId, resolved, options = {}) {
      return setPackageCommentResolved(packageStore, commentId, resolved, options.historyToken).ok;
    },

    setCommentText(commentId, text, options = {}) {
      return setPackageCommentText(packageStore, commentId, text, options.historyToken).ok;
    },

    setCommentTexts(edits, options = {}) {
      return setPackageCommentTexts(packageStore, edits, options.historyToken).ok;
    },

    deleteComment(commentId, scope = bodyScope, noteId, options) {
      return deleteComments([{ commentId }], scope, noteId, options);
    },

    deleteComments,
  };
}
