import { describe, expect, test } from "bun:test";

import {
  deepSeekHarnessProviderEngineAdapter,
  providerEngineAdapters,
  ProviderEngineAdapterRegistry,
  openCodeProviderEngineAdapter,
} from "../src/react-app/domains/connections/provider-auth/provider-engine-adapter";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import {
  mergeProviderListResponses,
  providerListQueryKey,
} from "../src/react-app/infra/provider-list-query";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { sharedProviderCredentialEnvKey } from "@ipollowork/types/provider-credentials";

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

describe("provider engine adapters", () => {
  test("keeps OpenCode as default while registering DeepSeek Harness as a peer", () => {
    expect(providerEngineAdapters.ids()).toEqual([DEFAULT_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID]);
    expect(providerEngineAdapters.get()).toBe(openCodeProviderEngineAdapter);
    expect(providerEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID)).toBe(deepSeekHarnessProviderEngineAdapter);
    expect(() => providerEngineAdapters.get("unknown")).toThrow(
      "Provider engine is not registered: unknown",
    );
    expect(providerEngineAdapters.createClient("unknown", {} as never)).toBeNull();
  });

  test("rejects duplicate provider adapters", () => {
    expect(() => new ProviderEngineAdapterRegistry([
      openCodeProviderEngineAdapter,
      { ...openCodeProviderEngineAdapter },
    ])).toThrow(`Duplicate provider engine adapter: ${DEFAULT_ENGINE_ID}`);
  });

  test("separates provider caches by engine", () => {
    expect(providerListQueryKey({ engineId: "opencode", baseUrl: "http://runtime" }))
      .not.toEqual(providerListQueryKey({ engineId: "deepseek-harness", baseUrl: "http://runtime" }));
  });

  test("routes provider list, auth and disabled state through OpenCode", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const connection = openCodeProviderEngineAdapter.connect(client);

    expect(await connection.listProviders()).toEqual({
      all: [{ id: "opencode", name: "OpenCode", source: "api", env: [], models: {} }],
      connected: ["opencode"],
      default: { opencode: "default-model" },
    });
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
      providerAuthMethods: {
        "deepseek-official": [{ type: "api", label: expect.any(String) }],
      },
    });

    await store.submitProviderApiKey("deepseek-official", "secret");

    expect(queryClient.getQueryData(sessionQueryKey)).toMatchObject({
      connected: ["deepseek-official"],
    });
    expect(mirroredCredentials).toEqual([{
      key: sharedProviderCredentialEnvKey("deepseek-official"),
      value: "secret",
    }]);
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
        runtimePatches.push(patch);
        return { ok: true };
      },
      upsertUserEnv: async (entries: Array<{ key: string; value: string }>) => {
        mirroredCredentials.push(...entries);
        return { updated: entries.map((entry) => entry.key) };
      },
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
    expect(mirroredCredentials).toEqual([{
      key: sharedProviderCredentialEnvKey("deepseek-official"),
      value: "secret",
    }]);
    expect(connectedIds).toContain("deepseek-official");
  });

  test("disconnects every runtime-managed compatible provider, not only built-ins", async () => {
    const { calls, client } = createOpenCodeProviderClient();
    const runtimePatches: unknown[] = [];
    const deletedEnvKeys: string[] = [];
    let providers = [{
      id: "minimax",
      name: "MiniMax",
      source: "config" as const,
      env: [],
      models: { "MiniMax-M3": { id: "MiniMax-M3", name: "MiniMax-M3", capabilities: {} } },
    }];
    let connectedIds = ["minimax"];
    const serverClient = {
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
    expect(deletedEnvKeys).toEqual([sharedProviderCredentialEnvKey("minimax")]);
    expect(calls).toContainEqual({ name: "remove", value: { providerID: "minimax" } });
    expect(connectedIds).not.toContain("minimax");
  });

});
