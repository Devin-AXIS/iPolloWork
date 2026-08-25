import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  sharedConfiguredProviderIdsFromEnvKeys,
  sharedProviderCredentialEnvKey,
  sharedProviderDisconnectedEnvKey,
  sharedProviderDisconnectedIdsFromEnvKeys,
  sharedProviderIdsFromEnvKeys,
  sharedProviderProfileEnvKey,
  sharedProviderRuntimeRoute,
} from "@ipollowork/types/provider-credentials";

import {
  getEnginePreferences,
  updateModelPreferences,
  updateEnginePreferences,
  type LocalPreferences,
} from "../src/react-app/kernel/local-provider";
import { selectSharedProviderWorkspace } from "../src/react-app/domains/connections/provider-auth/shared-provider-workspace";
import {
  buildSharedProviderProfile,
  sharedProviderConnectionEnvEntries,
} from "../src/react-app/domains/connections/provider-auth/shared-provider-profile";

const sessionRouteSource = readFileSync(
  new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
  "utf8",
);
const settingsRouteSource = readFileSync(
  new URL("../src/react-app/shell/settings-route.tsx", import.meta.url),
  "utf8",
);

function preferences(): LocalPreferences {
  return {
    showThinking: true,
    model: { providerID: "openai", modelID: "gpt-5" },
    modelVariant: "high",
    enginePreferences: {
      [DEFAULT_ENGINE_ID]: {
        mode: "build",
      },
      [DEEPSEEK_HARNESS_ENGINE_ID]: {
        mode: "code",
      },
    },
    featureFlags: { microsandboxCreateSandbox: true, memory: false },
    hasCompletedOnboarding: true,
    analyticsEnabled: true,
    desktopNotifications: "off",
  };
}

describe("shared AI provider preferences", () => {
  test("preserves an independent model selection for each engine", () => {
    const initial = preferences();
    expect(getEnginePreferences(initial, DEEPSEEK_HARNESS_ENGINE_ID)).toEqual({
      mode: "code",
    });

    const updated = updateModelPreferences(initial, (current) => ({
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      modelVariant: null,
    }));

    expect(updated.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
    });
    const modeUpdated = updateEnginePreferences(updated, DEEPSEEK_HARNESS_ENGINE_ID, () => ({ mode: "review" }));
    expect(getEnginePreferences(modeUpdated, DEEPSEEK_HARNESS_ENGINE_ID).mode).toBe("review");
    expect(getEnginePreferences(modeUpdated, DEFAULT_ENGINE_ID).mode).toBe("build");
    expect(modeUpdated.model).toEqual(updated.model);
  });

  test("uses the OpenCode workspace as the shared provider control plane", () => {
    const dsh = { id: "dsh", engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const openCode = { id: "open", engineId: DEFAULT_ENGINE_ID, workspaceType: "local" };
    const secondOpenCode = { id: "open-2", engineId: DEFAULT_ENGINE_ID, workspaceType: "local" };

    expect(selectSharedProviderWorkspace([dsh, openCode], dsh)).toBe(openCode);
    expect(selectSharedProviderWorkspace([openCode, secondOpenCode], secondOpenCode)).toBe(openCode);
    expect(selectSharedProviderWorkspace([dsh], dsh)).toBe(dsh);
  });

  test("keeps the built-in OpenCode catalog when only a DSH workspace exists", () => {
    for (const source of [sessionRouteSource, settingsRouteSource]) {
      expect(source).toContain("const sharedProviderEngineId = DEFAULT_ENGINE_ID");
      expect(source).toContain("sharedProviderEndpoint?.opencodeBaseUrl");
      expect(source).not.toContain("deepSeekHarnessWorkspace.id !== sharedProviderWorkspace?.id");
    }
    expect(sessionRouteSource).not.toContain("runtimeModelCatalogSources");
    expect(settingsRouteSource).toContain("const supportedEngines = new Set(providerEngineAdapters.ids())");
    expect(settingsRouteSource).toContain("...runtimeModelCatalogSources,");
    expect(settingsRouteSource).not.toContain("sources.push(...runtimeModelCatalogSources)");
  });

  test("uses the merged account catalog but the active engine runtime for prompt delivery", () => {
    expect(sessionRouteSource).toContain("const providerListQuery = useMergedProviderListQuery({");
    expect(sessionRouteSource).toContain("sources: modelCatalogSources");
    expect(sessionRouteSource).toContain("enabled: modelCatalogSources.length > 0");
    expect(sessionRouteSource).toContain("const accountProviderList = filterProviderList(");
    expect(sessionRouteSource).toContain("? filterProviderList(activeProviderListQuery.data, hiddenProviderIds)");
    expect(sessionRouteSource).toContain("connectedProviderIds: sessionProviderAuthSnapshot.connectedProviderIds");
    expect(sessionRouteSource).toContain("disabledProviderIds: hiddenProviderIds");
    expect(settingsRouteSource).toContain("catalogSources: modelCatalogSources");
    expect(settingsRouteSource).toContain("runtimeSource: activeModelProviderSource");
    expect(settingsRouteSource).toContain("connectedProviderIds: providerAuthSnapshot.connectedProviderIds");
    expect(sessionRouteSource).toContain("getSelectableChatModelSnapshot(activeProviderList)");
    expect(sessionRouteSource).toContain("runtimeSource: activeProviderSource");
    expect(sessionRouteSource).toContain("model: activeSelectedModel");
    expect(sessionRouteSource).toContain("providerId: activeSelectedModel.providerID");
  });

  test("describes compatible providers once for every engine adapter", () => {
    const profile = buildSharedProviderProfile({
      providerId: "acme",
      displayName: "Acme Gateway",
      api: "https://gateway.acme.example/v1",
      npm: "@ai-sdk/openai-compatible",
      models: { "acme-large": { name: "Acme Large" } },
    });

    expect(profile).toEqual({
      schemaVersion: 1,
      providerId: "acme",
      displayName: "Acme Gateway",
      api: "openai-completions",
      baseURL: "https://gateway.acme.example/v1",
      models: [{ id: "acme-large", name: "Acme Large" }],
    });
    expect(sharedProviderConnectionEnvEntries({ apiKey: "secret", profile })).toHaveLength(2);
  });

  test("adds portable runtime routes to native provider profiles", () => {
    const cases = [
      ["openai", "openai-responses", "https://api.openai.com/v1"],
      ["deepseek-official", "openai-completions", "https://api.deepseek.com"],
      ["alibaba-cn", "openai-completions", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
      ["anthropic", "anthropic-messages", "https://api.anthropic.com"],
      ["kimi-for-coding", "anthropic-messages", "https://api.kimi.com/coding"],
      ["minimax-cn", "anthropic-messages", "https://api.minimaxi.com/anthropic"],
      ["google", "openai-completions", "https://generativelanguage.googleapis.com/v1beta/openai"],
      ["mistral", "openai-completions", "https://api.mistral.ai/v1"],
      ["cohere", "openai-completions", "https://api.cohere.ai/compatibility/v1"],
    ] as const;

    for (const [providerId, api, baseURL] of cases) {
      expect(buildSharedProviderProfile({
        providerId: ` ${providerId.toUpperCase()} `,
        displayName: providerId,
        models: { model: { name: "Model" } },
      })).toMatchObject({ providerId, api, baseURL });
      expect(sharedProviderRuntimeRoute(providerId)).toEqual({ api, baseURL });
    }

    expect(sharedProviderRuntimeRoute("dynamic-cloud-provider")).toBeUndefined();
  });

  test("derives account provider connections from user-level credentials", () => {
    expect(sharedProviderIdsFromEnvKeys([
      sharedProviderProfileEnvKey("openai"),
      sharedProviderCredentialEnvKey("openai"),
      sharedProviderCredentialEnvKey("deepseek-official"),
      sharedProviderCredentialEnvKey("openai"),
      "OPENAI_API_KEY",
    ])).toEqual(["deepseek-official", "openai"]);
  });

  test("keeps OAuth providers account-connected through their non-secret profile", () => {
    expect(sharedConfiguredProviderIdsFromEnvKeys([
      sharedProviderProfileEnvKey("openai"),
      sharedProviderCredentialEnvKey("deepseek-official"),
      sharedProviderProfileEnvKey("deepseek-official"),
    ])).toEqual(["deepseek-official", "openai"]);
    expect(sharedConfiguredProviderIdsFromEnvKeys([
      sharedProviderProfileEnvKey("openai"),
      sharedProviderCredentialEnvKey("deepseek-official"),
    ], [])).toEqual(["deepseek-official"]);
    expect(sharedConfiguredProviderIdsFromEnvKeys([
      sharedProviderProfileEnvKey("openai"),
    ], ["openai"])).toEqual(["openai"]);
  });

  test("lets an explicit account disconnect override every discovered credential source", () => {
    const disconnectedKey = sharedProviderDisconnectedEnvKey("openai");
    const keys = [
      sharedProviderCredentialEnvKey("openai"),
      sharedProviderProfileEnvKey("openai"),
      disconnectedKey,
    ];

    expect(sharedProviderDisconnectedIdsFromEnvKeys(keys)).toEqual(["openai"]);
    expect(sharedProviderIdsFromEnvKeys(keys)).toEqual([]);
    expect(sharedConfiguredProviderIdsFromEnvKeys(keys, ["openai"])).toEqual([]);
  });
});
