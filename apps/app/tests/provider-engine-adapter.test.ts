import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";

import {
  deepSeekHarnessProviderEngineAdapter,
  providerEngineAdapters,
  ProviderEngineAdapterRegistry,
  openCodeProviderEngineAdapter,
} from "../src/react-app/domains/connections/provider-auth/provider-engine-adapter";
import { providerListQueryKey } from "../src/react-app/infra/provider-list-query";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

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
      method: "credentials.set",
      payload: { ref: "DEEPSEEK_API_KEY", value: "secret" },
    });
    expect(calls).toContainEqual({
      method: "credentials.unset",
      payload: { ref: "DEEPSEEK_API_KEY" },
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

  test("removes project provider state without leaving disabled entries", () => {
    const raw = `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "tokenstar": { "name": "TokenStar" },
    "other": { "name": "Other" }
  },
  "disabled_providers": ["tokenstar", "other"]
}
`;
    const updated = openCodeProviderEngineAdapter.formatProjectWithoutProvider(
      raw,
      "tokenstar",
      ["tokenstar", "other"],
    );
    const config = parse(updated);

    expect(config.provider).toEqual({ other: { name: "Other" } });
    expect(config.disabled_providers).toEqual(["other"]);
  });
});
