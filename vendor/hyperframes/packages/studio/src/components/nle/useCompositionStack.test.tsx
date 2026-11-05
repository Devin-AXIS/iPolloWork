// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player";
import { useCompositionStack } from "./useCompositionStack";
import { NLEProvider, useNLEContext } from "./NLEContext";

const player = vi.hoisted(() => ({
  iframeRef: { current: null },
  seek: vi.fn(() => true),
  togglePlay: vi.fn(),
  onIframeLoad: vi.fn(),
  refreshPlayer: vi.fn(),
}));
vi.mock("../../player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player")>()),
  useTimelinePlayer: () => player,
}));

it("normalizes Windows composition paths and preserves the current frame when navigating between local timelines", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current?: ReturnType<typeof useCompositionStack> } = {};
  const onCompositionChange = vi.fn();
  function Harness() {
    api.current = useCompositionStack({ projectId: "nested", onCompositionChange });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    if (!api.current) throw new Error("composition stack did not mount");
    usePlayerStore.getState().setCurrentTime(5.5);
    await act(async () =>
      api.current?.handleDrillDown({
        id: "china",
        compositionSrc: "compositions\\china-map.html",
        start: 1.5,
      }),
    );
    expect(api.current.compositionStack.map((level) => level.id)).toEqual([
      "master",
      "compositions/china-map.html",
    ]);
    expect(api.current.compositionStack[1].previewUrl).toBe(
      "/api/projects/nested/preview/comp/compositions/china-map.html",
    );
    expect(usePlayerStore.getState().currentTime).toBe(4);
    await act(async () =>
      api.current?.handleDrillDown({
        id: "inner",
        compositionSrc: "compositions/inner.html",
        start: 1,
      }),
    );
    expect(usePlayerStore.getState().currentTime).toBe(3);
    await act(async () => api.current?.handleNavigateComposition(1));
    expect(usePlayerStore.getState().currentTime).toBe(4);
    await act(async () => api.current?.handleNavigateComposition(0));
    expect(usePlayerStore.getState().currentTime).toBe(5.5);
    expect(api.current.compositionStack).toHaveLength(1);
    usePlayerStore.getState().setCurrentTime(0);
    await act(async () =>
      api.current?.handleDrillDown({
        id: "china",
        compositionSrc: "compositions/china-map.html",
        start: 0,
      }),
    );
    usePlayerStore.getState().setCurrentTime(3);
    await act(async () => api.current?.handleNavigateComposition(0));
    expect(usePlayerStore.getState().currentTime).toBe(3);
    expect(onCompositionChange).toHaveBeenLastCalledWith(null);
    usePlayerStore.getState().setCurrentTime(14);
    await act(async () =>
      api.current?.handleDrillDown({
        id: "trimmed",
        compositionSrc: "compositions/trimmed.html",
        start: 12,
        playbackStart: 1,
        playbackRate: 2,
      }),
    );
    expect(usePlayerStore.getState().currentTime).toBe(5);
    usePlayerStore.getState().setCurrentTime(7);
    await act(async () => api.current?.handleNavigateComposition(0));
    expect(usePlayerStore.getState().currentTime).toBe(15);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("enters inline groups without changing preview, source callbacks, global time, or discovered elements", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current?: ReturnType<typeof useCompositionStack> } = {};
  const changed = vi.fn();
  function Harness() {
    api.current = useCompositionStack({ projectId: "inline", onCompositionChange: changed });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    const scene: import("../../player/store/playerStore").TimelineElement = {
      id: "alpha",
      label: "Alpha",
      tag: "section",
      start: 2,
      duration: 6,
      track: 10,
      inlineScopeKind: "scene",
    };
    usePlayerStore.getState().setElements([scene]);
    usePlayerStore.getState().setCurrentTime(4);
    const elements = usePlayerStore.getState().elements;
    changed.mockClear();
    await act(async () => api.current?.handleDrillDown(scene));
    await act(async () =>
      api.current?.handleDrillDown({
        ...scene,
        id: "group",
        label: "Group",
        inlineScopeKind: "group",
      }),
    );
    expect(api.current?.compositionStack.map((level) => level.label)).toEqual([
      "Master",
      "Alpha",
      "Group",
    ]);
    expect(
      api.current?.compositionStack.every(
        (level) => level.previewUrl === "/api/projects/inline/preview",
      ),
    ).toBe(true);
    expect(usePlayerStore.getState().currentTime).toBe(4);
    expect(usePlayerStore.getState().elements).toBe(elements);
    usePlayerStore.getState().setSelectedElementId("leaf");
    await act(async () => api.current?.handleNavigateComposition(1));
    expect(usePlayerStore.getState().selectedElementId).toBe("group");
    await act(async () =>
      api.current?.handleDrillDown({ ...scene, id: "group", inlineScopeKind: "group" }),
    );
    usePlayerStore.getState().setSelectedElementId("leaf");
    await act(async () => api.current?.handleNavigateComposition(0));
    expect(usePlayerStore.getState().selectedElementId).toBe("alpha");
    expect(usePlayerStore.getState().currentTime).toBe(4);
    expect(usePlayerStore.getState().elements).toBe(elements);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("prepares out-of-range inline entry for the provider scene clock and preserves valid frames", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current?: ReturnType<typeof useCompositionStack> } = {};
  const changed = vi.fn();
  function Harness() {
    api.current = useCompositionStack({ projectId: "inline", onCompositionChange: changed });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    const scene: import("../../player/store/playerStore").TimelineElement = {
      id: "signals",
      label: "Signals",
      tag: "section",
      start: 13.514,
      duration: 6,
      track: 10,
      inlineScopeKind: "scene",
    };
    usePlayerStore.getState().setElements([scene]);
    const elements = usePlayerStore.getState().elements;
    usePlayerStore.getState().setCurrentTime(3.5);
    changed.mockClear();
    await act(async () => api.current?.handleDrillDown(scene));
    expect(usePlayerStore.getState().currentTime).toBe(13.514);
    expect(api.current?.compositionStack.at(-1)?.previewUrl).toBe("/api/projects/inline/preview");
    await act(async () => api.current?.handleNavigateComposition(0));
    expect(usePlayerStore.getState().currentTime).toBe(13.514);
    usePlayerStore.getState().setCurrentTime(15);
    await act(async () => api.current?.handleDrillDown(scene));
    expect(usePlayerStore.getState().currentTime).toBe(15);
    await act(async () => api.current?.handleNavigateComposition(0));
    usePlayerStore.getState().setCurrentTime(25);
    await act(async () => api.current?.handleDrillDown(scene));

    expect(changed).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().elements).toBe(elements);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("leaves initial root seek to URL restoration and syncs only scene entry, range edits, and exit", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current?: ReturnType<typeof useNLEContext> } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ content: "" }))),
  );
  player.seek.mockClear();
  player.togglePlay.mockClear();
  function Harness() {
    api.current = useNLEContext();
    return null;
  }
  try {
    await act(async () =>
      root.render(
        createElement(NLEProvider, { projectId: "restore", children: createElement(Harness) }),
      ),
    );
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.togglePlay).not.toHaveBeenCalled();
    const scene: import("../../player/store/playerStore").TimelineElement = {
      id: "alpha",
      tag: "section",
      start: 8,
      duration: 8,
      track: 10,
      inlineScopeKind: "scene",
    };
    await act(async () => {
      usePlayerStore.getState().setCurrentTime(10.5);
      usePlayerStore.getState().setElements([scene]);
    });
    expect(player.seek).not.toHaveBeenCalled();
    await act(async () => api.current?.handleDrillDown(scene));
    expect(player.seek).toHaveBeenLastCalledWith(10.5);
    expect(api.current?.scenePlaybackRange).toEqual({ start: 8, end: 16 });
    await act(async () => usePlayerStore.getState().setElements([{ ...scene, duration: 6 }]));
    expect(player.seek).toHaveBeenCalledTimes(2);
    expect(api.current?.scenePlaybackRange).toEqual({ start: 8, end: 14 });
    await act(async () => {
      usePlayerStore.getState().setCurrentTime(11);
      usePlayerStore.getState().setIsPlaying(true);
      api.current?.handleNavigateComposition(0);
    });
    expect(player.seek).toHaveBeenCalledTimes(3);
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenLastCalledWith(11);
    expect(api.current?.scenePlaybackRange).toBeNull();
    await act(async () => usePlayerStore.getState().setElements([scene]));
    expect(player.seek).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
