// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  materializeMotionTextPreviewParts,
  previewStructuredMotion,
} from "./structuredMotionPreview";

function createTimeline() {
  const timeline = {
    to: vi.fn(),
    set: vi.fn(),
    play: vi.fn(),
    kill: vi.fn(),
  };
  timeline.to.mockReturnValue(timeline);
  timeline.set.mockReturnValue(timeline);
  return timeline;
}

describe("previewStructuredMotion", () => {
  it("uses the same reversible word or character parts as persisted text motion", () => {
    const target = document.createElement("p");
    const original = document.createTextNode("Exact motion");
    target.append(original);

    const preview = materializeMotionTextPreviewParts(target, "character");

    expect(preview.targets).toHaveLength(11);
    expect(preview.targets.every((part) => part.style.fontWeight === "700")).toBe(true);
    expect(target.textContent).toBe("Exact motion");

    preview.restore();
    expect(target.firstChild).toBe(original);
    expect(target.childNodes).toHaveLength(1);
  });

  it("runs Highlight with the compiled role tracks and restores the exact authored DOM", () => {
    const target = document.createElement("h1");
    target.setAttribute("style", "letter-spacing: 1px");
    target.setAttribute("data-source", "authored");
    const originalText = document.createTextNode("Make motion clear.");
    target.append(originalText);
    document.body.append(target);
    const timeline = createTimeline();
    const createGsapTimeline = vi.fn(() => timeline);

    const preview = previewStructuredMotion({
      target,
      presetId: "text.emphasis.highlight-sweep",
      targetKind: "text",
      parameters: {
        unit: "word",
        stagger: 0.05,
        colorSource: "custom",
        color: "#FF1745",
        direction: "right",
        intensity: 1,
        roundness: 10,
        speed: 1,
      },
      duration: 0.65,
      loop: true,
      gsap: { timeline: createGsapTimeline },
    });

    expect(preview?.timeline).toBe(timeline);
    expect(createGsapTimeline).toHaveBeenCalledWith({ paused: true });
    expect(target.querySelectorAll('[data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(target.querySelectorAll('[data-ipw-motion-role="background"]')).toHaveLength(3);
    expect(target.querySelectorAll('[data-ipw-motion-role="text"]')).toHaveLength(3);
    expect(target.getAttribute("data-ipw-motion-presentation")).toBe("text-v1");
    const previewText = target.querySelector<HTMLElement>('[data-ipw-motion-role="text"]');
    expect(previewText?.style.fontWeight).toBe("700");
    expect(previewText?.style.lineHeight).toBe("1.1");
    expect(previewText?.style.letterSpacing).toBe("-0.025em");
    expect(timeline.to).toHaveBeenCalledTimes(4);
    expect(timeline.set).toHaveBeenCalledTimes(1);

    const [revealTargets, revealVars, revealPosition] = timeline.to.mock.calls[0];
    expect(revealTargets).toHaveLength(3);
    expect(revealPosition).toBe(0);
    expect(revealVars.duration).toBeCloseTo(0.181395348837, 12);
    expect(revealVars.stagger).toBeCloseTo(0.060465116279, 12);
    expect(revealVars).not.toHaveProperty("ease");
    expect(revealVars.keyframes["0%"].backgroundImage).toContain("#ff1745");
    expect(revealVars.keyframes["100%"].ease).toBe("power2.out");

    const exitVars = timeline.to.mock.calls[1][1];
    expect(exitVars.duration).toBeCloseTo(0.120930232558, 12);
    expect(exitVars.stagger).toBeCloseTo(0.060465116279, 12);
    expect(exitVars.keyframes["100%"].ease).toBe("power2.in");
    expect(exitVars).not.toHaveProperty("ease");

    const [resetTargets, resetVars, resetPosition] = timeline.set.mock.calls[0];
    expect(resetTargets).toHaveLength(3);
    expect(resetPosition).toBeCloseTo(0.399069767442, 12);
    expect(resetVars.opacity).toBe(0);
    expect(resetVars.scaleX).toBe(0);
    expect(resetVars.stagger).toBeCloseTo(0.060465116279, 12);
    expect(resetVars).not.toHaveProperty("keyframes");
    expect(timeline.play).toHaveBeenCalledWith(0);

    preview?.cleanup();

    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(target.firstChild).toBe(originalText);
    expect(target.textContent).toBe("Make motion clear.");
    expect(target.getAttribute("style")).toBe("letter-spacing: 1px");
    expect(target.getAttribute("data-source")).toBe("authored");
    expect(target.hasAttribute("data-ipw-motion-structure")).toBe(false);
    expect(target.hasAttribute("data-ipw-motion-presentation")).toBe(false);
    target.remove();
  });

  it("drives structured preview while video GSAP is paused and holds its readable final frame", () => {
    const target = document.createElement("h1");
    target.textContent = "Make motion clear.";
    document.body.append(target);
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const timeline = {
      ...createTimeline(),
      progress: vi.fn(),
      eventCallback: vi.fn(),
    };
    timeline.progress.mockReturnValue(timeline);
    timeline.eventCallback.mockReturnValue(timeline);

    const preview = previewStructuredMotion({
      target,
      presetId: "text.emphasis.highlight-sweep",
      targetKind: "text",
      parameters: { unit: "word", stagger: 0.05 },
      duration: 0.65,
      loop: true,
      gsap: { timeline: vi.fn(() => timeline) },
    });

    expect(timeline.play).not.toHaveBeenCalled();
    expect(timeline.progress).toHaveBeenCalledWith(0);
    frameCallbacks.shift()?.(1_000);
    frameCallbacks.shift()?.(1_260);
    expect(timeline.progress).toHaveBeenCalledWith(0.5);
    frameCallbacks.shift()?.(1_520);
    expect(timeline.progress).toHaveBeenCalledWith(1);
    frameCallbacks.shift()?.(1_600);
    expect(timeline.progress.mock.calls.at(-1)?.[0]).toBe(1);
    frameCallbacks.shift()?.(1_650);
    expect(timeline.progress.mock.calls.at(-1)?.[0]).toBe(0);

    preview?.cleanup();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    target.remove();
    vi.unstubAllGlobals();
  });

  it("leaves the DOM untouched when the preset is not structured", () => {
    const target = document.createElement("div");
    const originalText = document.createTextNode("Plain motion");
    target.append(originalText);
    const createGsapTimeline = vi.fn();

    const preview = previewStructuredMotion({
      target,
      presetId: "text.enter.rise",
      targetKind: "text",
      parameters: {},
      duration: 0.7,
      loop: false,
      gsap: { timeline: createGsapTimeline },
    });

    expect(preview).toBeUndefined();
    expect(createGsapTimeline).not.toHaveBeenCalled();
    expect(target.firstChild).toBe(originalText);
  });

  it("rolls back materialized DOM when a track cannot be scheduled", () => {
    const target = document.createElement("div");
    target.setAttribute("style", "color: navy");
    const originalText = document.createTextNode("Make motion clear.");
    target.append(originalText);
    const timeline = createTimeline();
    timeline.to.mockImplementationOnce(() => {
      throw new Error("GSAP rejected track");
    });

    const preview = previewStructuredMotion({
      target,
      presetId: "text.emphasis.highlight-sweep",
      targetKind: "text",
      parameters: {},
      duration: 0.65,
      loop: false,
      gsap: { timeline: vi.fn(() => timeline) },
    });

    expect(preview).toBeUndefined();
    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(target.firstChild).toBe(originalText);
    expect(target.getAttribute("style")).toBe("color: navy");
    expect(target.hasAttribute("data-ipw-motion-structure")).toBe(false);
  });
});
