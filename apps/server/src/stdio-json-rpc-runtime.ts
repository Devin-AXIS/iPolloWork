import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonRpcId = string | number;

type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type StdioJsonRpcEvent =
  | { type: "notification"; method: string; params: unknown }
  | { type: "request"; id: JsonRpcId; method: string; params: unknown };

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export class StdioJsonRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;

  constructor(message: string, input: { code?: number; data?: unknown; cause?: unknown } = {}) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "StdioJsonRpcError";
    this.code = input.code;
    this.data = input.data;
  }
}

export class StdioJsonRpcProcess {
  readonly #name: string;
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #listeners = new Set<(event: StdioJsonRpcEvent) => void>();
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  #child: ChildProcess | null = null;
  #reader: Interface | null = null;
  #nextId = 1;
  #stderr = "";

  constructor(input: {
    name: string;
    command: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) {
    this.#name = input.name;
    this.#command = input.command;
    this.#args = input.args;
    this.#cwd = input.cwd;
    this.#env = input.env;
  }

  start(): void {
    if (this.#child?.exitCode === null) return;
    const child = spawn(this.#command, [...this.#args], {
      cwd: this.#cwd,
      env: this.#env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString()}`.slice(-8_000);
    });
    const reader = createInterface({ input: child.stdout! });
    this.#reader = reader;
    reader.on("line", (line) => this.#handleLine(line));
    child.once("error", (error) => this.#fail(new StdioJsonRpcError(
      `${this.#name} failed to start: ${error.message}`,
      { cause: error },
    )));
    child.once("exit", (code) => this.#fail(new StdioJsonRpcError(
      `${this.#name} exited (code ${code ?? "unknown"})${this.#stderr.trim() ? `: ${this.#stderr.trim()}` : ""}`,
    )));
  }

  subscribe(listener: (event: StdioJsonRpcEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async call<T>(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<T> {
    this.start();
    const child = this.#child;
    if (!child?.stdin?.writable) throw new StdioJsonRpcError(`${this.#name} is unavailable`);
    const id = this.#nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new StdioJsonRpcError(`${this.#name} request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return await result as T;
  }

  notify(method: string, params: unknown = {}): void {
    this.start();
    const child = this.#child;
    if (!child?.stdin?.writable) throw new StdioJsonRpcError(`${this.#name} is unavailable`);
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: JsonRpcId, result: unknown): void {
    const child = this.#child;
    if (!child?.stdin?.writable) throw new StdioJsonRpcError(`${this.#name} is unavailable`);
    child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    this.#reader?.close();
    this.#reader = null;
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const message = value as Record<string, unknown>;
    if ((typeof message.id === "number" || typeof message.id === "string") && !("method" in message)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      const response = message as JsonRpcResponse;
      if (response.error) {
        pending.reject(new StdioJsonRpcError(
          response.error.message || `${this.#name} request failed`,
          { code: response.error.code, data: response.error.data },
        ));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const event: StdioJsonRpcEvent = typeof message.id === "number" || typeof message.id === "string"
      ? { type: "request", id: message.id, method: message.method, params: message.params }
      : { type: "notification", method: message.method, params: message.params };
    for (const listener of this.#listeners) listener(event);
  }

  #fail(error: Error): void {
    this.#reader?.close();
    this.#reader = null;
    this.#child = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
