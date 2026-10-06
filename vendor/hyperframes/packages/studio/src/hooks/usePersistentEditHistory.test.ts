import { describe, expect, it, vi } from "vitest";

import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";
import { createPersistentEditHistoryStore } from "./usePersistentEditHistory";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve: () => resolve() };
}

async function settleTogether(...tasks: Promise<unknown>[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(tasks).then(() => true),
      new Promise<boolean>((done) => { timer = setTimeout(() => done(false), 500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("createPersistentEditHistoryStore", () => {
  it.each(["undo", "redo"] as const)("finishes a saved insertion and a concurrent %s without holding reciprocal queues", async (direction) => {
    const store = createPersistentEditHistoryStore({
      projectId: "project", storage: createMemoryEditHistoryStorage(),
      initialState: { version: 1, updatedAt: 0, undo: [], redo: [] }, onChange: () => {},
    });
    let content = "motion";
    const writer = async (_path: string, next: string) => { content = next; };
    const callbacks = {
      readFile: async () => content,
      writeFile: writer,
      serialize: <T>(paths: readonly string[], task: () => Promise<T>) =>
        serializeStudioFileMutations(writer, paths, task),
    };
    await store.recordEdit({ label: "Previous edit", kind: "source", files: { "index.html": { before: "plain", after: "motion" } } });
    if (direction === "redo") await store.undo(callbacks);
    const previousContent = content;
    const enteredRead = deferred();
    const releaseRead = deferred();
    const save = saveProjectFilesWithHistory({
      projectId: "project", label: "Add Venn", kind: "timeline", files: { "index.html": "Venn inserted" },
      readFile: async () => { enteredRead.resolve(); await releaseRead.promise; return content; },
      writeFile: writer, recordEdit: store.recordEdit,
    });
    await enteredRead.promise;
    const historyStep = store[direction](callbacks);
    await Promise.resolve();
    releaseRead.resolve();

    expect(await settleTogether(save, historyStep)).toBe(true);
    if (direction === "undo") {
      expect(await historyStep).toMatchObject({ ok: true, label: "Add Venn" });
      expect(content).toBe(previousContent);
    } else {
      expect(await historyStep).toMatchObject({ ok: false, reason: "empty" });
      expect(content).toBe("Venn inserted");
      expect((await store.undo(callbacks)).label).toBe("Add Venn");
      expect(content).toBe(previousContent);
    }
    expect((await store.redo(callbacks)).label).toBe("Add Venn");
    expect(content).toBe("Venn inserted");
  });

  it("locks the current history files when a queued insertion changes the undo target", async () => {
    const storage = createMemoryEditHistoryStorage();
    const store = createPersistentEditHistoryStore({
      projectId: "project", storage,
      initialState: { version: 1, updatedAt: 0, undo: [], redo: [] }, onChange: () => {},
    });
    const content = new Map([["index.html", "motion"], ["diagram.html", "original diagram"]]);
    const writer = async (path: string, next: string) => { content.set(path, next); };
    await store.recordEdit({ label: "Previous edit", kind: "source", files: { "index.html": { before: "plain", after: "motion" } } });
    const enteredStorage = deferred();
    const releaseStorage = deferred();
    const originalSet = storage.set;
    vi.spyOn(storage, "set").mockImplementationOnce(async (projectId, state) => {
      enteredStorage.resolve(); await releaseStorage.promise; await originalSet(projectId, state);
    });
    content.set("index.html", "busy edit");
    const busy = store.recordEdit({ label: "Busy edit", kind: "source", files: { "index.html": { before: "motion", after: "busy edit" } } });
    await enteredStorage.promise;
    const insertionQueued = deferred();
    const save = saveProjectFilesWithHistory({
      projectId: "project", label: "Add diagram", kind: "timeline", files: { "diagram.html": "new diagram" },
      readFile: async (path) => content.get(path)!, writeFile: writer,
      recordEdit: async (entry) => { const queued = store.recordEdit(entry); insertionQueued.resolve(); await queued; },
    });
    await insertionQueued.promise;
    let lockedPaths = new Set<string>();
    const callbacks = {
      readFile: async (path: string) => content.get(path)!,
      writeFile: async (path: string, next: string) => {
        expect(lockedPaths.has(path)).toBe(true);
        await writer(path, next);
      },
      serialize: <T>(paths: readonly string[], task: () => Promise<T>) =>
        serializeStudioFileMutations(writer, paths, async () => {
          lockedPaths = new Set(paths);
          try { return await task(); } finally { lockedPaths.clear(); }
        }),
    };
    const undo = store.undo(callbacks);
    await Promise.resolve();
    releaseStorage.resolve();

    expect(await settleTogether(busy, save, undo)).toBe(true);
    expect(await undo).toMatchObject({ ok: true, label: "Add diagram" });
    expect(content.get("index.html")).toBe("busy edit");
    expect(content.get("diagram.html")).toBe("original diagram");
    expect((await store.redo(callbacks)).label).toBe("Add diagram");
    expect(content.get("diagram.html")).toBe("new diagram");
  });

  it("keeps a later redo behind an undo waiting for a different file", async () => {
    const store = createPersistentEditHistoryStore({
      projectId: "project", storage: createMemoryEditHistoryStorage(),
      initialState: { version: 1, updatedAt: 0, undo: [], redo: [] }, onChange: () => {},
    });
    const content = new Map([["index.html", "motion"], ["diagram.html", "changed diagram"]]);
    const writer = async (path: string, next: string) => { content.set(path, next); };
    const callbacks = {
      readFile: async (path: string) => content.get(path)!, writeFile: writer,
      serialize: <T>(paths: readonly string[], task: () => Promise<T>) =>
        serializeStudioFileMutations(writer, paths, task),
    };
    await store.recordEdit({ label: "Motion edit", kind: "source", files: { "index.html": { before: "plain", after: "motion" } } });
    await store.recordEdit({ label: "Diagram edit", kind: "source", files: { "diagram.html": { before: "original diagram", after: "changed diagram" } } });
    await store.undo(callbacks);
    const enteredRead = deferred();
    const releaseRead = deferred();
    const save = saveProjectFilesWithHistory({
      projectId: "project", label: "Add Venn", kind: "timeline", files: { "index.html": "Venn inserted" },
      readFile: async (path) => { enteredRead.resolve(); await releaseRead.promise; return content.get(path)!; },
      writeFile: writer, recordEdit: store.recordEdit,
    });
    await enteredRead.promise;
    const undo = store.undo(callbacks);
    const redo = store.redo(callbacks);
    await Promise.resolve();
    releaseRead.resolve();

    expect(await settleTogether(save, undo, redo)).toBe(true);
    expect(await undo).toMatchObject({ ok: true, label: "Add Venn" });
    expect(await redo).toMatchObject({ ok: true, label: "Add Venn" });
    expect(content.get("index.html")).toBe("Venn inserted");
    expect(content.get("diagram.html")).toBe("original diagram");
  });

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
