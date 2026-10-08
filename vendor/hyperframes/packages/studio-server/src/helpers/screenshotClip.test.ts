import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reviewVideoRuntime } from "./screenshotClip.js";

beforeAll(() => {
  // Exercise the same bundled GSAP runtime used by native video recipes.
  new Function(readFileSync("../../registry/blocks/process-steps/gsap.min.js", "utf8")).call(window);
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
  Reflect.get(window, "gsap").globalTimeline.clear();
  Reflect.get(window, "gsap").globalTimeline.startTime(0);
  Reflect.get(window, "gsap").ticker.sleep();
  Reflect.deleteProperty(window, "__timelines");
  document.body.innerHTML = "";
});

function fixture(start = 0, duration = 8, rootStart: number | null = 0) {
  document.body.innerHTML = `<section id="proof" class="scene clip" data-start="${start}" data-duration="${duration}"><div class="card"></div><div class="card"></div><div class="card"></div></section><div id="outside"></div>`;
  const scene = document.querySelector("#proof")!;
  const cards = Array.from(scene.querySelectorAll(".card"));
  const gsap = Reflect.get(window, "gsap");
  const timeline = gsap.timeline({ paused: true });
  if (rootStart !== null) timeline.startTime(rootStart);
  Reflect.set(window, "__timelines", { root: timeline });
  const beat = (from: number, to: number, animation = "custom:tasks-enter") => ({ intent: "Develop", animation, targets: [".card"], motion: { start: from, end: to } });
  const declare = (...beats: ReturnType<typeof beat>[]) => scene.setAttribute("data-ipw-beats", JSON.stringify(beats));
  return { gsap, timeline, cards, beat, declare };
}

describe("executed custom motion windows", () => {
  it("uses composition time when a paused root is authored after loading", async () => {
    const gsap = Reflect.get(window, "gsap");
    gsap.to({ clock: 0 }, { clock: 1, duration: 10 });
    gsap.updateRoot(7);
    const { timeline, cards, beat, declare } = fixture(0, 8, null);
    expect(timeline.globalTime(0)).toBeGreaterThan(6);
    timeline.to(cards, { x: 100, duration: 1, data: "custom:tasks-enter" }, 1);
    declare(beat(1, 2));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("uses the root's local clock even when its playback timeScale changes", async () => {
    const { timeline, cards, beat, declare } = fixture(0, 8, 7);
    timeline.timeScale(2);
    timeline.to(cards, { x: 100, duration: 1, data: "custom:tasks-enter" }, 1);
    declare(beat(1, 2));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("maps separately registered nested children to their master composition clock", async () => {
    const { gsap, timeline, cards, beat, declare } = fixture(0, 8, 9);
    const nested = gsap.timeline({ paused: false }).timeScale(2);
    nested.to(cards, { x: 100, duration: 2, data: "custom:tasks-enter" }, 1);
    timeline.add(nested, 2.5).timeScale(1.5);
    nested.pause();
    Reflect.set(window, "__timelines", { child: nested, root: timeline });
    declare(beat(3, 4));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("rejects a staggered entrance ending before its declared Develop window", async () => {
    const { timeline, cards, beat, declare } = fixture(0, 8, 7);
    timeline.to(cards, { x: 100, duration: .85, stagger: .55, data: "custom:tasks-enter" }, 1.8);
    declare(beat(1.8, 5.6));
    const result = await reviewVideoRuntime();
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: "executed-event-end-mismatch", time: 5.6, detail: expect.stringContaining("executed end 3.75") })]);
  });

  it("keeps the existing decorative-action scan in the same composition clock", async () => {
    const { timeline, cards, beat, declare } = fixture(0, 8, 7);
    timeline.to(cards, { letterSpacing: 1, duration: 5, data: "custom:tasks-enter" }, 1);
    declare(beat(1, 6));
    expect((await reviewVideoRuntime()).issues).toEqual([expect.objectContaining({ code: "long-develop-only-decorative" })]);
  });

  it("accepts the full stagger duration followed by a deliberate reading hold", async () => {
    const { timeline, cards, beat, declare } = fixture(0, 12);
    timeline.to(cards, { x: 100, duration: .85, stagger: .55, data: "custom:tasks-enter" }, 1.8);
    declare(beat(1.8, 3.75));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("uses nested offsets and timeScale in composition time", async () => {
    const { gsap, timeline, cards, beat, declare } = fixture(8, 8);
    const nested = gsap.timeline({ paused: false }).timeScale(2);
    nested.to(cards, { x: 100, duration: 3.8, data: "custom:tasks-enter" }, 2.4);
    timeline.add(nested, 8.6);
    declare(beat(1.8, 3.7));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("includes finite repeats and their deliberate pauses", async () => {
    const { timeline, cards, beat, declare } = fixture();
    timeline.to(cards, { x: 100, duration: .5, repeat: 2, repeatDelay: .25, data: "custom:tasks-enter" }, 1);
    declare(beat(1, 3));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it.each([
    { start: .1, length: 1, code: "executed-event-time-mismatch" },
    { start: 0, length: 1.1, code: "executed-event-end-mismatch" },
  ])("rejects an actual endpoint outside frame tolerance ($code)", async ({ start, length, code }) => {
    const { timeline, cards, beat, declare } = fixture();
    timeline.to(cards, { x: 100, duration: length, data: "custom:tasks-enter" }, 1 + start);
    declare(beat(1, 2));
    expect((await reviewVideoRuntime()).issues).toEqual([expect.objectContaining({ code })]);
  });

  it("accepts endpoint rounding within one review frame", async () => {
    const { timeline, cards, beat, declare } = fixture();
    timeline.to(cards, { x: 100, duration: 1, data: "custom:tasks-enter" }, 1.02);
    declare(beat(1, 2));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("keeps separate windows when a shared action tag is reused", async () => {
    const { timeline, cards, beat, declare } = fixture();
    timeline.to(cards[0], { x: 100, duration: 1, data: "custom:tasks-enter" }, 1);
    timeline.to(cards[1], { x: 100, duration: 1, data: "custom:tasks-enter" }, 6);
    declare(beat(1, 2), beat(6, 7));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("allows pauses between correctly declared steps of one action", async () => {
    const { timeline, cards, beat, declare } = fixture();
    timeline.to(cards[0], { x: 100, duration: 1, data: "custom:tasks-enter" }, 1);
    timeline.to(cards[1], { x: 100, duration: 1, data: "custom:tasks-enter" }, 6);
    declare(beat(1, 7));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });

  it("does not satisfy a scene action with a tween targeting another scene", async () => {
    const { timeline, beat, declare } = fixture();
    timeline.to(document.querySelector("#outside"), { x: 100, duration: 1, data: "custom:tasks-enter" }, 1);
    declare(beat(1, 2));
    expect((await reviewVideoRuntime()).issues).toEqual([expect.objectContaining({ code: "semantic-event-not-executed" })]);
  });

  it("retains native component timing without imposing the custom endpoint check", async () => {
    const { timeline, cards, beat, declare } = fixture(8, 8, 7);
    timeline.to(cards, { x: 100, duration: 4 }, 1);
    declare(beat(1, 2, "component:spatial-camera-suite"));
    expect((await reviewVideoRuntime()).issues).toEqual([]);
  });
});
