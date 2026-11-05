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
    data-outline={JSON.stringify(range.annotationOutline)}
    onPointerDownCapture={(event) => {
      if ((mode !== "annotate" && mode !== "annotate-lasso") || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      range.handlePointerDown(event);
    }}
    onPointerDown={range.handlePointerDown} onPointerMove={range.handlePointerMove}
    onPointerUp={range.handlePointerUp} onPointerCancel={range.cancelRangeSelection}>
    <div data-clip="true" onPointerDown={clipDrag}>Clip</div>
    <div data-clip="true" data-el-id="other-track" onPointerDown={clipDrag}>Other track</div>
    <button onClick={range.cancelRangeSelection}>Close annotation</button>
  </div>;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  usePlayerStore.setState({ activeTool: "annotate", isPlaying: true, selectedElementId: "clip-one", selectedElementIds: new Set(["clip-one"]),
    elements: [{ id: "clip-one", tag: "div", start: 1, duration: 3, track: 1 },
      { id: "other-track", tag: "div", start: 1, duration: 3, track: 2 }] });
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  const scroll = host.firstElementChild;
  if (!(scroll instanceof HTMLDivElement)) throw new Error("Timeline scroll missing");
  vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 1000, 300));
  scroll.setPointerCapture = vi.fn();
  const other = host.querySelector('[data-el-id="other-track"]');
  if (!other) throw new Error("Other track missing");
  vi.spyOn(other, "getBoundingClientRect").mockReturnValue(new DOMRect(228, 180, 300, 40));
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

it("limits a partial range to the pressed clip and excludes overlapping tracks, even when dragging past its end", async () => {
  const node = host.querySelector<HTMLElement>("[data-clip]");
  if (!node) throw new Error("Clip missing");
  node.dataset.elId = "clip-one";
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue(new DOMRect(228, 90, 300, 40));
  await pointer("pointerdown", 1.25);
  await pointer("pointermove", 9);
  await pointer("pointerup", 9);
  const range = JSON.parse(host.firstElementChild?.getAttribute("data-range") || "{}");
  expect(range).toMatchObject({ start: 1.25, end: 4, kind: "clip-range", row: { top: 50, height: 40 } });
  expect(range.selectedElements.map((el: { id: string }) => el.id)).toEqual(["clip-one"]);
  expect(clipDrag).not.toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
});

it("lassos actual rendered clip boxes with scrolling and leaves unselected tracks unchanged", async () => {
  const scroll = host.firstElementChild;
  const clip = host.querySelector<HTMLElement>("[data-clip]");
  if (!(scroll instanceof HTMLDivElement) || !clip) throw new Error("Timeline missing");
  clip.dataset.elId = "clip-one";
  vi.spyOn(clip, "getBoundingClientRect").mockReturnValue(new DOMRect(228, 90, 300, 40));
  scroll.scrollLeft = 100;
  scroll.scrollTop = 30;
  await act(async () => usePlayerStore.getState().setActiveTool("annotate-lasso"));
  for (const [index, [x, y]] of [[215, 80], [540, 80], [540, 140], [215, 140], [215, 80]].entries()) {
    await act(async () => (index === 0 ? clip : scroll).dispatchEvent(new PointerEvent(index === 0 ? "pointerdown" : "pointermove", {
      bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y,
    })));
  }
  await act(async () => scroll.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 })));
  const range = JSON.parse(scroll.getAttribute("data-range") || "{}");
  expect(range).toMatchObject({ start: 1, end: 4, kind: "timeline-lasso" });
  expect(range.selectedElements.map((el: { id: string }) => el.id)).toEqual(["clip-one"]);
  expect(scroll.getAttribute("data-open")).toBe("true");
  expect(JSON.parse(scroll.getAttribute("data-outline") || "[]")).toHaveLength(5);
  expect(clipDrag).not.toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().activeTool).toBe("select");
  await act(async () => host.querySelector("button")?.click());
  expect(scroll.getAttribute("data-outline")).toBe("[]");
  expect(scroll.getAttribute("data-range")).toBe("null");
  expect(scroll.getAttribute("data-open")).toBe("false");
});

it("does not submit empty lasso selections and cancels them without moving clips", async () => {
  await act(async () => usePlayerStore.getState().setActiveTool("annotate-lasso"));
  await pointer("pointerdown", 8);
  await pointer("pointermove", 9);
  await pointer("pointerup", 9);
  expect(host.firstElementChild?.getAttribute("data-open")).toBe("false");
  expect(usePlayerStore.getState().activeTool).toBe("annotate-lasso");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(usePlayerStore.getState().activeTool).toBe("select");
});

it("shows the open pen stroke and ignores a straight drag across a real clip", async () => {
  const scroll = host.firstElementChild;
  const clip = host.querySelector<HTMLElement>("[data-clip]");
  if (!(scroll instanceof HTMLDivElement) || !clip) throw new Error("Timeline missing");
  clip.dataset.elId = "clip-one";
  vi.spyOn(clip, "getBoundingClientRect").mockReturnValue(new DOMRect(228, 90, 300, 40));
  await act(async () => usePlayerStore.getState().setActiveTool("annotate-lasso"));
  await pointer("pointerdown", 1.25);
  await pointer("pointermove", 2.5);
  expect(JSON.parse(scroll.getAttribute("data-outline") || "[]")).toHaveLength(2);
  await pointer("pointerup", 2.5);
  expect(scroll.getAttribute("data-open")).toBe("false");
  expect(scroll.getAttribute("data-outline")).toBe("[]");
  expect(usePlayerStore.getState().activeTool).toBe("annotate-lasso");
  expect(clipDrag).not.toHaveBeenCalled();
});

it("uses the freehand polygon rather than its bounding box to exclude a clip in an unselected corner", async () => {
  const scroll = host.firstElementChild;
  const clip = host.querySelector<HTMLElement>("[data-clip]");
  const other = host.querySelector('[data-el-id="other-track"]');
  if (!(scroll instanceof HTMLDivElement) || !clip || !other) throw new Error("Timeline missing");
  clip.dataset.elId = "clip-one";
  vi.spyOn(clip, "getBoundingClientRect").mockReturnValue(new DOMRect(228, 90, 300, 40));
  vi.mocked(other.getBoundingClientRect).mockReturnValue(new DOMRect(370, 190, 100, 30));
  await act(async () => usePlayerStore.getState().setActiveTool("annotate-lasso"));
  for (const [index, [x, y]] of [[220, 80], [550, 80], [550, 140], [320, 140], [320, 250], [220, 250], [220, 80]].entries()) {
    await act(async () => (index === 0 ? clip : scroll).dispatchEvent(new PointerEvent(index === 0 ? "pointerdown" : "pointermove", {
      bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y,
    })));
  }
  await act(async () => scroll.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 })));
  const range = JSON.parse(scroll.getAttribute("data-range") || "{}");
  expect(range.selectedElements.map((el: { id: string }) => el.id)).toEqual(["clip-one"]);
  expect(scroll.getAttribute("data-open")).toBe("true");
});
