import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export function remoteRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid DSH Remote object");
  return value as Record<string, unknown>;
}

/** One authenticated connection carries all logical subscriptions for a consumer. */
export class DeepSeekRemoteMux {
  #socket: WebSocket;
  #streams = new Map<string, { open: () => void; receive: (frame: Record<string, unknown>) => void; finish: (error?: unknown) => void }>();
  #closed = false;

  constructor(baseUrl: string, cookie: string) {
    const url = new URL("/api/remote.mux", baseUrl);
    url.protocol = "ws:";
    this.#socket = new WebSocket(url, { headers: { cookie } });
    this.#socket.on("open", () => { for (const stream of this.#streams.values()) stream.open(); });
    this.#socket.on("message", (data) => {
      try {
        const frame = remoteRecord(JSON.parse(data.toString()));
        if (typeof frame.streamId === "string") this.#streams.get(frame.streamId)?.receive(frame);
      } catch (error) { this.close(error); }
    });
    this.#socket.on("error", (error) => this.close(error));
    this.#socket.on("close", () => this.close(new Error("DSH Remote connection closed")));
  }

  close(error?: unknown) {
    if (this.#closed) return;
    this.#closed = true;
    for (const stream of this.#streams.values()) stream.finish(error);
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.close();
    else if (this.#socket.readyState === WebSocket.CONNECTING) this.#socket.terminate();
  }

  async *stream(endpoint: string, args: Record<string, unknown>, signal: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    signal.throwIfAborted();
    if (this.#closed) throw new Error("DSH Remote connection is closed");
    const socket = this.#socket;
    const streamId = randomUUID();
    let controller: ReadableStreamDefaultController<Record<string, unknown>>;
    let closed = false;
    const finish = (error?: unknown) => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error) controller.error(error);
      else controller.close();
      this.#streams.delete(streamId);
      if (!this.#closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", streamId }));
    };
    const abort = () => finish(signal.reason);
    const source = new ReadableStream<Record<string, unknown>>({
      start(value) { controller = value; },
      cancel() { finish(); },
    });
    const timeout = setTimeout(() => finish(new Error("DSH Remote stream did not become ready")), 15_000);
    const open = () => socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }));
    const receive = (frame: Record<string, unknown>) => {
      if (closed) return;
      try {
        clearTimeout(timeout);
        if (frame.type === "error") {
          const error = remoteRecord(frame.error);
          finish(new Error(typeof error.message === "string" ? error.message : "DSH Remote stream failed"));
        } else if (frame.type === "end") finish();
        else if (frame.type === "item") controller.enqueue(remoteRecord(frame.value));
      } catch (error) { finish(error); }
    };
    this.#streams.set(streamId, { open, receive, finish });
    if (socket.readyState === WebSocket.OPEN) open();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const reader = source.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) return;
        yield item.value;
      }
    } finally {
      finish();
      reader.releaseLock();
    }
  }
}

/** A short-lived subscription, used for a single snapshot. */
export async function* deepSeekRemoteStream(baseUrl: string, cookie: string, endpoint: string, args: Record<string, unknown>, signal: AbortSignal) {
  const connection = new DeepSeekRemoteMux(baseUrl, cookie);
  try { yield* connection.stream(endpoint, args, signal); }
  finally { connection.close(); }
}

export async function deepSeekRemoteSnapshot(
  baseUrl: string,
  cookie: string,
  endpoint: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for await (const value of deepSeekRemoteStream(baseUrl, cookie, endpoint, args, AbortSignal.timeout(15_000))) return value;
  throw new Error("DSH Remote snapshot ended before its opening frame");
}

/** Work's public RPC names project onto the current upstream named arguments. */
export function deepSeekRemoteCall(method: string, value: unknown) {
  const payload = remoteRecord(value);
  switch (method) {
    case "session.list": return { method: "session/list", args: { _request: payload } };
    case "llm.models":
    case "session.models": return { method: "session/modelCatalog", args: {} };
    case "llm.providers": return { method: "llm/listConfigurableProviders", args: {} };
    case "agentPreset.list": return { method: "agentPresets/list", args: {} };
    case "agentPreset.select": return { method: "agentPresets/select", args: { agentId: payload.sessionId, agentPreset: payload.agentPreset } };
    case "credentials.describe":
    case "credentials.set":
    case "credentials.unset":
    case "settings.describe":
    case "settings.mutate":
    case "$events/result": return { method: method.replace(".", "/"), args: payload };
    case "commands/execute": return { method, args: { submittedAttachments: [], ...remoteRecord(payload.args) } };
    case "session.prompt": {
      const { clientUserMessageId, ...request } = payload;
      return { method: "session/prompt", args: { request: { ...request, requestId: clientUserMessageId ?? randomUUID() } } };
    }
    default: return { method: method.replace(".", "/"), args: { request: payload } };
  }
}
