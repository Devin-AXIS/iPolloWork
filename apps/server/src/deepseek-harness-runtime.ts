import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  providerApiKeyCredentialRef,
  serializeSharedProviderProfile,
  sharedProviderProfileEnvKey,
  sharedProviderProfiles,
  type SharedProviderProfile,
} from "@ipollowork/types/provider-credentials";
import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import type { EnvService } from "./env-file.js";
import { writeDeepSeekHarnessPatchFile } from "./deepseek-harness-patch.js";
import { onRuntimeMcpConfigWrite } from "./runtime-capability-store.js";
import { readRuntimeProviderChannels } from "./runtime-opencode-config-store.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import { resolveOpenAiCodexOAuthSession } from "./openai-codex-oauth.js";
import {
  compatibleProviderRuntimeProfiles,
  sharedProviderApiCredentials as readSharedProviderApiCredentials,
  sharedProviderChildEnvironment,
} from "./shared-provider-runtime.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir } from "./utils.js";

export {
  openAiCodexOAuthCredential,
  openAiCodexOAuthCredentialNeedsRefresh,
  refreshOpenAiCodexOAuthCredential,
  type OpenAiCodexOAuthCredential,
} from "./openai-codex-oauth.js";

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
    input?: Array<"text" | "image">;
  }>;
};

export function deepSeekHarnessWebArgs(
  configuredCli: string,
  patchPath: string,
): string[] {
  const webArgs = ["--profile", "web", "--patch", patchPath, "--port", "0"];
  return configuredCli ? [configuredCli, ...webArgs] : webArgs;
}

type DeepSeekHarnessProviderBridge = {
  providerId: string;
  displayName: string;
  api?: SharedProviderProfile["api"];
  baseURL?: string;
  discoverModels?: boolean;
  models?: DeepSeekHarnessDiscoveredModels["models"];

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

const OPENAI_CODEX_AUTH_PROVIDER_ID = "openai";
const OPENAI_CODEX_PROVIDER_BRIDGE: DeepSeekHarnessProviderBridge = {
  providerId: "openai-codex",
  displayName: "OpenAI",
};
const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;

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

// Provider catalogs occasionally use different stable IDs for the same
// public API channel. Keep those names at this adapter boundary so the app's
// shared credential remains engine-neutral and neither engine core needs a
// fork. Do not add aliases between products that merely share a vendor.
const DEEPSEEK_HARNESS_PROVIDER_ID_ALIASES = new Map<string, string>([
  ["kimi-for-coding", "kimi-coding"],
]);

/**
 * Translate the app-wide OpenCode-compatible provider profiles into the
 * provider-neutral shape consumed by the DSH pi-ai adapter. Credentials are
 * intentionally excluded and continue to cross the runtime boundary only
 * through credential references.
 */
export function deepSeekHarnessCompatibleProviderProfiles(
  providers: unknown,
): Map<string, DeepSeekHarnessProviderBridge> {
  return compatibleProviderRuntimeProfiles(providers);
}

export function sharedProviderApiCredentials(
  records: ReadonlyArray<{ key: string; value: string }>,
): Map<string, string> {
  return readSharedProviderApiCredentials(records);
}

export function deepSeekHarnessProviderCredentials(
  records: ReadonlyArray<{ key: string; value: string }>,
  options: { openAiCodexAccessToken?: string | null } = {},
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
    const targetProviderId = bridge?.providerId
      ?? DEEPSEEK_HARNESS_PROVIDER_ID_ALIASES.get(providerId)
      ?? providerId;
    credentials.set(targetProviderId, {
      apiKey,
      bridge,

    });
  }
  const openAiCodexAccessToken = options.openAiCodexAccessToken?.trim();
  if (openAiCodexAccessToken) {
    credentials.set(OPENAI_CODEX_PROVIDER_BRIDGE.providerId, {
      apiKey: openAiCodexAccessToken,
      bridge: OPENAI_CODEX_PROVIDER_BRIDGE,
    });
  }
  return credentials;
}

export function deepSeekHarnessChildEnvironment(
  records: ReadonlyArray<{ key: string; value: string }>,
): Record<string, string> {
  return sharedProviderChildEnvironment(records);
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
  readonly #workspace: WorkspaceInfo;
  #baseUrl: string | null = null;
  #child: ChildProcess | null = null;
  #starting: Promise<string> | null = null;
  #closing: Promise<void> | null = null;
  #providerCredentialSync: Promise<void> | null = null;
  #syncedCredentialFingerprint = "";
  #syncedProviderIds = new Set<string>();
  #syncedCompatibleProviderIds = new Set<string>();

  constructor(input: { config: ServerConfig; env: EnvService; workspace?: WorkspaceInfo }) {
    this.#config = input.config;
    this.#env = input.env;
    const workspace = input.workspace ?? input.config.workspaces.find((entry) => entry.engineId === DEEPSEEK_HARNESS_ENGINE_ID);
    if (!workspace) throw new Error("DeepSeek Harness requires a configured workspace");
    this.#workspace = workspace;
  }

  async call<T>(method: string, payload: unknown): Promise<T> {
    const baseUrl = await this.#ensureStarted();
    if (
      method === "session.selectModel"
      || method === "session.prompt"
      || method === "llm.models"
      || method === "llm.providers"
    ) {
      await this.#syncSharedProviderApiCredentials(baseUrl);
    }
    return this.#callAtBaseUrl<T>(baseUrl, method, payload);
  }

  async #callAtBaseUrl<T>(
    baseUrl: string,
    method: string,
    payload: unknown,
    timeoutMs = 60_000,
  ): Promise<T> {
    const rpcId = randomUUID();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/${encodeURIComponent(method)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        signal: AbortSignal.timeout(timeoutMs),
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
    if (this.#providerCredentialSync) return this.#providerCredentialSync;
    const pending = this.#performSharedProviderApiCredentialSync(baseUrl);
    this.#providerCredentialSync = pending;
    try {
      await pending;
    } finally {
      if (this.#providerCredentialSync === pending) {
        this.#providerCredentialSync = null;
      }
    }
  }

  async #performSharedProviderApiCredentialSync(baseUrl: string): Promise<void> {
    const [records, openAiCodexOAuth] = await Promise.all([
      this.#env.list(),
      resolveOpenAiCodexOAuthSession(this.#config),
    ]);
    if (
      openAiCodexOAuth
      && !sharedProviderProfiles(records).has(OPENAI_CODEX_AUTH_PROVIDER_ID)
    ) {
      await this.#env.upsertMany([{
        key: sharedProviderProfileEnvKey(OPENAI_CODEX_AUTH_PROVIDER_ID),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: OPENAI_CODEX_AUTH_PROVIDER_ID,
          displayName: "OpenAI",
          models: [],
        }),
      }]).catch(() => {});
    }
    const credentials = deepSeekHarnessProviderCredentials(records, {
      openAiCodexAccessToken: openAiCodexOAuth?.accessToken,
    });
    const compatibleProfiles = deepSeekHarnessCompatibleProviderProfiles(
      await readRuntimeProviderChannels(this.#config).catch(() => ({})),
    );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        credentials: [...credentials.entries()].sort(([a], [b]) => a.localeCompare(b)),
        profiles: [...compatibleProfiles.entries()].sort(([a], [b]) => a.localeCompare(b)),
      }))
      .digest("hex");
    if (fingerprint === this.#syncedCredentialFingerprint) return;
    let syncSucceeded = true;
    const removedProviderIds = new Set(
      [...this.#syncedProviderIds].filter((providerId) => !credentials.has(providerId)),
    );
    const directory = credentials.size > 0 || removedProviderIds.size > 0
      ? await this.#callAtBaseUrl<DeepSeekHarnessProviderDirectory>(
          baseUrl,
          "llm.providers",
          {},
        )
      : { providers: [] };
    const routes = new Map(directory.providers.map((route) => [route.provider, route]));
    for (const providerId of removedProviderIds) {
      const route = routes.get(providerId);
      if (route) {
        await this.#callAtBaseUrl(baseUrl, "settings.mutate", {
          ns: route.settingsNs,
          ops: [{ op: "unset", path: [...route.settingsPath, "apiKeyEnv"] }],
        }).catch(() => {
          syncSucceeded = false;
        });
      }
      await this.#callAtBaseUrl(baseUrl, "credentials.unset", {
        ref: providerApiKeyCredentialRef(providerId),
      }).catch(() => {
        syncSucceeded = false;
      });
    }
    const desiredCompatibleProviderIds = new Set(
      [...credentials.entries()].flatMap(([providerId, credential]) => {
        const explicitProfile = compatibleProfiles.get(providerId);
        const route = routes.get(providerId);
        if (explicitProfile && (!route || route.settingsNs === "llm-pi-ai")) return [providerId];
        if (credential.bridge && !route?.active) return [providerId];
        return [];
      }),
    );
    for (const providerId of this.#syncedCompatibleProviderIds) {
      if (desiredCompatibleProviderIds.has(providerId)) continue;
      await this.#callAtBaseUrl(baseUrl, "settings.mutate", {
        ns: "llm-pi-ai",
        ops: [{ op: "unset", path: ["providers", providerId] }],
      }).catch(() => {
        syncSucceeded = false;
      });
    }
    const orderedCredentials = [...credentials.entries()].sort(([, left], [, right]) => (
      Number(Boolean(left.bridge?.discoverModels)) - Number(Boolean(right.bridge?.discoverModels))
    ));
    for (const [providerId, credential] of orderedCredentials) {
      const explicitProfile = compatibleProfiles.get(providerId);
      const { apiKey } = credential;
      const route = routes.get(providerId);
      const useNativeRoute = Boolean(
        route && explicitProfile && route.settingsNs !== "llm-pi-ai",
      );
      if (useNativeRoute && route) {
        const ref = providerApiKeyCredentialRef(providerId);

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
          // Keep syncing the remaining providers when a native route refuses its credential.
          syncSucceeded = false;
        }
        continue;
      }
      const bridge = explicitProfile ?? credential.bridge;
      if (bridge) {
        const ref = providerApiKeyCredentialRef(providerId);
        if (!explicitProfile && route?.active) {
          try {
            await this.#callAtBaseUrl(baseUrl, "credentials.set", { ref, value: apiKey });
          } catch {
            // A single provider credential must not block the remaining shared
            // channels from reaching DeepSeek Harness.
            syncSucceeded = false;
          }
          continue;
        }
        let models = bridge.models;

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
            PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
          ).catch(() => null);
          models = discovery?.models
            .filter((model) => (
              providerId !== OPENCODE_ZEN_PUBLIC_PROVIDER_BRIDGE.providerId
              || apiKey !== OPENCODE_ZEN_PUBLIC_API_KEY
              || isOpenCodeZenPublicModel(model.id)
            ))
            .slice(0, 500);
        }
        if (bridge.discoverModels && !models?.length) {
          syncSucceeded = false;
          continue;
        }
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
          syncSucceeded = false;
        }
        continue;
      }
      if (!route) continue;
      const ref = providerApiKeyCredentialRef(providerId);
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
        syncSucceeded = false;
      }

    }
    if (syncSucceeded) {
      this.#syncedCredentialFingerprint = fingerprint;
      this.#syncedProviderIds = new Set(credentials.keys());
      this.#syncedCompatibleProviderIds = desiredCompatibleProviderIds;
    }
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
    if (!this.#closing) {
      this.#closing = this.#close().finally(() => {
        this.#closing = null;
      });
    }
    return this.#closing;
  }

  async #close(): Promise<void> {
    const starting = this.#starting;
    if (starting) await starting.catch(() => undefined);
    const child = this.#child;
    this.#baseUrl = null;
    this.#child = null;
    this.#starting = null;
    this.#syncedCredentialFingerprint = "";
    this.#syncedProviderIds.clear();
    this.#syncedCompatibleProviderIds.clear();
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  async #ensureStarted(): Promise<string> {
    if (this.#closing) await this.#closing;
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

    const dshHome = deepSeekHarnessHome(
      this.#config,
      this.#workspace,
      process.env.IPOLLOWORK_DSH_HOME?.trim(),

    );
    await ensureDir(dshHome);
    const patchPath = join(dshHome, ".ipollowork-runtime.patch.yml");
    await writeDeepSeekHarnessPatchFile({
      config: this.#config,
      workspace: this.#workspace,
      path: patchPath,
    });
    const storedEnv = deepSeekHarnessChildEnvironment(await this.#env.list());
    const childEnv = { ...process.env, ...storedEnv };
    // The Authorization Center owns this media-service credential. A chat
    // provider is enabled only through an explicit shared provider key.
    delete childEnv.DASHSCOPE_API_KEY;
    childEnv.IPOLLOWORK_SERVER_URL = `http://127.0.0.1:${this.#config.port}`;
    childEnv.IPOLLOWORK_SERVER_TOKEN = this.#config.token;
    childEnv.IPOLLOWORK_WORKSPACE_ID = this.#workspace.id;
    const nodeExecutable = process.versions.electron
      ? process.execPath
      : process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.platform === "win32" ? "node.exe" : "node");
    const executable = configuredCli ? nodeExecutable : process.platform === "win32" ? "dsh.cmd" : "dsh";
    const args = deepSeekHarnessWebArgs(configuredCli, patchPath);

    const child = spawn(executable, args, {
      cwd: this.#workspace.path,
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
        this.#syncedCompatibleProviderIds.clear();
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

function safeRuntimeSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-");
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === "-") start += 1;
  while (end > start && normalized[end - 1] === "-") end -= 1;
  return normalized.slice(start, end) || "workspace";
}

function deepSeekHarnessHome(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  configuredHome?: string,
): string {
  const root = runtimeStorageDir(config);
  const firstWorkspace = config.workspaces.find((entry) => entry.engineId === DEEPSEEK_HARNESS_ENGINE_ID);
  if (firstWorkspace?.id === workspace.id) {
    // Preserve the original single-runtime home so existing DSH sessions remain available.
    return configuredHome || join(root, "deepseek-harness");
  }
  if (configuredHome) return join(configuredHome, "workspaces", safeRuntimeSegment(workspace.id));
  return join(root, "deepseek-harness-workspaces", safeRuntimeSegment(workspace.id));
}

export class DeepSeekHarnessRuntimePool {
  readonly #config: ServerConfig;
  readonly #env: EnvService;
  readonly #runtimes = new Map<string, DeepSeekHarnessRuntime>();
  readonly #stopConfigListener: () => void;

  constructor(input: { config: ServerConfig; env: EnvService }) {
    this.#config = input.config;
    this.#env = input.env;
    this.#stopConfigListener = onRuntimeMcpConfigWrite((config, workspaceId) => {
      if (config !== this.#config) return;
      void this.closeWorkspace(workspaceId);
    });
  }

  forWorkspace(workspace: WorkspaceInfo): DeepSeekHarnessRuntime {
    const existing = this.#runtimes.get(workspace.id);
    if (existing) return existing;
    const runtime = new DeepSeekHarnessRuntime({ config: this.#config, env: this.#env, workspace });
    this.#runtimes.set(workspace.id, runtime);
    return runtime;
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    const runtime = this.#runtimes.get(workspaceId);
    this.#runtimes.delete(workspaceId);
    await runtime?.close();
  }

  async close(): Promise<void> {
    this.#stopConfigListener();
    await Promise.all([...this.#runtimes.values()].map((runtime) => runtime.close()));
    this.#runtimes.clear();
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
