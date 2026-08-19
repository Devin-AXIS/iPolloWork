import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  sharedProviderCredentialEnvKey,
  sharedProviderIdsFromEnvKeys,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  getEnginePreferences,
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
    enginePreferences: {
      [DEFAULT_ENGINE_ID]: {
        model: { providerID: "openai", modelID: "gpt-5" },
        modelVariant: "high",
        mode: "build",
      },
      [DEEPSEEK_HARNESS_ENGINE_ID]: {
        model: { providerID: "deepseek", modelID: "legacy-engine-model" },
        modelVariant: null,
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
      model: { providerID: "deepseek", modelID: "legacy-engine-model" },
      modelVariant: null,
      mode: "code",
    });

    const updated = updateEnginePreferences(initial, DEEPSEEK_HARNESS_ENGINE_ID, (current) => ({
      ...current,
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      modelVariant: null,
    }));

    expect(getEnginePreferences(updated, DEEPSEEK_HARNESS_ENGINE_ID).model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
    });
    expect(getEnginePreferences(updated, DEFAULT_ENGINE_ID).model).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
    expect(getEnginePreferences(updated, DEEPSEEK_HARNESS_ENGINE_ID).mode).toBe("code");
    expect(getEnginePreferences(updated, DEFAULT_ENGINE_ID).mode).toBe("build");
  });

  test("uses the OpenCode workspace as the shared provider control plane", () => {
    const dsh = { id: "dsh", engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const openCode = { id: "open", engineId: DEFAULT_ENGINE_ID };

    expect(selectSharedProviderWorkspace([dsh, openCode], dsh)).toBe(openCode);
    expect(selectSharedProviderWorkspace([dsh, openCode], openCode)).toBe(openCode);
    expect(selectSharedProviderWorkspace([dsh], dsh)).toBe(dsh);
  });

  test("keeps the built-in OpenCode catalog when only a DSH workspace exists", () => {
    for (const source of [sessionRouteSource, settingsRouteSource]) {
      expect(source).toContain("const sharedProviderEngineId = DEFAULT_ENGINE_ID");
      expect(source).toContain("sharedProviderEndpoint.opencodeBaseUrl");
      expect(source).toContain("if (deepSeekHarnessProviderClient && deepSeekHarnessWorkspace)");
      expect(source).not.toContain("deepSeekHarnessWorkspace.id !== sharedProviderWorkspace?.id");
    }
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

  test("derives account provider connections from user-level credentials", () => {
    expect(sharedProviderIdsFromEnvKeys([
      sharedProviderProfileEnvKey("openai"),
      sharedProviderCredentialEnvKey("openai"),
      sharedProviderCredentialEnvKey("deepseek-official"),
      sharedProviderCredentialEnvKey("openai"),
      "OPENAI_API_KEY",
    ])).toEqual(["deepseek-official", "openai"]);
  });
});
