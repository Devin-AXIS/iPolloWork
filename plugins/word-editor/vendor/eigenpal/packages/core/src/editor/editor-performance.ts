/**
 * The editor's performance summaries: how long the engine took to lay out and paint, and how
 * long a key press or a pointer press on the pages took to reach the screen.
 *
 * Timings collect per editor and leave as one `performance` diagnostic per window, never one
 * event per key press. A summary holds counts and milliseconds only: no key, no position, no
 * text.
 */
import type { PerformanceDiagnostic, TimingSummary } from '../contracts/diagnostics.ts';
import { countBucket, type DiagnosticPayload } from '@docx-editor.dev/core/automation';

/** Upper bounds of the summary bands, in milliseconds. A last band counts everything above. */
export const TIMING_BANDS_MS: readonly number[] = Object.freeze([16, 33, 50, 100, 200, 500, 1000]);

/** Timings kept per series for percentiles. Counts, bands, and the maximum stay exact. */
const RESERVOIR = 2048;
/** A window closes this long after its first timing. */
const WINDOW_MS = 60_000;
/** The 95th percentile of key presses above which a summary carries a code. */
const SLOW_INTERACTION_MS = 200;
/** Fewer presses than this are too few for a percentile to mean slow. */
const SLOW_INTERACTION_MIN_COUNT = 20;
/** Presses kept waiting for one frame. A burst beyond it is timed from its first presses. */
const MAX_PENDING_PRESSES = 256;
/** A press that takes longer than this to reach the screen was not measured: the page slept. */
const MAX_INTERACTION_MS = 60_000;

type Series = 'interaction' | 'layout' | 'paint';

interface Collected {
  count: number;
  max: number;
  readonly bands: number[];
  readonly samples: number[];
}

/** The scheduling the sampler needs; tests pass their own. */
export interface PerformanceClock {
  readonly now: () => number;
  /**
   * Calls `onFrame` when the next frame starts, before the browser paints it, and `onPainted`
   * after it is on screen. Returns false when there are no frames.
   */
  readonly afterNextFrame: (onFrame: () => void, onPainted: () => void) => boolean;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface PerformanceSamplerOptions {
  readonly deliver: (payload: DiagnosticPayload<PerformanceDiagnostic>) => void;
  /** Whether anyone listens. Nothing is measured while this is false. */
  readonly enabled: () => boolean;
  readonly windowMs?: number;
  readonly clock?: PerformanceClock;
}

export type PerformanceSampler = ReturnType<typeof createPerformanceSampler>;

function browserClock(): PerformanceClock {
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  return {
    now,
    afterNextFrame(onFrame, onPainted) {
      const frame = globalThis.requestAnimationFrame;
      if (typeof frame !== 'function') return false;
      // The frame callback runs before the browser paints; a task queued from it runs after.
      frame(() => {
        onFrame();
        globalThis.setTimeout(onPainted, 0);
      });
      return true;
    },
    setTimer(callback, ms) {
      const timer = globalThis.setTimeout(callback, ms);
      (timer as { unref?: () => void }).unref?.();
      return timer;
    },
    clearTimer: (timer) =>
      globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
  };
}

function empty(): Collected {
  return { count: 0, max: 0, bands: new Array(TIMING_BANDS_MS.length + 1).fill(0), samples: [] };
}

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
}

function summarize(series: Collected): TimingSummary {
  const sorted = [...series.samples].sort((a, b) => a - b);
  return Object.freeze({
    count: series.count,
    p50Ms: Math.round(percentile(sorted, 0.5)),
    p95Ms: Math.round(percentile(sorted, 0.95)),
    maxMs: Math.round(series.max),
    bands: Object.freeze([...series.bands]),
  });
}

/** One sampler per editor instance. */
export function createPerformanceSampler(options: PerformanceSamplerOptions) {
  const clock = options.clock ?? browserClock();
  const windowMs = options.windowMs ?? WINDOW_MS;
  let collected: Record<Series, Collected> = {
    interaction: empty(),
    layout: empty(),
    paint: empty(),
  };
  let windowStart: number | null = null;
  let timer: unknown = null;
  let pages: number | null = null;
  /** Start times of the presses that wait for the next frame on screen. */
  let pendingPresses: number[] = [];
  let disposed = false;

  function add(series: Series, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const target = collected[series];
    target.count += 1;
    target.max = Math.max(target.max, ms);
    const band = TIMING_BANDS_MS.findIndex((bound) => ms <= bound);
    target.bands[band === -1 ? TIMING_BANDS_MS.length : band]! += 1;
    // Reservoir sampling keeps a uniform sample of a long window in bounded memory.
    if (target.samples.length < RESERVOIR) target.samples.push(ms);
    else {
      const slot = Math.floor(Math.random() * target.count);
      if (slot < RESERVOIR) target.samples[slot] = ms;
    }
    if (windowStart === null) {
      windowStart = clock.now();
      timer = clock.setTimer(flush, windowMs);
    }
  }

  /** Send what the window holds, if anything, and start an empty one. */
  function flush(): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    const start = windowStart;
    windowStart = null;
    const window = collected;
    collected = { interaction: empty(), layout: empty(), paint: empty() };
    if (start === null) return;
    const summary: { -readonly [K in Series]?: TimingSummary } = {};
    for (const series of ['interaction', 'layout', 'paint'] as const)
      if (window[series].count > 0) summary[series] = summarize(window[series]);
    const slow =
      (summary.interaction?.count ?? 0) >= SLOW_INTERACTION_MIN_COUNT &&
      summary.interaction!.p95Ms > SLOW_INTERACTION_MS;
    options.deliver({
      kind: 'performance',
      ...(slow ? { code: 'performance.slow-interaction' as const } : {}),
      windowMs: Math.max(0, Math.round(clock.now() - start)),
      ...(pages === null ? {} : { pagesBucket: countBucket(pages) }),
      ...summary,
    });
  }

  const onHidden = (): void => {
    if ((globalThis as { document?: Document }).document?.visibilityState !== 'hidden') return;
    // A hidden page draws no frames: a press waiting now would be timed with the hidden time.
    pendingPresses = [];
    flush();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onHidden);
  const hidden = (): boolean =>
    (globalThis as { document?: Document }).document?.visibilityState === 'hidden';

  return {
    /** One timing from the surface: milliseconds for layout and paint, a timestamp for input. */
    timing(phase: 'layout' | 'paint' | 'input', value: number, pageCount?: () => number): void {
      if (disposed || !options.enabled()) return;
      if (pageCount) pages = pageCount();
      if (phase !== 'input') {
        add(phase, value);
        return;
      }
      // A hidden page draws no frames, so its presses cannot be timed to one.
      if (pendingPresses.length >= MAX_PENDING_PRESSES || hidden()) return;
      const now = clock.now();
      // An event timestamp shares the clock of `performance.now()` in browsers; one that does
      // not (zero, or in the future) is replaced by the time the surface heard the press.
      const start = value > 0 && value <= now ? value : now;
      pendingPresses.push(start);
      // Every press waiting is timed to the same frame, so presses queued behind a long task
      // count with their full delay.
      if (pendingPresses.length > 1) return;
      const waiting = pendingPresses;
      let closed = false;
      const scheduled = clock.afterNextFrame(
        () => {
          // A hidden page dropped these presses; a newer batch waits for its own frame.
          if (waiting !== pendingPresses) return;
          // The batch closes as this frame starts: a press after it waits for the next frame.
          pendingPresses = [];
          closed = true;
        },
        () => {
          if (!closed || disposed) return;
          const end = clock.now();
          for (const pressed of waiting)
            if (end - pressed <= MAX_INTERACTION_MS) add('interaction', end - pressed);
        }
      );
      if (!scheduled) pendingPresses = [];
    },
    flush,
    /** Send the last summary and stop. */
    dispose(): void {
      if (disposed) return;
      flush();
      disposed = true;
      globalThis.document?.removeEventListener?.('visibilitychange', onHidden);
    },
  };
}
