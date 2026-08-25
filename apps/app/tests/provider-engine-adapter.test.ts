import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  codexHarnessProviderEngineAdapter,
  deepSeekHarnessProviderEngineAdapter,
  modelRuntimeAdapters,
  ModelRuntimeAdapterRegistry,
  openCodeProviderEngineAdapter,
  providerEngineAdapters,
} from "../src/react-app/domains/connections/provider-auth/provider-engine-adapter";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import {
  ensureMergedProviderListQuery,
  fetchProviderList,
  getChatProviderCatalogItems,
  getEngineChatModelEntries,
  getRunnableChatModelEntries,
  getRunnableChatModelSnapshot,
  getSelectableChatProviderItems,
  mergeProviderListResponses,
  projectAccountProviderConnections,
  providerListQueryKey,
  refreshProviderListQueries,
} from "../src/react-app/infra/provider-list-query";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  parseSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderDisconnectedEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";
import { iPolloWorkServerError } from "../src/app/lib/ipollowork-server";
import type { ProviderListItem } from "../src/app/types";

function createOpenCodeProviderClient() {
  const calls: Array<{ name: string; value?: unknown }> = [];
  let disabledProviders = ["disabled-provider"];
  const providerList = {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        source: "api" as const,
        env: [],
        models: {},
      },
    ],
    connected: ["opencode"],
    default: { opencode: "default-model" },
  };

  return {
    calls,
    client: {
      global: {
        health: async () => ({ data: { healthy: true } }),
      },
      provider: {
        list: async () => ({ data: providerList }),
        auth: async () => ({ data: { openai: [{ type: "oauth", label: "OpenAI" }] } }),
        oauth: {
          authorize: async (value: unknown) => {
            calls.push({ name: "authorize", value });
            return {
              data: {
                url: "https://example.com/oauth",
                method: "code" as const,
                instructions: "Paste the code",
              },
            };
          },
          callback: async (value: unknown) => {
            calls.push({ name: "callback", value });
            return { data: true };
          },
        },
      },
      auth: {
        set: async (value: unknown) => {
          calls.push({ name: "set", value });
          return { data: true };
        },
        remove: async (value: unknown) => {
          calls.push({ name: "remove", value });
          return { data: true };
        },
      },
      config: {
        get: async () => ({ data: { disabled_providers: disabledProviders } }),
        update: async (value: { config: { disabled_providers?: string[] } }) => {
          disabledProviders = value.config.disabled_providers ?? [];
          calls.push({ name: "config.update", value });
          return { data: true };
        },
      },
      instance: {
        dispose: async () => ({ data: true }),
      },
    },
  };
}

describe("model runtime adapters", () => {
  test("coalesces concurrent provider refreshes during settings startup", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const { client } = createOpenCodeProviderClient();
    let resolveEnvKeys = () => {};
    const envKeysReady = new Promise<void>((resolve) => {
      resolveEnvKeys = resolve;
    });
    let envKeyRequests = 0;
    let providers: ProviderListItem[] = [];
    let connectedProviderIds: string[] = [];
    let providerDefaults: Record<string, string> = {};
    let disabledProviderIds: string[] = [];
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => providerDefaults,
      providerConnectedIds: () => connectedProviderIds,
      disabledProviders: () => disabledProviderIds,
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-startup-refresh",
        name: "Startup refresh",
        path: "C:\\workspace-startup-refresh",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost/provider-startup-refresh",
      selectedWorkspaceRoot: () => "C:\\workspace-startup-refresh",
      runtimeWorkspaceId: () => "workspace-startup-refresh",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: {
            async listUserEnvKeys() {
              envKeyRequests += 1;
              await envKeysReady;
              return { keys: [], oauthProviderIds: [] };
            },
          } as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: (value) => { providerDefaults = value; },
      setProviderConnectedIds: (value) => { connectedProviderIds = value; },
      setDisabledProviders: (value) => { disabledProviderIds = value; },
      markEngineConfigReloadRequired: () => {},
    });

    const first = store.refreshProviders();
    const second = store.refreshProviders();
    const forced = store.refreshProviders({ force: true });
    const alsoForced = store.refreshProviders({ force: true });
    await Promise.resolve();
    expect(envKeyRequests).toBe(1);

    resolveEnvKeys();
    await Promise.all([first, second, forced, alsoForced]);
    expect(envKeyRequests).toBe(2);
    expect(store.getSnapshot().connectedProviderIds).toEqual(["opencode"]);
    store.dispose();
    queryClient.clear();
  });

  test("waits for the provider client during settings startup", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const { client } = createOpenCodeProviderClient();
    let activeClient: unknown | null = null;
    let providers: ProviderListItem[] = [];
    let connectedProviderIds: string[] = [];
    let providerDefaults: Record<string, string> = {};
    let disabledProviderIds: string[] = [];
    const store = createProviderAuthStore({
      client: () => activeClient,
      providers: () => providers,
      providerDefaults: () => providerDefaults,
      providerConnectedIds: () => connectedProviderIds,
      disabledProviders: () => disabledProviderIds,
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-reconnect",
        name: "Reconnect Workspace",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-reconnect",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "disconnected",
          ipolloworkServerClient: null,
          ipolloworkServerCapabilities: null,
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: (value) => { providerDefaults = value; },
      setProviderConnectedIds: (value) => { connectedProviderIds = value; },
      setDisabledProviders: (value) => { disabledProviderIds = value; },
      markEngineConfigReloadRequired: () => {},
    });

    const opening = store.openProviderAuthModal();
    expect(store.getSnapshot().providerAuthBusy).toBe(true);
    activeClient = client;
    await opening;

    expect(store.getSnapshot().providerAuthError).toBeNull();
    expect(store.getSnapshot().providerAuthBusy).toBe(false);
    expect(store.getSnapshot().providerAuthModalOpen).toBe(true);
    expect(store.getSnapshot().providerAuthMethods.openai).toEqual([
      { type: "oauth", label: "OpenAI", methodIndex: 0 },
    ]);
    store.dispose();
    queryClient.clear();
  });

  test("refreshes each active provider query only once", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let requests = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: providerListQueryKey({
        engineId: DEFAULT_ENGINE_ID,
        baseUrl: "http://localhost/provider-refresh",
        directory: "C:\\workspace",
      }),
      queryFn: async () => {
        requests += 1;
        return { all: [], connected: [], default: {} };
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await refreshProviderListQueries(queryClient);

    expect(requests).toBe(2);
    unsubscribe();
    queryClient.clear();
  });

  test("keeps OpenCode as default while registering Harness model runtimes as peers", () => {
    expect(modelRuntimeAdapters.ids()).toEqual([
      DEFAULT_ENGINE_ID,
      DEEPSEEK_HARNESS_ENGINE_ID,
      CODEX_HARNESS_ENGINE_ID,
    ]);
    expect(modelRuntimeAdapters.get()).toBe(openCodeProviderEngineAdapter);
    expect(modelRuntimeAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID)).toBe(deepSeekHarnessProviderEngineAdapter);
    expect(modelRuntimeAdapters.get(CODEX_HARNESS_ENGINE_ID)).toBe(codexHarnessProviderEngineAdapter);
    expect(() => modelRuntimeAdapters.get("unknown")).toThrow(
      "Model runtime is not registered: unknown",
    );
    expect(providerEngineAdapters.createClient("unknown", {} as never)).toBeNull();
  });

  test("rejects duplicate model runtime adapters", () => {
    expect(() => new ModelRuntimeAdapterRegistry([
      openCodeProviderEngineAdapter,
      { ...openCodeProviderEngineAdapter },
    ])).toThrow(`Duplicate model runtime adapter: ${DEFAULT_ENGINE_ID}`);
  });

  test("separates provider caches by engine", () => {
    expect(providerListQueryKey({ engineId: "opencode", baseUrl: "http://runtime" }))
      .not.toEqual(providerListQueryKey({ engineId: "deepseek-harness", baseUrl: "http://runtime" }));
  });

  test("supports an explicit provider catalog refresh when requested", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const { client } = createOpenCodeProviderClient();
    const source = {
      client,
      engineId: DEFAULT_ENGINE_ID,
      baseUrl: "http://runtime",
      directory: "C:\\workspace",
    };
    queryClient.setQueryData(providerListQueryKey(source), {
      all: [{
        id: "stale-provider",
        name: "Stale provider",
        source: "config",
        env: [],
        models: {},
      }],
      connected: ["stale-provider"],
      default: {},
    });

    expect((await ensureMergedProviderListQuery(queryClient, [source])).all[0]?.id)
      .toBe("stale-provider");
    expect((await ensureMergedProviderListQuery(queryClient, [source], { force: true })).all[0]?.id)
      .toBe("opencode");
    queryClient.clear();
  });

  test("keeps successful account catalogs when a secondary engine catalog fails", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const { client } = createOpenCodeProviderClient();
    const unavailableHarnessClient = {
      async call(): Promise<never> {
        throw new Error("DeepSeek Harness is unavailable");
      },
    };

    const result = await ensureMergedProviderListQuery(queryClient, [{
      client,
      engineId: DEFAULT_ENGINE_ID,
      baseUrl: "http://opencode-runtime",
      directory: "C:\\workspace",
    }, {
      client: unavailableHarnessClient,
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      baseUrl: "http://dsh-runtime",
      directory: "C:\\workspace",
    }], { force: true });

    expect(result.all[0]?.id).toBe("opencode");
    queryClient.clear();
  });

  test("resolves a connected GPT model independently from the agent engine", () => {
    const providers = {
      all: [{
        id: "openai",
        name: "OpenAI",
        source: "config" as const,
        env: ["OPENAI_API_KEY"],
        models: {
          "gpt-5": {
            id: "gpt-5",
            name: "GPT-5",
            capabilities: {
              attachment: true,
              reasoning: true,
              toolcall: true,
              input: { text: true, image: true },
              output: { text: true },
            },
          },
        },
      }],
      connected: ["openai"],
      default: { openai: "gpt-5" },
    };

    expect(modelRuntimeAdapters.resolveModel({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      providers,
      model: { providerID: "openai", modelID: "gpt-5" },
    })).toEqual({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      model: { providerID: "openai", modelID: "gpt-5" },
      status: "ready",
      capabilities: {
        text: true,
        attachments: true,
        vision: true,
        reasoning: true,
        toolCalls: true,
      },
    });

    expect(modelRuntimeAdapters.resolveModel({
      engineId: DEFAULT_ENGINE_ID,
      providers: { ...providers, connected: [] },
      model: { providerID: "openai", modelID: "gpt-5" },
    }).status).toBe("provider-disconnected");
    expect(modelRuntimeAdapters.resolveModel({
      engineId: DEFAULT_ENGINE_ID,
      providers,
      model: { providerID: "openai", modelID: "missing" },
    }).status).toBe("model-unavailable");
  });

  test("projects the account catalog to models executable by the active engine", () => {
    const catalog = {
      all: [{
        id: "openai",
        name: "OpenAI",
        source: "config" as const,
        env: [],
        models: {
          "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", capabilities: {} },
          "gpt-5.6-sol-fast": { id: "gpt-5.6-sol-fast", name: "GPT-5.6 Sol Fast", capabilities: {} },
        },
      }, {
        id: "deepseek-official",
        name: "DeepSeek",
        source: "config" as const,
        env: [],
        models: {
          "deepseek-v4-flash": { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", capabilities: {} },
        },
      }],
      connected: ["openai", "deepseek-official"],
      default: {},
    };
    const dshRuntime = {
      all: [{
        ...catalog.all[0]!,
        models: { "gpt-5.6-sol": catalog.all[0]!.models["gpt-5.6-sol"]! },
      }, catalog.all[1]!],
      connected: ["deepseek-official"],
      default: {},
    };

    expect(getRunnableChatModelEntries({
      catalog,
      runtime: dshRuntime,
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    }).map(({ provider, modelId }) => `${provider.id}:${modelId}`)).toEqual([
      "deepseek-official:deepseek-v4-flash",
    ]);
    expect(getEngineChatModelEntries({
      catalog,
      runtime: dshRuntime,
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    }).map(({ provider, modelId, runtime }) => (
      `${provider.id}:${modelId}:${runtime.status}`
    ))).toEqual([
      "openai:gpt-5.6-sol:provider-disconnected",
      "deepseek-official:deepseek-v4-flash:ready",
    ]);

    const codexRuntime = {
      all: [{
        ...catalog.all[0]!,
        models: {
          "gpt-5.6-sol": catalog.all[0]!.models["gpt-5.6-sol"]!,
          "gpt-4-turbo": { id: "gpt-4-turbo", name: "GPT-4 Turbo", capabilities: {} },
          "gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT-4.1 mini", capabilities: {} },
        },
      }],
      connected: ["openai"],
      default: { openai: "gpt-5.6-sol" },
    };
    expect(getRunnableChatModelEntries({
      catalog,
      runtime: codexRuntime,
      engineId: CODEX_HARNESS_ENGINE_ID,
    }).map(({ provider, modelId }) => `${provider.id}:${modelId}`)).toEqual([
      "openai:gpt-5.6-sol",
    ]);
    expect(getRunnableChatModelSnapshot({
      catalog,
      runtime: codexRuntime,
      engineId: CODEX_HARNESS_ENGINE_ID,
    })).toEqual([{ providerID: "openai", modelIDs: ["gpt-5.6-sol"] }]);
  });

  test("persists and idempotently disconnects an OAuth provider without mirroring its secret", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const profileWrites: Array<{ key: string; value: string }> = [];
    const envDeleteAttempts: string[] = [];
    const envKeys: string[] = [];
    let oauthConnected = true;
    const providerList = () => ({
      all: [{
        id: "openai",
        name: "OpenAI",
        source: "api" as const,
        env: [],
        models: { "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" } },
      }],
      connected: oauthConnected ? ["openai"] : [],
      default: { openai: "gpt-5.4" },
    });
    let disabledProviderIds: string[] = [];
    const client = {
      global: { health: async () => ({ data: { healthy: true } }) },
      provider: {
        list: async () => ({ data: providerList() }),
        auth: async () => ({ data: { openai: [{ type: "oauth", label: "OpenAI" }] } }),
        oauth: {
          authorize: async () => ({ data: { url: "https://example.com", method: "code" } }),
          callback: async () => ({ data: true }),
        },
      },
      auth: {
        set: async () => {
          providers = providers.map((provider) => (
            provider.id === "openai" ? { ...provider, source: "api" as const } : provider
          ));
          return { data: true };
        },
        remove: async () => {
          oauthConnected = false;
          return { data: true };
        },
      },
      config: {
        get: async () => ({ data: { disabled_providers: disabledProviderIds } }),
        update: async (value: { config: { disabled_providers?: string[] } }) => {
          disabledProviderIds = value.config.disabled_providers ?? [];
          return { data: true };
        },
      },
      instance: { dispose: async () => ({ data: true }) },
    };
    let providers = providerList().all;
    let connectedIds = providerList().connected;
    let accountServerAvailable = true;
    const serverClient = {
      readOpencodeConfigFile: async () => ({
        content: disabledProviderIds.length
          ? `{\"disabled_providers\":[\"${disabledProviderIds.join('\",\"')}\"]}`
          : "{}",
      }),
      writeOpencodeConfigFile: async (_workspaceId: string, _scope: string, content: string) => {
        disabledProviderIds = content.includes('"openai"') ? ["openai"] : [];
        return { ok: true };
      },
      listUserEnvKeys: async () => ({
        keys: [...envKeys],
        oauthProviderIds: oauthConnected ? ["openai"] : [],
      }),
      upsertUserEnv: async (entries: Array<{ key: string; value: string }>) => {
        profileWrites.push(...entries);
        for (const entry of entries) if (!envKeys.includes(entry.key)) envKeys.push(entry.key);
        return { updated: entries.map((entry) => entry.key) };
      },
      deleteUserEnv: async (key: string) => {
        envDeleteAttempts.push(key);
        const index = envKeys.indexOf(key);
        if (index < 0) {
          throw new iPolloWorkServerError(404, "env_not_found", "Environment variable not found");
        }
        envKeys.splice(index, 1);
        return { ok: true };
      },
      reloadEngine: async () => ({ ok: true }),
    };
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => providerList().default,
      providerConnectedIds: () => connectedIds,
      disabledProviders: () => disabledProviderIds,
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-oauth",
        name: "OAuth Workspace",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-oauth",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: accountServerAvailable ? "connected" : "disconnected",
          ipolloworkServerClient: accountServerAvailable ? serverClient as never : null,
          ipolloworkServerCapabilities: accountServerAvailable
            ? { config: { read: true, write: true } }
            : null,
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { connectedIds = value; },
      setDisabledProviders: (value) => { disabledProviderIds = value; },
      markEngineConfigReloadRequired: () => {},
    });

    expect(await store.completeProviderAuthOAuth("openai", 0, "oauth-code"))
      .toMatchObject({ connected: true });
    expect(profileWrites).toHaveLength(1);
    expect(profileWrites[0]?.key).toBe(sharedProviderProfileEnvKey("openai"));
    expect(profileWrites[0]?.key).not.toBe(sharedProviderCredentialEnvKey("openai"));
    await store.refreshProviders();
    expect(store.getSnapshot().connectedProviderIds).toContain("openai");
    accountServerAvailable = false;
    await expect(store.disconnectProvider("openai")).rejects.toThrow("disconnect");
    expect(envKeys).toEqual([sharedProviderProfileEnvKey("openai")]);
    accountServerAvailable = true;
    expect(await store.disconnectProvider("openai")).toContain("openai");
    expect(envDeleteAttempts).toEqual([
      sharedProviderDisconnectedEnvKey("openai"),
      sharedProviderCredentialEnvKey("openai"),
      sharedProviderProfileEnvKey("openai"),
      "OPENAI_API_KEY",
    ]);
    expect(envKeys).toEqual([sharedProviderDisconnectedEnvKey("openai")]);
    expect(disabledProviderIds).toEqual([]);
    expect(store.getSnapshot().connectedProviderIds).not.toContain("openai");
    oauthConnected = true;
    await store.refreshProviders({ force: true });
    expect(store.getSnapshot().explicitlyDisconnectedProviderIds).toContain("openai");
    expect(store.getSnapshot().connectedProviderIds).not.toContain("openai");
    store.dispose();
    queryClient.clear();
  });

  test("disconnects DeepSeek aliases from every mounted runtime without requesting a manual reload", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    const { calls: openCodeCalls, client: openCodeClient } = createOpenCodeProviderClient();
    const dshCalls: Array<{ method: string; payload: unknown }> = [];
    const dshClient = {
      call: async <T>(method: string, payload: unknown) => {
        dshCalls.push({ method, payload });
        if (method === "credentials.unset") return undefined as T;
        if (method === "llm.models") return { groups: [] } as T;
        throw new Error(`Unexpected DSH method: ${method}`);
      },
    };
    const deletedEnvKeys: string[] = [];
    let providers: ProviderListItem[] = [{
      id: "deepseek-official",
      name: "DeepSeek",
      source: "config" as const,
      env: ["DEEPSEEK_API_KEY"],
      models: {},
    }];
    // Model the React render lag that originally caused a disconnected
    // provider to be merged back into the settings list. The setter records
    // the new value, while the getter deliberately keeps returning the
    // previous render's connected IDs.
    const connectedProviderIds = ["deepseek-official", "deepseek"];
    let writtenConnectedProviderIds = connectedProviderIds;
    let manualReloadRequests = 0;
    const serverClient = {
      listUserEnvKeys: async () => ({ keys: [], oauthProviderIds: [] }),
      upsertUserEnv: async () => ({ updated: [] }),
      deleteUserEnv: async (key: string) => {
        deletedEnvKeys.push(key);
        return { ok: true };
      },
      readOpencodeConfigFile: async () => ({ content: "{}" }),
      writeOpencodeConfigFile: async () => ({ ok: true }),
      reloadEngine: async () => ({ ok: true }),
    };
    const store = createProviderAuthStore({
      client: () => openCodeClient,
      providerRuntimeConnections: () => [{
        engineId: DEEPSEEK_HARNESS_ENGINE_ID,
        client: dshClient,
      }],
      providers: () => providers,
      providerDefaults: () => ({}),
      providerConnectedIds: () => connectedProviderIds,
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-deepseek-account",
        name: "DeepSeek Account",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-deepseek-account",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: serverClient as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { writtenConnectedProviderIds = value; },
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => { manualReloadRequests += 1; },
    });

    await store.disconnectProvider("deepseek-official");

    expect(openCodeCalls).toContainEqual({
      name: "remove",
      value: { providerID: "deepseek-official" },
    });
    expect(openCodeCalls).toContainEqual({
      name: "remove",
      value: { providerID: "deepseek" },
    });
    expect(dshCalls.filter(({ method }) => method === "credentials.unset")).toEqual([
      { method: "credentials.unset", payload: { ref: "DEEPSEEK_API_KEY" } },
      { method: "credentials.unset", payload: { ref: "DEEPSEEK_API_KEY" } },
    ]);
    expect(deletedEnvKeys).toEqual(expect.arrayContaining([
      sharedProviderCredentialEnvKey("deepseek-official"),
      sharedProviderProfileEnvKey("deepseek-official"),
      sharedProviderCredentialEnvKey("deepseek"),
      sharedProviderProfileEnvKey("deepseek"),
      "DEEPSEEK_API_KEY",
    ]));
    expect(writtenConnectedProviderIds).not.toContain("deepseek-official");
    expect(writtenConnectedProviderIds).not.toContain("deepseek");
    expect(store.getSnapshot().connectedProviderIds).not.toContain("deepseek-official");
    expect(store.getSnapshot().connectedProviderIds).not.toContain("deepseek");
    expect(manualReloadRequests).toBe(0);
    store.dispose();
    queryClient.clear();
  });

  test("keeps an environment-backed provider disabled until the user reconnects it", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    let disabledProviderIds: string[] = [];
    let providers: ProviderListItem[] = [{
      id: "openai",
      name: "OpenAI",
      source: "env" as const,
      env: ["OPENAI_API_KEY"],
      models: {
        "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", capabilities: {} },
      },
    }];
    let connectedProviderIds = ["openai"];
    const providerList = () => ({
      all: providers,
      connected: ["openai"],
      default: { openai: "gpt-5.4" },
    });
    const client = {
      global: { health: async () => ({ data: { healthy: true } }) },
      provider: {
        list: async () => ({ data: providerList() }),
        auth: async () => ({ data: {} }),
        oauth: {
          authorize: async () => ({ data: {} }),
          callback: async () => ({ data: true }),
        },
      },
      auth: {
        set: async () => {
          providers = providers.map((provider) => (
            provider.id === "openai" ? { ...provider, source: "api" as const } : provider
          ));
          return { data: true };
        },
        remove: async () => ({ data: true }),
      },
      config: {
        get: async () => ({ data: { disabled_providers: disabledProviderIds } }),
        update: async (value: { config: { disabled_providers?: string[] } }) => {
          disabledProviderIds = value.config.disabled_providers ?? [];
          return { data: true };
        },
      },
      instance: { dispose: async () => ({ data: true }) },
    };
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => providerList().default,
      providerConnectedIds: () => connectedProviderIds,
      disabledProviders: () => disabledProviderIds,
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-env",
        name: "Environment Workspace",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-env",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "disconnected",
          ipolloworkServerClient: null,
          ipolloworkServerCapabilities: null,
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { connectedProviderIds = value; },
      setDisabledProviders: (value) => { disabledProviderIds = value; },
      markEngineConfigReloadRequired: () => {},
    });

    expect(await store.disconnectProvider("openai")).toBe("Disconnected openai");
    expect(disabledProviderIds).toEqual(["openai"]);
    expect(store.getSnapshot().connectedProviderIds).not.toContain("openai");

    await store.submitProviderApiKey("openai", "reconnected-key");
    expect(disabledProviderIds).toEqual([]);
    expect(store.getSnapshot().connectedProviderIds).toContain("openai");
    store.dispose();
    queryClient.clear();
  });

  test("keeps an account-connected model ready after engine catalogs are merged", () => {
    const account = {
      all: [{
        id: "openai",
        name: "OpenAI",
        source: "config" as const,
        env: [],
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            name: "GPT-5.4",
            capabilities: { reasoning: true, input: { text: true }, output: { text: true } },
          },
        },
      }],
      connected: ["openai"],
      default: { openai: "gpt-5.4" },
    };
    const harness = {
      all: [{ id: "deepseek-official", name: "DeepSeek", source: "config" as const, env: [], models: {} }],
      connected: ["deepseek-official"],
      default: {},
    };
    const merged = mergeProviderListResponses([account, harness]);

    expect(modelRuntimeAdapters.resolveModel({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      providers: merged,
      model: { providerID: "openai", modelID: "gpt-5.4" },
    }).status).toBe("ready");
  });

  test("routes provider list, auth and disabled state through OpenCode", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const connection = openCodeProviderEngineAdapter.connect(client);

    const providers = await fetchProviderList({ client, engineId: DEFAULT_ENGINE_ID });
    expect(Object.keys(providers.all[0]?.models ?? {})).toEqual([
      "big-pickle",
      "hy3-free",
      "mimo-v2.5-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "x-preview-f-free",
    ]);
    expect(providers.all[0]?.models["x-preview-f-free"]?.name).toBe("Ox Alpha Free");
    expect(providers.connected).toEqual(["opencode"]);
    expect(providers.default).toEqual({ opencode: "big-pickle" });
    expect(await connection.listAuthMethods()).toEqual({
      openai: [{ type: "oauth", label: "OpenAI" }],
    });
    expect(await connection.readDisabledProviders()).toEqual(["disabled-provider"]);

    await connection.setApiKey("tokenstar", "secret");
    await connection.removeCredentials("tokenstar");
    await connection.writeDisabledProviders(["tokenstar"]);

    expect(await connection.readDisabledProviders()).toEqual(["tokenstar"]);
    expect(calls.map((entry) => entry.name)).toEqual(["set", "remove", "config.update"]);
  });

  test("maps DeepSeek Harness native models and credentials", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    let configured = false;
    const client = {
      async call<T>(method: string, payload: unknown): Promise<T> {
        calls.push({ method, payload });
        if (method === "llm.models") {
          return {
            groups: [{
              id: "deepseek-official",
              name: "DeepSeek",
              models: [{
                id: "deepseek-v4-flash",
                name: "DeepSeek-V4-Flash",
                reasoning: {
                  efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }],
                  defaultEffort: "high",
                },
              }],
            }],
          } as T;
        }
        if (method === "llm.providers") {
          return {
            providers: [
              {
                provider: "deepseek-official",
                displayName: "DeepSeek",
                settingsNs: "deepseek",
                settingsPath: ["connection"],
                active: true,
              },
              {
                provider: "opencode",
                displayName: "OpenCode Zen",
                settingsNs: "llm-pi-ai",
                settingsPath: ["providers", "opencode"],
                active: false,
              },
            ],
          } as T;
        }
        if (method === "settings.describe") {
          return { namespaces: [{ ns: "deepseek", value: {} }] } as T;
        }
        if (method === "settings.mutate") return undefined as T;
        if (method === "credentials.describe") {
          return { credentials: { DEEPSEEK_API_KEY: { configured, writable: true } } } as T;
        }
        if (method === "credentials.set") {
          configured = true;
          return undefined as T;
        }
        if (method === "credentials.unset") {
          configured = false;
          return undefined as T;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };
    const connection = deepSeekHarnessProviderEngineAdapter.connect(client);

    expect(await connection.listProviders()).toMatchObject({
      all: [{
        id: "deepseek-official",
        env: ["DEEPSEEK_API_KEY"],
        models: {
          "deepseek-v4-flash": {
            capabilities: { attachment: false, reasoning: true },
            variants: { off: { name: "Off" }, high: { name: "High" } },
          },
        },
      }],
      connected: [],
      default: { "deepseek-official": "deepseek-v4-flash" },
    });
    expect(await connection.listAuthMethods()).toEqual({
      "deepseek-official": [{ type: "api", label: "API key" }],
      opencode: [{ type: "api", label: "API key" }],
    });

    await connection.setApiKey("deepseek-official", "secret");
    expect((await connection.listProviders()).connected).toEqual(["deepseek-official"]);
    await connection.removeCredentials("deepseek-official");
    expect(calls).toContainEqual({
      method: "settings.mutate",
      payload: {
        ns: "deepseek",
        ops: [{
          op: "set",
          path: ["connection", "apiKeyEnv"],
          value: "DEEPSEEK_API_KEY",
        }],
      },
    });
    expect(calls).toContainEqual({
      method: "credentials.set",
      payload: { ref: "DEEPSEEK_API_KEY", value: "secret" },
    });
    expect(calls).toContainEqual({
      method: "credentials.unset",
      payload: { ref: "DEEPSEEK_API_KEY" },
    });
    await connection.removeCredentials("openai");
    expect(calls).toContainEqual({
      method: "credentials.unset",
      payload: { ref: "OPENAI_API_KEY" },
    });
    expect(calls).toContainEqual({
      method: "credentials.unset",
      payload: { ref: "OPENAI_CODEX_API_KEY" },
    });
  });

  test("merges engine model catalogs while preserving the shared provider metadata", () => {
    const merged = mergeProviderListResponses([
      {
        all: [{
          id: "shared",
          name: "Shared provider",
          source: "api",
          env: ["SHARED_KEY"],
          models: {
            common: { id: "common", name: "Shared name", capabilities: { attachment: true } },
          },
        }],
        connected: ["shared"],
        default: { shared: "common" },
      },
      {
        all: [
          {
            id: "shared",
            name: "Engine provider",
            source: "config",
            env: ["ENGINE_KEY"],
            models: {
              common: { id: "common", name: "Engine name", capabilities: { attachment: false } },
              engine: { id: "engine", name: "Engine only", capabilities: {} },
            },
          },
          {
            id: "engine-only",
            name: "Engine only provider",
            source: "config",
            env: [],
            models: {},
          },
        ],
        connected: ["shared", "engine-only"],
        default: { shared: "engine", "engine-only": "" },
      },
    ]);

    expect(merged.connected).toEqual(["shared", "engine-only"]);
    expect(merged.default.shared).toBe("common");
    expect(merged.all[0]).toMatchObject({
      id: "shared",
      name: "Shared provider",
      env: ["SHARED_KEY", "ENGINE_KEY"],
      models: {
        common: { name: "Shared name", capabilities: { attachment: true } },
        engine: { name: "Engine only" },
      },
    });
    expect(merged.all[1]?.id).toBe("engine-only");
  });

  test("promotes an explicitly configured provider over an ambient duplicate", () => {
    const merged = mergeProviderListResponses([
      {
        all: [{
          id: "alibaba-cn",
          name: "Alibaba (China)",
          source: "env",
          env: ["DASHSCOPE_API_KEY"],
          models: { qwen: { id: "qwen", name: "Qwen", capabilities: {} } },
        }],
        connected: ["alibaba-cn"],
        default: {},
      },
      {
        all: [{
          id: "alibaba-cn",
          name: "Qwen / Alibaba Cloud",
          source: "config",
          env: ["IPOLLOWORK_PROVIDER_API_KEY"],
          models: { qwen: { id: "qwen", name: "Qwen", capabilities: {} } },
        }],
        connected: ["alibaba-cn"],
        default: {},
      },
    ]);

    expect(merged.all[0]?.source).toBe("config");
    expect(merged.connected).toEqual(["alibaba-cn"]);
  });

  test("does not combine an ambient connection with a disconnected engine profile", () => {
    const merged = mergeProviderListResponses([
      {
        all: [{
          id: "alibaba-cn",
          name: "Alibaba (China)",
          source: "env",
          env: ["DASHSCOPE_API_KEY"],
          models: { qwen: { id: "qwen", name: "Qwen", capabilities: {} } },
        }],
        connected: ["alibaba-cn"],
        default: {},
      },
      {
        all: [{
          id: "alibaba-cn",
          name: "Qwen / Alibaba Cloud",
          source: "config",
          env: ["IPOLLOWORK_PROVIDER_API_KEY"],
          models: { qwen: { id: "qwen", name: "Qwen", capabilities: {} } },
        }],
        connected: [],
        default: {},
      },
    ]);

    expect(merged.all[0]?.source).toBe("env");
    expect(merged.connected).toEqual([]);
  });

  test("projects only explicitly account-configured env providers into the shared model directory", () => {
    const projected = projectAccountProviderConnections({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          source: "env",
          env: ["OPENAI_API_KEY"],
          models: {
            "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", capabilities: {} },
          },
        },
        {
          id: "ambient-only",
          name: "Ambient only",
          source: "env",
          env: ["AMBIENT_ONLY_API_KEY"],
          models: {
            ambient: { id: "ambient", name: "Ambient", capabilities: {} },
          },
        },
      ],
      connected: [],
      default: { openai: "gpt-5.4" },
    }, ["openai"]);

    expect(projected?.all.find((provider) => provider.id === "openai")?.source).toBe("config");
    expect(projected?.all.find((provider) => provider.id === "ambient-only")?.source).toBe("env");
    expect(projected?.connected).toEqual(["openai"]);
    expect(getChatProviderCatalogItems(projected).map((provider) => provider.id)).toEqual(["openai"]);
    expect(modelRuntimeAdapters.resolveModel({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      providers: projected!,
      model: { providerID: "openai", modelID: "gpt-5.4" },
    }).status).toBe("ready");
  });

  test("keeps authorization-center environment providers out of the chat picker", () => {
    const projected = projectAccountProviderConnections({
      all: [
        {
          id: "alibaba-cn",
          name: "Alibaba (China)",
          source: "env",
          env: ["DASHSCOPE_API_KEY"],
          models: { qwen: { id: "qwen", name: "Qwen", capabilities: {} } },
        },
        {
          id: "openai",
          name: "OpenAI",
          source: "config",
          env: [],
          models: { "gpt-5.6": { id: "gpt-5.6", name: "GPT-5.6", capabilities: {} } },
        },
      ],
      connected: [],
      default: {},
    }, ["openai"]);

    expect(projected?.all.find((provider) => provider.id === "alibaba-cn")?.source).toBe("env");
    expect(getSelectableChatProviderItems(projected).map((provider) => provider.id)).toEqual(["openai"]);
  });

  test("keeps disconnected catalog models available for the shared key flow", () => {
    expect(getChatProviderCatalogItems({
      all: [{
        id: "openai",
        name: "OpenAI",
        source: "api",
        env: [],
        models: { "gpt-next": { id: "gpt-next", name: "GPT Next", capabilities: {} } },
      }],
      connected: [],
      default: {},
    }).map((provider) => provider.id)).toEqual(["openai"]);
  });

  test("updates the same endpoint-scoped provider cache read by a DeepSeek session", async () => {
    const queryClient = getReactQueryClient();
    queryClient.clear();
    let configured = false;
    const providerList = () => ({
      all: [{
        id: "deepseek-official",
        name: "DeepSeek",
        source: "config" as const,
        env: ["DEEPSEEK_API_KEY"],
        models: {
          "deepseek-v4-flash": {
            id: "deepseek-v4-flash",
            name: "DeepSeek-V4-Flash",
            capabilities: { attachment: false, reasoning: true, input: { image: false } },
          },
        },
      }],
      connected: configured ? ["deepseek-official"] : [],
      default: { "deepseek-official": "deepseek-v4-flash" },
    });
    const client = {
      async call<T>(method: string): Promise<T> {
        if (method === "llm.models") {
          return {
            groups: [{
              id: "deepseek-official",
              name: "DeepSeek",
              models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
            }],
          } as T;
        }
        if (method === "llm.providers") {
          return {
            providers: [{
              provider: "deepseek-official",
              displayName: "DeepSeek",
              settingsNs: "deepseek",
              settingsPath: ["connection"],
              active: true,
            }],
          } as T;
        }
        if (method === "settings.describe") {
          return { namespaces: [{ ns: "deepseek", value: {} }] } as T;
        }
        if (method === "settings.mutate") return undefined as T;
        if (method === "credentials.describe") {
          return { credentials: { DEEPSEEK_API_KEY: { configured, writable: true } } } as T;
        }
        if (method === "credentials.set") {
          configured = true;
          return undefined as T;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };
    const providerBaseUrl = "http://localhost:43121/opencode";
    const workspaceRoot = "C:\\workspace";
    const sessionQueryKey = providerListQueryKey({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      baseUrl: providerBaseUrl,
      directory: workspaceRoot,
    });
    queryClient.setQueryData(sessionQueryKey, providerList());

    let providers = providerList().all;
    let defaults = providerList().default;
    let connectedIds = providerList().connected;
    const mirroredCredentials: Array<{ key: string; value: string }> = [];
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => defaults,
      providerConnectedIds: () => connectedIds,
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-a",
        name: "Workspace A",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      }),
      providerBaseUrl: () => providerBaseUrl,
      selectedWorkspaceRoot: () => workspaceRoot,
      runtimeWorkspaceId: () => "workspace-a",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: {
            upsertUserEnv: async (entries: Array<{ key: string; value: string }>) => {
              mirroredCredentials.push(...entries);
              return { updated: entries.map((entry) => entry.key) };
            },
            deleteUserEnv: async () => ({ ok: true }),
          } as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: (value) => { defaults = value; },
      setProviderConnectedIds: (value) => { connectedIds = value; },
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => {},
    });

    await store.openProviderAuthModal({ preferredProviderId: "deepseek-official" });
    expect(store.getSnapshot()).toMatchObject({
      providerAuthModalOpen: true,
      providerAuthPreferredProviderId: "deepseek-official",
      connectedProviderIds: ["opencode"],
      providerAuthMethods: {
        "deepseek-official": [{ type: "api", label: expect.any(String) }],
      },
    });
    expect(store.getSnapshot().providerAuthProviders).toContainEqual({
      id: "opencode",
      name: "iPolloWork Built-in Models",
      env: [],
    });

    await store.submitProviderApiKey("deepseek-official", "secret");

    expect(queryClient.getQueryData(sessionQueryKey)).toMatchObject({
      connected: ["deepseek-official"],
    });
    expect(mirroredCredentials[0]).toEqual({
      key: sharedProviderCredentialEnvKey("deepseek-official"),
      value: "secret",
    });
    expect(mirroredCredentials[1]?.key).toBe(sharedProviderProfileEnvKey("deepseek-official"));
    expect(parseSharedProviderProfile(mirroredCredentials[1]?.value ?? "")).toMatchObject({
      providerId: "deepseek-official",
      api: "openai-completions",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
    });
    queryClient.clear();
  });

  test("activates a configured API-key provider in DeepSeek Harness", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const client = {
      async call<T>(method: string, payload: unknown): Promise<T> {
        calls.push({ method, payload });
        if (method === "llm.providers") {
          return {
            providers: [{
              provider: "openai",
              displayName: "OpenAI",
              settingsNs: "llm-pi-ai",
              settingsPath: ["providers", "openai"],
              active: false,
            }],
          } as T;
        }
        if (method === "settings.mutate" || method === "credentials.set") {
          return undefined as T;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    await deepSeekHarnessProviderEngineAdapter.connect(client).setApiKey("openai", "secret");

    expect(calls).toContainEqual({
      method: "settings.mutate",
      payload: {
        ns: "llm-pi-ai",
        ops: [{
          op: "set",
          path: ["providers", "openai", "apiKeyEnv"],
          value: "OPENAI_API_KEY",
        }],
      },
    });
    expect(calls).toContainEqual({
      method: "credentials.set",
      payload: { ref: "OPENAI_API_KEY", value: "secret" },
    });
  });

  test("materializes compatible providers only inside the OpenCode adapter", () => {
    expect(
      openCodeProviderEngineAdapter.buildCompatibleProviderPatch({
        id: "tokenstar",
        name: "TokenStar",
        baseURL: "https://api.tokenstar.io/v1",
        models: { model: { name: "Model" } },
      }),
    ).toEqual({
      tokenstar: {
        npm: "@ai-sdk/openai-compatible",
        name: "TokenStar",
        options: { baseURL: "https://api.tokenstar.io/v1" },
        models: { model: { name: "Model" } },
      },
    });
  });

  test("connects the DSH DeepSeek route as a callable shared OpenCode provider", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const runtimePatches: unknown[] = [];
    const mirroredCredentials: Array<{ key: string; value: string }> = [];
    let providers = [
      {
        id: "opencode",
        name: "OpenCode",
        source: "api" as const,
        env: [],
        models: {},
      },
    ];
    let connectedIds = ["opencode"];
    const serverClient = {
      patchConfig: async (_workspaceId: string, patch: unknown) => {
        calls.push({ name: "patch-config" });
        runtimePatches.push(patch);
        return { ok: true };
      },
      reloadEngine: async () => {
        calls.push({ name: "reload-engine" });
        return { ok: true };
      },
      upsertUserEnv: async (entries: Array<{ key: string; value: string }>) => {
        calls.push({ name: "mirror-shared" });
        mirroredCredentials.push(...entries);
        return { updated: entries.map((entry) => entry.key) };
      },
      deleteUserEnv: async () => ({ ok: true }),
    };
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => ({ opencode: "default-model" }),
      providerConnectedIds: () => connectedIds,
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-a",
        name: "Workspace A",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-a",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: serverClient as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { connectedIds = value; },
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => {},
    });

    await store.openProviderAuthModal({ preferredProviderId: "deepseek-official" });
    expect(store.getSnapshot()).toMatchObject({
      providerAuthModalOpen: true,
      providerAuthPreferredProviderId: "deepseek-official",
      providerAuthMethods: {
        "deepseek-official": [{ type: "api", label: expect.any(String) }],
      },
    });

    await store.submitProviderApiKey("deepseek-official", "secret");

    expect(runtimePatches).toEqual([{
      opencode: {
        provider: {
          "deepseek-official": {
            npm: "@ai-sdk/openai-compatible",
            name: "DeepSeek",
            options: { baseURL: "https://api.deepseek.com" },
            models: {
              "deepseek-v4-flash": { name: "DeepSeek-V4-Flash" },
              "deepseek-v4-pro": { name: "DeepSeek-V4-Pro" },
            },
          },
        },
      },
    }]);
    expect(calls).toContainEqual({
      name: "set",
      value: {
        providerID: "deepseek-official",
        auth: { type: "api", key: "secret" },
      },
    });
    expect(calls.findIndex((call) => call.name === "mirror-shared")).toBeLessThan(
      calls.findIndex((call) => call.name === "patch-config"),
    );
    expect(calls.findIndex((call) => call.name === "patch-config")).toBeLessThan(
      calls.findIndex((call) => call.name === "reload-engine"),
    );
    expect(calls.findIndex((call) => call.name === "reload-engine")).toBeLessThan(
      calls.findIndex((call) => call.name === "set"),
    );
    expect(mirroredCredentials[0]).toEqual({
      key: sharedProviderCredentialEnvKey("deepseek-official"),
      value: "secret",
    });
    expect(mirroredCredentials[1]?.key).toBe(sharedProviderProfileEnvKey("deepseek-official"));
    expect(parseSharedProviderProfile(mirroredCredentials[1]?.value ?? "")).toMatchObject({
      providerId: "deepseek-official",
      api: "openai-completions",
      baseURL: "https://api.deepseek.com",
    });
    expect(connectedIds).toContain("deepseek-official");
  });

  test("connects the OrcaRouter compatible provider preset as a callable shared OpenCode provider", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const runtimePatches: unknown[] = [];
    const mirroredCredentials: Array<{ key: string; value: string }> = [];
    let providers = [
      {
        id: "opencode",
        name: "OpenCode",
        source: "api" as const,
        env: [],
        models: {},
      },
    ];
    let connectedIds = ["opencode"];
    const serverClient = {
      patchConfig: async (_workspaceId: string, patch: unknown) => {
        calls.push({ name: "patch-config" });
        runtimePatches.push(patch);
        return { ok: true };
      },
      reloadEngine: async () => {
        calls.push({ name: "reload-engine" });
        return { ok: true };
      },
      upsertUserEnv: async (entries: Array<{ key: string; value: string }>) => {
        calls.push({ name: "mirror-shared" });
        mirroredCredentials.push(...entries);
        return { updated: entries.map((entry) => entry.key) };
      },
      deleteUserEnv: async () => ({ ok: true }),
    };
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => ({ opencode: "default-model" }),
      providerConnectedIds: () => connectedIds,
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-a",
        name: "Workspace A",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-a",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: serverClient as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { connectedIds = value; },
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => {},
    });

    await store.openProviderAuthModal({ preferredProviderId: "orcarouter" });
    expect(store.getSnapshot()).toMatchObject({
      providerAuthModalOpen: true,
      providerAuthPreferredProviderId: "orcarouter",
      providerAuthMethods: {
        orcarouter: [{ type: "api", label: expect.any(String) }],
      },
    });

    await store.submitProviderApiKey("orcarouter", "secret");

    expect(runtimePatches).toEqual([{
      opencode: {
        provider: {
          orcarouter: {
            npm: "@ai-sdk/openai-compatible",
            name: "OrcaRouter",
            options: { baseURL: "https://api.orcarouter.ai/v1" },
            models: {
              "orcarouter/auto": { name: "OrcaRouter Auto" },
              "openai/gpt-5.5": { name: "GPT-5.5" },
              "anthropic/claude-opus-4.8": { name: "Claude Opus 4.8" },
              "google/gemini-3.5-flash": { name: "Gemini 3.5 Flash" },
              "deepseek/deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
              "qwen/qwen3.7-max": { name: "Qwen3.7 Max" },
              "minimax/minimax-m2.7": { name: "MiniMax M2.7" },
              "grok/grok-4.3": { name: "Grok 4.3" },
            },
          },
        },
      },
    }]);
    expect(calls).toContainEqual({
      name: "set",
      value: {
        providerID: "orcarouter",
        auth: { type: "api", key: "secret" },
      },
    });
    expect(calls.findIndex((call) => call.name === "mirror-shared")).toBeLessThan(
      calls.findIndex((call) => call.name === "patch-config"),
    );
    expect(calls.findIndex((call) => call.name === "patch-config")).toBeLessThan(
      calls.findIndex((call) => call.name === "reload-engine"),
    );
    expect(calls.findIndex((call) => call.name === "reload-engine")).toBeLessThan(
      calls.findIndex((call) => call.name === "set"),
    );
    expect(mirroredCredentials[0]).toEqual({
      key: sharedProviderCredentialEnvKey("orcarouter"),
      value: "secret",
    });
    expect(mirroredCredentials[1]?.key).toBe(sharedProviderProfileEnvKey("orcarouter"));
    expect(parseSharedProviderProfile(mirroredCredentials[1]?.value ?? "")).toMatchObject({
      providerId: "orcarouter",
      api: "openai-completions",
      baseURL: "https://api.orcarouter.ai/v1",
    });
    expect(connectedIds).toContain("orcarouter");
  });

  test("imports a DSH API-key connection into OpenCode", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const credentialKey = sharedProviderCredentialEnvKey("deepseek-official");
    const profileKey = sharedProviderProfileEnvKey("deepseek-official");
    const profile = JSON.stringify({
      schemaVersion: 1,
      providerId: "deepseek-official",
      displayName: "DeepSeek",
      api: "openai-completions",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }],
    });
    const runtimePatches: unknown[] = [];
    const serverClient = {
      listUserEnvKeys: async () => ({ keys: [credentialKey, profileKey] }),
      getUserEnv: async (key: string) => ({
        item: { key, value: key === credentialKey ? "secret" : profile },
      }),
      getConfig: async () => ({ opencode: { provider: {} } }),
      patchConfig: async (_workspaceId: string, patch: unknown) => {
        calls.push({ name: "patch-config" });
        runtimePatches.push(patch);
        return { ok: true };
      },
      reloadEngine: async () => {
        calls.push({ name: "reload-engine" });
        return { ok: true };
      },
    };
    let providers = [{
      id: "opencode",
      name: "OpenCode",
      source: "api" as const,
      env: [],
      models: {},
    }];
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => ({ opencode: "default-model" }),
      providerConnectedIds: () => ["opencode"],
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-shared-import",
        name: "Shared import",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43122/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-shared-import",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: serverClient as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: () => {},
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => {},
    });

    await store.refreshProviders();
    await store.refreshProviders();

    expect(store.getSnapshot().connectedProviderIds).toEqual([
      "opencode",
      "deepseek-official",
    ]);

    expect(runtimePatches).toEqual([{
      opencode: {
        provider: {
          "deepseek-official": {
            npm: "@ai-sdk/openai-compatible",
            name: "DeepSeek",
            options: { baseURL: "https://api.deepseek.com" },
            models: { "deepseek-v4-pro": { name: "DeepSeek-V4-Pro" } },
          },
        },
      },
    }]);
    expect(calls.filter((call) => call.name === "set")).toEqual([{
      name: "set",
      value: {
        providerID: "deepseek-official",
        auth: { type: "api", key: "secret" },
      },
    }]);
    expect(calls.findIndex((call) => call.name === "patch-config")).toBeLessThan(
      calls.findIndex((call) => call.name === "reload-engine"),
    );
    expect(calls.findIndex((call) => call.name === "reload-engine")).toBeLessThan(
      calls.findIndex((call) => call.name === "set"),
    );
  });

  test("projects DSH's Codex OAuth route into the account OpenAI provider", async () => {
    const client = {
      async call<T>(method: string): Promise<T> {
        if (method === "llm.models") {
          return { groups: [
            {
              id: "openai",
              name: "OpenAI API",
              models: [{ id: "gpt-5", name: "GPT-5" }],
            },
            {
              id: "openai-codex",
              name: "OpenAI Codex",
              models: [{ id: "gpt-5.4", name: "GPT-5.4" }],
            },
            {
              id: "openai-codex-priority",
              name: "OpenAI",
              models: [{ id: "gpt-5.4-fast", name: "GPT-5.4 Fast" }],
            },
          ] } as T;
        }
        if (method === "llm.providers") {
          return { providers: [
            {
              provider: "openai",
              displayName: "OpenAI API",
              settingsNs: "llm-pi-ai",
              settingsPath: ["providers", "openai"],
              active: true,
            },
            {
              provider: "openai-codex",
              displayName: "OpenAI Codex",
              settingsNs: "llm-pi-ai",
              settingsPath: ["providers", "openai-codex"],
              active: true,
            },
          ] } as T;
        }
        if (method === "settings.describe") {
          return { namespaces: [{
            ns: "llm-pi-ai",
            value: { providers: {
              openai: { apiKeyEnv: "OPENAI_API_KEY" },
              "openai-codex": { apiKeyEnv: "OPENAI_CODEX_API_KEY" },
            } },
          }] } as T;
        }
        if (method === "credentials.describe") {
          return { credentials: {
            OPENAI_API_KEY: { configured: true },
            OPENAI_CODEX_API_KEY: { configured: true },
          } } as T;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };

    const providers = await deepSeekHarnessProviderEngineAdapter.connect(client).listProviders();
    expect(providers.all).toEqual([expect.objectContaining({
      id: "openai",
      models: expect.objectContaining({
        "gpt-5": expect.any(Object),
        "gpt-5.4": expect.any(Object),
        "gpt-5.4-fast": expect.any(Object),
      }),
    })]);
    expect(providers.connected).toEqual(["openai"]);
    expect(providers.default).toEqual({ openai: "gpt-5" });
  });

  test("disconnects every runtime-managed compatible provider, not only built-ins", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const runtimePatches: unknown[] = [];
    const deletedEnvKeys: string[] = [];
    let providers = [{
      id: "minimax",
      name: "MiniMax",
      source: "config" as const,
      env: ["MINIMAX_API_KEY"],
      models: { "MiniMax-M3": { id: "MiniMax-M3", name: "MiniMax-M3", capabilities: {} } },
    }];
    let connectedIds = ["minimax"];
    const serverClient = {
      readOpencodeConfigFile: async () => ({ content: "{}" }),
      writeOpencodeConfigFile: async () => ({ ok: true }),
      getConfig: async () => ({
        opencode: { provider: { minimax: { name: "MiniMax" } } },
        ipollowork: {},
      }),
      patchConfig: async (_workspaceId: string, patch: unknown) => {
        runtimePatches.push(patch);
        return { updatedAt: Date.now() };
      },
      deleteUserEnv: async (key: string) => {
        deletedEnvKeys.push(key);
        return { deleted: [key] };
      },
      upsertUserEnv: async () => ({ updated: [] }),
    };
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => providers,
      providerDefaults: () => ({}),
      providerConnectedIds: () => connectedIds,
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => ({
        id: "workspace-a",
        name: "Workspace A",
        path: "C:\\workspace",
        preset: "starter",
        workspaceType: "local",
        engineId: DEFAULT_ENGINE_ID,
      }),
      providerBaseUrl: () => "http://localhost:43121/opencode",
      selectedWorkspaceRoot: () => "C:\\workspace",
      runtimeWorkspaceId: () => "workspace-a",
      ipolloworkServer: {
        getSnapshot: () => ({
          ipolloworkServerStatus: "connected",
          ipolloworkServerClient: serverClient as never,
          ipolloworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: (value) => { providers = value; },
      setProviderDefaults: () => {},
      setProviderConnectedIds: (value) => { connectedIds = value; },
      setDisabledProviders: () => {},
      markEngineConfigReloadRequired: () => {},
    });

    await store.disconnectProvider("minimax");

    expect(runtimePatches).toEqual([{ opencode: { provider: { minimax: null } } }]);
    expect(deletedEnvKeys).toEqual([
      sharedProviderCredentialEnvKey("minimax"),
      sharedProviderProfileEnvKey("minimax"),
      "MINIMAX_API_KEY",
    ]);
    expect(calls).toContainEqual({ name: "remove", value: { providerID: "minimax" } });
    expect(connectedIds).not.toContain("minimax");
  });
});
