import {
  lateAnswerFailures,
  lateAnswerHasFaces,
  mergeDeferredAnswer,
  withoutReportedFailures,
} from '../layout/font-deferred.ts';
import { fontRequestKey } from '../layout/font-resource.ts';
import type { FontConfigurationFragment } from './font-composition.ts';

/**
 * How long late faces may hold `resolving` and the substitution notice. A stalled download
 * must not leave a loading indicator spinning for the whole document. Faces that arrive
 * after this still install.
 */
export const LATE_FONT_WAIT_MS = 10_000;

/**
 * The origins a late installation composes. `full` is the whole composition again, already
 * first-wins, so it leads; faces a live resolution added since only fill what it lacks.
 * Failures were reported when each answer arrived, so neither carries them again.
 */
export function lateFontOrigins(
  full: FontConfigurationFragment,
  installed: FontConfigurationFragment | undefined
): readonly FontConfigurationFragment[] {
  return installed ? [full, withoutReportedFailures(installed)] : [full];
}

/**
 * Whether `installed` already holds every face and substitution `full` would install. A late
 * answer can arrive twice, when a live resolution asked again before the first one landed;
 * the second must not lay the document out again for nothing.
 */
export function lateFacesInstalled(
  full: FontConfigurationFragment,
  installed: FontConfigurationFragment | undefined
): boolean {
  if (!installed) return false;
  try {
    const sources = new Set(
      (installed.sources ?? []).map((entry) => fontRequestKey(entry.request))
    );
    const routes = new Set(
      (installed.substitutions ?? []).map(
        (entry) => `${fontRequestKey(entry.from)}>${fontRequestKey(entry.to)}`
      )
    );
    return (
      (full.sources ?? []).every((entry) => sources.has(fontRequestKey(entry.request))) &&
      (full.substitutions ?? []).every((entry) =>
        routes.has(`${fontRequestKey(entry.from)}>${fontRequestKey(entry.to)}`)
      )
    );
  } catch {
    // A face key this cannot form is left to composition, which reports it.
    return false;
  }
}

/** Late faces queued for installation, with the token that tracks them until they install. */
export interface LateFontDelivery {
  readonly full: FontConfigurationFragment;
  readonly token: object;
}

/**
 * Tracks faces a font origin delivers after the first paint, from the promise to the end of
 * their installation. `pending()` holds until the last one installs, so `resolving` cannot
 * read false between the download and the layout that uses it, and for at most
 * {@link LATE_FONT_WAIT_MS}.
 */
export function createLateFontArrival(options: {
  readonly deliver: (generation: number, delivery: LateFontDelivery) => void;
  readonly changed: () => void;
  /** Failures a raw resolver's late answer carries; a composition reported its own. */
  readonly report: (cause: unknown) => void;
  /** Overrides {@link LATE_FONT_WAIT_MS}; for tests. */
  readonly waitMs?: number;
  /**
   * When this user last changed the document (`performance.now()`). An install lays the
   * document out again, so late faces wait for a pause in editing (`whenEditsPause`), for at
   * most {@link EDIT_PAUSE_MAX_MS}. Omitted, they install when they arrive.
   */
  readonly editedAt?: () => number;
}) {
  const timers = new Map<object, ReturnType<typeof globalThis.setTimeout>>();
  /** Stop waiting for `token`; `quiet` when the caller announces the change itself. */
  const settle = (token: object, quiet = false): void => {
    const timer = timers.get(token);
    if (timer === undefined) return;
    globalThis.clearTimeout(timer);
    timers.delete(token);
    if (!quiet) options.changed();
  };
  return {
    pending: (): boolean => timers.size > 0,
    /** Forget every load's late faces; a new document or font configuration starts with none. */
    clear: (): void => {
      for (const timer of timers.values()) globalThis.clearTimeout(timer);
      timers.clear();
    },
    /**
     * Stop waiting for `delivery`, quietly: call it just BEFORE installing it, so the one
     * announcement the installation makes already reads `resolving` and the notice correctly.
     */
    settle: (delivery: LateFontDelivery | undefined): void => {
      if (delivery) settle(delivery.token, true);
    },
    /**
     * Queue `later` for installation once it lands, unless the load moved on (`current`). It
     * merges into `installed`, the answer it was split from, so a raw resolver's late faces
     * install with its immediate ones. An arrival with nothing in it installs nothing and
     * lays nothing out. A host promise that rejects counts as nothing arriving.
     */
    track(
      later: Promise<FontConfigurationFragment | undefined>,
      installed: FontConfigurationFragment | undefined,
      generation: number,
      current: () => boolean
    ): void {
      const token = {};
      timers.set(
        token,
        // A timer, not DOM work: any window's clock will do.
        globalThis.setTimeout(() => settle(token), options.waitMs ?? LATE_FONT_WAIT_MS)
      );
      later.then(
        (arrived) => {
          if (!current()) return settle(token);
          let full: FontConfigurationFragment;
          try {
            // A raw resolver's late answer is untrusted shape: anything but an object is
            // nothing arriving, and one that cannot merge is a failure to report, never an
            // unhandled rejection with the wait left holding.
            if (typeof arrived !== 'object' || arrived === null) return settle(token);
            for (const cause of lateAnswerFailures(arrived)) options.report(cause);
            if (!lateAnswerHasFaces(arrived)) return settle(token);
            full = mergeDeferredAnswer(installed, arrived) as FontConfigurationFragment;
          } catch (cause) {
            options.report(cause);
            return settle(token);
          }
          if (!options.editedAt) return options.deliver(generation, { full, token });
          void whenEditsPause(options.editedAt).then(() =>
            current() ? options.deliver(generation, { full, token }) : settle(token)
          );
        },
        () => settle(token)
      );
    },
  };
}

/** How long editing must pause before late faces install. */
export const EDIT_PAUSE_MS = 1000;

/** The longest late faces wait for a pause: text that needs them must not wait forever. */
export const EDIT_PAUSE_MAX_MS = 3000;

/**
 * Resolves once `changedAt()` (a `performance.now()` time) is `pauseMs` in the past, or after
 * `maxMs` at most.
 */
export function whenEditsPause(
  changedAt: () => number,
  pauseMs = EDIT_PAUSE_MS,
  maxMs = EDIT_PAUSE_MAX_MS
): Promise<void> {
  const deadline = performance.now() + maxMs;
  return new Promise((resolve) => {
    const check = (): void => {
      const wait = Math.min(changedAt() + pauseMs, deadline) - performance.now();
      // A timer, not DOM work: any window's clock will do.
      if (wait > 0) globalThis.setTimeout(check, wait);
      else resolve();
    };
    check();
  });
}
