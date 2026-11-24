// A scheduled open that throws is no longer scheduled. Without this, `isOpening` stayed true
// beside the refusal the facade publishes, and the loading screen spun behind the alert.
//
// The scheduler's tasks run on frames and timers. These tests queue them by hand, so a throw
// surfaces in the test instead of as an uncaught error between tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createOpenScheduler } from '../docx-editor-open-scheduler.ts';

type Task = () => void;
let tasks: { id: number; run: Task }[] = [];
let nextId = 1;
const saved = {
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  MessageChannel: globalThis.MessageChannel,
};

beforeEach(() => {
  tasks = [];
  const queue = (run: Task) => {
    const id = nextId++;
    tasks.push({ id, run });
    return id;
  };
  const drop = (id: number) => {
    tasks = tasks.filter((task) => task.id !== id);
  };
  Object.assign(globalThis, {
    requestAnimationFrame: queue,
    cancelAnimationFrame: drop,
    setTimeout: queue,
    clearTimeout: drop,
    MessageChannel: undefined,
  });
});

afterEach(() => {
  Object.assign(globalThis, saved);
});

/** Run queued tasks in order, returning the first throw. */
function runTasks(): unknown {
  while (tasks.length > 0) {
    const next = tasks.shift()!;
    try {
      next.run();
    } catch (error) {
      return error;
    }
  }
  return null;
}

describe('a scheduled open that throws', () => {
  test('a throwing mount ends the open and publishes it', () => {
    const events: string[] = [];
    const scheduler = createOpenScheduler({
      mount: () => {
        throw new Error('mount failed');
      },
      scheduled: () => events.push('scheduled'),
    });
    scheduler.schedule(new Uint8Array(1));
    expect(scheduler.isScheduled()).toBe(true);
    expect((runTasks() as Error).message).toBe('mount failed');
    expect(scheduler.isScheduled()).toBe(false);
    expect(events).toEqual(['scheduled', 'scheduled']);
  });

  test('a throwing layout slice ends the open and publishes it', () => {
    const events: string[] = [];
    const scheduler = createOpenScheduler({
      mount: () => events.push('mount'),
      continueOpen: () => {
        throw new Error('slice failed');
      },
      scheduled: () => events.push('scheduled'),
    });
    scheduler.schedule(new Uint8Array(1));
    expect((runTasks() as Error).message).toBe('slice failed');
    expect(scheduler.isScheduled()).toBe(false);
    expect(events).toEqual(['scheduled', 'mount', 'scheduled']);
  });

  test('a flush whose mount throws publishes the ended open', () => {
    const events: string[] = [];
    const scheduler = createOpenScheduler({
      mount: () => {
        throw new Error('mount failed');
      },
      scheduled: () => events.push('scheduled'),
    });
    scheduler.schedule(new Uint8Array(1));
    expect(() => scheduler.flush()).toThrow('mount failed');
    expect(scheduler.isScheduled()).toBe(false);
    expect(events).toEqual(['scheduled', 'scheduled']);
  });
});
