import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createScheduledTasks, parseCron, cronMatches, nextRunAfter } from "./scheduled-tasks.mjs";

function makeScheduler(overrides = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "ipw-sched-test-"));
  return createScheduledTasks({ homedir: () => home, ...overrides });
}

// ── cron engine ────────────────────────────────────────────────────────

test("parseCron rejects non-5-field expressions", () => {
  assert.equal(parseCron("0 9 * *"), null);
  assert.equal(parseCron("0 9 * * * *"), null);
  assert.equal(parseCron(""), null);
});

test("parseCron rejects malformed tokens", () => {
  assert.equal(parseCron("5abc 9 * * *"), null);
  assert.equal(parseCron("0 9 * * 1-2x"), null);
  assert.equal(parseCron("*/2z 9 * * *"), null);
  assert.equal(parseCron("99 99 * * *"), null);
});

test("parseCron accepts valid expressions", () => {
  assert.ok(parseCron("0 9 * * 1-5"));
  assert.ok(parseCron("*/15 * * * *"));
  assert.ok(parseCron("0 9,17 * * 1-5"));
  assert.ok(parseCron("0 9 1 * *"));
  assert.ok(parseCron("0 */6 * * *"));
});

test("cronMatches matches weekday 9am only", () => {
  const monday9 = new Date(2026, 0, 5, 9, 0); // Monday
  const sunday9 = new Date(2026, 0, 4, 9, 0); // Sunday
  assert.equal(cronMatches("0 9 * * 1-5", monday9), true);
  assert.equal(cronMatches("0 9 * * 1-5", sunday9), false);
});

test("weekday 7 and 0 both mean Sunday", () => {
  const sunday9 = new Date(2026, 0, 4, 9, 0);
  assert.equal(cronMatches("0 9 * * 7", sunday9), true);
  assert.equal(cronMatches("0 9 * * 0", sunday9), true);
});

test("DOM/DOW OR semantics when both fields restricted", () => {
  const monday = new Date(2026, 0, 5, 9, 0); // Monday, day 5
  assert.equal(cronMatches("0 9 1 * 1", monday), true);
});

test("nextRunAfter returns the next matching minute", () => {
  const from = new Date(2026, 0, 5, 8, 0); // Monday 8:00
  const next = nextRunAfter("0 9 * * 1-5", from);
  assert.equal(next, new Date(2026, 0, 5, 9, 0).getTime());
});

test("nextRunAfter returns null for never-matching cron (bounded)", () => {
  const from = new Date(2026, 0, 5, 0, 0);
  assert.equal(nextRunAfter("0 0 31 2 *", from), null);
});

// ── factory CRUD ───────────────────────────────────────────────────────

test("create/list roundtrip with nextRunAt", () => {
  const s = makeScheduler();
  const t = s.create({ name: "站会", cron: "0 9 * * 1-5", prompt: "汇总", workspaceId: "/ws" });
  assert.equal(t.enabled, true);
  const list = s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "站会");
  assert.ok(Number.isFinite(list[0].nextRunAt));
});

test("create rejects invalid cron", () => {
  const s = makeScheduler();
  assert.equal(s.create({ name: "x", cron: "99 99 * *", prompt: "x" }), null);
  assert.equal(s.list().length, 0);
});

test("update applies lastRun fields and rejects invalid cron", () => {
  const s = makeScheduler();
  const t = s.create({ name: "x", cron: "0 9 * * *", prompt: "x" });
  const updated = s.update(t.id, { lastRunAt: 123, lastRunStatus: "ok" });
  assert.equal(updated.lastRunAt, 123);
  assert.equal(updated.lastRunStatus, "ok");
  assert.equal(s.update(t.id, { cron: "bad cron" }), null);
});

test("runNow records log and status", async () => {
  const s = makeScheduler();
  const t = s.create({ name: "x", cron: "0 9 * * *", prompt: "x" });
  const fired = await s.runNow(t.id);
  assert.equal(fired.lastRunStatus, "ok");
  assert.ok(Number.isFinite(fired.lastRunAt));
  assert.equal(s.logs(t.id).length, 1);
});

test("setEnabled disables nextRunAt", () => {
  const s = makeScheduler();
  const t = s.create({ name: "x", cron: "0 9 * * *", prompt: "x" });
  s.setEnabled(t.id, false);
  assert.equal(s.list()[0].nextRunAt, null);
});

test("remove deletes the task", () => {
  const s = makeScheduler();
  const t = s.create({ name: "x", cron: "0 9 * * *", prompt: "x" });
  assert.equal(s.remove(t.id), true);
  assert.equal(s.list().length, 0);
});

test("tick fires once per minute", () => {
  let currentTime = new Date(2026, 0, 5, 9, 0, 0).getTime();
  const s = makeScheduler({ now: () => currentTime });
  s.create({ name: "站会", cron: "* * * * *", prompt: "x" });

  try {
    s.start();
    assert.equal(s.list()[0].lastRunAt, currentTime);

    s.stop();
    currentTime = new Date(2026, 0, 5, 9, 0, 10).getTime(); // same minute
    s.start();
    assert.equal(s.list()[0].lastRunAt, new Date(2026, 0, 5, 9, 0, 0).getTime());

    s.stop();
    currentTime = new Date(2026, 0, 5, 9, 1, 0).getTime(); // next minute
    s.start();
    assert.equal(s.list()[0].lastRunAt, currentTime);
  } finally {
    s.stop();
  }
});
