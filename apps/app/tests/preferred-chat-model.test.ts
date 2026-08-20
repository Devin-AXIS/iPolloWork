import { describe, expect, test } from "bun:test";

import {
  resolveEngineSelectableChatModel,
  resolvePreferredSelectableChatModel,
} from "../src/react-app/infra/preferred-chat-model";

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
      providers: [{ providerID: "deepseek-official", modelIDs: ["deepseek-v4-flash"] }],
      defaults: { "deepseek-official": "deepseek-v4-flash" },
      preferred,
    })).toEqual({ providerID: "deepseek-official", modelID: "deepseek-v4-flash" });
    expect(preferred).toEqual({ providerID: "tokenstar", modelID: "gpt-5.6-sol" });
  });

  test("falls back to the built-in engine route when it is the only option", () => {
    expect(resolveEngineSelectableChatModel({
      providers: [{ providerID: "opencode", modelIDs: ["big-pickle"] }],
      preferred: { providerID: "deepseek-official", modelID: "deepseek-v4-flash" },
    })).toEqual({ providerID: "opencode", modelID: "big-pickle" });
  });

  test("restores the shared preference on an engine that supports it", () => {
    expect(resolveEngineSelectableChatModel({
      providers: [{ providerID: "tokenstar", modelIDs: ["gpt-5.6-sol"] }],
      preferred: { providerID: "tokenstar", modelID: "gpt-5.6-sol" },
    })).toEqual({ providerID: "tokenstar", modelID: "gpt-5.6-sol" });
  });
});
