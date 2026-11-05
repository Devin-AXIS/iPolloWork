// @vitest-environment happy-dom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import { TimelinePropertyKeyframes } from "./TimelinePropertyKeyframes";
import { TRACK_H } from "./timelineLayout";
import { usePlayerStore } from "../store/playerStore";

let container: HTMLDivElement;
let root: Root;
const element = {
  id: "title",
  key: "title",
  domId: "title",
  tag: "h1",
  start: 0,
  duration: 6,
  track: 1,
};
const animations = parseGsapScriptAcorn(
  'const tl=gsap.timeline();tl.to("#title",{duration:2,keyframes:{"0%":{x:0,opacity:0},"50%":{x:100,opacity:0.5},"100%":{x:200,opacity:1}}},1);tl.to("#title",{duration:1,keyframes:{"0%":{x:200},"100%":{x:300}}},4);',
).animations;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  usePlayerStore.setState({
    currentTime: 1.5,
    selectedPropertyKeyframe: null,
    selectedKeyframes: new Set(["title:50"]),
    activeKeyframePct: 50,
  });
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});
const render = (property = "opacity", edit = vi.fn(async () => true), timeOffset = 0, isLastPropertyRow = false) => {
  flushSync(() =>
    root.render(
      <TimelinePropertyKeyframes
        element={element}
        row={{ kind: "property", key: property, property, label: property }}
        animations={animations}
        pps={100}
        timeOffset={timeOffset}
        isLastPropertyRow={isLastPropertyRow}
        gutterWidth={255}
        trackContentWidth={600}
        onEditPropertyKeyframe={edit}
        onSeek={vi.fn()}
      />,
    ),
  );
  return edit;
};

it("aligns actual source keys to the ruler and connects only their own animation", () => {
  render("x");
  const lines = container.querySelectorAll("[data-property-animation-line]");
  expect(lines).toHaveLength(2);
  expect(container.querySelectorAll('[data-keyframe-time="1"]')).toHaveLength(1);
  const first = container.querySelector('[data-keyframe-time="1"]');
  if (!(first instanceof HTMLButtonElement)) throw new Error("Position key missing");
  expect(first.style.left).toBe("100px");
  expect(first.dataset.animationId).toBe(animations[0].id);
  expect(usePlayerStore.getState().selectedKeyframes.has("title:50")).toBe(true);
});

it("selects only one property point, clears legacy selection, and deletes just its channel", async () => {
  const edit = render();
  const point = container.querySelector('[data-keyframe-percentage="50"]');
  if (!(point instanceof HTMLButtonElement)) throw new Error("Opacity key missing");
  await act(async () => point.click());
  expect(usePlayerStore.getState().selectedPropertyKeyframe).toMatchObject({
    ownerKey: "title",
    property: "opacity",
    animationId: animations[0].id,
    time: 2,
  });
  expect(usePlayerStore.getState().selectedKeyframes.size).toBe(0);
  expect(usePlayerStore.getState().activeKeyframePct).toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="opacity keyframe value at 50%"]')
      ?.value,
  ).toBe("50");
  await act(async () =>
    point.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }),
    ),
  );
  expect(edit).toHaveBeenCalledWith(element, animations[0].id, "opacity", 50, { action: "remove" });
});

it("leaves recording to the toolbar instead of duplicating an add button in each property row", () => {
  render();
  expect(container.querySelector('[aria-label="opacity add keyframe at playhead"]')).toBeNull();
});

it("rebinds a selected channel after the source tween is split without losing its time", async () => {
  render();
  const point = container.querySelector('[data-keyframe-percentage="50"]');
  if (!(point instanceof HTMLButtonElement)) throw new Error("Property key missing");
  await act(async () => point.click());
  const split = animations.map((animation) =>
    animation === animations[0] ? { ...animation, id: "isolated-opacity" } : animation,
  );
  flushSync(() =>
    root.render(
      <TimelinePropertyKeyframes
        element={element}
        row={{ kind: "property", key: "opacity", property: "opacity", label: "Opacity" }}
        animations={split}
        pps={100}
        gutterWidth={255}
        trackContentWidth={600}
        onEditPropertyKeyframe={vi.fn(async () => true)}
      />,
    ),
  );
  expect(
    container
      .querySelector('[data-animation-id="isolated-opacity"][aria-pressed="true"]')
      ?.getAttribute("data-keyframe-time"),
  ).toBe("2");
});

it("shows local ruler positions with decorative hierarchy while retaining global key identity", async () => {
  const edit = render("x", vi.fn(async () => true), 1);
  const point = container.querySelector('[data-keyframe-time="1"]');
  if (!(point instanceof HTMLButtonElement)) throw new Error("Position key missing");
  expect(point.style.left).toBe("0px");
  const line = container.querySelector("[data-property-animation-line]");
  if (!(line instanceof HTMLElement)) throw new Error("Animation connector missing");
  expect(line.style.left).toBe("0px");
  expect(container.querySelector("[data-timeline-property-connector]")?.getAttribute("aria-hidden")).toBe("true");
  await act(async () => point.click());
  expect(usePlayerStore.getState().selectedPropertyKeyframe?.time).toBe(1);
  expect(edit).not.toHaveBeenCalled();
});

it("connects authored properties at one depth and ends the last branch without fictional ancestors", () => {
  render("x");
  const first = container.querySelector("[data-timeline-property-connector]");
  expect(first?.getAttribute("width")).toBe("44");
  expect(first?.querySelectorAll("path")).toHaveLength(2);
  expect(container.querySelector(".hf-timeline-property-label")?.textContent).toBe("x");
  render("opacity", vi.fn(async () => true), 0, true);
  const last = container.querySelector("[data-timeline-property-connector]");
  expect(last?.getAttribute("width")).toBe("44");
  expect(last?.querySelectorAll("path")).toHaveLength(1);
  expect(last?.querySelector("path")?.getAttribute("d")).toBe(`M 36 0 V ${TRACK_H / 2} H 41`);
});

it("rejects an out-of-range time and restores the saved field instead of leaving a false value", async () => {
  const edit=render();
  const point=container.querySelector('[data-keyframe-percentage="50"]');
  if (!(point instanceof HTMLButtonElement)) throw new Error("Opacity point missing");
  await act(async () => point.click());
  const input=container.querySelector('[aria-label="opacity keyframe time at 50%"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Time field missing");
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(input,"8");
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await act(async () => input.blur());
  expect(container.querySelector<HTMLInputElement>('[aria-label="opacity keyframe time at 50%"]')?.value).toBe("2");
  expect(edit).not.toHaveBeenCalled();
});
