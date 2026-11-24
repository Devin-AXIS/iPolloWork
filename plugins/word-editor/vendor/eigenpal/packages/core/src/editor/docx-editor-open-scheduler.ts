// The open-yield scheduler: one painted frame between "open this document" and the
// blocking mount, so a host's loading screen can actually show.
//
// Opening a document parses, lays out and paints in one synchronous pass — seconds of
// blocked main thread on a long file — and a mount that runs in the same task as
// `load()`/`attach()` blocks the very frame that would have painted the host's loading
// screen. Documents past {@link OPEN_PAINT_YIELD_CONTENT_BYTES} of CONTENT therefore
// schedule the mount behind one painted frame, and `snapshot().isOpening` is true for
// exactly that window. Small documents keep the synchronous path: they need no loading
// flash, and every existing synchronous caller stays as it was. So does every
// environment without `requestAnimationFrame` — headless and server hosts mount
// synchronously by definition.

import { hostTimers, hostWindowOf } from './host-realm.ts';
import { queueTask } from './sliced-steps.ts';

/**
 * The UNCOMPRESSED size past which an open earns a painted loading frame first.
 *
 * Mount cost tracks the content, and the zipped size lies about it: a 200-page
 * tracked-changes document is ~1.6 MB of XML but zips under 90 KiB, while WordprocessingML
 * routinely compresses 10–20×. So the threshold reads the true entry sizes from the ZIP
 * central directory (see {@link zipContentExceeds} — a bounded scan, no decompression).
 * Documents under this mount well inside a frame or two on current hardware; over it,
 * the synchronous mount visibly freezes the page the document was opened from.
 */
const OPEN_PAINT_YIELD_CONTENT_BYTES = 512 * 1024;

/**
 * Whether the ZIP's entries sum past `limit` uncompressed — WITHOUT inflating anything.
 * The central directory records every entry's uncompressed size; walking it costs
 * microseconds on any real document.
 *
 * Attacker-controlled input rules (the bytes come straight from a file): the entry
 * count is a bounded uint16, the walk advances monotonically and bounds-checks every
 * read, the sizes are only summed and compared — never fed to an allocation — and the
 * sum exits early at the limit, so a forged huge size simply means "defer", which the
 * real parser then judges. Anything malformed answers `false` and the open proceeds on
 * the synchronous path, where the parser reports the actual error.
 */
function zipContentExceeds(bytes: Uint8Array, limit: number): boolean {
  const length = bytes.byteLength;
  if (length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  // End-of-central-directory: signature PK\x05\x06, at most 64 KiB of trailing comment.
  const scanFloor = Math.max(0, length - (64 * 1024 + 22));
  let eocd = -1;
  for (let at = length - 22; at >= scanFloor; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return false;
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > length) return false;
    if (view.getUint32(offset, true) !== 0x02014b50) return false;
    // A ZIP64 sentinel (0xFFFFFFFF) sums as huge and exits below: correct — it IS huge.
    total += view.getUint32(offset + 24, true);
    if (total >= limit) return true;
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return false;
}

/**
 * The longest a mount waits for its prepare work. The page stays responsive while it waits,
 * and a mount that starts without the work still completes; it only pays for it later.
 */
export const PREPARED_WORK_WAIT_MS = 2000;

/** What one prepare step leaves: nothing, work to wait for, or the next step. */
type PrepareResult = void | Promise<unknown> | PrepareStep;
type PrepareStep = () => void | Promise<unknown> | PrepareStep;

/** What the facade hands the scheduler; both close over facade-owned state. */
export interface OpenSchedulerHooks {
  /** The real synchronous mount (`mountBytes`). */
  readonly mount: (bytes: Uint8Array) => void;
  /**
   * Optional first half of the mount, run in its own task before `mount`. Parsing a long
   * document and laying it out in ONE task froze the page for long enough to get it
   * reported as unresponsive. `mount` must still work when this has not run, because
   * `flush` mounts at once.
   *
   * A returned promise is work the mount would rather start after, such as font resolution
   * that would otherwise lay the document out a second time. The mount waits for it, but
   * never longer than {@link PREPARED_WORK_WAIT_MS}. A returned function is more work for a
   * task of its own, such as a whole-document scan; its result is what the mount waits for,
   * and the wait starts only once it returns.
   */
  readonly prepare?: (bytes: Uint8Array) => PrepareResult;
  /**
   * Called when a mount is scheduled, and again when a sliced open finishes — the facade
   * bumps and emits here, because `isOpening` moved.
   */
  readonly scheduled: () => void;
  /**
   * Optional slices after `mount`: advance the opening layout for a short while and answer
   * whether it is complete. Each runs in its own task, and the open stays scheduled
   * (`isOpening`) until one answers true. `flush` runs the rest at once.
   */
  readonly continueOpen?: (budgetMs: number) => boolean;
  /**
   * The element the document will paint in. Its window's frames and timers pace the open: a
   * frame requested from a hidden opener never comes, and its timers are throttled. Pending
   * steps follow the element to another window and leave a window that closes.
   */
  readonly node?: () => Node | null;
}

/** One scheduled open: its bytes, whether `mount` already ran, and how to stop it. */
interface ScheduledOpen {
  readonly bytes: Uint8Array;
  mounted(): boolean;
  cancel(): void;
}

/** The work one opening slice aims to do, in milliseconds. */
const OPEN_SLICE_MS = 40;

/** The deferred-mount window, owned by the facade. See the module comment. */
export interface OpenScheduler {
  /** Whether this open is worth (and able to get) a painted frame before the mount. */
  shouldYield(bytes: Uint8Array): boolean;
  /** Schedule the mount behind one painted frame and report the state move. */
  schedule(bytes: Uint8Array): void;
  /** Cancel a scheduled open and hand its bytes back to the caller to re-route. */
  cancel(): Uint8Array | null;
  /**
   * Run a scheduled open NOW. For callers that need the document synchronously — a
   * `save()` or `exec` issued inside the yield window must see the document that was
   * just loaded, not a "no document is loaded" refusal the next frame would disprove.
   */
  flush(): void;
  /** Whether a mount is currently waiting on its frame — `snapshot().isOpening`. */
  isScheduled(): boolean;
}

export function createOpenScheduler(hooks: OpenSchedulerHooks): OpenScheduler {
  let scheduled: ScheduledOpen | null = null;
  const viewOf = (): Window => hostWindowOf(hooks.node?.() ?? null);

  const cancel = (): Uint8Array | null => {
    if (!scheduled) return null;
    const { bytes } = scheduled;
    scheduled.cancel();
    scheduled = null;
    return bytes;
  };

  return {
    // The zipped size is a shortcut, not the measure: a file already past the limit
    // zipped cannot be under it unpacked in any way that mounts fast.
    shouldYield: (bytes) =>
      typeof viewOf().requestAnimationFrame === 'function' &&
      typeof viewOf().cancelAnimationFrame === 'function' &&
      (bytes.byteLength >= OPEN_PAINT_YIELD_CONTENT_BYTES ||
        zipContentExceeds(bytes, OPEN_PAINT_YIELD_CONTENT_BYTES)),

    // `requestAnimationFrame` fires BEFORE the pending paint, so the heavy work goes
    // into a task queued from inside it — the first slot guaranteed to run after the
    // loading screen is on screen. Until then the previous document (if any) stays
    // mounted under the host's overlay. A HIDDEN tab never fires rAF at all, so a
    // plain-timer fallback mounts anyway: a document opened in the background must be
    // there when the tab is next looked at, not still waiting for a frame.
    schedule(bytes) {
      const timers = hostTimers(() => hooks.node?.() ?? null);
      let timer: number | null = null;
      let fallback: number | null = null;
      /** The next prepare step, each in a task of its own; null once preparing is done. */
      let step: PrepareStep | null = hooks.prepare ? () => hooks.prepare!(bytes) : null;
      let cancelled = false;
      let mounted = false;
      // A throw ends the open: it is no longer scheduled, so `isOpening` clears beside the
      // refusal the facade publishes, rather than a spinner running forever behind it.
      const endOnThrow = <T>(work: () => T): T => {
        try {
          return work();
        } catch (error) {
          if (scheduled === entry) {
            scheduled = null;
            hooks.scheduled();
          }
          throw error;
        }
      };
      const run = () => {
        if (cancelled) return;
        if (step) {
          const current = step;
          step = null;
          let work: PrepareResult = undefined;
          try {
            work = current();
          } catch {
            // The mount opens the bytes again and reports the failure itself.
          }
          if (typeof work === 'function') {
            step = work;
            // A message task, not a timer: a chain of nested timers waits 4 ms between steps.
            queueTask(run, viewOf());
            return;
          }
          if (!work) {
            // The mount gets its own task, so input and paint can run in between.
            timer = timers.setTimeout(run, 0);
            return;
          }
          let waiting = true;
          const proceed = () => {
            if (!waiting) return;
            waiting = false;
            if (timer !== null) timers.clearTimeout(timer);
            timer = timers.setTimeout(run, 0);
          };
          timer = timers.setTimeout(proceed, PREPARED_WORK_WAIT_MS);
          work.then(proceed, proceed);
          return;
        }
        mounted = true;
        endOnThrow(() => hooks.mount(bytes));
        const slice = () => {
          if (cancelled || scheduled !== entry) return;
          const done = !hooks.continueOpen || endOnThrow(() => hooks.continueOpen!(OPEN_SLICE_MS));
          // Completion observers can load another document. This slice owns only its entry.
          if (cancelled || scheduled !== entry) return;
          if (!done) {
            queueTask(slice, viewOf());
            return;
          }
          scheduled = null;
          if (hooks.continueOpen) hooks.scheduled();
        };
        if (hooks.continueOpen) queueTask(slice, viewOf());
        else if (scheduled === entry) {
          // The open ends at the mount; `isOpening` moved, so the facade publishes it. A load
          // the mount itself started is another entry, and stays scheduled.
          scheduled = null;
          hooks.scheduled();
        }
      };
      const raf = timers.requestAnimationFrame(() => {
        if (fallback !== null) timers.clearTimeout(fallback);
        fallback = null;
        timer = timers.setTimeout(run, 0);
      });
      fallback = timers.setTimeout(() => {
        timers.cancelAnimationFrame(raf);
        run();
      }, 250);
      const entry: ScheduledOpen = {
        bytes,
        mounted: () => mounted,
        cancel: () => {
          cancelled = true;
          timers.cancelAnimationFrame(raf);
          if (timer !== null) timers.clearTimeout(timer);
          if (fallback !== null) timers.clearTimeout(fallback);
        },
      };
      scheduled = entry;
      hooks.scheduled();
    },

    cancel,

    flush() {
      const entry = scheduled;
      if (!entry) return;
      const alreadyMounted = entry.mounted();
      cancel();
      try {
        if (!alreadyMounted) hooks.mount(entry.bytes);
        if (hooks.continueOpen) while (!hooks.continueOpen(Number.POSITIVE_INFINITY));
      } catch (error) {
        // `isOpening` already cleared above; publish it beside the refusal, then rethrow.
        hooks.scheduled();
        throw error;
      }
      if (alreadyMounted) hooks.scheduled();
    },

    isScheduled: () => scheduled !== null,
  };
}
