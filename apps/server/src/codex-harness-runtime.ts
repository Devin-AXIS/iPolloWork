import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import {
  sharedProviderDisconnectedIdsFromEnvKeys,
  sharedProviderProfiles,
  sharedProviderRuntimeRoute,
  type SharedProviderModelProfile,
  type SharedProviderProtocol,
} from "@ipollowork/types/provider-credentials";
import { openCodeZenPublicModels } from "@ipollowork/types/opencode-zen-public-models";
import { CODEX_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { EnvService } from "./env-file.js";
import {
  CodexProviderGateway,
  type CodexProviderGatewayUpstream,
} from "./codex-provider-gateway.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import {
  resolveOpenAiCodexOAuthSession,
  type OpenAiCodexOAuthSession,
} from "./openai-codex-oauth.js";
import { readRuntimeMcpConfig } from "./runtime-capability-store.js";
import { onRuntimeMcpConfigWrite } from "./runtime-capability-store.js";
import { readRuntimeProviderChannels } from "./runtime-opencode-config-store.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import {
  compatibleProviderRuntimeProfiles,
  sharedProviderApiCredentials,
  sharedProviderChildEnvironment,
} from "./shared-provider-runtime.js";
import {
  StdioJsonRpcError,
  StdioJsonRpcProcess,
  type StdioJsonRpcEvent,
} from "./stdio-json-rpc-runtime.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir } from "./utils.js";

type ProviderProtocol = "openai-responses";

export type CodexHarnessProvider = {
  id: string;
  name: string;
  api: ProviderProtocol;
  baseURL: string;
  apiKey: string;
  models: SharedProviderModelProfile[];
  httpHeaders?: Record<string, string>;
  upstream?: CodexProviderGatewayUpstream;
};

export type CodexHarnessProviderCatalogItem = Pick<
  CodexHarnessProvider,
  "id" | "name" | "models"
>;

export type CodexHarnessProviderDirectory = {
  all: CodexHarnessProviderCatalogItem[];
  connected: string[];
};

export type CodexHarnessEvent = StdioJsonRpcEvent;

const OPENCODE_PROVIDER: Omit<CodexHarnessProvider, "models"> = {
  id: "opencode",
  name: "iPolloWork Built-in Models",
  api: "openai-responses",
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: "public",
};

type AccountProviderCatalog = Map<string, {
  name: string;
  models: SharedProviderModelProfile[];
}>;

const OPENAI_CODEX_OAUTH_BASE_URL = "https://chatgpt.com/backend-api/codex";
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringMap(value: Record<string, unknown>): string | null {
  const entries = Object.entries(value).flatMap(([key, entry]) => (
    typeof entry === "string" ? [[key, entry] as const] : []
  ));
  return entries.length
    ? `{ ${entries.map(([key, entry]) => `${tomlString(key)} = ${tomlString(entry)}`).join(", ")} }`
    : null;
}

function safeEnvironmentSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "PROVIDER";
}

function safeRuntimeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function codexHarnessRuntimeProviderId(providerId: string): string {
  return `ipollowork-${safeRuntimeSegment(providerId).toLowerCase()}`;
}

function providerEnvironmentKey(providerId: string): string {
  return `IPOLLOWORK_CODEX_PROVIDER_${safeEnvironmentSegment(providerId)}_API_KEY`;
}

function normalizeProviderApi(value: unknown): SharedProviderProtocol | null {
  if (value === "openai-responses" || value === "openai-completions" || value === "anthropic-messages") {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codexHarnessOpenCodeModels(models: SharedProviderModelProfile[]): SharedProviderModelProfile[] {
  const discovered = new Map(models.map((model) => [model.id, model]));
  return openCodeZenPublicModels().map((profile) => {
    const model = discovered.get(profile.id);
    return model ? { ...model, name: profile.name } : profile;
  });
}

async function readAccountProviderCatalog(config: ServerConfig): Promise<AccountProviderCatalog> {
  const workspace = config.workspaces.find(
    (entry) => (entry.engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID,
  ) ?? config.workspaces[0];
  if (!workspace) return new Map();
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl) return new Map();
  const client = createOpencodeClient({
    baseUrl: connection.baseUrl,
    ...(workspace.path ? { directory: workspace.path } : {}),
    ...(connection.authHeader ? { headers: { Authorization: connection.authHeader } } : {}),
  });
  const result = await client.provider.list({ directory: workspace.path });
  if (!result.data) return new Map();
  return new Map(result.data.all.map((provider) => [provider.id, {
    name: provider.name,
    models: Object.values(provider.models).map((model) => ({
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(model.limit.context > 0 ? { contextWindow: model.limit.context } : {}),
      ...(model.limit.output > 0 ? { maxTokens: model.limit.output } : {}),
    })),
  }]));
}

export async function codexHarnessProviders(input: {
  config: ServerConfig;
  records: ReadonlyArray<{ key: string; value: string }>;
  openAiCodexOAuth?: OpenAiCodexOAuthSession | null;
  catalog?: AccountProviderCatalog;
}): Promise<CodexHarnessProvider[]> {
  const credentials = sharedProviderApiCredentials(input.records);
  const profiles = sharedProviderProfiles(input.records);
  const runtimeProfiles = compatibleProviderRuntimeProfiles(
    await readRuntimeProviderChannels(input.config).catch(() => ({})),
  );
  const providers = new Map<string, CodexHarnessProvider>();

  const runtimeOpenCode = runtimeProfiles.get(OPENCODE_PROVIDER.id);
  const catalogOpenCode = input.catalog?.get(OPENCODE_PROVIDER.id);
  const profileOpenCode = profiles.get(OPENCODE_PROVIDER.id);
  const openCodeModels = runtimeOpenCode?.models.length
    ? runtimeOpenCode.models
    : profileOpenCode?.models.length
      ? profileOpenCode.models
      : catalogOpenCode?.models ?? [];
  providers.set(OPENCODE_PROVIDER.id, {
    ...OPENCODE_PROVIDER,
    name: catalogOpenCode?.name ?? OPENCODE_PROVIDER.name,
    models: codexHarnessOpenCodeModels(openCodeModels),
    upstream: {
      providerId: OPENCODE_PROVIDER.id,
      protocol: "openai-completions",
      baseURL: OPENCODE_PROVIDER.baseURL,
      apiKey: OPENCODE_PROVIDER.apiKey,
      // Preserve the OpenCode client identity while the gateway applies each
      // model's session-affinity compatibility from the shared Zen roster.
      httpHeaders: { "User-Agent": "opencode/ipollowork" },
    },
  });

  for (const [providerId, apiKey] of credentials) {
    const profile = profiles.get(providerId);
    const runtimeProfile = runtimeProfiles.get(providerId);
    const defaults = sharedProviderRuntimeRoute(providerId);
    const api = normalizeProviderApi(profile?.api)
      ?? normalizeProviderApi(runtimeProfile?.api)
      ?? defaults?.api;
    const baseURL = profile?.baseURL ?? runtimeProfile?.baseURL ?? defaults?.baseURL;
    if (!api || !baseURL) continue;
    const catalogProvider = input.catalog?.get(providerId);
    const models = profile?.models.length
      ? profile.models
      : runtimeProfile?.models.length
        ? runtimeProfile.models
        : catalogProvider?.models ?? [];
    providers.set(providerId, {
      id: providerId,
      name: profile?.displayName ?? runtimeProfile?.displayName ?? catalogProvider?.name ?? providerId,
      api: "openai-responses",
      baseURL,
      apiKey,
      models,
      ...(api === "openai-responses"
        ? {}
        : {
            upstream: {
              providerId,
              protocol: api,
              baseURL,
              apiKey,
            },
          }),
    });
  }

  // The account provider UI stores OpenAI Codex sign-in in OpenCode's shared
  // OAuth vault, not as a second API key. Project that same account session
  // into Codex Harness only when an explicit OpenAI API key did not already
  // select the public Responses API route.
  if (input.openAiCodexOAuth && profiles.has("openai") && !providers.has("openai")) {
    const profile = profiles.get("openai");
    const runtimeProfile = runtimeProfiles.get("openai");
    const catalogProvider = input.catalog?.get("openai");
    providers.set("openai", {
      id: "openai",
      name: profile?.displayName ?? runtimeProfile?.displayName ?? catalogProvider?.name ?? "OpenAI",
      api: "openai-responses",
      baseURL: OPENAI_CODEX_OAUTH_BASE_URL,
      apiKey: input.openAiCodexOAuth.accessToken,
      models: profile?.models.length
        ? profile.models
        : runtimeProfile?.models.length
          ? runtimeProfile.models
          : catalogProvider?.models ?? [],
      ...(input.openAiCodexOAuth.accountId
        ? { httpHeaders: { "ChatGPT-Account-Id": input.openAiCodexOAuth.accountId } }
        : {}),
    });
  }
  return [...providers.values()];
}

/**
 * Describe every account provider that Codex Harness knows how to route,
 * including providers whose credential is currently unavailable. Runtime
 * configuration still receives only `connected` providers with usable
 * secrets; this directory exists so clients can keep configured models
 * visible and offer a reconnect action instead of silently hiding them.
 */
export function codexHarnessProviderDirectory(input: {
  records: ReadonlyArray<{ key: string; value: string }>;
  providers: readonly CodexHarnessProvider[];
  catalog?: AccountProviderCatalog;
}): CodexHarnessProviderDirectory {
  const profiles = sharedProviderProfiles(input.records);
  const all = new Map<string, CodexHarnessProviderCatalogItem>(
    input.providers.map((provider) => [provider.id, {
      id: provider.id,
      name: provider.name,
      models: provider.models,
    }]),
  );

  for (const [providerId, profile] of profiles) {
    if (all.has(providerId)) continue;
    const defaults = sharedProviderRuntimeRoute(providerId);
    const api = normalizeProviderApi(profile.api) ?? defaults?.api;
    const baseURL = profile.baseURL ?? defaults?.baseURL;
    const catalogProvider = input.catalog?.get(providerId);
    const models = profile.models.length ? profile.models : catalogProvider?.models ?? [];
    if (!api || !baseURL || models.length === 0) continue;
    all.set(providerId, {
      id: providerId,
      name: profile.displayName || catalogProvider?.name || providerId,
      models,
    });
  }

  return {
    all: [...all.values()],
    connected: input.providers.map((provider) => provider.id),
  };
}

function codexMcpConfig(name: string, value: Record<string, unknown>): string[] {
  if (value.enabled === false) return [];
  const table = `[mcp_servers.${tomlString(name)}]`;
  if (value.type === "local" && Array.isArray(value.command)) {
    const [command, ...args] = value.command.filter((entry): entry is string => typeof entry === "string");
    if (!command) return [];
    const lines = [table, `command = ${tomlString(command)}`];
    if (args.length) lines.push(`args = [${args.map(tomlString).join(", ")}]`);
    const environment = value.environment;
    if (environment && typeof environment === "object" && !Array.isArray(environment)) {
      const env = tomlStringMap(environment as Record<string, unknown>);
      if (env) lines.push(`env = ${env}`);
    }
    return lines;
  }
  if (value.type === "remote" && typeof value.url === "string" && value.url.trim()) {
    const lines = [table, `url = ${tomlString(value.url.trim())}`];
    const headers = value.headers;
    if (headers && typeof headers === "object" && !Array.isArray(headers)) {
      const httpHeaders = tomlStringMap(headers as Record<string, unknown>);
      if (httpHeaders) lines.push(`http_headers = ${httpHeaders}`);
    }
    return lines;
  }
  return [];
}

export function codexHarnessHostMcp(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Record<string, unknown> {
  return {
    type: "remote",
    url: `http://127.0.0.1:${config.port}/engine-tools/mcp?workspaceId=${encodeURIComponent(workspace.id)}`,
    headers: { Authorization: `Bearer ${config.token}` },
  };
}

export function codexHarnessConfig(input: {
  providers: readonly CodexHarnessProvider[];
  mcp: Record<string, Record<string, unknown>>;
}): string {
  const lines = [
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "",
    "[features]",
    // iPolloWork owns plugin discovery and execution through its scoped MCP
    // bridge. Codex's separate marketplace otherwise clones openai/plugins
    // into every workspace runtime before a tool turn can continue.
    "plugins = false",
    "",
  ];
  for (const provider of input.providers) {
    const runtimeProviderId = codexHarnessRuntimeProviderId(provider.id);
    const block = [
      `[model_providers.${tomlString(runtimeProviderId)}]`,
      `name = ${tomlString(provider.name)}`,
      `base_url = ${tomlString(provider.baseURL)}`,
      `env_key = ${tomlString(providerEnvironmentKey(runtimeProviderId))}`,
      'wire_api = "responses"',
      "request_max_retries = 2",
      "stream_max_retries = 2",
    ];
    const httpHeaders = provider.httpHeaders ? tomlStringMap(provider.httpHeaders) : null;
    if (httpHeaders) block.push(`http_headers = ${httpHeaders}`);
    lines.push(...block, "");
  }
  for (const [name, value] of Object.entries(input.mcp)) {
    const block = codexMcpConfig(name, value);
    if (block.length) lines.push(...block, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export class CodexHarnessUnavailableError extends Error {
  readonly code = "codex_harness_unavailable";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexHarnessUnavailableError";
  }
}

export class CodexHarnessModelSelectionError extends Error {
  readonly code = "codex_harness_model_selection_failed";

  constructor(message: string) {
    super(message);
    this.name = "CodexHarnessModelSelectionError";
  }
}

export function isCodexUnmaterializedThreadError(error: unknown): boolean {
  if (!(error instanceof StdioJsonRpcError)) return false;
  const message = error.message.toLowerCase();
  return message.includes("no rollout found for thread id")
    || (
      message.includes("not materialized yet")
      && message.includes("includeturns is unavailable before first user message")
    );
}

type AttachedThreadSelection = {
  provider: string;
  model: string;
};

export class CodexHarnessRuntime {
  readonly #config: ServerConfig;
  readonly #env: EnvService;
  readonly #workspace: WorkspaceInfo;
  #process: StdioJsonRpcProcess | null = null;
  #starting: Promise<StdioJsonRpcProcess> | null = null;
  #fingerprint = "";
  #providers: CodexHarnessProvider[] = [];
  readonly #attachedThreadSelections = new Map<string, AttachedThreadSelection>();
  readonly #eventListeners = new Set<(event: CodexHarnessEvent) => void>();
  #unsubscribeProcessEvents = () => {};
  readonly #providerGateway = new CodexProviderGateway();

  constructor(input: { config: ServerConfig; env: EnvService; workspace: WorkspaceInfo }) {
    this.#config = input.config;
    this.#env = input.env;
    this.#workspace = input.workspace;
  }

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const process = await this.#ensureStarted();
    try {
      const result = await process.call<T>(method, params);
      this.#rememberThreadProvider(method, params, result);
      return result;
    } catch (error) {
      if (error instanceof StdioJsonRpcError) throw error;
      throw new CodexHarnessUnavailableError("Codex Harness request failed", { cause: error });
    }
  }

  async startThread<T extends Record<string, unknown>>(
    input: Record<string, unknown>,
  ): Promise<T> {
    return await this.#callWithVerifiedSelection<T>("thread/start", input);
  }

  async resumeThread(input: {
    threadId: string;
    cwd?: string;
    modelProvider?: string;
    model?: string;
  }, options: { force?: boolean } = {}): Promise<Record<string, unknown> | null> {
    const requested = {
      provider: input.modelProvider ?? "",
      model: input.model ?? "",
    };
    const attached = this.#attachedThreadSelections.get(input.threadId);
    if (!options.force && attached?.provider === requested.provider && attached.model === requested.model) return null;
    if (
      attached?.provider
      && requested.provider
      && attached.provider !== requested.provider
    ) {
      // Codex cannot reliably switch providers on an already-running thread.
      // Unload the in-memory thread first so thread/resume applies the explicit
      // provider/model pair while reconstructing it from persisted history.
      await this.#stopProcess();
    }
    try {
      return await this.#callWithVerifiedSelection("thread/resume", { ...input });
    } catch (error) {
      if (error instanceof StdioJsonRpcError || error instanceof CodexHarnessModelSelectionError) throw error;
      throw new CodexHarnessUnavailableError("Codex Harness request failed", { cause: error });
    }
  }

  async providers(): Promise<CodexHarnessProvider[]> {
    const { providers } = await this.#readSourceProviders();
    this.#providers = providers;
    return providers;
  }

  async providerDirectory(): Promise<CodexHarnessProviderDirectory> {
    const { catalog, providers, records } = await this.#readSourceProviders();
    this.#providers = providers;
    return codexHarnessProviderDirectory({ records, providers, catalog });
  }

  async respond(id: string | number, result: unknown): Promise<void> {
    (await this.#ensureStarted()).respond(id, result);
  }

  async events(signal: AbortSignal): Promise<Response> {
    await this.#ensureStarted();
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const stop = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          controller.close();
        };
        const listener = (event: CodexHarnessEvent) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        this.#eventListeners.add(listener);
        unsubscribe = () => this.#eventListeners.delete(listener);
        signal.addEventListener("abort", stop, { once: true });
      },
      cancel() {
        closed = true;
        unsubscribe();
      },
    });
    return new Response(body, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
      },
    });
  }

  async close(): Promise<void> {
    await this.#stopProcess();
    await this.#providerGateway.close();
  }

  async #stopProcess(): Promise<void> {
    const process = this.#process;
    this.#process = null;
    this.#starting = null;
    this.#fingerprint = "";
    this.#attachedThreadSelections.clear();
    this.#unsubscribeProcessEvents();
    this.#unsubscribeProcessEvents = () => {};
    if (process) await process.close();
  }

  async #callWithVerifiedSelection<T extends Record<string, unknown>>(
    method: "thread/start" | "thread/resume",
    input: Record<string, unknown>,
  ): Promise<T> {
    let process = await this.#ensureStarted();
    let result: T;
    try {
      result = await process.call<T>(method, input);
    } catch (error) {
      if (method !== "thread/resume" || !isCodexUnmaterializedThreadError(error)) throw error;
      const replacement = await this.#replaceUnmaterializedThread<T>(process, input, true);
      if (replacement) return replacement;
      throw error;
    }
    if (!this.#selectionMismatch(input, result)) {
      this.#rememberThreadProvider(method, input, result);
      return result;
    }

    if (method === "thread/resume") {
      const replacement = await this.#replaceUnmaterializedThread<T>(process, input);
      if (replacement) return replacement;
    }

    // Codex rejoins an already-loaded thread without applying a different
    // provider. Restarting only this workspace runtime unloads the thread;
    // the second resume then applies the explicit provider/model overrides.
    await this.#stopProcess();
    process = await this.#ensureStarted();
    result = await process.call<T>(method, input);
    const mismatch = this.#selectionMismatch(input, result);
    if (mismatch) {
      throw new CodexHarnessModelSelectionError(
        `Codex Harness did not apply the selected model (${mismatch.requested.provider || "default"}/${mismatch.requested.model || "default"}); runtime reported ${mismatch.actual.provider || "default"}/${mismatch.actual.model || "default"}`,
      );
    }
    this.#rememberThreadProvider(method, input, result);
    return result;
  }

  async #replaceUnmaterializedThread<T extends Record<string, unknown>>(
    process: StdioJsonRpcProcess,
    input: Record<string, unknown>,
    confirmed = false,
  ): Promise<T | null> {
    const threadId = typeof input.threadId === "string" ? input.threadId.trim() : "";
    if (!threadId) return null;
    if (!confirmed) {
      try {
        await process.call("thread/read", { threadId, includeTurns: true });
        return null;
      } catch (error) {
        if (!isCodexUnmaterializedThreadError(error)) return null;
      }
    }

    const metadata = await process.call<{ thread?: Record<string, unknown> }>("thread/read", {
      threadId,
      includeTurns: false,
    }).catch(() => null);
    const previousThread = metadata && isRecord(metadata.thread) ? metadata.thread : null;
    const replacement = await this.#callWithVerifiedSelection<T>("thread/start", {
      ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
      ...(typeof input.modelProvider === "string" ? { modelProvider: input.modelProvider } : {}),
      ...(typeof input.model === "string" ? { model: input.model } : {}),
      allowProviderModelFallback: false,
    });
    const replacementThread = isRecord(replacement.thread) ? replacement.thread : null;
    const replacementId = typeof replacementThread?.id === "string" ? replacementThread.id : "";
    const previousName = typeof previousThread?.name === "string" ? previousThread.name.trim() : "";
    if (replacementId && previousName) {
      await this.call("thread/name/set", { threadId: replacementId, name: previousName }).catch(() => undefined);
    }
    await this.call("thread/delete", { threadId }).catch(() => undefined);
    return replacement;
  }

  #selectionMismatch(input: Record<string, unknown>, result: Record<string, unknown>): {
    requested: AttachedThreadSelection;
    actual: AttachedThreadSelection;
  } | null {
    const requested = {
      provider: typeof input.modelProvider === "string" ? input.modelProvider : "",
      model: typeof input.model === "string" ? input.model : "",
    };
    const thread = isRecord(result.thread) ? result.thread : null;
    const actual = {
      provider: typeof result.modelProvider === "string"
        ? result.modelProvider
        : typeof thread?.modelProvider === "string"
          ? thread.modelProvider
          : "",
      model: typeof result.model === "string"
        ? result.model
        : typeof thread?.model === "string"
          ? thread.model
          : "",
    };
    return (requested.provider && requested.provider !== actual.provider)
      || (requested.model && requested.model !== actual.model)
      ? { requested, actual }
      : null;
  }

  #rememberThreadProvider(method: string, params: unknown, result: unknown): void {
    const input = isRecord(params) ? params : null;
    if (method === "thread/delete" || method === "thread/archive") {
      if (typeof input?.threadId === "string") this.#attachedThreadSelections.delete(input.threadId);
      return;
    }
    if (method === "thread/read") {
      const output = isRecord(result) ? result : null;
      const thread = output && isRecord(output.thread) ? output.thread : null;
      const threadId = typeof thread?.id === "string"
        ? thread.id
        : typeof input?.threadId === "string"
          ? input.threadId
          : null;
      if (!threadId) return;
      const provider = typeof output?.modelProvider === "string"
        ? output.modelProvider
        : typeof thread?.modelProvider === "string"
          ? thread.modelProvider
          : "";
      const model = typeof output?.model === "string"
        ? output.model
        : typeof thread?.model === "string"
          ? thread.model
          : "";
      if (provider || model) this.#attachedThreadSelections.set(threadId, { provider, model });
      return;
    }
    if (method !== "thread/start" && method !== "thread/resume" && method !== "thread/fork") return;
    const output = isRecord(result) ? result : null;
    const thread = output && isRecord(output.thread) ? output.thread : null;
    const threadId = typeof thread?.id === "string"
      ? thread.id
      : typeof input?.threadId === "string"
        ? input.threadId
        : null;
    if (!threadId) return;
    const provider = typeof output?.modelProvider === "string"
      ? output.modelProvider
      : typeof thread?.modelProvider === "string"
        ? thread.modelProvider
        : typeof input?.modelProvider === "string"
          ? input.modelProvider
          : "";
    const model = typeof output?.model === "string"
      ? output.model
      : typeof thread?.model === "string"
        ? thread.model
        : typeof input?.model === "string"
          ? input.model
          : "";
    this.#attachedThreadSelections.set(threadId, { provider, model });
  }

  async #ensureStarted(): Promise<StdioJsonRpcProcess> {
    // Provider and MCP writes already dispose the workspace runtime through
    // the shared engine-reload path. Re-reading every credential/catalog,
    // reconfiguring the protocol gateway, and rewriting config.toml before
    // *each* RPC made a warm create -> rename -> prompt sequence pay the same
    // preparation cost four times. A live app-server is the authoritative
    // prepared runtime until that explicit reload closes it.
    if (this.#process) return this.#process;
    if (!this.#starting) {
      this.#starting = this.#prepareRuntime()
        .then((prepared) => this.#process ?? this.#start(prepared))
        .finally(() => {
          this.#starting = null;
        });
    }
    return this.#starting;
  }

  async #prepareRuntime(): Promise<{
    codexHome: string;
    providers: CodexHarnessProvider[];
    environment: NodeJS.ProcessEnv;
    fingerprint: string;
  }> {
    const [{ records, providers: sourceProviders }, mcp] = await Promise.all([
      this.#readSourceProviders(),
      readRuntimeMcpConfig(this.#config, this.#workspace.id),
    ]);
    const gatewayRoutes = await this.#providerGateway.configure(
      sourceProviders.flatMap((provider) => {
        if (!provider.upstream) return [];
        if (provider.id !== OPENCODE_PROVIDER.id) return [provider.upstream];
        return [{
          ...provider.upstream,
          httpHeaders: {
            ...provider.upstream.httpHeaders,
            "x-opencode-project": this.#workspace.id,
          },
        }];
      }),
    );
    const providers = sourceProviders.map((provider) => {
      const route = gatewayRoutes.get(provider.id);
      return route ? { ...provider, ...route } : provider;
    });
    const codexHome = join(
      runtimeStorageDir(this.#config),
      "codex-harness-workspaces",
      safeRuntimeSegment(this.#workspace.id),
    );
    await ensureDir(codexHome);
    const config = codexHarnessConfig({
      providers,
      mcp: {
        ...mcp,
        // Reserved built-in bridge. Installed plugin services, Design/Video
        // Studio tools, and Workspace Apps must use the same host dispatcher
        // as OpenCode and DeepSeek Harness instead of engine-specific copies.
        ipollowork: codexHarnessHostMcp(this.#config, this.#workspace),
      },
    });
    await writeFile(join(codexHome, "config.toml"), config, "utf8");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...sharedProviderChildEnvironment(records),
      CODEX_HOME: codexHome,
      NO_COLOR: "1",
    };
    for (const provider of providers) {
      environment[providerEnvironmentKey(codexHarnessRuntimeProviderId(provider.id))] = provider.apiKey;
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ config, credentials: providers.map(({ id, apiKey }) => [id, apiKey]) }))
      .digest("hex");
    return { codexHome, providers, environment, fingerprint };
  }

  async #readSourceProviders(): Promise<{
    records: Awaited<ReturnType<EnvService["list"]>>;
    providers: CodexHarnessProvider[];
    catalog: AccountProviderCatalog;
  }> {
    const records = await this.#env.list();
    const disconnected = new Set(
      sharedProviderDisconnectedIdsFromEnvKeys(records.map((record) => record.key)),
    );
    const [openAiCodexOAuth, catalog] = await Promise.all([
      resolveOpenAiCodexOAuthSession(this.#config, {
        explicitlyDisconnected: disconnected.has("openai"),
      }),
      readAccountProviderCatalog(this.#config).catch(() => new Map()),
    ]);
    return {
      records,
      catalog,
      providers: await codexHarnessProviders({
        config: this.#config,
        records,
        openAiCodexOAuth,
        catalog,
      }),
    };
  }

  async #start(prepared: {
    providers: CodexHarnessProvider[];
    environment: NodeJS.ProcessEnv;
    fingerprint: string;
  }): Promise<StdioJsonRpcProcess> {
    const configuredCli = process.env.IPOLLOWORK_CODEX_CLI?.trim() ?? "";
    if (configuredCli && !existsSync(configuredCli)) {
      throw new CodexHarnessUnavailableError(`Codex Harness runtime was not found at ${configuredCli}`);
    }
    const wrapper = configuredCli.endsWith(".js");
    const command = wrapper
      ? process.versions.electron
        ? process.execPath
        : process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.platform === "win32" ? "node.exe" : "node")
      : configuredCli || (process.platform === "win32" ? "codex.exe" : "codex");
    const args = [
      ...(wrapper ? [configuredCli] : []),
      "app-server",
      "--stdio",
    ];
    const rpc = new StdioJsonRpcProcess({
      name: "Codex Harness",
      command,
      args,
      cwd: this.#workspace.path,
      env: {
        ...prepared.environment,
        ...(wrapper && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
    });
    try {
      await rpc.call("initialize", {
        clientInfo: { name: "ipollowork", title: "iPolloWork", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      }, 30_000);
      rpc.notify("initialized", {});
      this.#unsubscribeProcessEvents();
      this.#unsubscribeProcessEvents = rpc.subscribe((event) => {
        for (const listener of this.#eventListeners) listener(event);
      });
      this.#process = rpc;
      this.#providers = prepared.providers;
      this.#fingerprint = prepared.fingerprint;
      return rpc;
    } catch (error) {
      await rpc.close();
      throw new CodexHarnessUnavailableError(
        error instanceof Error ? error.message : "Codex Harness failed to start",
        { cause: error },
      );
    }
  }
}

export class CodexHarnessRuntimePool {
  readonly #config: ServerConfig;
  readonly #env: EnvService;
  readonly #runtimes = new Map<string, CodexHarnessRuntime>();
  readonly #stopConfigListener: () => void;
  readonly #stopEnvironmentListener: () => void;

  constructor(input: { config: ServerConfig; env: EnvService }) {
    this.#config = input.config;
    this.#env = input.env;
    this.#stopConfigListener = onRuntimeMcpConfigWrite((config, workspaceId) => {
      if (config !== this.#config) return;
      void this.closeWorkspace(workspaceId);
    });
    this.#stopEnvironmentListener = this.#env.onChange(() => {
      void this.#closeAllRuntimes();
    });
  }

  forWorkspace(workspace: WorkspaceInfo): CodexHarnessRuntime {
    const existing = this.#runtimes.get(workspace.id);
    if (existing) return existing;
    if (workspace.engineId !== CODEX_HARNESS_ENGINE_ID) {
      throw new Error("Codex Harness requires a Codex workspace");
    }
    const runtime = new CodexHarnessRuntime({ config: this.#config, env: this.#env, workspace });
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
    this.#stopEnvironmentListener();
    await this.#closeAllRuntimes();
  }

  async #closeAllRuntimes(): Promise<void> {
    const runtimes = [...this.#runtimes.values()];
    this.#runtimes.clear();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }
}
