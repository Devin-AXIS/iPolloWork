// The background half of a large open: the surface is mounted and takes input, and its
// remaining pages lay out in short tasks (`surface-progressive-open.ts`).
//
// The open itself ended at the mount, so nothing here holds the document's bytes: a detach,
// an attach to another container, or an edit keeps the live surface. The tasks belong to the
// surface they started for, and stop once the facade holds another one; a destroyed surface
// cleans up its own opening state.

import { continueProgressiveOpen, progressiveOpenPending } from './surface-progressive-open.ts';

/** The work one background task aims to do, in milliseconds: room for a frame and for input. */
const OPENING_SLICE_MS = 12;

export interface OpeningLayoutHooks {
  /** The surface the facade holds now; the tasks stop once it is another one. */
  current(): object | null;
  /** The window the pages paint in: its tasks are the ones that run while it is visible. */
  view(): Window;
  /** Run one slice; the facade reports a throw as a failed open. */
  slice(run: () => boolean): boolean;
  /** The last page is laid out. */
  settled(): void;
}

function queueTask(run: () => void, view: Window): void {
  if (typeof MessageChannel === 'function') {
    // A message task, not a timer: a chain of nested timers waits 4 ms between steps.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      run();
    };
    channel.port2.postMessage(null);
    return;
  }
  view.setTimeout(run, 0);
}

/** Lay out `surface`'s remaining pages in background tasks, if it has any. */
export function continueOpeningLayout(surface: object, hooks: OpeningLayoutHooks): void {
  if (!progressiveOpenPending(surface)) return;
  const slice = (): void => {
    if (hooks.current() !== surface || !progressiveOpenPending(surface)) return;
    if (hooks.slice(() => continueProgressiveOpen(surface, OPENING_SLICE_MS))) hooks.settled();
    else queueTask(slice, hooks.view());
  };
  queueTask(slice, hooks.view());
}

/** An external refresh still opening when the mount ended: the host hears how the open ended. */
export interface OpeningRefresh {
  /** The refreshed bytes, once; null when this open is not a refresh. */
  take(): Uint8Array | null;
  /** Report a failed open. */
  crashed(error: unknown): void;
  /** Tell the refresh host the open ended, with its error when it failed. */
  mounted(bytes: Uint8Array, error?: unknown): void;
}

/**
 * `hooks`, with a refresh's ending reported to its host: on the last page once the open
 * settles, or with the error a slice threw. A failed refresh is not reported as settled, and
 * an open that is not a refresh throws as before.
 */
export function withOpeningRefresh(
  hooks: OpeningLayoutHooks,
  refresh: OpeningRefresh
): OpeningLayoutHooks {
  let failed = false;
  return {
    ...hooks,
    slice: (run) => {
      try {
        return hooks.slice(run);
      } catch (error) {
        const bytes = refresh.take();
        if (!bytes) throw error;
        refresh.crashed(error);
        refresh.mounted(bytes, error);
        failed = true;
        return true;
      }
    },
    settled: () => {
      if (failed) return;
      const bytes = refresh.take();
      hooks.settled();
      if (bytes) refresh.mounted(bytes);
    },
  };
}
