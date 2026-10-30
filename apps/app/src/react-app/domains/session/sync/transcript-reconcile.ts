import type { UIMessage } from "ai";

import { mergeSnapshotIntoCachedMessages } from "./message-merge";

export type TranscriptReconcileReason = "snapshot" | "revert";

export type ReconcileTranscriptInput = {
  /** Current canonical transcript cache rendered by the session UI. */
  currentMessages: UIMessage[];
  /** Messages reconstructed from the latest server snapshot. */
  snapshotMessages: UIMessage[];
  /** Why this reconciliation is happening. Reserved for explicit truncation rules. */
  reason?: TranscriptReconcileReason;
};

type ApplyRevertCursorOptions = {
  /**
   * A snapshot can finish after the user has already submitted a replacement
   * turn. Keep that newer client-owned row visible until the engine confirms
   * it, even when the snapshot still carries the previous branch's cursor.
   */
  preserveOptimisticUserMessages?: boolean;
};

function isOptimisticUserMessage(message: UIMessage) {
  if (message.role !== "user" || !message.metadata || typeof message.metadata !== "object") return false;
  const metadata = "ipollowork" in message.metadata ? message.metadata.ipollowork : null;
  return Boolean(metadata && typeof metadata === "object" && "optimistic" in metadata && metadata.optimistic === true);
}

/**
 * Reconcile a server snapshot into the canonical transcript cache.
 *
 * Snapshot reads can lag behind the engine event stream during prompt
 * submission. This helper centralizes the invariant that ordinary snapshots
 * may fill/update the cache, but must not make the visible transcript move
 * backwards. Explicit history operations such as revert can opt into their own
 * truncation path instead of relying on snapshot absence.
 */
export function reconcileTranscriptMessages(input: ReconcileTranscriptInput): UIMessage[] {
  const current = input.currentMessages;
  const snapshot = input.snapshotMessages;

  if (current.length === 0) return snapshot;
  if (snapshot.length === 0) return current;

  return mergeSnapshotIntoCachedMessages(snapshot, current);
}

/**
 * Hide messages at and after the engine's normalized revert cursor. Revert is an explicit
 * history mutation, so it is the one place the rendered transcript is allowed
 * to move backwards.
 *
 * The conversation contract treats the cursor as the FIRST reverted message
 * (every message with `id >= revert.messageID` is reverted), so the cursor
 * message itself must be hidden too.
 */
export function applyRevertCursor(
  messages: UIMessage[],
  revertMessageId: string | null | undefined,
  options: ApplyRevertCursorOptions = {},
): UIMessage[] {
  if (!revertMessageId || messages.length === 0) return messages;
  const idx = messages.findIndex((message) => message.id === revertMessageId);
  if (idx < 0) return messages;
  const retained = messages.slice(0, idx);
  if (!options.preserveOptimisticUserMessages) return retained;
  return [
    ...retained,
    ...messages.slice(idx).filter(isOptimisticUserMessage),
  ];
}
