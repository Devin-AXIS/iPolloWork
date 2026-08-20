import { describe, expect, test } from "bun:test";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  getEnginePreferences,
  updateModelPreferences,
  updateEnginePreferences,
  type LocalPreferences,
} from "../src/react-app/kernel/local-provider";
import { selectSharedProviderWorkspace } from "../src/react-app/domains/connections/provider-auth/shared-provider-workspace";

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
  test("uses one model selection while preserving engine-specific modes", () => {
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
});
