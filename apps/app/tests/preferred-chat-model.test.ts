import { describe, expect, test } from "bun:test";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  resolveChatModelStatus,
  resolveEngineSelectableChatModel,
  resolvePreferredSelectableChatModel,
} from "../src/react-app/infra/preferred-chat-model";

describe("model catalog readiness", () => {
  test("cold discovery and retries never claim that a model was removed", () => {
    const cold = { hasModel: false, catalogLoaded: false, fetching: true, error: null };
    expect(resolveChatModelStatus(cold)).toBe("loading");
    expect(resolveChatModelStatus({ ...cold, hasModel: true })).toBe("loading");
    expect(resolveChatModelStatus({ ...cold, error: new Error("Request timed out.") })).toBe("loading");
    expect(resolveChatModelStatus({ ...cold, fetching: false, error: new Error("Request timed out.") })).toBe("error");
    expect(resolveChatModelStatus({ ...cold, hasModel: true, fetching: false, error: new Error("Request timed out.") })).toBe("error");
    expect(resolveChatModelStatus({ ...cold, catalogLoaded: true, fetching: false, hasModel: true })).toBe("ready");
  });

  test("only a successfully loaded catalog can confirm no runnable models", () => {
    expect(resolveChatModelStatus({ hasModel: false, catalogLoaded: true, fetching: false, error: null }))
      .toBe("unavailable");
  });

  test("a failed background refresh preserves a known runnable model", () => {
    expect(resolveChatModelStatus({
      hasModel: true, catalogLoaded: true, fetching: false, error: new Error("Failed to fetch"),
    })).toBe("ready");
  });
});

describe("resolvePreferredSelectableChatModel", () => {
  const providers = [
    { providerID: "opencode", modelIDs: ["big-pickle"] },
    { providerID: "tokenstar", modelIDs: ["gpt-5.6-sol", "kimi-k2.7-code"] },
  ];

  test("keeps the available OpenCode Zen default", () => {
    expect(
      resolvePreferredSelectableChatModel({
        providers,
        defaults: { tokenstar: "kimi-k2.7-code" },
        current: { providerID: "opencode", modelID: "big-pickle" },
      }),
    ).toEqual({ providerID: "opencode", modelID: "big-pickle" });
  });

  test("recovers an unavailable model with a connected user provider", () => {
    expect(
      resolvePreferredSelectableChatModel({
        providers,
        defaults: { tokenstar: "kimi-k2.7-code" },
        current: { providerID: "missing", modelID: "missing-model" },
      }),
    ).toEqual({ providerID: "tokenstar", modelID: "kimi-k2.7-code" });
  });

  test("keeps an explicitly selected available model", () => {
    expect(
      resolvePreferredSelectableChatModel({
        providers,
        current: { providerID: "tokenstar", modelID: "gpt-5.6-sol" },
      }),
    ).toEqual({ providerID: "tokenstar", modelID: "gpt-5.6-sol" });
  });

  test("returns null when no usable user model replaces an unavailable model", () => {
    expect(
      resolvePreferredSelectableChatModel({
        providers: [{ providerID: "opencode", modelIDs: ["big-pickle"] }],
        current: { providerID: "missing", modelID: "missing-model" },
      }),
    ).toBeNull();
  });
});

describe("resolveEngineSelectableChatModel", () => {
  test("uses an engine fallback without replacing the shared preference", () => {
    const preferred = { providerID: "tokenstar", modelID: "gpt-5.6-sol" };

    expect(resolveEngineSelectableChatModel({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      providers: [{ providerID: "deepseek-official", modelIDs: ["deepseek-v4-flash"] }],
      defaults: { "deepseek-official": "deepseek-v4-flash" },
      preferred,
    })).toEqual({ providerID: "deepseek-official", modelID: "deepseek-v4-flash" });
    expect(preferred).toEqual({ providerID: "tokenstar", modelID: "gpt-5.6-sol" });
  });

  test("falls back to the built-in engine route when it is the only option", () => {
    expect(resolveEngineSelectableChatModel({
      providers: [{ providerID: "opencode", modelIDs: ["big-pickle"], freeModelIDs: ["big-pickle"] }],
      defaults: { opencode: "big-pickle" },
      preferred: { providerID: "deepseek-official", modelID: "deepseek-v4-flash" },
    })).toEqual({ providerID: "opencode", modelID: "big-pickle" });
  });

  test("restores the shared preference on an engine that supports it", () => {
    expect(resolveEngineSelectableChatModel({
      engineId: CODEX_HARNESS_ENGINE_ID,
      providers: [{ providerID: "tokenstar", modelIDs: ["gpt-5.6-sol"] }],
      preferred: { providerID: "tokenstar", modelID: "gpt-5.6-sol" },
    })).toEqual({ providerID: "tokenstar", modelID: "gpt-5.6-sol" });
  });

  test("defaults OpenCode to its live free route instead of an inherited paid shared model", () => {
    const preferred = { providerID: "openai", modelID: "gpt-5.5" };
    const providers = [
      { providerID: "openai", modelIDs: ["gpt-5.5"] },
      { providerID: "opencode", modelIDs: ["new-free", "other-free"], freeModelIDs: ["new-free", "other-free"] },
    ];
    const input = { engineId: DEFAULT_ENGINE_ID, providers, defaults: { opencode: "other-free" }, preferred };
    expect(resolveEngineSelectableChatModel(input)).toEqual({ providerID: "opencode", modelID: "other-free" });
    expect(resolveEngineSelectableChatModel({ ...input, selectedForEngine: preferred })).toEqual(preferred);
    expect(resolveEngineSelectableChatModel({
      ...input,
      preferred: { providerID: "tokenstar", modelID: "gpt-5.6-sol" },
      selectedForEngine: preferred,
    })).toEqual(preferred);
    expect(resolveEngineSelectableChatModel({ ...input, preferred: { providerID: "opencode", modelID: "new-free" } }))
      .toEqual({ providerID: "opencode", modelID: "new-free" });
    expect(resolveEngineSelectableChatModel({ ...input, engineId: CODEX_HARNESS_ENGINE_ID })).toEqual(preferred);
    expect(preferred).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
  });

  test("recovers null or retired defaults only with a currently declared free model", () => {
    const input = {
      providers: [{ providerID: "opencode", modelIDs: ["paid", "replacement-free"], freeModelIDs: ["replacement-free", "removed"] }],
      preferred: null,
    };
    for (const defaultModel of ["paid", "removed"]) {
      expect(resolveEngineSelectableChatModel({ ...input, defaults: { opencode: defaultModel } }))
        .toEqual({ providerID: "opencode", modelID: "replacement-free" });
    }
    expect(resolveEngineSelectableChatModel({
      ...input,
      providers: [{ providerID: "opencode", modelIDs: ["paid"], freeModelIDs: ["removed"] }],
    })).toBeNull();
    expect(resolveEngineSelectableChatModel({
      providers: [{ providerID: "openai", modelIDs: ["gpt-5.5"] }],
      preferred: { providerID: "openai", modelID: "gpt-5.5" },
    })).toBeNull();
  });
});
