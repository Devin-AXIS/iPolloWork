// @vitest-environment happy-dom

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TimelineClipAnimationSegments } from "./TimelineClipAnimationSegments";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

describe("timeline clip animation segment interaction", () => {
  test("keeps pointer preview local and performs one isolated release commit", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/player/components/TimelineClipAnimationSegments.tsx"),
      "utf8",
    );

    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("cancelAnimationFrame");
    expect(source).toContain("target.style.transform");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("hasPointerCapture");
    expect(source).toContain("releasePointerCapture");
    expect(source).toContain("onPointerCancel={handlePointerCancel}");
    expect(source).toContain("onLostPointerCapture={handlePointerCancel}");
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("commitResolvedAnimationSegmentDrag(");
    expect(source).toContain("event.ctrlKey");
    expect(source).toContain("event.metaKey");
    expect(source).toContain("event.shiftKey");
    expect(source).toContain('activeTool === "razor"');
    expect(source).toContain('closest("[data-clip]")');
    expect(source).not.toContain("useState");
  });
});


test("a click inspects an animation; a drag commits without opening the inspector", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const inspect = vi.fn(), move = vi.fn();
  const owner = { id: "shape", start: 0, duration: 6 } as TimelineElement;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  usePlayerStore.setState({ activeTool: "select" });
  try {
    await act(async () => root.render(React.createElement(TimelineEditProvider, {
      value: { onInspectAnimation: inspect },
      children: React.createElement("div", { "data-clip": "shape" }, React.createElement(TimelineClipAnimationSegments, {
        segments: [{ animationId: "manual", phase: "loop", origin: "manual", startPercentage: 0, endPercentage: 50 }],
        ownerElement: owner,
        canMoveAnimationSegment: () => true,
        onMoveAnimationSegment: move,
      })),
    })));
    const clip = host.querySelector("[data-clip]") as HTMLElement;
    clip.getBoundingClientRect = () => ({ width: 400 } as DOMRect);
    const button = host.querySelector("button")!;
    button.setPointerCapture = vi.fn();
    button.hasPointerCapture = () => true;
    button.releasePointerCapture = vi.fn();
    const pointer = (type: string, x: number) => button.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x, pointerId: 1 }));
    await act(async () => { pointer("pointerdown", 30); pointer("pointerup", 30); button.click(); });
    expect(inspect).toHaveBeenCalledExactlyOnceWith(owner);
    expect(move).not.toHaveBeenCalled();
    inspect.mockClear();
    await act(async () => { pointer("pointerdown", 30); pointer("pointermove", 70); pointer("pointerup", 70); button.click(); });
    expect(inspect).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledExactlyOnceWith(owner, "manual", 10);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
