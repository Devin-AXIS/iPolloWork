/**
 * The editor's session diagnostics: when an editor starts and ends, how long it was used, and
 * how many edits it committed.
 *
 * Activity collects per editor and leaves as one `session` diagnostic per window of use, never
 * one event per key press or edit. A summary holds counts and milliseconds only: no key, no
 * position, no command argument, no text.
 */
import type { SessionActivity, SessionDiagnostic } from '../contracts/diagnostics.ts';
import type { DiagnosticPayload } from '@docx-editor.dev/core/automation';

/** A window closes this long after its first activity. */
const WINDOW_MS = 60_000;
/** Activity this far apart or closer counts as continuous use; a longer pause is idle. */
export const SESSION_IDLE_MS = 30_000;

/** Where a committed edit came from. */
export type SessionEditOrigin = 'input' | 'command' | 'automation';

/** The scheduling the tracker needs; tests pass their own. */
export interface SessionClock {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface SessionTrackerOptions {
  readonly deliver: (payload: DiagnosticPayload<SessionDiagnostic>) => void;
  /**
   * Whether anyone listens, read once when the session starts. A session no one heard start
   * sends nothing later, so every `end` has its `start`.
   */
  readonly enabled: () => boolean;
  readonly windowMs?: number;
  readonly clock?: SessionClock;
}

export type SessionTracker = ReturnType<typeof createSessionTracker>;

function browserClock(): SessionClock {
  return {
    now: () => globalThis.performance?.now() ?? Date.now(),
    setTimer: (callback, ms) => {
      const timer = globalThis.setTimeout(callback, ms);
      // A pending summary must not keep a server process alive.
      (timer as { unref?: () => void }).unref?.();
      return timer;
    },
    clearTimer: (timer) =>
      globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
  };
}

type Counts = { -readonly [K in keyof Omit<SessionActivity, 'durationMs'>]: number };

const empty = (): Counts => ({ activeMs: 0, inputEdits: 0, commandEdits: 0, automationEdits: 0 });

const EDIT_FIELD = {
  input: 'inputEdits',
  command: 'commandEdits',
  automation: 'automationEdits',
} as const satisfies Record<SessionEditOrigin, keyof Counts>;

/**
 * One tracker per editor instance. Sends `start` on the next microtask, so a listener added right
 * after creation hears it.
 */
export function createSessionTracker(options: SessionTrackerOptions) {
  const clock = options.clock ?? browserClock();
  const windowMs = options.windowMs ?? WINDOW_MS;
  const created = clock.now();
  let window = empty();
  const totals = empty();
  let windowStart: number | null = null;
  let timer: unknown = null;
  let lastActivity: number | null = null;
  let ended = false;
  let started = false;

  queueMicrotask(() => {
    if (ended || !options.enabled()) return;
    started = true;
    options.deliver({ kind: 'session', phase: 'start' });
  });

  /** Send what the window holds, if anything, and start an empty one. */
  function flush(): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    const start = windowStart;
    windowStart = null;
    const counts = window;
    window = empty();
    if (start === null || !started) return;
    for (const key of Object.keys(counts) as (keyof Counts)[]) totals[key] += counts[key];
    options.deliver({
      kind: 'session',
      phase: 'active',
      durationMs: Math.max(0, Math.round(clock.now() - start)),
      ...counts,
      activeMs: Math.round(counts.activeMs),
    });
  }

  function activity(): void {
    if (ended) return;
    const now = clock.now();
    if (lastActivity !== null && now - lastActivity <= SESSION_IDLE_MS)
      window.activeMs += Math.max(0, now - lastActivity);
    lastActivity = now;
    if (windowStart === null) {
      windowStart = now;
      timer = clock.setTimer(flush, windowMs);
    }
  }

  const onVisibility = (): void => {
    if ((globalThis as { document?: Document }).document?.visibilityState === 'hidden') flush();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);

  function end(): void {
    if (ended) return;
    flush();
    ended = true;
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
    if (!started) return;
    options.deliver({
      kind: 'session',
      phase: 'end',
      durationMs: Math.max(0, Math.round(clock.now() - created)),
      ...totals,
      activeMs: Math.round(totals.activeMs),
    });
  }

  return {
    /** A key press or pointer press on the pages. */
    activity,
    /** An edit this editor committed. */
    edit(origin: SessionEditOrigin): void {
      if (ended) return;
      window[EDIT_FIELD[origin]] += 1;
      activity();
    },
    flush,
    /** Send the last summary and the totals, then stop. */
    end,
  };
}
