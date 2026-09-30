import type { UIMessage } from "ai";
import type { SessionArtifact } from "@ipollowork/types/workspace";
import { formatFileSize } from "@/lib/utils";

export function getPartMetadataId(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    const metadata = part.callProviderMetadata?.ipollowork;
    return metadata && typeof metadata === "object" && typeof metadata.partId === "string" ? metadata.partId : null;
  }
  if (part.type === "data-design-selection" || part.type === "data-animation-references" || part.type === "data-voice-reference") {
    const data = part.data;
    return data && typeof data === "object" && "partId" in data && typeof data.partId === "string" ? data.partId : null;
  }
  if (!("providerMetadata" in part)) return null;
  const metadata = part.providerMetadata?.ipollowork;
  return metadata && typeof metadata === "object" && typeof metadata.partId === "string" ? metadata.partId : null;
}

function mergeMessageParts(snapshotMessage: UIMessage, cachedMessage: UIMessage) {
  // Parts can arrive out of order. Array positions are not provider identities.
  const identity = (part: UIMessage["parts"][number]) =>
    part.type === "dynamic-tool" ? part.toolCallId : getPartMetadataId(part);
  const cachedById = new Map<string, UIMessage["parts"][number]>();
  for (const part of cachedMessage.parts) {
    const id = identity(part);
    if (id && !cachedById.has(id)) cachedById.set(id, part);
  }
  const seen = new Set<string>();
  const parts = snapshotMessage.parts.map((part, index) => {
    const id = identity(part);
    if (id) seen.add(id);
    const cachedPart = id ? cachedById.get(id) : cachedMessage.parts[index];
    if (!cachedPart) return part;

    if (
      (part.type === "text" || part.type === "reasoning") &&
      cachedPart.type === part.type &&
      (!id || part.state !== "done") &&
      cachedPart.text.startsWith(part.text) &&
      cachedPart.text.length > part.text.length
    ) {
      return { ...part, text: cachedPart.text };
    }

    return part;
  });

  for (const [index, part] of cachedMessage.parts.entries()) {
    const id = identity(part);
    if (id ? !seen.has(id) : index >= snapshotMessage.parts.length) {
      parts.push(part);
      if (id) seen.add(id);
    }
  }

  return parts;
}

function mergeSnapshotMessageWithCached(snapshotMessage: UIMessage, cachedMessage: UIMessage): UIMessage {
  const metadata = snapshotMessage.metadata ?? cachedMessage.metadata;

  return {
    ...snapshotMessage,
    ...(metadata === undefined ? {} : { metadata }),
    parts: mergeMessageParts(snapshotMessage, cachedMessage),
  };
}

function messageCreated(message: UIMessage) {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || !("ipollowork" in metadata)) return null;

  const ipollowork = metadata.ipollowork;
  if (!ipollowork || typeof ipollowork !== "object" || !("created" in ipollowork)) return null;

  const created = ipollowork.created;
  return typeof created === "number" ? created : null;
}

function insertMessageByChronology(messages: UIMessage[], message: UIMessage, sourceOrder: UIMessage[]) {
  const created = messageCreated(message);
  if (created !== null) {
    const timestampIndex = messages.findIndex((existing) => {
      const existingCreated = messageCreated(existing);
      return existingCreated !== null && existingCreated > created;
    });
    if (timestampIndex !== -1) {
      messages.splice(timestampIndex, 0, message);
      return;
    }
  }

  const sourceIndex = sourceOrder.findIndex((item) => item.id === message.id);
  if (sourceIndex !== -1) {
    for (let index = sourceIndex + 1; index < sourceOrder.length; index += 1) {
      const nextIndex = messages.findIndex((item) => item.id === sourceOrder[index]?.id);
      if (nextIndex !== -1) {
        messages.splice(nextIndex, 0, message);
        return;
      }
    }

    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
      const previousIndex = messages.findIndex((item) => item.id === sourceOrder[index]?.id);
      if (previousIndex !== -1) {
        messages.splice(previousIndex + 1, 0, message);
        return;
      }
    }
  }

  messages.push(message);
}

function sortFullyTimestampedMessages(messages: UIMessage[]) {
  const withCreated = messages.map((message, index) => ({ message, index, created: messageCreated(message) }));
  if (withCreated.some((item) => item.created === null)) return messages;

  return withCreated
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0) || a.index - b.index)
    .map((item) => item.message);
}

export function messageListContainsAll(container: UIMessage[], required: UIMessage[]) {
  if (required.length === 0) return true;
  const ids = new Set(container.map((message) => message.id));
  return required.every((message) => ids.has(message.id));
}

export function mergeSnapshotAndLiveMessages(
  snapshotMessages: UIMessage[],
  liveMessages: UIMessage[],
  options: { appendLiveOnlyMessages?: boolean } = {},
) {
  if (snapshotMessages.length === 0) return liveMessages;
  if (liveMessages.length === 0) return snapshotMessages;

  const liveById = new Map(liveMessages.map((message) => [message.id, message]));
  const snapshotIds = new Set(snapshotMessages.map((message) => message.id));
  const merged = snapshotMessages.map((snapshotMessage) => {
    const liveMessage = liveById.get(snapshotMessage.id);
    return liveMessage ? mergeSnapshotMessageWithCached(snapshotMessage, liveMessage) : snapshotMessage;
  });

  if (options.appendLiveOnlyMessages) {
    for (const liveMessage of liveMessages) {
      if (!snapshotIds.has(liveMessage.id)) insertMessageByChronology(merged, liveMessage, liveMessages);
    }
  }

  return sortFullyTimestampedMessages(merged);
}

export function mergeSnapshotIntoCachedMessages(snapshotMessages: UIMessage[], cachedMessages: UIMessage[]) {
  if (snapshotMessages.length === 0) return cachedMessages;
  if (cachedMessages.length === 0) return snapshotMessages;

  const snapshotById = new Map(snapshotMessages.map((message) => [message.id, message]));
  const cachedById = new Map(cachedMessages.map((message) => [message.id, message]));
  const seen = new Set<string>();
  const merged = snapshotMessages.map((message) => {
    seen.add(message.id);
    const snapshotMessage = snapshotById.get(message.id);
    const cachedMessage = cachedById.get(message.id);
    return snapshotMessage && cachedMessage
      ? mergeSnapshotMessageWithCached(snapshotMessage, cachedMessage)
      : message;
  });

  for (const message of cachedMessages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    insertMessageByChronology(merged, message, cachedMessages);
  }

  return sortFullyTimestampedMessages(merged);
}

/**
 * Presentation only: these receipts must never be sent back to the conversation engine.
 *
 * Generated media can finish before the assistant has finished the whole turn.
 * Keep those artifacts available to the session, but hold their delivery
 * receipts until the caller has an authoritative end-of-turn signal.
 */
export function withStudioResults(
  messages: UIMessage[],
  artifacts: SessionArtifact[],
  labels: { image: string; video: string },
  options: { showResults?: boolean } = {},
) {
  if (options.showResults === false) return messages;

  const seen = new Set<string>();
  const results: UIMessage[] = [];
  for (const artifact of artifacts) {
    const generation = artifact.generation;
    if (!generation || seen.has(generation.id)) continue;
    seen.add(generation.id);
    // A path in a tool result or inline preview is not a delivery card.
    // Receipts use stable generation IDs so refreshes remain idempotent.
    const details = [
      formatFileSize(artifact.size),
      generation.width && generation.height ? `${generation.width} × ${generation.height}` : null,
      generation.duration ? `${Number(generation.duration.toFixed(1))} s` : null,
      generation.model,
    ].filter(Boolean).join(" · ");
    const filename = artifact.path.split("/").pop() ?? artifact.path;
    results.push({
      id: `studio-result:${generation.id}`,
      role: "assistant",
      metadata: { ipollowork: { created: generation.completedAt, completed: generation.completedAt } },
      parts: [{ type: "text", text: `${labels[generation.kind]}\n\n${details}\n\n[${filename.replace(/[\[\]\\]/g, "\\$&")}](${encodeURI(artifact.path).replace(/\(/g, "%28").replace(/\)/g, "%29")})` }],
    });
  }
  return mergeSnapshotAndLiveMessages(messages, sortFullyTimestampedMessages(results), { appendLiveOnlyMessages: true });
}
