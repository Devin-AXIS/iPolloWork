import { afterAll, beforeEach, expect, test } from "bun:test";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const saved = new Map<string, string>();
let writes = 0;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => { writes += 1; saved.set(key, value); },
  removeItem: (key: string) => { saved.delete(key); },
} });

const { useSidebarLayoutStore: store, createSidebarLayoutSnapshot, SIDEBAR_LAYOUT_STORAGE_KEY } =
  await import("../src/react-app/domains/session/sidebar/sidebar-layout-store");

beforeEach(() => {
  store.setState(createSidebarLayoutSnapshot());
  writes = 0;
});

afterAll(() => {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

const knownItems = {
  contextId: "personal", projectIds: ["project-a", "project-b"], sessionKeys: ["session-a", "session-b"],
  sourceProjectBySessionKey: { "session-a": "project-a", "session-b": "project-b" },
};

test("repeating the same sidebar layout causes no notifications or storage writes", () => {
  store.getState().prune(knownItems);
  store.getState().reorderProjects("personal", "project-b", "project-a");
  store.getState().reorderSessions("project-a", "session-a", "session-b");
  const before = store.getState();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });
  writes = 0;
  try {
    for (let count = 0; count < 100; count += 1) {
      store.getState().prune(knownItems);
      store.getState().reorderProjects("personal", "project-b", "project-a");
      store.getState().reorderSessions("project-a", "session-a", "session-b");
      store.getState().moveSession("session-a", "project-a");
    }
    expect(store.getState()).toBe(before);
    expect(notifications).toBe(0);
    expect(writes).toBe(0);
  } finally {
    unsubscribe();
  }
});

test("invalid or self-directed reorder requests leave an empty layout untouched", () => {
  const before = store.getState();
  store.getState().reorderProjects("personal", "project-a", "project-a");
  store.getState().reorderProjects("personal", "", "project-a");
  store.getState().reorderSessions("project-a", "session-a", "");
  expect(store.getState()).toBe(before);
  expect(writes).toBe(0);
});

test("real moves, cleanup and reload retain project and session ordering", async () => {
  store.getState().prune(knownItems);
  store.getState().reorderProjects("personal", "project-b", "project-a");
  store.getState().moveSession("session-a", "project-b");
  store.getState().reorderSessions("project-b", "session-a", "session-b");
  expect(writes).toBe(4);
  const persisted = saved.get(SIDEBAR_LAYOUT_STORAGE_KEY);
  if (!persisted) throw new Error("Expected a persisted layout");
  store.setState(createSidebarLayoutSnapshot());
  saved.set(SIDEBAR_LAYOUT_STORAGE_KEY, persisted);
  await store.persist.rehydrate();
  expect(store.getState()).toMatchObject({
    projectOrderByContext: { personal: ["project-b", "project-a"] },
    sessionOrderByProject: { "project-b": ["session-a", "session-b"] },
    sessionProjectByKey: { "session-a": "project-b", "session-b": "project-b" },
  });
  store.getState().prune({ contextId: "personal", projectIds: ["project-b"], sessionKeys: ["session-b"] });
  expect(store.getState()).toMatchObject({
    projectOrderByContext: { personal: ["project-b"] },
    sessionOrderByProject: { "project-b": ["session-b"] },
    sessionProjectByKey: { "session-b": "project-b" },
  });
});
