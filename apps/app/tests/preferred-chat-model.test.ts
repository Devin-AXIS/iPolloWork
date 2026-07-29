import { describe, expect, test } from "bun:test";

import { resolvePreferredSelectableChatModel } from "../src/react-app/infra/preferred-chat-model";

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
