import { describe, expect, test } from "bun:test";

import { sanitizePortableOpencodeConfig } from "./portable-opencode.js";

describe("sanitizePortableOpencodeConfig", () => {
  test("keeps only portable top-level config keys", () => {
    const sanitized = sanitizePortableOpencodeConfig({
      model: "anthropic/claude-sonnet-4-5",
      provider: { openai: { options: { apiKey: "secret" } } },
      tools: { bash: false },
      permission: { edit: "ask" },
      plugin: ["opencode-helicone-session"],
      command: { review: { template: "Review changes" } },
      mcp: { jira: { type: "remote", url: "https://jira.example.com/mcp" } },
      agent: { reviewer: { description: "Reviews code" } },
      instructions: ["CONTRIBUTING.md"],
      share: "manual",
      watcher: { ignore: ["dist/**"] },
      autoupdate: false,
    });

    expect(sanitized).toEqual({
      tools: { bash: false },
      permission: { edit: "ask" },
      plugin: ["opencode-helicone-session"],
      command: { review: { template: "Review changes" } },
      mcp: { jira: { type: "remote", url: "https://jira.example.com/mcp" } },
      agent: { reviewer: { description: "Reviews code" } },
      instructions: ["CONTRIBUTING.md"],
      share: "manual",
      watcher: { ignore: ["dist/**"] },
    });
  });

  test("returns a defensive clone", () => {
    const input = { plugin: ["a"], tools: { bash: false } };
    const sanitized = sanitizePortableOpencodeConfig(input);
    (sanitized.plugin as string[]).push("b");
    (sanitized.tools as Record<string, unknown>).bash = true;

    expect(input).toEqual({ plugin: ["a"], tools: { bash: false } });
  });
});
