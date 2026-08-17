import { describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import {
  canTransitionTask,
  createTaskStore,
  isTerminalTaskState,
  TASK_STATES,
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATES,
  type TaskEvent,
  type TaskState,
  type TaskStore,
} from "./store.js";

function createHarness() {
  let clock = 1_000;
  let counter = 0;
  const store = createTaskStore({
    now: () => clock,
    newId: () => `task_${++counter}`,
  });
  return {
    store,
    tick(by = 1): number {
      clock += by;
      return clock;
    },
    get clock() {
      return clock;
    },
  };
}

function addTask(store: TaskStore, overrides: { workspaceId?: string; goal?: string } = {}) {
  return store.add({
    workspaceId: overrides.workspaceId ?? "w1",
    goal: overrides.goal ?? "Ship the thing",
  });
}

/** Walks a fresh task to `state` using only legal transitions. */
function taskInState(store: TaskStore, state: TaskState, workspaceId = "w1") {
  const task = store.add({ workspaceId, goal: `reach ${state}` });
  const path: Record<TaskState, TaskState[]> = {
    queued: [],
    running: ["running"],
    awaiting_approval: ["running", "awaiting_approval"],
    done: ["running", "done"],
    failed: ["failed"],
    cancelled: ["cancelled"],
  };
  let current = task;
  for (const next of path[state]) current = store.update(task.id, { state: next });
  expect(current.state).toBe(state);
  return current;
}

describe("task state machine constants", () => {
  test("declares a transition list for every state", () => {
    for (const state of TASK_STATES) {
      expect(Array.isArray(TASK_TRANSITIONS[state])).toBe(true);
    }
  });

  test("terminal states accept no transition", () => {
    for (const state of TERMINAL_TASK_STATES) {
      expect(TASK_TRANSITIONS[state]).toEqual([]);
      expect(isTerminalTaskState(state)).toBe(true);
    }
  });

  test("the happy path and both approval directions are legal", () => {
    expect(canTransitionTask("queued", "running")).toBe(true);
    expect(canTransitionTask("running", "awaiting_approval")).toBe(true);
    expect(canTransitionTask("awaiting_approval", "running")).toBe(true);
    expect(canTransitionTask("running", "done")).toBe(true);
  });

  test("done is only reachable from running", () => {
    for (const state of TASK_STATES) {
      expect(canTransitionTask(state, "done")).toBe(state === "running");
    }
  });

  test("failed and cancelled are reachable from every live state", () => {
    for (const state of ["queued", "running", "awaiting_approval"] as const) {
      expect(canTransitionTask(state, "failed")).toBe(true);
      expect(canTransitionTask(state, "cancelled")).toBe(true);
    }
  });
});

describe("add", () => {
  test("creates a queued task with documented defaults", () => {
    const { store } = createHarness();
    const task = addTask(store);

    expect(task).toMatchObject({
      id: "task_1",
      workspaceId: "w1",
      state: "queued",
      goal: "Ship the thing",
      agent: null,
      model: null,
      approvalPolicy: "auto",
      timeoutMs: null,
      sessionId: null,
      engineId: null,
      summary: "",
      artifacts: [],
      pendingPermissions: [],
      error: null,
      cancelReason: null,
      startedAt: null,
      completedAt: null,
    });
    expect(store.size).toBe(1);
  });

  test("trims the goal and rejects an empty one", () => {
    const { store } = createHarness();
    expect(store.add({ workspaceId: "w1", goal: "  hello  " }).goal).toBe("hello");
    expect(() => store.add({ workspaceId: "w1", goal: "   " })).toThrow(/must not be empty/);
  });

  test("rejects a duplicate id", () => {
    const { store } = createHarness();
    store.add({ workspaceId: "w1", goal: "a", id: "fixed" });
    try {
      store.add({ workspaceId: "w1", goal: "b", id: "fixed" });
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("task_duplicate");
    }
  });

  test("copies metadata rather than aliasing the caller's object", () => {
    const { store } = createHarness();
    const metadata = { run: 1 };
    const task = store.add({ workspaceId: "w1", goal: "a", metadata });
    metadata.run = 2;
    expect(task.metadata).toEqual({ run: 1 });
  });
});

describe("update transitions", () => {
  test("accepts every legal transition", () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_TRANSITIONS[from]) {
        const { store } = createHarness();
        const task = taskInState(store, from);
        expect(store.update(task.id, { state: to }).state).toBe(to);
      }
    }
  });

  test("rejects every illegal transition", () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        if (from === to || TASK_TRANSITIONS[from].includes(to)) continue;
        const { store } = createHarness();
        const task = taskInState(store, from);
        try {
          store.update(task.id, { state: to });
          throw new Error(`expected ${from} -> ${to} to be rejected`);
        } catch (error) {
          expect(isApiError(error)).toBe(true);
          expect((error as { code: string; status: number }).code).toBe("task_invalid_transition");
          expect((error as { status: number }).status).toBe(409);
        }
        // The rejected transition must not have been partially applied.
        expect(store.require(task.id).state).toBe(from);
      }
    }
  });

  test("a same-state write is not a transition", () => {
    const { store } = createHarness();
    const task = taskInState(store, "done");
    expect(store.update(task.id, { state: "done", summary: "final" }).summary).toBe("final");
  });

  test("stamps completedAt when a task becomes terminal", () => {
    const harness = createHarness();
    const task = taskInState(harness.store, "running");
    expect(task.completedAt).toBeNull();
    harness.tick(50);
    const done = harness.store.update(task.id, { state: "done" });
    expect(done.completedAt).toBe(harness.clock);
  });

  test("non-state fields stay writable after a task finished", () => {
    const { store } = createHarness();
    const task = taskInState(store, "cancelled");
    const updated = store.update(task.id, { summary: "partial output", sessionId: "s1" });
    expect(updated.state).toBe("cancelled");
    expect(updated.summary).toBe("partial output");
    expect(updated.sessionId).toBe("s1");
  });

  test("update returns a new record rather than mutating the old one", () => {
    const { store } = createHarness();
    const task = addTask(store);
    const running = store.update(task.id, { state: "running" });
    expect(task.state).toBe("queued");
    expect(running).not.toBe(task);
  });

  test("throws 404 for an unknown task", () => {
    const { store } = createHarness();
    try {
      store.update("nope", { state: "running" });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { status: number; code: string }).status).toBe(404);
      expect((error as { code: string }).code).toBe("task_not_found");
    }
  });
});

describe("cancel", () => {
  test("cancels from every live state and records a reason", () => {
    for (const state of ["queued", "running", "awaiting_approval"] as const) {
      const { store } = createHarness();
      const task = taskInState(store, state);
      const cancelled = store.cancel(task.id, " user asked ");
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.cancelReason).toBe("user asked");
      expect(cancelled.pendingPermissions).toEqual([]);
    }
  });

  test("defaults the reason", () => {
    const { store } = createHarness();
    expect(store.cancel(addTask(store).id).cancelReason).toBe("Cancelled by request");
  });

  test("refuses an already-terminal task with 409", () => {
    for (const state of TERMINAL_TASK_STATES) {
      const { store } = createHarness();
      const task = taskInState(store, state);
      try {
        store.cancel(task.id);
        throw new Error(`expected cancel of ${state} to be rejected`);
      } catch (error) {
        expect((error as { code: string }).code).toBe("task_not_cancellable");
        expect((error as { status: number }).status).toBe(409);
      }
    }
  });
});

describe("require", () => {
  test("scopes by workspace so ids from another workspace read as missing", () => {
    const { store } = createHarness();
    const task = addTask(store, { workspaceId: "w1" });
    expect(store.require(task.id, "w1").id).toBe(task.id);
    try {
      store.require(task.id, "w2");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { status: number; code: string }).status).toBe(404);
      expect((error as { code: string }).code).toBe("task_not_found");
    }
  });
});

describe("list", () => {
  test("filters by workspace and returns newest first", () => {
    const harness = createHarness();
    const a = addTask(harness.store, { workspaceId: "w1", goal: "a" });
    harness.tick(10);
    const b = addTask(harness.store, { workspaceId: "w1", goal: "b" });
    harness.tick(10);
    const other = addTask(harness.store, { workspaceId: "w2", goal: "c" });

    expect(harness.store.list({ workspaceId: "w1" }).map((task) => task.id)).toEqual([b.id, a.id]);
    expect(harness.store.list({ workspaceId: "w2" }).map((task) => task.id)).toEqual([other.id]);
    expect(harness.store.list().length).toBe(3);
  });

  test("filters by a single state and by a list of states", () => {
    const { store } = createHarness();
    const queued = taskInState(store, "queued");
    const running = taskInState(store, "running");
    const done = taskInState(store, "done");

    expect(store.list({ state: "running" }).map((task) => task.id)).toEqual([running.id]);
    expect(new Set(store.list({ state: ["queued", "done"] }).map((task) => task.id)))
      .toEqual(new Set([queued.id, done.id]));
    expect(store.list({ state: "failed" })).toEqual([]);
  });

  test("applies and clamps the limit", () => {
    const harness = createHarness();
    for (let index = 0; index < 5; index += 1) {
      addTask(harness.store, { goal: `goal ${index}` });
      harness.tick();
    }
    expect(harness.store.list({ limit: 2 })).toHaveLength(2);
    expect(harness.store.list({ limit: 10_000 })).toHaveLength(5);
  });
});

describe("subscribe", () => {
  test("delivers created, state and updated events", () => {
    const { store } = createHarness();
    const seen: TaskEvent[] = [];
    store.subscribe({ onEvent: (event) => seen.push(event) });

    const task = addTask(store);
    store.update(task.id, { state: "running" });
    store.update(task.id, { summary: "half" });

    expect(seen.map((event) => event.type)).toEqual(["task.created", "task.state", "task.updated"]);
    expect(seen[1]).toMatchObject({ from: "queued", to: "running" });
    expect(seen[2]?.task.summary).toBe("half");
    expect(seen.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  test("unsubscribing stops delivery", () => {
    const { store } = createHarness();
    const seen: TaskEvent[] = [];
    const unsubscribe = store.subscribe({ onEvent: (event) => seen.push(event) });
    const task = addTask(store);
    unsubscribe();
    store.update(task.id, { state: "running" });
    expect(seen).toHaveLength(1);
  });

  test("a taskId filter only sees that task", () => {
    const { store } = createHarness();
    const first = addTask(store, { goal: "first" });
    const second = addTask(store, { goal: "second" });
    const seen: TaskEvent[] = [];
    store.subscribe({ taskId: second.id, onEvent: (event) => seen.push(event) });

    store.update(first.id, { state: "running" });
    store.update(second.id, { state: "running" });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.taskId).toBe(second.id);
  });

  test("after replays the buffered log before attaching", () => {
    const { store } = createHarness();
    const task = addTask(store);
    store.update(task.id, { state: "running" });

    const seen: TaskEvent[] = [];
    const unsubscribe = store.subscribe({ taskId: task.id, after: 1, onEvent: (event) => seen.push(event) });
    expect(seen.map((event) => event.seq)).toEqual([2]);

    store.update(task.id, { state: "done" });
    expect(seen.map((event) => event.seq)).toEqual([2, 3]);
    unsubscribe();
  });

  test("a throwing subscriber does not break the store or other subscribers", () => {
    const { store } = createHarness();
    const seen: TaskEvent[] = [];
    store.subscribe({
      onEvent: () => {
        throw new Error("subscriber exploded");
      },
    });
    store.subscribe({ onEvent: (event) => seen.push(event) });

    const task = addTask(store);
    expect(() => store.update(task.id, { state: "running" })).not.toThrow();
    expect(seen).toHaveLength(2);
    expect(store.require(task.id).state).toBe("running");
  });
});

describe("events", () => {
  test("returns the whole log, or only what follows a cursor", () => {
    const { store } = createHarness();
    const task = addTask(store);
    store.update(task.id, { state: "running" });
    store.update(task.id, { state: "done" });

    expect(store.events(task.id).map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(store.events(task.id, 2).map((event) => event.seq)).toEqual([3]);
    expect(store.events(task.id, 99)).toEqual([]);
    expect(store.events("unknown")).toEqual([]);
  });

  test("bounds the retained log per task", () => {
    const store = createTaskStore({ maxEventsPerTask: 3 });
    const task = store.add({ workspaceId: "w1", goal: "noisy" });
    for (let index = 0; index < 10; index += 1) store.update(task.id, { summary: `n${index}` });
    expect(store.events(task.id)).toHaveLength(3);
  });
});

describe("retention", () => {
  test("evicts the oldest terminal tasks but never a live one", () => {
    const harness = createHarness();
    const store = createTaskStore({ now: () => harness.clock, maxTasks: 2 });

    const oldDone = store.add({ workspaceId: "w1", goal: "old" });
    store.update(oldDone.id, { state: "running" });
    store.update(oldDone.id, { state: "done" });
    harness.tick(10);
    const live = store.add({ workspaceId: "w1", goal: "live" });
    store.update(live.id, { state: "running" });
    harness.tick(10);
    const newDone = store.add({ workspaceId: "w1", goal: "new" });
    store.update(newDone.id, { state: "failed" });

    expect(store.size).toBe(2);
    expect(store.get(oldDone.id)).toBeUndefined();
    expect(store.get(live.id)?.state).toBe("running");
    expect(store.get(newDone.id)?.state).toBe("failed");
  });
});
