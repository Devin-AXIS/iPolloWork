import { describe, expect, test } from "bun:test";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  getEnginePreferences,
  updateEnginePreferences,
  type LocalPreferences,
} from "../src/react-app/kernel/local-provider";
import { selectSharedProviderWorkspace } from "../src/react-app/domains/connections/provider-auth/shared-provider-workspace";

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
  test("uses one model selection while preserving engine-specific modes", () => {
    const initial = preferences();
    expect(getEnginePreferences(initial, DEEPSEEK_HARNESS_ENGINE_ID)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      modelVariant: "high",
      mode: "code",
    });

    const updated = updateEnginePreferences(initial, DEEPSEEK_HARNESS_ENGINE_ID, (current) => ({
      ...current,
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      modelVariant: null,
    }));

    expect(getEnginePreferences(updated, DEFAULT_ENGINE_ID).model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
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
});
