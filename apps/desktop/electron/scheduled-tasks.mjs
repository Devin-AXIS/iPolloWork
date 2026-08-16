// Scheduled tasks: JSON persistence + cron ticker + run log, wired as a
// factory (createScheduledTasks pattern) so it stays unit-testable like
// ssh-ops.mjs / git-graph.mjs. The actual agent execution is intentionally
// delegated via the `onFire` callback so main.mjs can wire it to the runtime
// later; for now the tick records a run log entry and notifies the renderer.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_SCAN_MINUTES = 366 * 24 * 60 * 4; // 4 years covers the leap-year cycle
const FIELD_NAMES = ["minute", "hour", "day", "month", "weekday"];
const FIELD_META = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  weekday: { min: 0, max: 7 },
};

function parseFieldPart(part, min, max, allowSeven) {
  const values = new Set();
  const add = (n) => {
    if (n < min || n > max) return false;
    if (!allowSeven && n === 7) return false;
    values.add(n);
    return true;
  };
  for (const raw of part.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    const stepMatch = /^(\*|\d+-\d+|\d+)\/(\d+)$/.exec(trimmed);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number.parseInt(stepMatch[2], 10);
      if (!Number.isInteger(step) || step <= 0) return null;
      let rangeStart = min;
      let rangeEnd = max;
      if (base !== "*") {
        if (base.includes("-")) {
          const [a, b] = base.split("-").map((n) => Number.parseInt(n, 10));
          if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
          rangeStart = a;
          rangeEnd = b;
        } else {
          const single = Number.parseInt(base, 10);
          if (!Number.isInteger(single)) return null;
          rangeStart = single;
          rangeEnd = max;
        }
      }
      for (let i = rangeStart; i <= rangeEnd; i += step) {
        if (!add(i)) return null;
      }
      continue;
    }
    if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-").map((n) => Number.parseInt(n, 10));
      if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return null;
      for (let i = a; i <= b; i++) if (!add(i)) return null;
      continue;
    }
    const single = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(single)) return null;
    if (!add(single)) return null;
  }
  return values;
}

function parseCron(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields = {};
  const raw = {};
  for (let i = 0; i < FIELD_NAMES.length; i++) {
    const name = FIELD_NAMES[i];
    const meta = FIELD_META[name];
    const values = parseFieldPart(parts[i], meta.min, meta.max, name === "weekday");
    if (!values || values.size === 0) return null;
    fields[name] = values;
    raw[name] = parts[i];
  }
  return { fields, raw };
}

function weekdayMatches(field, date) {
  const dow = date.getDay();
  if (field.has(dow === 7 ? 0 : dow)) return true;
  return field.has(7) && dow === 0;
}

function matchesParsed(parsed, date) {
  const { fields, raw } = parsed;
  const minute = fields.minute.has(date.getMinutes());
  const hour = fields.hour.has(date.getHours());
  const month = fields.month.has(date.getMonth() + 1);
  const day = fields.day.has(date.getDate());
  const dow = weekdayMatches(fields.weekday, date);
  const dayRestricted = !raw.day.includes("*");
  const dowRestricted = !raw.weekday.includes("*");
  const dayMatch = dayRestricted && dowRestricted ? day || dow : day && dow;
  return minute && hour && month && dayMatch;
}

function cronMatches(expression, date) {
  const parsed = parseCron(expression);
  if (!parsed) return false;
  return matchesParsed(parsed, date);
}

function nextRunAfter(expression, after) {
  const parsed = parseCron(expression);
  if (!parsed) return null;
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (matchesParsed(parsed, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export function createScheduledTasks({
  homedir = () => os.homedir(),
  now = () => Date.now(),
  broadcast = () => {},
  onFire = () => {},
  tickIntervalMs = 30_000,
} = {}) {
  const dataDir = () => path.join(homedir(), ".config", "ipollowork", "scheduled-tasks");
  const tasksPath = () => path.join(dataDir(), "tasks.json");
  const logsDir = () => path.join(dataDir(), "logs");
  const logPathFor = (taskId) => path.join(logsDir(), `${taskId}.jsonl`);

  function ensureDirs() {
    mkdirSync(logsDir(), { recursive: true });
  }

  function readTasks() {
    try {
      const raw = readFileSync(tasksPath(), "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeTasks(tasks) {
    ensureDirs();
    writeFileSync(tasksPath(), JSON.stringify(tasks, null, 2), "utf8");
  }

  function list() {
    const tasks = readTasks();
    return tasks.map((task) => ({
      ...task,
      nextRunAt: task.enabled && task.cron ? nextRunAfter(task.cron, new Date(now())) : null,
    }));
  }

  function create(input) {
    const tasks = readTasks();
    const id = randomUUID();
    const task = {
      id,
      name: String(input.name ?? "").trim() || "未命名任务",
      description: String(input.description ?? "").trim(),
      cron: String(input.cron ?? "").trim(),
      workspaceId: String(input.workspaceId ?? ""),
      prompt: String(input.prompt ?? "").trim(),
      enabled: input.enabled !== false,
      templateId: input.templateId ? String(input.templateId) : null,
      createdAt: now(),
      lastRunAt: null,
      lastRunStatus: null,
    };
    tasks.push(task);
    writeTasks(tasks);
    broadcast({ type: "changed" });
    return task;
  }

  function update(id, patch) {
    const tasks = readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const task = tasks[index];
    if (patch.name !== undefined) task.name = String(patch.name ?? "").trim() || task.name;
    if (patch.description !== undefined) task.description = String(patch.description ?? "").trim();
    if (patch.cron !== undefined) task.cron = String(patch.cron ?? "").trim();
    if (patch.workspaceId !== undefined) task.workspaceId = String(patch.workspaceId ?? "");
    if (patch.prompt !== undefined) task.prompt = String(patch.prompt ?? "").trim();
    if (patch.enabled !== undefined) task.enabled = Boolean(patch.enabled);
    if (patch.lastRunAt !== undefined) task.lastRunAt = patch.lastRunAt;
    if (patch.lastRunStatus !== undefined) task.lastRunStatus = patch.lastRunStatus;
    tasks[index] = task;
    writeTasks(tasks);
    broadcast({ type: "changed" });
    return task;
  }

  function setEnabled(id, enabled) {
    return update(id, { enabled: Boolean(enabled) });
  }

  function remove(id) {
    const tasks = readTasks();
    const next = tasks.filter((task) => task.id !== id);
    if (next.length === tasks.length) return false;
    writeTasks(next);
    try {
      rmSync(logPathFor(id), { force: true });
    } catch {
      // log cleanup is best-effort
    }
    broadcast({ type: "changed" });
    return true;
  }

  function appendLog(taskId, status, message) {
    ensureDirs();
    const entry = { at: now(), status, message };
    appendFileSync(logPathFor(taskId), `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  function logs(id, limit = 50) {
    try {
      const raw = readFileSync(logPathFor(id), "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      return lines.slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  function fire(task) {
    const entry = appendLog(task.id, "ok", "定时触发，开始执行");
    const updated = update(task.id, { lastRunAt: entry.at, lastRunStatus: "ok" });
    broadcast({ type: "fired", taskId: task.id });
    onFire(updated ?? task);
    return updated ?? task;
  }

  function runNow(id) {
    const task = readTasks().find((item) => item.id === id);
    if (!task) return null;
    return fire(task);
  }

  function preview(cron) {
    if (!parseCron(cron)) return { valid: false, nextRunAt: null };
    return { valid: true, nextRunAt: nextRunAfter(cron, new Date(now())) };
  }

  function tick() {
    const current = new Date(now());
    const minuteStamp = Math.floor(current.getTime() / 60_000);
    for (const task of readTasks()) {
      if (!task.enabled || !task.cron || !cronMatches(task.cron, current)) continue;
      const lastMinute = task.lastRunAt ? Math.floor(task.lastRunAt / 60_000) : null;
      if (lastMinute === minuteStamp) continue;
      fire(task);
    }
  }

  let timer = null;
  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, tickIntervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function dispose() {
    stop();
  }

  return { list, create, update, setEnabled, remove, runNow, logs, preview, start, stop, dispose };
}
