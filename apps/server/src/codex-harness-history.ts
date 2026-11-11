import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolveWithinRoot } from "./paths.js";
import type { CodexThreadItem } from "./codex-harness-session-read-model.js";

export type CodexHistoryTurn = {
  id: string;
  agentMessageIds: string[];
  reasoningIds: string[];
  order: string[];
  plan?: unknown[];
  calls: CodexThreadItem[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function agentState(value: unknown): { status: string; message?: string } {
  if (typeof value === "string") return { status: value === "shutdown" ? "interrupted" : value };
  if (!record(value)) return { status: "unknown" };
  for (const key of ["completed", "errored", "shutdown", "interrupted"]) {
    if (key in value) return { status: key === "shutdown" ? "interrupted" : key, ...(typeof value[key] === "string" ? { message: value[key] } : {}) };
  }
  return { status: "running" };
}

/** Only accepted native calls are projected. Text is never used as message identity. */
function createCodexHistoryProjection(threadId: string) {
  const turns = new Map<string, CodexHistoryTurn>();
  const userCounts = new Map<string, number>();
  const pending = new Map<string, { turn: CodexHistoryTurn; name: string; args: Record<string, unknown> }>();
  let current: CodexHistoryTurn | undefined;
  const select = (id: string) => {
    if (current?.id !== id) pending.clear();
    current = turns.get(id);
    if (!current) {
      current = { id, agentMessageIds: [], reasoningIds: [], order: [], calls: [] };
      turns.set(id, current);
      if (turns.size > 100) {
        const oldest = turns.keys().next().value;
        if (oldest) { turns.delete(oldest); userCounts.delete(oldest); }
      }
    }
  };
  function append(line: string) {
    const row = json(line);
    if (!record(row) || !record(row.payload)) return;
    const p = row.payload;
    if (row.type === "event_msg" && p.type === "task_started" && typeof p.turn_id === "string") select(p.turn_id);
    if (row.type === "turn_context" && typeof p.turn_id === "string") select(p.turn_id);
    if (current && row.type === "event_msg" && p.type === "user_message") {
      const index = userCounts.get(current.id) ?? 0;
      current.order.push(`user:${index}`);
      userCounts.set(current.id, index + 1);
    }
    if (!current || row.type !== "response_item") return;
    if (p.type === "message" && p.role === "assistant" && typeof p.id === "string" && Array.isArray(p.content)
      && p.content.some(c => record(c) && typeof c.text === "string" && c.text.trim())) {
      if (!current.agentMessageIds.includes(p.id)) { current.agentMessageIds.push(p.id); current.order.push(p.id); }
    }
    if (p.type === "reasoning" && typeof p.id === "string" && !current.reasoningIds.includes(p.id)) { current.reasoningIds.push(p.id); current.order.push(p.id); }
    const nativeId = typeof p.call_id === "string" ? p.call_id : typeof p.id === "string" ? p.id : undefined;
    if (nativeId && !current.order.includes(nativeId)) current.order.push(nativeId);
    if (p.type === "function_call" && typeof p.call_id === "string" && typeof p.name === "string" && typeof p.arguments === "string") {
      const args = json(p.arguments);
      if (record(args) && ["update_plan", "spawn_agent", "wait_agent", "send_input", "close_agent"].includes(p.name)) pending.set(p.call_id, { turn: current, name: p.name, args });
    }
    if (p.type !== "function_call_output" || typeof p.call_id !== "string") return;
    const call = pending.get(p.call_id);
    pending.delete(p.call_id);
    if (!call || call.turn !== current || typeof p.output !== "string") return;
    const output = json(p.output);
    const failed = p.is_error === true || record(output) && Boolean(output.error);
    if (call.name === "update_plan") {
      if (!failed && p.output.trim() === "Plan updated" && Array.isArray(call.args.plan)
        && call.args.plan.length <= 100 && call.args.plan.every(s => record(s) && typeof s.step === "string" && ["pending", "in_progress", "completed"].includes(String(s.status)))) {
        current.plan = call.args.plan.map(s => record(s) ? { step: s.step, status: s.status === "in_progress" ? "inProgress" : s.status } : s);
      }
      return;
    }
    const children = call.name === "spawn_agent"
      ? record(output) && typeof output.agent_id === "string" ? [output.agent_id] : []
      : call.name === "wait_agent" && Array.isArray(call.args.ids) ? call.args.ids.filter((id): id is string => typeof id === "string")
        : typeof call.args.id === "string" ? [call.args.id] : [];
    const states: Record<string, { status: string; message?: string }> = {};
    for (const id of children) {
      states[id] = record(output) && record(output.status) && id in output.status
        ? agentState(output.status[id])
        : call.name === "close_agent" && record(output) && output.status !== undefined ? agentState(output.status)
          : { status: "running" };
    }
    current.calls.push({ type: "collabAgentToolCall", id: p.call_id, tool: call.name === "spawn_agent" ? "spawnAgent" : call.name === "wait_agent" ? "wait" : call.name === "send_input" ? "sendInput" : "closeAgent",
      senderThreadId: threadId, receiverThreadIds: children, agentsStates: states, status: failed ? "failed" : "completed", prompt: typeof call.args.message === "string" ? call.args.message : null });
  }
  function finish(): CodexHistoryTurn[] {
    for (const turn of turns.values()) {
      const states = Object.assign({}, ...turn.calls.map(call => call.agentsStates));
      for (const call of turn.calls) {
        for (const child of call.receiverThreadIds ?? []) if (states[child]) call.agentsStates = { ...call.agentsStates, [child]: states[child] };
      }
    }
    return [...turns.values()].slice(-100);
  }
  return { append, finish };
}

export function projectCodexHistory(lines: readonly string[], threadId: string): CodexHistoryTurn[] {
  const projection = createCodexHistoryProjection(threadId);
  for (const line of lines) projection.append(line);
  return projection.finish();
}

/** Bounded, read-only projection of this workspace's existing native rollout. */
export class CodexHistoryReader {
  readonly #cache = new Map<string, { signature: string; turns: CodexHistoryTurn[] }>();
  async read(home: string, path: string, threadId: string): Promise<CodexHistoryTurn[]> {
    const file = await resolveWithinRoot(home, path);
    const info = await stat(file);
    if (!info.isFile()) return [];
    const key = `${threadId}:${file}`;
    const signature = `${info.size}:${info.mtimeMs}`;
    const cached = this.#cache.get(key);
    if (cached?.signature === signature) return cached.turns;
    const handle = await open(file, "r");
    try {
      if (!info.size) return [];
      // Scan the complete native log: a current plan may precede arbitrarily
      // large tool outputs. Memory holds one JSONL record and 100 turn summaries,
      // not the whole file. Bound this read to the size observed at its start.
      const input = handle.createReadStream({ start: 0, end: info.size - 1, autoClose: false });
      const lines = createInterface({ input, crlfDelay: Infinity });
      const projection = createCodexHistoryProjection(threadId);
      let first = true;
      try {
        for await (const line of lines) {
          if (first) {
            first = false;
            const meta = json(line);
            if (!record(meta) || meta.type !== "session_meta" || !record(meta.payload) || meta.payload.id !== threadId) return [];
          } else projection.append(line);
        }
      } finally { lines.close(); input.destroy(); }
      const turns = projection.finish();
      this.#cache.delete(key);
      this.#cache.set(key, { signature, turns });
      if (this.#cache.size > 16) { const oldest = this.#cache.keys().next().value; if (oldest) this.#cache.delete(oldest); }
      return turns;
    } finally { await handle.close(); }
  }
}
