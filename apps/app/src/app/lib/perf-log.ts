import { recordDevLog } from "./dev-log";

export type PerfLogRecord = {
  id: number;
  at: string;
  ts: number;
  scope: string;
  event: string;
  payload?: Record<string, unknown>;
};

type PerfRoot = typeof globalThis & {
  __ipollowalkPerfSeq?: number;
  __ipollowalkPerfLogs?: PerfLogRecord[];
  __ipollowalkPerfConsoleAt?: Record<string, number>;
  __ipollowalkPerfConsoleSuppressed?: Record<string, number>;
};

const PERF_LOG_LIMIT = 500;
const HOT_EVENT_MIN_INTERVAL_MS = 750;
const HOT_EVENT_KEYS = new Set([
  "session.sse:flush",
  "session.sse:arrival-gap",
  "session.event:message.part.delta",
  "session.event:message.part.updated",
  "session.compaction:synthetic-continue",
  "session.input:draft-flush",
  "session.render:message-blocks",
  "session.render:tool-summary",
  "session.render:batch-commit",
  "session.main-thread:lag",
  "session.window:state",
]);

export const perfNow = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const round = (value: number) => Math.round(value * 100) / 100;

export const recordPerfLog = (
  enabled: boolean,
  scope: string,
  event: string,
  payload?: Record<string, unknown>,
) => {
  if (!enabled) return;

  const root = globalThis as PerfRoot;
  const id = (root.__ipollowalkPerfSeq ?? 0) + 1;
  root.__ipollowalkPerfSeq = id;

  const entry: PerfLogRecord = {
    id,
    at: new Date().toISOString(),
    ts: Date.now(),
    scope,
    event,
    payload,
  };

  const logs = root.__ipollowalkPerfLogs ?? [];
  logs.push(entry);
  if (logs.length > PERF_LOG_LIMIT) {
    logs.splice(0, logs.length - PERF_LOG_LIMIT);
  }
  root.__ipollowalkPerfLogs = logs;
  recordDevLog(enabled, {
    level: "perf",
    source: scope,
    label: event,
    payload,
  });

  try {
    const key = `${scope}:${event}`;
    const now = Date.now();
    const lastByKey = root.__ipollowalkPerfConsoleAt ?? (root.__ipollowalkPerfConsoleAt = {});
    const suppressedByKey =
      root.__ipollowalkPerfConsoleSuppressed ?? (root.__ipollowalkPerfConsoleSuppressed = {});
    if (HOT_EVENT_KEYS.has(key)) {
      const last = lastByKey[key] ?? 0;
      if (now - last < HOT_EVENT_MIN_INTERVAL_MS) {
        suppressedByKey[key] = (suppressedByKey[key] ?? 0) + 1;
        return;
      }
    }

    lastByKey[key] = now;
    const suppressed = suppressedByKey[key] ?? 0;
    if (suppressed > 0) {
      suppressedByKey[key] = 0;
    }

    if (payload === undefined) {
      if (suppressed > 0) {
        console.log(`[OWPERF] ${scope}:${event}`, { suppressed });
        return;
      }
      console.log(`[OWPERF] ${scope}:${event}`);
      return;
    }

    if (suppressed > 0) {
      console.log(`[OWPERF] ${scope}:${event}`, { ...payload, suppressed });
      return;
    }

    console.log(`[OWPERF] ${scope}:${event}`, payload);
  } catch {
    // ignore
  }
};

export const readPerfLogs = (limit = 120) => {
  const root = globalThis as PerfRoot;
  const logs = root.__ipollowalkPerfLogs ?? [];
  if (limit <= 0) return [];
  if (logs.length <= limit) return logs.slice();
  return logs.slice(logs.length - limit);
};

export const clearPerfLogs = () => {
  const root = globalThis as PerfRoot;
  root.__ipollowalkPerfLogs = [];
  root.__ipollowalkPerfSeq = 0;
};

export const finishPerf = (
  enabled: boolean,
  scope: string,
  event: string,
  startedAt: number,
  payload?: Record<string, unknown>,
) => {
  if (!enabled) return;
  recordPerfLog(enabled, scope, event, {
    ...(payload ?? {}),
    ms: round(perfNow() - startedAt),
  });
};
