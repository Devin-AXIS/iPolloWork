import { describe, expect, it, vi } from "vitest";

import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import { createPersistentEditHistoryStore } from "./usePersistentEditHistory";

describe("createPersistentEditHistoryStore", () => {
  it("drops a stale undo entry after a content mismatch so later Studio edits remain undoable", async () => {
    let timestamp = 1;
    let latestState = null as ReturnType<
      ReturnType<typeof createPersistentEditHistoryStore>["snapshot"]
    >["state"] | null;
    const storage = createMemoryEditHistoryStorage();
    const store = createPersistentEditHistoryStore({
      projectId: "project",
      storage,
      initialState: {
        version: 1,
        updatedAt: 0,
        undo: [],
        redo: [],
      },
      now: () => timestamp++,
      onChange: (state) => {
        latestState = state;
      },
    });

    await store.recordEdit({
      label: "Apply motion preset",
      kind: "manual",
      files: { "index.html": { before: "plain", after: "motion" } },
    });

    const writeFile = vi.fn();
    const staleUndo = await store.undo({
      readFile: async () => "motion changed outside Studio",
      writeFile,
    });

    expect(staleUndo).toEqual({ ok: false, reason: "content-mismatch" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(store.snapshot().canUndo).toBe(false);
    expect(latestState?.undo).toHaveLength(0);

    await store.recordEdit({
      label: "Edit text",
      kind: "manual",
      files: { "index.html": { before: "motion changed outside Studio", after: "new studio edit" } },
    });

    const writes: Array<[string, string]> = [];
    const successfulUndo = await store.undo({
      readFile: async () => "new studio edit",
      writeFile: async (path, content) => {
        writes.push([path, content]);
      },
    });

    expect(successfulUndo.ok).toBe(true);
    expect(successfulUndo.label).toBe("Edit text");
    expect(writes).toEqual([["index.html", "motion changed outside Studio"]]);
  });

  it("drops every stale undo entry in one attempt before reporting content mismatch", async () => {
    let timestamp = 10;
    const storage = createMemoryEditHistoryStorage();
    const store = createPersistentEditHistoryStore({
      projectId: "project",
      storage,
      initialState: {
        version: 1,
        updatedAt: 0,
        undo: [],
        redo: [],
      },
      now: () => timestamp++,
      onChange: () => {},
    });

    await store.recordEdit({
      label: "Apply first motion preset",
      kind: "manual",
      files: { "index.html": { before: "plain", after: "motion-one" } },
    });
    await store.recordEdit({
      label: "Apply second motion preset",
      kind: "manual",
      files: { "index.html": { before: "motion-one", after: "motion-two" } },
    });

    const writeFile = vi.fn();
    const staleUndo = await store.undo({
      readFile: async () => "changed outside Studio",
      writeFile,
    });

    expect(staleUndo).toEqual({ ok: false, reason: "content-mismatch" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(store.snapshot().canUndo).toBe(false);
  });

  it("undoes the latest matching Studio edit before considering older stale entries", async () => {
    let timestamp = 20;
    const storage = createMemoryEditHistoryStorage();
    const store = createPersistentEditHistoryStore({
      projectId: "project",
      storage,
      initialState: {
        version: 1,
        updatedAt: 0,
        undo: [],
        redo: [],
      },
      now: () => timestamp++,
      onChange: () => {},
    });

    await store.recordEdit({
      label: "Old motion edit",
      kind: "manual",
      files: { "index.html": { before: "plain", after: "old motion" } },
    });
    await store.recordEdit({
      label: "New Studio edit",
      kind: "manual",
      files: { "index.html": { before: "changed outside Studio", after: "new studio edit" } },
    });

    const writes: Array<[string, string]> = [];
    const result = await store.undo({
      readFile: async () => "new studio edit",
      writeFile: async (path, content) => {
        writes.push([path, content]);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.label).toBe("New Studio edit");
    expect(writes).toEqual([["index.html", "changed outside Studio"]]);
    expect(store.snapshot().undoLabel).toBe("Old motion edit");
  });
});
