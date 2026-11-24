import { commentPackageContext } from './comment-package-edit.ts';
// Comment write through the package coordinator, so collaboration can journal it.
//
// `addComment` commits on the story store. The coordinator then grafts the new parts onto
// the package. That path never entered `TreePackageStore.transact`, so a comment did not
// produce a primitive journal and a peer never saw the `@w:id`. Concurrent comment mints
// then could not be tested — or replicated — as a journaled edit.
//
// Capture is armed around the story write when the package store has observers. The graft,
// shell replace, and publish stay the same sequence `replyToComment` already used.
// Resolve and delete used that graft/replace sequence WITHOUT arming capture, so a peer
// kept markers that named a comment (or a `w15:done` part) it never received.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import { deleteCommentBatch } from '../package/comment-batch-delete.ts';
import {
  addComment,
  setCommentResolved,
  setCommentTexts,
  type AddCommentRequest,
  type AddCommentResult,
  type SetCommentResolvedResult,
  type SetCommentTextResult,
} from './comment-writes.ts';
import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import { settingsPartOf } from '../package/note-properties.ts';
import { lifecycleProtectionRefusal } from './forms-protection.ts';
import type { HistoryGroup } from './history-group.ts';

const BODY: StoryScope = { kind: 'body' };

/**
 * Add a comment on one story and publish the new package shell.
 *
 * The story store still performs the write. The package coordinator records the undo unit
 * and, when observed, the primitive journal.
 */
export function addPackageComment(
  packageStore: TreePackageStore,
  request: AddCommentRequest,
  scope: StoryScope = BODY,
  historyGroup?: HistoryGroup
): AddCommentResult {
  const resolved = scope.kind === 'body' ? null : packageStore.resolveStory(scope);
  const store = resolved?.ok ? resolved.store : packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = addComment(store, request);
      if (!result.ok) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptGroupedPackageUnit(beforePackage, historyGroup);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => packageTransactionPublished(result),
    historyGroup
  );
}

/**
 * Resolve or reopen a comment thread and publish the new package shell.
 *
 * `@w15:done` lives in `commentsExtended.xml`, which a document with no reply does not have.
 * Capture must be armed for that create-part, or a peer keeps an open thread.
 */
export function setPackageCommentResolved(
  packageStore: TreePackageStore,
  commentId: string,
  resolved: boolean,
  historyGroup?: HistoryGroup
): SetCommentResolvedResult {
  const store = packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  // A package-ONLY write: no story op accompanies it, so the per-op gate never sees it and
  // the package channel cannot refuse forms protection without also refusing a legitimate
  // field fill. Asked here instead, or a form sent out for filling came back with every
  // comment thread resolved by a reader who could not type a character.
  const locked = lifecycleProtectionRefusal(settingsPartOf(beforePackage), {
    op: 'setCommentResolved',
  });
  if (locked) return { ok: false, reason: locked };
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = setCommentResolved(store, commentId, resolved);
      if (!result.ok) return result;
      if (!result.changed) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptGroupedPackageUnit(beforePackage, historyGroup);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => result.ok && result.changed,
    historyGroup
  );
}

/**
 * Replace the text of one comment or reply and publish the new package shell.
 *
 * The same observed transaction as resolving a thread, so a peer receives the new body and Undo
 * restores the old one in one step. A document protected for filling in forms refuses it, as it
 * refuses every other comment write.
 */
export function setPackageCommentText(
  packageStore: TreePackageStore,
  commentId: string,
  text: string,
  historyGroup?: HistoryGroup
): SetCommentTextResult {
  return setPackageCommentTexts(packageStore, [{ commentId, text }], historyGroup);
}

/** Replace several comment bodies atomically, preserving one package history entry. */
export function setPackageCommentTexts(
  packageStore: TreePackageStore,
  edits: readonly { readonly commentId: string; readonly text: string }[],
  historyGroup?: HistoryGroup
): SetCommentTextResult {
  const store = packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const locked = lifecycleProtectionRefusal(settingsPartOf(beforePackage), {
    op: 'setCommentText',
  });
  if (locked) return { ok: false, reason: locked };
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = setCommentTexts(store, edits);
      if (!result.ok) return result;
      if (!result.changed) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptGroupedPackageUnit(beforePackage, historyGroup);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => result.ok && result.changed,
    historyGroup
  );
}

/** One comment object in a delete batch: a root, or a reply naming its parent. */
export interface PackageCommentDelete {
  readonly commentId: string;
  readonly parentCommentId?: string;
}

/**
 * Delete comment threads or replies and install the rewritten package.
 *
 * Installed, not shell-replaced: `replacePackageShell` re-overlays every opened story
 * store, and a header the reader had entered would restore its markers after the body
 * had already dropped them.
 */
export function deletePackageComments(
  packageStore: TreePackageStore,
  comments: readonly PackageCommentDelete[],
  scope: StoryScope = BODY,
  noteId?: number,
  historyGroup?: HistoryGroup
): boolean {
  if (comments.length === 0) return false;
  // Package-only, like the resolve above: asked here because no story op carries it.
  if (
    lifecycleProtectionRefusal(settingsPartOf(packageStore.currentPackage()), {
      op: 'deleteComments',
    })
  ) {
    return false;
  }
  const storyPart =
    scope.kind === 'body' ? packageStore.bodyStore().part : packageStore.partFor(scope);
  if (!storyPart) return false;
  const owner = {
    storyPartName: storyPart.name,
    ...(noteId === undefined ? {} : { noteId }),
  };
  const store = packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      let refused = false;
      let removed = false;
      const result = store.transact((transaction) => {
        const ctx = commentPackageContext(transaction);
        ctx.applyPackage((current) => {
          const next = deleteCommentBatch(current, comments, owner);
          if (next === null) {
            refused = true;
            return current;
          }
          removed = next !== current;
          return next;
        });
      });
      if (refused || !result.ok || !removed) return false;
      store.restoreHistoryStacks(checkpoint);
      packageStore.installPackageSnapshot(store.package);
      packageStore.adoptGroupedPackageUnit(beforePackage, historyGroup);
      packageStore.publishStoryWrite(result.change);
      return true;
    },
    (ok) => ok,
    historyGroup
  );
}
