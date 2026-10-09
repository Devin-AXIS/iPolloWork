// @vitest-environment happy-dom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { usePlayerStore } from "../store/playerStore";
import { TRACKS_LEFT_PAD } from "./timelineLayout";

let root: Root;
let host: HTMLDivElement;
const seek = vi.fn();
const clipDrag = vi.fn();
function Harness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const ppsRef = useRef(100);
  const elementsRef = useRef(usePlayerStore.getState().elements);
  const trackOrderRef = useRef([1]);
  const isDragging = useRef(false);
  const dragScrollRaf = useRef(0);
  const [open, setOpen] = useState(false);
  const mode = usePlayerStore((state) => state.activeTool);
  const range = useTimelineRangeSelection({
    scrollRef, ppsRef, effectiveDuration: 10, pps: 100, seekFromX: seek,
    autoScrollDuringDrag: () => {}, dragScrollRaf, isDragging, setShowPopover: setOpen,
    elementsRef, trackOrderRef, gutterWidth: 100,
  });
  return <div ref={scrollRef} data-open={open} data-range={JSON.stringify(range.rangeSelection)}
    onPointerDownCapture={(event) => {
      if (mode !== "annotate" || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      range.handlePointerDown(event);
    }}
    onPointerDown={range.handlePointerDown} onPointerMove={range.handlePointerMove}
    onPointerUp={range.handlePointerUp} onPointerCancel={range.cancelRangeSelection}>
    <div data-clip="true" onPointerDown={clipDrag}>Clip</div>
  </div>;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  usePlayerStore.setState({ activeTool: "annotate", isPlaying: true, selectedElementId: "clip-one", selectedElementIds: new Set(["clip-one"]),
    elements: [{ id: "clip-one", tag: "div", start: 1, duration: 3, track: 1 }] });
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  const scroll = host.firstElementChild;
  if (!(scroll instanceof HTMLDivElement)) throw new Error("Timeline scroll missing");
  vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 1000, 300));
  scroll.setPointerCapture = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function pointer(type: string, seconds: number, shiftKey = false) {
  const target = type === "pointerdown" ? host.querySelector("[data-clip]") : host.firstElementChild;
  if (!target) throw new Error("Timeline target missing");
  await act(async () => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, button: 0, clientX: 20 + 100 + TRACKS_LEFT_PAD + seconds * 100,
    clientY: 100, shiftKey,
  })));
}

it("annotates a dragged range over clips without seeking, moving them, or requiring Shift", async () => {
  const before = JSON.stringify(usePlayerStore.getState().elements);
  await pointer("pointerdown", 1.25);
  await pointer("pointermove", 3.75);
  expect(host.firstElementChild?.getAttribute("data-open")).toBe("false");
  await pointer("pointerup", 3.75);
  expect(JSON.parse(host.firstElementChild?.getAttribute("data-range") || "{}")).toMatchObject({ start: 1.25, end: 3.75 });
  expect(host.firstElementChild?.getAttribute("data-open")).toBe("true");
  expect(clipDrag).not.toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().activeTool).toBe("select");
  expect(usePlayerStore.getState().isPlaying).toBe(false);
  expect(JSON.stringify(usePlayerStore.getState().elements)).toBe(before);
});

it("supports reverse selection with horizontal scrolling and clamps to the video duration", async () => {
  const scroll = host.firstElementChild;
  if (!(scroll instanceof HTMLDivElement)) throw new Error("Scroll missing");
  scroll.scrollLeft = 100;
  await pointer("pointerdown", 12);
  await pointer("pointermove", 1);
  await pointer("pointerup", 1);
  expect(JSON.parse(scroll.getAttribute("data-range") || "{}")).toMatchObject({ start: 10, end: 2 });
  expect(scroll.getAttribute("data-open")).toBe("true");
});

it.each(["Escape", "pointercancel"])("cancels %s without opening an AI dialog or changing the selected clip", async (action) => {
  await pointer("pointerdown", 1);
  await pointer("pointermove", 3);
  if (action === "Escape") await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  else await pointer("pointercancel", 3);
  await pointer("pointerup", 3);
  expect(host.firstElementChild?.getAttribute("data-open")).toBe("false");
  expect(host.firstElementChild?.getAttribute("data-range")).toBe("null");
  expect(usePlayerStore.getState().selectedElementId).toBe("clip-one");
  expect(usePlayerStore.getState().activeTool).toBe("select");
});

it("ignores a click without a meaningful range and keeps existing selection gestures available", async () => {
  await pointer("pointerdown", 2);
  await pointer("pointerup", 2);
  expect(host.firstElementChild?.getAttribute("data-open")).toBe("false");
  expect(host.firstElementChild?.getAttribute("data-range")).toBe("null");
  await pointer("pointerdown", 2);
  expect(clipDrag).toHaveBeenCalledOnce();
});
