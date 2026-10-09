// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { preloadBlockCatalog, type CatalogItem } from "./useBlockCatalog";
import { useBlockHandlers } from "./useBlockHandlers";
import * as blockInstaller from "../utils/blockInstaller";

vi.mock("./useBlockCatalog", () => ({ preloadBlockCatalog: vi.fn() }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const catalog: CatalogItem[] = [{
  name: "stage-radial", title: "Stage Radial", description: "Radial diagram",
  type: "hyperframes:block", category: "data", kind: "animation",
  dimensions: { width: 1920, height: 1080 }, duration: 10,
  files: [{ path: "stage-radial.html", target: "compositions/stage-radial.html", type: "hyperframes:composition" }],
  variables: [{ id: "title", label: "Title", type: "string", default: "Teaching scenario", maxLength: 72, update: "live" }],
  visualComponent: { version: 1, category: "business", surfaces: ["video"], themeMode: "inherit" },
}];
const elements: TimelineElement[] = [{
  id: "radial-runtime", domId: "stage-radial", tag: "div", start: 2.37,
  duration: 10, track: 4, sourceFile: "index.html", compositionSrc: "compositions/stage-radial.html",
}];
const source = (title?: string) => `<main data-composition-id="main"><div id="stage-radial"${title ? ` data-variable-values='${JSON.stringify({ title })}'` : ""}></div></main>`;
const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach(unmount => unmount());
  usePlayerStore.getState().reset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function mountHandlers(options: { readHost?: () => Promise<string>; writeGate?: Promise<void> } = {}) {
  vi.mocked(preloadBlockCatalog).mockResolvedValue(catalog);
  usePlayerStore.getState().setSelectedElementId("radial-runtime");
  let hostSource = source("Saved title");
  let historyState = { undo: [], redo: [], updatedAt: 0 };
  let latest: ReturnType<typeof useBlockHandlers> | null = null;
  const readProjectFile = vi.fn(async (path: string) => path === "index.html"
    ? options.readHost ? options.readHost() : hostSource
    : "<html><body></body></html>");
  const writeProjectFile = vi.fn(async (_path: string, content: string) => {
    await options.writeGate;
    hostSource = content;
  });
  const deps = {
    activeCompPath: null, previewIframeRef: { current: null }, timelineElements: elements,
    readProjectFile, writeProjectFile, recordEdit: vi.fn(async () => undefined),
    markStudioWrite: vi.fn(), refreshFileTree: vi.fn(async () => undefined), reloadPreview: vi.fn(),
    showToast: vi.fn(() => 1), dismissToast: vi.fn(),
  };
  const callbacks = {
    clearDomSelection: vi.fn(), setCompositionLoading: vi.fn(),
    setRightCollapsed: vi.fn(), setRightPanelTab: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness({ loading }: { loading: boolean }) {
    const params = { projectId: "variable-history-proof", blockCtxDeps: deps, compositionLoading: loading, historyState, ...callbacks };
    latest = useBlockHandlers(params);
    return null;
  }
  const render = async (loading = false) => {
    await act(async () => root.render(createElement(Harness, { loading })));
  };
  await render();
  unmounts.push(() => { flushSync(() => root.unmount()); container.remove(); });
  return {
    render, readProjectFile, writeProjectFile, markStudioWrite: deps.markStudioWrite, ...callbacks,
    setElements: (next: TimelineElement[]) => { deps.timelineElements = next; },
    setSource: (next: string) => { hostSource = next; },
    advanceHistory: () => { historyState = { ...historyState, updatedAt: historyState.updatedAt + 1 }; },
    result: () => { if (!latest) throw Error("Block hook did not mount"); return latest; },
  };
}

describe("selected component variables after source history restore", () => {
  it("clears variables when Redo removes the selected component from the timeline", async () => {
    const harness = await mountHandlers();
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Saved title" });
    harness.setElements([]);
    harness.advanceHistory();
    await harness.render();
    expect(harness.result().activeBlockParams).toBeNull();
  });

  it("clears an unselected component and rejects its late source hydration", async () => {
    const pending = deferred<string>();
    let reads = 0;
    const harness = await mountHandlers({ readHost: () => ++reads === 2 ? pending.promise : Promise.resolve(source("Saved title")) });
    harness.advanceHistory();
    await harness.render();
    await act(async () => usePlayerStore.getState().clearSelection());
    await harness.render();
    expect(harness.result().activeBlockParams).toBeNull();
    await act(async () => pending.resolve(source("Deleted component title")));
    expect(harness.result().activeBlockParams).toBeNull();
  });

  it("keeps a slow install's intermediate writes suppressed until completion", async () => {
    vi.useFakeTimers();
    const gate = deferred<null>();
    vi.spyOn(blockInstaller, "addBlockToProject").mockReturnValue(gate.promise);
    const harness = await mountHandlers();
    let lastWriteMark = Date.now();
    harness.markStudioWrite.mockImplementation(() => { lastWriteMark = Date.now(); });
    let operation: Promise<boolean> | undefined;
    await act(async () => { operation = harness.result().handleAddBlock("stage-radial"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(Date.now() - lastWriteMark).toBeLessThan(4_000);
    gate.resolve(null);
    await act(async () => { await operation; });
    const marksAtCompletion = harness.markStudioWrite.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.markStudioWrite).toHaveBeenCalledTimes(marksAtCompletion);
  });

  it("stops install write suppression on unmount while the request is still pending", async () => {
    vi.useFakeTimers();
    const gate = deferred<null>();
    vi.spyOn(blockInstaller, "addBlockToProject").mockReturnValue(gate.promise);
    const harness = await mountHandlers();
    let operation: Promise<boolean> | undefined;
    await act(async () => { operation = harness.result().handleAddBlock("stage-radial"); });
    await vi.advanceTimersByTimeAsync(2_000);
    unmounts.pop()?.();
    const marksAtUnmount = harness.markStudioWrite.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.markStudioWrite).toHaveBeenCalledTimes(marksAtUnmount);
    gate.resolve(null);
    await operation;
  });

  it("clears install write suppression when installation throws", async () => {
    vi.useFakeTimers();
    vi.spyOn(blockInstaller, "addBlockToProject").mockRejectedValue(Error("Install unavailable"));
    const harness = await mountHandlers();
    await act(async () => {
      await expect(harness.result().handleAddBlock("stage-radial")).rejects.toThrow("Install unavailable");
    });
    const marksAtFailure = harness.markStudioWrite.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.markStudioWrite).toHaveBeenCalledTimes(marksAtFailure);
    expect(harness.setCompositionLoading).toHaveBeenLastCalledWith(false);
  });

  it("re-reads Undo and Redo values after preview reload with unchanged timeline elements", async () => {
    const harness = await mountHandlers();
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Saved title" });
    harness.setSource(source());
    await harness.render(true);
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Saved title" });
    await harness.render(false);
    expect(harness.result().activeBlockParams?.variableValues).toEqual({});
    expect(harness.result().activeBlockParams?.variables[0]?.default).toBe("Teaching scenario");

    harness.setSource(source("Saved title"));
    await harness.render(true);
    await harness.render(false);
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Saved title" });
  });

  it("re-reads soft Undo and Redo without a preview reload or timeline identity change", async () => {
    const harness = await mountHandlers();
    harness.setSource(source());
    harness.advanceHistory();
    await harness.render();
    expect(harness.result().activeBlockParams?.variableValues).toEqual({});

    harness.setSource(source("Saved title"));
    harness.advanceHistory();
    await harness.render();
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Saved title" });
  });

  it("does not reopen the variables panel when the same component's source is refreshed", async () => {
    const harness = await mountHandlers();
    expect(harness.setRightCollapsed).toHaveBeenCalledWith(false);
    expect(harness.setRightPanelTab).toHaveBeenCalledWith("block-params");
    harness.setRightCollapsed.mockClear();
    harness.setRightPanelTab.mockClear();

    harness.setSource(source());
    harness.advanceHistory();
    await harness.render();
    expect(harness.result().activeBlockParams?.variableValues).toEqual({});
    harness.setSource(source("Restored title"));
    await harness.render(true);
    await harness.render(false);
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Restored title" });
    expect(harness.setRightCollapsed).not.toHaveBeenCalled();
    expect(harness.setRightPanelTab).not.toHaveBeenCalled();
  });

  it("does not publish a stale source read after a new preview reload begins", async () => {
    const pending = deferred<string>();
    let current = pending.promise;
    const harness = await mountHandlers({ readHost: () => current });
    await harness.render(true);
    await act(async () => pending.resolve(source("Obsolete title")));
    expect(harness.result().activeBlockParams).toBeNull();

    current = Promise.resolve(source());
    await harness.render(false);
    expect(harness.result().activeBlockParams?.variableValues).toEqual({});
  });

  it("waits for an in-flight variable save before history-triggered source hydration", async () => {
    const write = deferred<void>();
    const harness = await mountHandlers({ writeGate: write.promise });
    let save: Promise<void> = Promise.resolve();
    await act(async () => { save = harness.result().handleBlockVariableChange("title", "Latest title"); });
    await vi.waitFor(() => expect(harness.writeProjectFile).toHaveBeenCalledOnce());
    const readsBeforeRestore = harness.readProjectFile.mock.calls.length;
    harness.advanceHistory();
    await harness.render();
    expect(harness.readProjectFile).toHaveBeenCalledTimes(readsBeforeRestore);

    await act(async () => { write.resolve(); await save; });
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Latest title" });
    expect(harness.readProjectFile.mock.calls.length).toBeGreaterThan(readsBeforeRestore);
  });

  it("does not overwrite a newer variable save when an older history read finishes late", async () => {
    const pending = deferred<string>();
    let reads = 0;
    const harness = await mountHandlers({
      readHost: () => ++reads === 2 ? pending.promise : Promise.resolve(source("Saved title")),
    });
    harness.advanceHistory();
    await harness.render();
    expect(reads).toBe(2);

    await act(async () => {
      await harness.result().handleBlockVariableChange("title", "Latest title");
    });
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Latest title" });
    await act(async () => pending.resolve(source("Obsolete title")));
    expect(harness.result().activeBlockParams?.variableValues).toEqual({ title: "Latest title" });
  });
});
