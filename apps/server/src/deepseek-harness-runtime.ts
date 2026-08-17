import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { isReservedEnvKey, type EnvService } from "./env-file.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

type RpcFailure = {
  code: string;
  message: string;
  details?: unknown;
};

type RpcResponse<T> = {
  type: "server-response";
  rpcId: string;
  result: { ok: true; value: T } | { ok: false; error: RpcFailure };
};

export class DeepSeekHarnessUnavailableError extends Error {
  readonly code = "deepseek_harness_unavailable";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeepSeekHarnessUnavailableError";
  }
}

export class DeepSeekHarnessRpcError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(error: RpcFailure) {
    super(error.message);
    this.name = "DeepSeekHarnessRpcError";
    this.code = error.code;
    this.details = error.details;
  }
}

export class DeepSeekHarnessRuntime {
  readonly #config: ServerConfig;
  readonly #env: EnvService;
  #baseUrl: string | null = null;
  #child: ChildProcess | null = null;
  #starting: Promise<string> | null = null;

  constructor(input: { config: ServerConfig; env: EnvService }) {
    this.#config = input.config;
    this.#env = input.env;
  }

  async call<T>(method: string, payload: unknown): Promise<T> {
    const baseUrl = await this.#ensureStarted();
    const rpcId = randomUUID();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/${encodeURIComponent(method)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new DeepSeekHarnessUnavailableError("DeepSeek Harness could not be reached", { cause: error });
    }
    if (!response.ok) {
      throw new DeepSeekHarnessUnavailableError(
        `DeepSeek Harness returned HTTP ${response.status}`,
      );
    }
    const envelope = await response.json() as RpcResponse<T>;
    if (envelope.rpcId !== rpcId) {
      throw new DeepSeekHarnessUnavailableError("DeepSeek Harness returned a mismatched response");
    }
    if (!envelope.result.ok) throw new DeepSeekHarnessRpcError(envelope.result.error);
    return envelope.result.value;
  }

  async respond(input: { rpcId: string; result: unknown }): Promise<void> {
    const baseUrl = await this.#ensureStarted();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-response", rpcId: input.rpcId, result: input.result }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new DeepSeekHarnessUnavailableError("DeepSeek Harness could not receive the response", { cause: error });
    }
    if (!response.ok) {
      throw new DeepSeekHarnessUnavailableError(`DeepSeek Harness returned HTTP ${response.status}`);
    }
    const receipt = await response.json() as { accepted?: boolean; reason?: string };
    if (receipt.accepted !== true) {
      throw new DeepSeekHarnessUnavailableError(receipt.reason || "DeepSeek Harness rejected the response");
    }
  }

  async events(stream: "mux" | "host", signal: AbortSignal): Promise<Response> {
    const baseUrl = await this.#ensureStarted();
    try {
      const response = await fetch(`${baseUrl}/api/events.${stream}`, { signal });
      if (response.ok && response.body) return response;
      if (response.status === 426) {
        await response.body?.cancel();
        return await openWebSocketEventStream(baseUrl, stream, signal);
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new DeepSeekHarnessUnavailableError("DeepSeek Harness event stream is unavailable", { cause: error });
    }
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#baseUrl = null;
    this.#child = null;
    this.#starting = null;
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  async #ensureStarted(): Promise<string> {
    if (this.#baseUrl && this.#child?.exitCode === null) return this.#baseUrl;
    if (!this.#starting) {
      this.#starting = this.#start().finally(() => {
        this.#starting = null;
      });
    }
    return this.#starting;
  }

  async #start(): Promise<string> {
    const configuredCli = process.env.IPOLLOWORK_DSH_CLI?.trim() ?? "";
    if (configuredCli && !existsSync(configuredCli)) {
      throw new DeepSeekHarnessUnavailableError(`DeepSeek Harness runtime was not found at ${configuredCli}`);
    }

    const dshHome = process.env.IPOLLOWORK_DSH_HOME?.trim()
      || join(runtimeStorageDir(this.#config), "deepseek-harness");
    await ensureDir(dshHome);
    const storedEnv = Object.fromEntries(
      (await this.#env.list())
        .filter((entry) => !isReservedEnvKey(entry.key))
        .map((entry) => [entry.key, entry.value]),
    );
    const nodeExecutable = process.versions.electron
      ? process.execPath
      : process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.platform === "win32" ? "node.exe" : "node");
    const executable = configuredCli ? nodeExecutable : process.platform === "win32" ? "dsh.cmd" : "dsh";
    const args = configuredCli
      ? [configuredCli, "web", "--port", "0"]
      : ["web", "--port", "0"];
    const child = spawn(executable, args, {
      cwd: dshHome,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...storedEnv,
        DSH_HOME: dshHome,
        ELECTRON_RUN_AS_NODE: "1",
        NO_COLOR: "1",
      },
    });
    this.#child = child;

    try {
      const baseUrl = await waitForReadyUrl(child);
      child.stdout?.resume();
      child.stderr?.resume();
      this.#baseUrl = baseUrl.replace(/\/+$/, "");
      child.once("exit", () => {
        if (this.#child !== child) return;
        this.#baseUrl = null;
        this.#child = null;
      });
      return this.#baseUrl;
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGTERM");
      this.#child = null;
      throw error instanceof DeepSeekHarnessUnavailableError
        ? error
        : new DeepSeekHarnessUnavailableError("DeepSeek Harness failed to start", { cause: error });
    }
  }
}

function openWebSocketEventStream(
  baseUrl: string,
  stream: "mux" | "host",
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/events.${stream}`, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    const encoder = new TextEncoder();
    let opened = false;
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        cancelStream();
      },
    });
    const timeout = setTimeout(() => fail(new Error("WebSocket connection timed out")), 15_000);

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
    };
    const closeSocket = () => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
    const finish = () => {
      if (closed) return;
      closed = true;
      cleanup();
      controller.close();
    };
    const cancelStream = () => {
      if (closed) return;
      closed = true;
      cleanup();
      closeSocket();
    };
    const fail = (error: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      closeSocket();
      if (opened) controller.error(error);
      else reject(error);
    };
    const handleOpen = () => {
      if (signal.aborted) {
        fail(signal.reason);
        return;
      }
      opened = true;
      clearTimeout(timeout);
      resolve(new Response(body));
    };
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        fail(new Error("DeepSeek Harness returned a binary event frame"));
        return;
      }
      controller.enqueue(encoder.encode(`data: ${event.data}\n\n`));
    };
    const handleClose = () => {
      if (opened) finish();
      else fail(new Error("WebSocket connection closed before opening"));
    };
    const handleError = () => fail(new Error("WebSocket connection failed"));
    const handleAbort = () => fail(signal.reason);

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

function waitForReadyUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new DeepSeekHarnessUnavailableError(`DeepSeek Harness did not start in time${output ? `: ${output.trim()}` : ""}`));
    }, 60_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onData = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-8_000);
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output);
      if (!match?.[1]) return;
      cleanup();
      resolve(match[1]);
    };
    const onError = (error: Error) => {
      cleanup();
      const hint = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "DeepSeek Harness is not installed. Install dsh or set IPOLLOWORK_DSH_CLI."
        : `DeepSeek Harness failed to start: ${error.message}`;
      reject(new DeepSeekHarnessUnavailableError(hint, { cause: error }));
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new DeepSeekHarnessUnavailableError(
        `DeepSeek Harness exited before it was ready (code ${code ?? "unknown"})${output ? `: ${output.trim()}` : ""}`,
      ));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
