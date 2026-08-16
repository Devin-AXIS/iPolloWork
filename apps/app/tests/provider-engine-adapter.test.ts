import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";

import {
  ProviderEngineAdapterRegistry,
  openCodeProviderEngineAdapter,
} from "../src/react-app/domains/connections/provider-auth/provider-engine-adapter";
import { providerListQueryKey } from "../src/react-app/infra/provider-list-query";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

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
  test("keeps OpenCode as the only default adapter", () => {
    const registry = new ProviderEngineAdapterRegistry([openCodeProviderEngineAdapter]);
    expect(registry.ids()).toEqual([DEFAULT_ENGINE_ID]);
    expect(registry.get()).toBe(openCodeProviderEngineAdapter);
    expect(() => registry.get("deepseek-harness")).toThrow(
      "Provider engine is not registered: deepseek-harness",
    );
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
