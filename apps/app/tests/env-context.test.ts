import { describe, expect, test } from "bun:test";

import type { iPolloWalkServerClient } from "../src/app/lib/ipollowalk-server";
import {
  buildiPolloWalkEnvSystemContext,
  cleariPolloWalkEnvSystemContextCache,
} from "../src/react-app/domains/session/sync/env-context";

function client(keys: string[], calls: { count: number }): iPolloWalkServerClient {
  return {
    baseUrl: "http://127.0.0.1:3000",
    listUserEnvKeys: async () => {
      calls.count += 1;
      return { keys };
    },
  } as iPolloWalkServerClient;
}

describe("buildiPolloWalkEnvSystemContext", () => {
  test("lists configured key names without inventing secret values", async () => {
    cleariPolloWalkEnvSystemContextCache();
    const calls = { count: 0 };
    const context = await buildiPolloWalkEnvSystemContext(
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
    expect(calls.count).toBe(1);
  });

  test("caches key context per session", async () => {
    cleariPolloWalkEnvSystemContextCache();
    const calls = { count: 0 };
    const server = client(["OPENROUTER_API_KEY"], calls);

    await buildiPolloWalkEnvSystemContext(server, {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });
    await buildiPolloWalkEnvSystemContext(server, {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });
    await buildiPolloWalkEnvSystemContext(server, {
      cacheKey: "session-b",
      readPendingChanges: () => false,
    });

    expect(calls.count).toBe(2);
  });

  test("does not truncate long key lists", async () => {
    cleariPolloWalkEnvSystemContextCache();
    const calls = { count: 0 };
    const keys = Array.from({ length: 90 }, (_, index) => `KEY_${index}`);
    const context = await buildiPolloWalkEnvSystemContext(client(keys, calls), {
      cacheKey: "session-a",
      readPendingChanges: () => false,
    });

    expect(context).toContain("- KEY_0");
    expect(context).toContain("- KEY_89");
    expect(context).not.toContain("and 10 more");
  });

  test("skips context while environment changes are pending", async () => {
    cleariPolloWalkEnvSystemContextCache();
    const calls = { count: 0 };
    const context = await buildiPolloWalkEnvSystemContext(client(["ANTHROPIC_API_KEY"], calls), {
      cacheKey: "session-a",
      readPendingChanges: () => true,
    });

    expect(context).toBeUndefined();
    expect(calls.count).toBe(0);
  });
});
