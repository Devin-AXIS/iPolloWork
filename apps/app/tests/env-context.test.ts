import { describe, expect, test } from "bun:test";

import type { iPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import {
  buildiPolloWorkEnvSystemContext,
  cleariPolloWorkEnvSystemContextCache,
} from "../src/react-app/domains/session/sync/env-context";

function client(
  keys: string[],
  calls: { env: number; authorizations: number },
  authorizations: Array<{
    id: "openai-images" | "aliyun-bailian" | "volcengine-video" | "aliyun-oss";
    configured: boolean;
    fields: Array<{ key: string; configured: boolean }>;
    agent: { capability: string; useWhen: string; instruction: string };
  }> = [],
): iPolloWorkServerClient {
  return {
    baseUrl: "http://127.0.0.1:3000",
    listUserEnvKeys: async () => {
      calls.env += 1;
      return { keys };
    },
    listAuthorizationServices: async () => {
      calls.authorizations += 1;
      return { items: authorizations };
    },
  } as iPolloWorkServerClient;
}

describe("buildiPolloWorkEnvSystemContext", () => {
  test("lists configured key names without inventing secret values", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const context = await buildiPolloWorkEnvSystemContext(
      client(["NBA_LIVE_KEY", "bad-key", "ANTHROPIC_API_KEY", "NBA_LIVE_KEY"], calls),
      {
        cacheKey: "session-a",
        readPendingChanges: () => false,
      },
    );

    expect(context).toContain("- ANTHROPIC_API_KEY");
    expect(context).toContain("- NBA_LIVE_KEY");
    expect(context).not.toContain("bad-key");
    expect(context).not.toContain("sk-ant-secret");
    expect(calls).toEqual({ env: 1, authorizations: 1 });
  });

  test("caches key context per session", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const server = client(["OPENROUTER_API_KEY"], calls);

    await buildiPolloWorkEnvSystemContext(server, {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });
    await buildiPolloWorkEnvSystemContext(server, {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });
    await buildiPolloWorkEnvSystemContext(server, {
      cacheKey: "session-b",
      readPendingChanges: () => false,
    });

    expect(calls).toEqual({ env: 2, authorizations: 2 });
  });

  test("does not truncate long key lists", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const keys = Array.from({ length: 90 }, (_, index) => `KEY_${index}`);
    const context = await buildiPolloWorkEnvSystemContext(client(keys, calls), {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });

    expect(context).toContain("- KEY_0");
    expect(context).toContain("- KEY_89");
    expect(context).not.toContain("and 10 more");
  });

  test("skips context while environment changes are pending", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const context = await buildiPolloWorkEnvSystemContext(client(["ANTHROPIC_API_KEY"], calls), {
      cacheKey: "session-a",
      readPendingChanges: () => true,
    });

    expect(context).toContain("Never start a long-running development or preview server as a foreground shell command");
    expect(calls).toEqual({ env: 0, authorizations: 0 });
  });

  test("gives every AI session safe instructions for configured global services", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const context = await buildiPolloWorkEnvSystemContext(
      client(["OPENAI_API_KEY"], calls, [{
        id: "openai-images",
        configured: true,
        fields: [{ key: "OPENAI_API_KEY", configured: true }],
        agent: {
          capability: "OpenAI image generation",
          useWhen: "Use when the user asks to create an image asset.",
          instruction: "Prefer the iPolloWork image extension.",
        },
      }]),
      { cacheKey: "session-a", readPendingChanges: () => false },
    );

    expect(context).toContain("iPolloWork global AI services already authorized");
    expect(context).toContain("OpenAI image generation (OPENAI_API_KEY)");
    expect(context).toContain("Prefer the iPolloWork image extension.");
    expect(context).toContain("Never ask for, read, reveal, copy");
    expect(context).not.toContain("sk-openai-secret");
  });

  test("prevents foreground preview servers from blocking a tool call", async () => {
    cleariPolloWorkEnvSystemContextCache();
    const calls = { env: 0, authorizations: 0 };
    const context = await buildiPolloWorkEnvSystemContext(client([], calls), {
      cacheKey: "session-server",
      readPendingChanges: () => false,
    });

    expect(context).toContain("Never start a long-running development or preview server as a foreground shell command");
    expect(context).toContain("Never stop all Node processes");
    expect(context).toContain("Do not restart an application-owned preview service");
    expect(context).toContain("health check");
    expect(context).toContain("return control immediately");
  });
});
