import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonRecord = Record<string, unknown>;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type HarnessTurnResult = {
  finalResponse: string;
  notificationCount: number;
  subagentCount: number;
};

export type HarnessTurnInput = {
  command: string;
  args?: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  provider: string;
  model: string;
  maxTokens?: number;
  prompt: string;
  sessionId: string;
  signal: AbortSignal;
};

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => {
    const item = record(block);
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
}

function assistantMessageText(params: JsonRecord, sessionId: string): string | null {
  if (params.sessionId !== sessionId) return null;
  const event = record(params.event);
  if (event?.type !== "assistant/message") return null;
  const data = record(event.data);
  const message = record(data?.message);
  if (message) return textBlocks(message.content);
  return textBlocks(data?.content);
}

class HarnessProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stderr: string[] = [];
  private nextId = 1;
  private closed = false;
  private idleResolve: (() => void) | null = null;
  private idleReject: ((error: Error) => void) | null = null;
  private finalResponse = "";
  private notificationCount = 0;
  private subagentCount = 0;

  constructor(private readonly input: HarnessTurnInput) {
    this.child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env,
      stdio: "pipe",
      detached: process.platform !== "win32",
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));
    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.stderr.push(line);
      if (this.stderr.length > 80) this.stderr.shift();
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed) return;
      this.fail(new Error(`DeepSeek Harness runtime exited before completion (${signal ?? code ?? "unknown"})${this.diagnostics()}`));
    });
    input.signal.addEventListener("abort", () => {
      this.fail(new Error("DeepSeek Harness job was cancelled"));
      this.terminate();
    }, { once: true });
  }

  async run(): Promise<HarnessTurnResult> {
    try {
      const initialize: JsonRecord = {
        cwd: this.input.cwd,
        provider: this.input.provider,
        model: this.input.model,
      };
      if (this.input.maxTokens !== undefined) initialize.maxTokens = this.input.maxTokens;
      await this.request("initialize", initialize);
      const idle = new Promise<void>((resolve, reject) => {
        this.idleResolve = resolve;
        this.idleReject = reject;
      });
      const prompt = this.request("session/prompt", {
        sessionId: this.input.sessionId,
        contentBlocks: [{ type: "text", text: this.input.prompt }],
      });
      await Promise.all([prompt, idle]);
      return {
        finalResponse: this.finalResponse,
        notificationCount: this.notificationCount,
        subagentCount: this.subagentCount,
      };
    } finally {
      await this.close();
    }
  }

  private request(method: string, params?: JsonRecord): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("DeepSeek Harness runtime is closed"));
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
    return response;
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const message = record(value);
    if (!message) return;
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      const error = record(message.error);
      if (error) {
        pending.reject(new Error(`DeepSeek Harness ${typeof error.message === "string" ? error.message : "request failed"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    this.notificationCount += 1;
    const params = record(message.params) ?? {};
    if (message.method === "subagent.started") this.subagentCount += 1;
    if (message.method === "session.event") {
      const response = assistantMessageText(params, this.input.sessionId);
      if (response !== null) this.finalResponse = response;
    }
    if (message.method === "session.status" && params.sessionId === this.input.sessionId && params.status === "idle") {
      this.idleResolve?.();
      this.idleResolve = null;
      this.idleReject = null;
    }
  }

  private diagnostics(): string {
    return this.stderr.length ? `\n${this.stderr.join("\n")}` : "";
  }

  private fail(error: Error): void {
    if (this.closed) return;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.idleReject?.(error);
    this.idleResolve = null;
    this.idleReject = null;
  }

  private terminate(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null || this.child.pid === undefined) return;
    try {
      if (process.platform === "win32") this.child.kill("SIGTERM");
      else process.kill(-this.child.pid, "SIGTERM");
    } catch {
      this.child.kill("SIGTERM");
    }
    const pid = this.child.pid;
    setTimeout(() => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return;
      try {
        if (process.platform === "win32") this.child.kill("SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }

  private async close(): Promise<void> {
    if (this.closed) return;
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.closed = true;
      return;
    }
    const shutdown = this.request("shutdown");
    await Promise.race([shutdown, new Promise((resolve) => setTimeout(resolve, 1_000))]).catch(() => undefined);
    this.closed = true;
    this.child.stdin.end();
    this.terminate();
  }
}

export function runHarnessTurn(input: HarnessTurnInput): Promise<HarnessTurnResult> {
  return new HarnessProcess(input).run();
}
