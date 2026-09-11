import type { UIMessage } from "ai";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types";

import { mergeSnapshotAndLiveMessages } from "../sync/message-merge";
import { applyRevertCursor } from "../sync/transcript-reconcile";
import type { ConversationSnapshot } from "../engine/conversation-engine";

const COMPOSER_INPUT_HISTORY_LIMIT = 50;

export function resolveRenderedSessionSnapshot(input: {
  sessionId: string;
  currentSnapshot: ConversationSnapshot | null | undefined;
  cachedRendered: { sessionId: string; snapshot: ConversationSnapshot } | null | undefined;
}) {
  if (input.currentSnapshot?.session.id === input.sessionId) {
    return input.currentSnapshot;
  }
  if (
    input.cachedRendered?.sessionId === input.sessionId &&
    input.cachedRendered.snapshot.session.id === input.sessionId
  ) {
    return input.cachedRendered.snapshot;
  }
  return null;
}

export function deriveRenderedSessionMessages(input: {
  transcriptState: UIMessage[] | null | undefined;
  snapshot: ConversationSnapshot | null | undefined;
}) {
  const revertMessageId = input.snapshot?.session.revertMessageId ?? null;
  const liveMessages = input.transcriptState ?? [];

  const snapshotMessages = input.snapshot && input.snapshot.messages.length > 0
    ? input.snapshot.messages
    : [];

  // Render the server snapshot as the history floor and layer live stream
  // updates on top. During prompt submission the live cache can briefly contain
  // only the new turn; it must not replace the older persisted transcript.
  const messages = snapshotMessages.length > 0
    ? mergeSnapshotAndLiveMessages(snapshotMessages, liveMessages, { appendLiveOnlyMessages: true })
    : liveMessages;

  // Older clients cached this retry notification as a terminal error. Drop
  // only that exact client-only notice once an authoritative snapshot exists;
  // native/persisted failures and all other errors must remain visible.
  const snapshotIds = new Set(snapshotMessages.map(message => message.id));
  const repaired = input.snapshot ? messages.filter(message => !(
    message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)
    && !snapshotIds.has(message.id)
    && message.parts.length === 1
    && message.parts[0].type === "text"
    && /^Reconnecting(?:\.{3}|…)\s*waiting for network\s*$/i.test(message.parts[0].text.trim())
  )) : messages;
  return applyRevertCursor(repaired, revertMessageId, { preserveOptimisticUserMessages: true });
}

export function deriveComposerInputHistory(messages: UIMessage[]): string[] {
  const history: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (!text || history[history.length - 1] === text) continue;
    history.push(text);
  }
  return history.slice(-COMPOSER_INPUT_HISTORY_LIMIT);
}
