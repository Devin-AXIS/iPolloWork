import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  providerApiKeyCredentialRef,
  sharedProviderIdFromCredentialEnvKey,
  sharedProviderProfiles,
  type SharedProviderProfile,
} from "@ipollowork/types/provider-credentials";

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

type DeepSeekHarnessProviderDirectory = {
  providers: Array<{
    provider: string;
    settingsNs: string;
    settingsPath: string[];
    active?: boolean;
  }>;
};

type DeepSeekHarnessDiscoveredModels = {
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
  }>;
};

export function deepSeekHarnessManagedPluginPatchPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "deepseek-harness", "ipollowork-plugin-packages.patch.yml");
}

export function deepSeekHarnessWebArgs(
  configuredCli: string,
  managedPluginPatch: string,
): string[] {
  // DSH stops parsing launcher options at the first web-app option. Keep the
  // launcher-owned --patch before --port, which belongs to the web app.
  const webArgs = ["web", "--patch", managedPluginPatch, "--port", "0"];
  return configuredCli ? [configuredCli, ...webArgs] : webArgs;
}

type DeepSeekHarnessProviderBridge = {
  providerId: string;
  displayName: string;
  api?: SharedProviderProfile["api"];
  baseURL?: string;
  discoverModels?: boolean;
  models?: SharedProviderProfile["models"];
};

type DeepSeekHarnessProviderCredential = {
  apiKey: string;
  bridge?: DeepSeekHarnessProviderBridge;
};

const DASHSCOPE_PROVIDER_BRIDGE: DeepSeekHarnessProviderBridge = {
  providerId: "alibaba-cn",
  displayName: "Qwen / Alibaba Cloud",
  api: "openai-completions",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  discoverModels: true,
};

const OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE: DeepSeekHarnessProviderBridge = {
  providerId: "opencode",
  displayName: "iPolloWork Built-in Models",
  api: "openai-completions",
  baseURL: "https://opencode.ai/zen/v1",
  discoverModels: true,
};

const OPENCODE_ZEN_PUBLIC_API_KEY = "public";

function isOpenCodeZenPublicModel(modelId: string): boolean {
  return modelId === "big-pickle" || modelId.endsWith("-free");
}

function providerBridge(
  providerId: string,
  profile?: SharedProviderProfile,
): DeepSeekHarnessProviderBridge | undefined {
  if (providerId === OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE.providerId) {
    return {
      ...OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE,
      displayName: profile?.displayName || OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE.displayName,
    };
  }
  if (providerId === "alibaba" || providerId === "alibaba-cn") {
    return {
      ...DASHSCOPE_PROVIDER_BRIDGE,
      providerId,
      displayName: profile?.displayName
        || (providerId === "alibaba" ? "Alibaba" : DASHSCOPE_PROVIDER_BRIDGE.displayName),
      ...(profile?.models.length ? { models: profile.models, discoverModels: false } : {}),
    };
  }
  if (!profile?.baseURL || !profile.api || profile.models.length === 0) return undefined;
  return {
    providerId: profile.providerId,
    displayName: profile.displayName,
    api: profile.api,
    baseURL: profile.baseURL,
    models: profile.models,
  };
}

export function sharedProviderApiCredentials(
  records: ReadonlyArray<{ key: string; value: string }>,
): Map<string, string> {
  return new Map(records.flatMap((record) => {
    const providerId = sharedProviderIdFromCredentialEnvKey(record.key);
    const apiKey = record.value.trim();
    return providerId && apiKey ? [[providerId, apiKey] as const] : [];
  }));
}

export function deepSeekHarnessProviderCredentials(
  records: ReadonlyArray<{ key: string; value: string }>,
): Map<string, DeepSeekHarnessProviderCredential> {
  const credentials = new Map<string, DeepSeekHarnessProviderCredential>([[
    OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE.providerId,
    {
      apiKey: OPENCODE_ZEN_PUBLIC_API_KEY,
      bridge: OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE,
    },
  ]]);
  const profiles = sharedProviderProfiles(records);
  for (const [providerId, apiKey] of sharedProviderApiCredentials(records)) {
    const bridge = providerBridge(providerId, profiles.get(providerId));
    credentials.set(bridge?.providerId ?? providerId, {
      apiKey,
      ...(bridge ? { bridge } : {}),
    });
  }
  return credentials;
}

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
  #syncedCredentialFingerprint = "";
  #syncedProviderIds = new Set<string>();

  constructor(input: { config: ServerConfig; env: EnvService }) {
    this.#config = input.config;
    this.#env = input.env;
  }

  async call<T>(method: string, payload: unknown): Promise<T> {
    const baseUrl = await this.#ensureStarted();
    if (
      method === "session.selectModel"
      || method === "llm.models"
      || method === "llm.providers"
    ) {
      await this.#syncSharedProviderApiCredentials(baseUrl);
    }
    return this.#callAtBaseUrl<T>(baseUrl, method, payload);
  }

  async #callAtBaseUrl<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
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

  async #syncSharedProviderApiCredentials(baseUrl: string): Promise<void> {
    const credentials = deepSeekHarnessProviderCredentials(await this.#env.list());
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([...credentials.entries()].sort(([a], [b]) => a.localeCompare(b))))
      .digest("hex");
    if (fingerprint === this.#syncedCredentialFingerprint) return;
    const removedProviderIds = new Set(
      [...this.#syncedProviderIds].filter((providerId) => !credentials.has(providerId)),
    );
    // Older builds mirrored the media-center DashScope key into this bridge.
    // Clear that persisted credential unless the user explicitly connected it.
    if (!credentials.has(DASHSCOPE_PROVIDER_BRIDGE.providerId)) {
      removedProviderIds.add(DASHSCOPE_PROVIDER_BRIDGE.providerId);
    }
    for (const providerId of removedProviderIds) {
      await this.#callAtBaseUrl(baseUrl, "credentials.unset", {
        ref: providerApiKeyCredentialRef(providerId),
      }).catch(() => undefined);
    }
    const directory = credentials.size > 0
      ? await this.#callAtBaseUrl<DeepSeekHarnessProviderDirectory>(
          baseUrl,
          "llm.providers",
          {},
        )
      : { providers: [] };
    const routes = new Map(directory.providers.map((route) => [route.provider, route]));
    for (const [providerId, credential] of credentials) {
      const { apiKey, bridge } = credential;
      const route = routes.get(providerId);
      const ref = providerApiKeyCredentialRef(providerId);
      if (route && !bridge) {
        try {
          await this.#callAtBaseUrl(baseUrl, "settings.mutate", {
            ns: route.settingsNs,
            ops: [{
              op: "set",
              path: [...route.settingsPath, "apiKeyEnv"],
              value: ref,
            }],
          });
          await this.#callAtBaseUrl(baseUrl, "credentials.set", { ref, value: apiKey });
        } catch {
          // A provider can be OpenCode-only (for example OAuth/custom protocol).
          // Leave that route untouched without blocking every other DSH model.
        }
        continue;
      }
      if (bridge) {
        let models: DeepSeekHarnessDiscoveredModels["models"] | undefined = bridge.models;
        if (bridge.discoverModels) {
          const discovery = await this.#callAtBaseUrl<DeepSeekHarnessDiscoveredModels>(
            baseUrl,
            "llm.discoverModels",
            {
              settingsNs: "llm-pi-ai",
              provider: bridge.providerId,
              baseURL: bridge.baseURL,
              api: bridge.api,
              apiKey,
            },
          ).catch(() => null);
          models = discovery?.models
            .filter((model) => (
              providerId !== OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE.providerId
              || apiKey !== OPENCODE_ZEN_PUBLIC_API_KEY
              || isOpenCodeZenPublicModel(model.id)
            ))
            .slice(0, 500);
        }
        if (bridge.discoverModels && !models?.length) continue;
        try {
          await this.#callAtBaseUrl(baseUrl, "settings.mutate", {
            ns: route?.settingsNs ?? "llm-pi-ai",
            ops: [{
              op: "set",
              path: route?.settingsPath ?? ["providers", providerId],
              value: {
                displayName: bridge.displayName,
                apiKeyEnv: ref,
                ...(bridge.api ? { api: bridge.api } : {}),
                ...(bridge.baseURL ? { baseURL: bridge.baseURL } : {}),
                ...(models ? { models } : {}),
              },
            }],
          });
          await this.#callAtBaseUrl(baseUrl, "credentials.set", { ref, value: apiKey });
        } catch {
          // Keep syncing the remaining providers when one compatible endpoint
          // rejects discovery or its profile.
        }
        continue;
      }
    }
    this.#syncedCredentialFingerprint = fingerprint;
    this.#syncedProviderIds = new Set(credentials.keys());
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
    this.#syncedCredentialFingerprint = "";
    this.#syncedProviderIds.clear();
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
    const managedPluginPatch = deepSeekHarnessManagedPluginPatchPath(this.#config);
    if (!existsSync(managedPluginPatch)) await writeFile(managedPluginPatch, "[]\n", "utf8");
    const storedEnv = Object.fromEntries(
      (await this.#env.list())
        .filter((entry) => !isReservedEnvKey(entry.key))
        .map((entry) => [entry.key, entry.value]),
    );
    const childEnv = { ...process.env, ...storedEnv };
    // The Authorization Center owns this media-service credential. A chat
    // provider is enabled only through an explicit shared provider key.
    delete childEnv.DASHSCOPE_API_KEY;
    const nodeExecutable = process.versions.electron
      ? process.execPath
      : process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.platform === "win32" ? "node.exe" : "node");
    const executable = configuredCli ? nodeExecutable : process.platform === "win32" ? "dsh.cmd" : "dsh";
    const args = deepSeekHarnessWebArgs(configuredCli, managedPluginPatch);
    const child = spawn(executable, args, {
      cwd: dshHome,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...childEnv,
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
      await this.#syncSharedProviderApiCredentials(this.#baseUrl).catch(() => undefined);
      child.once("exit", () => {
        if (this.#child !== child) return;
        this.#baseUrl = null;
        this.#child = null;
        this.#syncedCredentialFingerprint = "";
        this.#syncedProviderIds.clear();
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
