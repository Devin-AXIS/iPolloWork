// Run engine work that comes as steps (`Generator<void, T>`) in short tasks.
//
// Saving a long document is seconds of work. Run in one task, it freezes typing, scrolling
// and every other script on the page until it ends. Run here, it advances for a few
// milliseconds at a time and gives the page a turn in between, so input stays responsive.
// Work that finishes inside its first slice, such as saving a short document, completes
// without giving up its turn at all.

import { hostWindowOf } from './host-realm.ts';

/** The work one slice aims to do, in milliseconds. Short enough to keep typing responsive. */
export const STEP_SLICE_MS = 12;

/**
 * Queue `run` as a new task. A message port, not a timer: nested timers are clamped to 4 ms
 * each, which a few hundred slices would turn into idle seconds, and a hidden page throttles
 * timers to one a second.
 */
export function queueTask(run: () => void, view: Window): void {
  if (typeof MessageChannel !== 'function') {
    view.setTimeout(run, 0);
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    run();
  };
  channel.port2.postMessage(null);
}

/**
 * Drive `steps` to completion in slices of about `sliceMs`, each in its own task.
 *
 * `node` names the window whose task queue paces the work, so an editor in a pop-out window
 * yields to that window. The promise rejects with whatever a step throws.
 */
export function runStepsInSlices<T>(
  steps: Generator<void, T>,
  node: Node | null,
  sliceMs: number = STEP_SLICE_MS
): Promise<T> {
  // Any window's clock will do: only differences between two readings are used.
  const clock = globalThis.performance ?? Date;
  return new Promise<T>((resolve, reject) => {
    const slice = (): void => {
      const deadline = clock.now() + sliceMs;
      try {
        for (;;) {
          const next = steps.next();
          if (next.done) {
            resolve(next.value);
            return;
          }
          if (clock.now() >= deadline) break;
        }
      } catch (error) {
        reject(error);
        return;
      }
      queueTask(slice, hostWindowOf(node));
    };
    slice();
  });
}
