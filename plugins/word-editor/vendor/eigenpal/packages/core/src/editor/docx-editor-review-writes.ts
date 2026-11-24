// The review writes a card or a review UI performs outside `exec`: comment, reply, resolve,
// delete, accept, and reject.
//
// Each one takes `HistoryGroupOptions`. A write that names an open handle runs with that
// group bound to the surface, so its store transaction carries the group and the package
// coordinator merges it with the group's other frames. One review decision — resolve the
// changes, write a counter-proposal, add a comment — is then one undo step. A handle that is
// not open on this editor refuses the write before anything is read or written.

import type {
  CommentTextOptions,
  DocumentEditingMode,
  ExecResult,
  HistoryGroupOptions,
  ReviewItemPlacement,
  ReviewItemQuery,
  SemanticPosition,
} from '../contracts/editor.ts';
import { firstReviewRange, type ReviewItem } from '../layout/index.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import { commentForKey, setReviewCommentResolved } from './docx-editor-comment-resolution.ts';
import type { EditorHistoryGroups } from './editor-history-groups.ts';
import { PRO_REVIEW_REASON } from './opening-editing-mode.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { findReviewPlacement, replacementPairHalves } from './review-replacement-pairs.ts';
import { reviewReplyRefusal } from './review-reply.ts';
import { reviewWriteRefusal } from './review-write-refusal.ts';
import { commentBodyText } from '../store/store/review-text.ts';
import { commentPartNameOf } from '../store/store/comment-writes.ts';
import { commentTextEditRefusal } from '../store/store/comment-text-support.ts';
import { revisionDateNow } from '../automation/revision-date.ts';

export interface ReviewWriteDeps {
  readonly reviewEnabled: boolean;
  readonly historyGroups: EditorHistoryGroups;
  surface(): PaginatedSurface | null;
  author(): string | null | undefined;
  editingMode(): DocumentEditingMode;
  commentTargetRange(): { from: SemanticPosition; to: SemanticPosition } | null;
  storyScopeOfParagraph(paragraphId: string): StoryScope;
  storyScopeOfReviewItem(item: ReviewItem): StoryScope;
  noteHomeOf(item: ReviewItem): string | null;
  placements(query?: ReviewItemQuery): readonly ReviewItemPlacement[];
  resolveReviewItem(key: string, action: 'accept' | 'reject'): ExecResult;
  bump(): void;
}

const AMBIGUOUS_OPTIONS: ExecResult = Object.freeze({
  ok: false,
  code: 'invalidArgs',
  reason: 'pass the author as a string and options last, or options alone in place of the author',
});

/**
 * The author position also accepts the options object, so a call needs no placeholder.
 * Anything else that is not text — an array, a class instance, or options in both
 * positions — is refused rather than guessed at.
 */
function authorAndOptions(
  author: unknown,
  options: HistoryGroupOptions | undefined
): [string | undefined, HistoryGroupOptions | undefined] | ExecResult {
  if (author === undefined || author === null || typeof author === 'string')
    return [author ?? undefined, options];
  // A plain object's prototype is `null` or an `Object.prototype`, whose own prototype is
  // `null`; compared by shape, not identity, so options built in a pop-out window count.
  const prototype = typeof author === 'object' ? Object.getPrototypeOf(author) : undefined;
  const plain =
    prototype === null || (prototype !== undefined && Object.getPrototypeOf(prototype) === null);
  if (!plain || Array.isArray(author) || options !== undefined) return AMBIGUOUS_OPTIONS;
  return [undefined, author as HistoryGroupOptions];
}

export function createReviewWrites(deps: ReviewWriteDeps) {
  /** Validate the handle, then run the write with its group bound to the surface. */
  const grouped = (options: HistoryGroupOptions | undefined, write: () => ExecResult) => {
    const refusal = deps.historyGroups.validate(options);
    if (refusal) return refusal;
    const surface = deps.surface();
    return surface ? deps.historyGroups.run(surface, undefined, options, write) : write();
  };

  const addComment = (text: string, authorOverride?: string): ExecResult => {
    // Comment authoring requires the review module, like other review writes.
    if (!deps.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = deps.surface();
    // The captured offsets outlive this write (they anchor the comment), so any
    // queued typing must land before they are taken. The range read itself is
    // flush-free: it is also the review store's snapshot.
    surface?.flushPendingInput();
    const range = deps.commentTargetRange();
    if (!range || !surface) {
      return { ok: false, code: 'invalidArgs', reason: 'a comment needs a selected range' };
    }
    const writer = (authorOverride ?? deps.author() ?? '').trim();
    if (writer.length === 0 || text.trim().length === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'a comment needs both an author and text' };
    }
    let created: string | null = null;
    const refused = surface.commitReviewOps((historyToken) => {
      created = surface.session.replyToComment(
        null,
        {
          paragraphId: range.from.paragraphId,
          start: range.from.offset,
          end: range.to.offset,
          ...(range.to.paragraphId === range.from.paragraphId
            ? {}
            : { endParagraphId: range.to.paragraphId }),
        },
        text,
        writer,
        revisionDateNow(),
        // The story the SELECTED PARAGRAPH is in, not the one the reader happens to have
        // open. Commenting on header or note text wrote against the body store, which has
        // never heard of that paragraph, so the write was refused — after the affordance
        // had already invited it.
        deps.storyScopeOfParagraph(range.from.paragraphId),
        undefined,
        { historyToken }
      );
      return { committed: created !== null };
    }, 'comment-add');
    if (created === null) return reviewWriteRefusal(refused, 'the comment could not be committed');
    return { ok: true, changed: true };
  };

  const deleteReviewItem = (key: string): ExecResult => {
    if (!deps.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = deps.surface();
    const item = findReviewPlacement(deps.placements, key)?.item as ReviewItem | undefined;
    if (!item || !surface) {
      return { ok: false, code: 'notFound', reason: 'no review item with that key' };
    }
    // Discarding a suggestion IS rejecting it — same transaction, same undo step, and the
    // refusal rules for an unresolvable kind already live there.
    if (item.kind === 'revision') return deps.resolveReviewItem(key, 'reject');
    if (item.kind !== 'comment') {
      return { ok: false, code: 'unsupported', reason: 'a custom node card cannot be deleted' };
    }
    // Nothing is dismissed. Activation reads the live queue, by caret and by pin, so a deleted
    // card cannot stay active. Dismissing first closed the open card and its draft even when
    // the delete was refused, and `dismissActiveReview` acts on whatever the caret is in, so
    // dismissing after it closed whichever other card covers the caret.
    let deleted = false;
    const refused = surface.commitReviewOps((historyToken) => {
      const note = deps.noteHomeOf(item);
      const parsed = note === null ? null : parseNoteScopeId(note);
      deleted = surface.session.deleteComment(
        item.id,
        deps.storyScopeOfReviewItem(item),
        parsed?.noteId,
        { historyToken }
      );
      return { committed: deleted };
    }, 'comment-delete');
    if (!deleted) return reviewWriteRefusal(refused, 'the comment could not be deleted');
    deps.bump();
    return { ok: true, changed: true };
  };

  const replyToReviewItem = (key: string, text: string, authorOverride?: string): ExecResult => {
    if (!deps.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = deps.surface();
    // The reply's anchor offsets are captured from the placements below and
    // outlive this call; queued typing must land before they are taken, the
    // same rule as commentTargetRange.
    surface?.flushPendingInput();
    const found = findReviewPlacement(deps.placements, key)?.item as ReviewItem | undefined;
    // A reply to a paired replacement anchors over its inserted words.
    const item = replacementPairHalves(found)?.insertion ?? found;
    if (!item || !surface) {
      return { ok: false, code: 'notFound', reason: 'no review item with that key' };
    }
    const range = firstReviewRange(item);
    if (!range) {
      return { ok: false, code: 'invalidArgs', reason: 'the item has no anchorable range' };
    }
    const writer = (authorOverride ?? deps.author() ?? '').trim();
    const refusal = reviewReplyRefusal(item, text, writer);
    if (refusal) return refusal;
    // Against a REVISION this is a comment over that revision's range: OOXML gives `w:ins`
    // and `w:del` no body and no thread, so there is nowhere else for the text to live.
    const parent = item.kind === 'comment' ? item.id : null;
    let created: string | null = null;
    const refused = surface.commitReviewOps((historyToken) => {
      created = surface.session.replyToComment(
        parent,
        { paragraphId: range.start.paragraphId, start: range.start.offset, end: range.end.offset },
        text,
        writer,
        // Every comment is stamped, and a card with no date reads as older than the ones
        // around it. The clock is the HOST's, which is why the store takes the value rather
        // than reading one: a store that called `Date.now()` could not be tested for a
        // deterministic round trip.
        revisionDateNow(),
        // The story the card's range lives in. Written against the body, a header
        // anchor names a paragraph the body store does not have, and every reply to a
        // header or footer card was refused.
        deps.storyScopeOfReviewItem(item),
        undefined,
        { historyToken }
      );
      return { committed: created !== null };
    }, 'comment-reply');
    if (created === null) return reviewWriteRefusal(refused, 'the reply could not be committed');
    return { ok: true, changed: true };
  };

  const setCommentText = (key: string, text: string, options?: CommentTextOptions): ExecResult => {
    if (!deps.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = deps.surface();
    if (deps.editingMode() === 'viewing') {
      // Refused THROUGH the surface, as resolving is, so it is recorded and reported once.
      const viewing = 'the document is open for viewing';
      const refused = surface?.commitReviewOps(
        () => ({ committed: false, reason: viewing }),
        'comment-edit'
      );
      return reviewWriteRefusal(refused ?? viewing, viewing, 'locked');
    }
    // `CT_Comment` allows an empty body, but a card with no words is not an edit anyone means;
    // `addComment` refuses it for the same reason.
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'a comment needs text' };
    }
    // Unpaired, so a reply's key names the reply itself rather than its thread.
    const placements = deps.placements({ pairReplacements: false });
    const item = commentForKey(placements, key);
    if (!('kind' in item)) return item;
    if (!surface) return { ok: false, code: 'notFound', reason: 'no review item with that key' };
    const author = deps.author();
    if (!author?.trim() || author !== item.comment.author) {
      return {
        ok: false,
        code: 'locked',
        reason: 'only the configured comment author can edit this comment',
      };
    }
    if (
      options?.expectedText !== undefined &&
      options.expectedText !== commentBodyText(item.comment)
    ) {
      return { ok: false, code: 'invalidArgs', reason: 'comment-text-changed' };
    }
    const pkg = surface.session.currentPackage();
    const part = pkg.parts.get(commentPartNameOf(pkg, pkg.mainDocumentPart));
    const unsupported = part && commentTextEditRefusal(part, item.id);
    if (unsupported) return { ok: false, code: 'unsupported', reason: unsupported };
    // The store decides what is unchanged, so the result reports what the package did.
    let ok = false;
    let changed = false;
    const refused = surface.commitReviewOps((historyToken) => {
      const revision = surface.session.packageRevision();
      ok = surface.session.setCommentText(item.id, text, { historyToken });
      changed = ok && surface.session.packageRevision() !== revision;
      return { committed: changed };
    }, 'comment-edit');
    if (!ok) return reviewWriteRefusal(refused, 'the comment could not be edited');
    if (changed) deps.bump();
    return { ok: true, changed };
  };

  return {
    addComment: (
      text: string,
      author?: string | HistoryGroupOptions,
      options?: HistoryGroupOptions
    ) => {
      const parsed = authorAndOptions(author, options);
      if (!Array.isArray(parsed)) return parsed;
      const [writer, opts] = parsed;
      return grouped(opts, () => addComment(text, writer));
    },
    acceptReviewItem: (key: string, options?: HistoryGroupOptions) =>
      grouped(options, () => deps.resolveReviewItem(key, 'accept')),
    rejectReviewItem: (key: string, options?: HistoryGroupOptions) =>
      grouped(options, () => deps.resolveReviewItem(key, 'reject')),
    setCommentResolved: (key: string, resolved: boolean, options?: HistoryGroupOptions) =>
      grouped(options, () =>
        setReviewCommentResolved(
          {
            reviewEnabled: deps.reviewEnabled,
            editingMode: deps.editingMode(),
            placements: deps.placements,
            surface: deps.surface(),
            proReviewReason: PRO_REVIEW_REASON,
            bump: deps.bump,
          },
          key,
          resolved
        )
      ),
    deleteReviewItem: (key: string, options?: HistoryGroupOptions) =>
      grouped(options, () => deleteReviewItem(key)),
    setCommentText: (key: string, text: string, options?: CommentTextOptions) =>
      grouped(options, () => setCommentText(key, text, options)),
    replyToReviewItem: (
      key: string,
      text: string,
      author?: string | HistoryGroupOptions,
      options?: HistoryGroupOptions
    ) => {
      const parsed = authorAndOptions(author, options);
      if (!Array.isArray(parsed)) return parsed;
      const [writer, opts] = parsed;
      return grouped(opts, () => replyToReviewItem(key, text, writer));
    },
  };
}
