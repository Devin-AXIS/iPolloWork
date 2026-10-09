// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player";
import { useCompositionStack } from "./useCompositionStack";

  it("normalizes Windows composition paths and restores each parent's local playhead, including zero", async () => {
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
      await act(async () => api.current?.handleDrillDown({
        id: "china", compositionSrc: "compositions\\china-map.html", start: 1.5,
      }));
      expect(api.current.compositionStack.map((level) => level.id))
        .toEqual(["master", "compositions/china-map.html"]);
      expect(api.current.compositionStack[1].previewUrl)
        .toBe("/api/projects/nested/preview/comp/compositions/china-map.html");
      expect(usePlayerStore.getState().currentTime).toBe(4);
      await act(async () => api.current?.handleDrillDown({
        id: "inner", compositionSrc: "compositions/inner.html", start: 1,
      }));
      expect(usePlayerStore.getState().currentTime).toBe(3);
      await act(async () => api.current?.handleNavigateComposition(1));
      expect(usePlayerStore.getState().currentTime).toBe(4);
      await act(async () => api.current?.handleNavigateComposition(0));
      expect(usePlayerStore.getState().currentTime).toBe(5.5);
      expect(api.current.compositionStack).toHaveLength(1);
      usePlayerStore.getState().setCurrentTime(0);
      await act(async () => api.current?.handleDrillDown({
        id: "china", compositionSrc: "compositions/china-map.html", start: 0,
      }));
      usePlayerStore.getState().setCurrentTime(3);
      await act(async () => api.current?.handleNavigateComposition(0));
      expect(usePlayerStore.getState().currentTime).toBe(0);
      expect(onCompositionChange).toHaveBeenLastCalledWith(null);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

