/** Coalesced deferred notifier for editor state ticks. @internal */

/**
 * How many consecutive notification WAVES may take the microtask path before the next one
 * yields through a task.
 *
 * A wave is one event-loop task's worth of notifications (every subscriber a single commit
 * notifies shares one wave). React's maximum-update-depth guard counts synchronous store
 * updates that reach it without a real yield, and sustained hardware input against a fast
 * engine can chain waves past that limit even though every update is a legitimate
 * keystroke: `isInputPending` reads false the moment the backlog is already dispatched
 * into tasks, so the pending-input check alone cannot break the chain. The streak resets
 * whenever a yielded task gets to run — a task running IS the yield React needs.
 */
const MAX_MICROTASK_WAVES_BEFORE_YIELD = 16;

let waveStreak = 0;
let waveOpen = false;
let streakResetArmed = false;

/**
 * Run `task` in a later event-loop task, through a message rather than a timer.
 *
 * Module-level code cannot know which window the editor is in, and the script's own timers
 * belong to the opener when the editor renders into a pop-out window: a hidden or minimized
 * opener throttles them to one run a second or slower. Message tasks are not throttled, so
 * a pop-out editor's chrome keeps up with typing.
 */
let pendingTasks: (() => void)[] = [];
let taskChannel: MessageChannel | null = null;
export function yieldTask(task: () => void): void {
  if (typeof MessageChannel !== 'function') {
    // Same throttling caveat; only engines without channels take this path.
    globalThis.setTimeout(task, 0);
    return;
  }
  if (!taskChannel) {
    taskChannel = new MessageChannel();
    taskChannel.port1.onmessage = () => {
      const tasks = pendingTasks;
      pendingTasks = [];
      for (const run of tasks) {
        // One failing subscriber must not strand the others' notifications.
        try {
          run();
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    };
  }
  pendingTasks.push(task);
  if (pendingTasks.length === 1) taskChannel.port2.postMessage(null);
}

/** Decide the scheduling lane for one coalesced notification. @internal */
export function notificationYieldsToTask(): boolean {
  const scheduling = (
    globalThis as typeof globalThis & {
      navigator?: {
        scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean };
      };
    }
  ).navigator?.scheduling;
  // Without the Scheduling API there is no input-driven cascade to break — test
  // environments and non-Chromium engines keep the legacy immediate path, and the wave
  // counter must not accrue where timers may never run to reset it. The residual case is a
  // REAL Chromium page under FAKED timers (Playwright clock.install): 17 waves would pin
  // every notification behind the fake clock until it advances. No repo test does that;
  // one that must should also stub `navigator.scheduling`.
  if (typeof scheduling?.isInputPending !== 'function') return false;
  if (scheduling.isInputPending({ includeContinuous: true })) return true;
  if (!waveOpen) {
    waveOpen = true;
    waveStreak += 1;
    // Closes at this task's microtask checkpoint, so notifications from a later task open
    // a new wave.
    queueMicrotask(() => {
      waveOpen = false;
    });
    if (!streakResetArmed) {
      streakResetArmed = true;
      yieldTask(() => {
        streakResetArmed = false;
        waveStreak = 0;
      });
    }
  }
  return waveStreak > MAX_MICROTASK_WAVES_BEFORE_YIELD;
}

export function deferredTick(notify: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      notify();
    };
    if (notificationYieldsToTask()) yieldTask(flush);
    else queueMicrotask(flush);
  };
}
