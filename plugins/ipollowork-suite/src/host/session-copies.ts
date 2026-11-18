import { createHash, randomUUID } from "node:crypto";
import { brandNumber, brandString } from "@deepseek-ai/dsh-brand";
import { Session, SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader, type SessionId, type SessionSeq } from "@deepseek-ai/dsh-session";
import type { MessageId } from "@deepseek-ai/dsh-llm";
import type { SharedMessage } from "../shared/enterprise.ts";

type EventInput<T = SessionEvent> = T extends SessionEvent ? Omit<T, "seq" | "time"> : never;
export interface CopyPersistence {
  stat(id: SessionId): Promise<unknown>;
  create(header: SessionHeader): Promise<{
    append(events: readonly SessionEvent[]): Promise<unknown>;
    flush(): Promise<unknown>;
    close(): Promise<unknown>;
  }>;
}
export interface CopyWorkspace {
  path: string;
  attachSession(id: SessionId): Promise<unknown>;
}

/** Rebuild plain conversation history using native seed events, without replaying tools or source prompts. */
export function conversationSeed(title: string, transcript: readonly SharedMessage[], time: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  const add = (event: EventInput) => events.push({ ...event, seq: brandNumber<SessionSeq>(events.length), time });
  const messageId = () => brandString<MessageId>(randomUUID());
  const turns: { user: string; reply: string[] }[] = [];
  for (const message of transcript) {
    if (message.role === "user") turns.push({ user: message.content, reply: [] });
    else turns.at(-1)?.reply.push(message.content);
  }
  for (const [index, item] of turns.entries()) {
    const turn = index + 1, step = 1;
    add({ type: "turn/start", data: { turn } });
    add({ type: "step/start", data: { turn, step } });
    if (turn === 1) add({ type: "system/message", data: { turn, step, message: {
      id: messageId(), role: "system", content: [], source: { kind: "system-prompt" },
    } }, surfaceOp: "append" });
    add({ type: "user/message", data: {
      id: messageId(), role: "user", content: [{ type: "text", text: item.user }], source: { kind: "user" },
    }, surfaceOp: "append" });
    if (item.reply.length) add({ type: "assistant/message", data: {
      turn, step, stream: [], message: {
        id: messageId(), role: "assistant", content: [{ type: "text", text: item.reply.join("\n\n") }],
        source: { kind: "model", provider: "ipollowork-share", model: "shared-copy" },
      },
    }, surfaceOp: "append" });
    add({ type: "step/end", data: { turn, step } });
    add({ type: "turn/end", data: { turn, reason: { kind: "completed" } } });
    if (turn === 1) add({ type: "session/title", data: { title, messageSeqs: [], source: { kind: "user" } } });
  }
  return events;
}

export function conversationCopyId(user: string, share: string): SessionId {
  const stable = createHash("sha256").update(JSON.stringify([user, share])).digest("hex").slice(0, 32);
  return brandString<SessionId>("ipw-copy-" + stable);
}

export async function importConversationCopy(
  persistence: CopyPersistence, workspace: CopyWorkspace, id: SessionId, title: string, transcript: readonly SharedMessage[],
) {
  if (!await persistence.stat(id)) {
    const time = Date.now();
    const header: SessionHeader = { id, version: SESSION_FORMAT_VERSION, cwd: workspace.path, createdAt: time, isSeeded: false };
    const events = conversationSeed(title, transcript, time);
    Session.create(id, events, header);
    const handle = await persistence.create(header);
    try {
      await handle.append(events);
      await handle.flush();
    } finally {
      await handle.close();
    }
  }
  await workspace.attachSession(id);
  return { sessionId: id };
}
