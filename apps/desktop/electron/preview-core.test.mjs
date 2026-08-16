import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreviewCore, publicSnapshotSummary } from "./preview-core.mjs";

function fakeRenderer({ snapshot, actions }) {
  const executed = [];
  return {
    executed,
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        executeJavaScript: async (expr) => {
          executed.push(expr);
          // Match the method by the guard the core injects:
          //   if (${method} === "snapshot") return ...
          if (expr.includes('"snapshot" === "snapshot"')) {
            return { ok: true, ...(snapshot ?? { status: "ready" }) };
          }
          if (expr.includes('"actions" === "actions"')) {
            return { ok: true, actions: actions ?? [] };
          }
          return { ok: false, error: "unknown" };
        },
      },
    }),
  };
}

test("getSnapshot returns the renderer snapshot", async () => {
  const renderer = fakeRenderer({ snapshot: { status: "ready", sessionId: "s1" } });
  const core = createPreviewCore({ getWindow: renderer.getWindow });
  const result = await core.getSnapshot();
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "s1");
});

test("getActions returns the action list", async () => {
  const renderer = fakeRenderer({ actions: [{ id: "a", label: "A" }] });
  const core = createPreviewCore({ getWindow: renderer.getWindow });
  const result = await core.getActions();
  assert.equal(result.ok, true);
  assert.equal(result.actions.length, 1);
});

test("getPublicSummary redacts sensitive keys and skips objects/arrays", async () => {
  const renderer = fakeRenderer({
    snapshot: {
      status: "ready",
      sessionId: "s1",
      workspaceRoot: "/Users/me",
      apiToken: "super-secret",
      accessKey: "k",
      nested: { a: 1 },
      tags: ["x"],
    },
    actions: [{ id: "a" }],
  });
  const core = createPreviewCore({ getWindow: renderer.getWindow });
  const result = await core.getPublicSummary();
  assert.equal(result.ok, true);
  assert.equal(result.summary.sessionId, "s1");
  assert.equal(result.summary.workspaceRoot, "/Users/me");
  assert.equal(result.summary.apiToken, "••••••");
  assert.equal(result.summary.accessKey, "••••••");
  assert.equal("nested" in result.summary, false);
  assert.equal("tags" in result.summary, false);
  assert.equal(result.actions.length, 1);
});

test("getPublicSummary throws when renderer is unavailable", async () => {
  const core = createPreviewCore({
    getWindow: () => ({ isDestroyed: () => true, webContents: null }),
  });
  await assert.rejects(() => core.getPublicSummary(), /renderer-unavailable/);
});

test("publicSnapshotSummary redacts token-like keys", () => {
  const summary = publicSnapshotSummary({ status: "ok", bearerToken: "abc" });
  assert.equal(summary.status, "ok");
  assert.equal(summary.bearerToken, "••••••");
});
