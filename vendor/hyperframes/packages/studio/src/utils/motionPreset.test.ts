import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { RegistryMotionPreset } from "@hyperframes/core/registry";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  rebaseMotionPresetKeyframes,
  resolveCaptionMotionTargetElement,
  resolveMotionPresetSelection,
  resolveMotionPresetTiming,
  resolveMotionTimelineSpan,
  resolveSemanticMotionTiming,
  resolveStructuredTextMotionTiming,
} from "./motionPreset";

const openingPreset: RegistryMotionPreset = {
  version: 1,
  category: "opening",
  targets: ["any"],
  anchor: "clip-start",
  duration: 1.2,
  ease: "power3.out",
  keyframes: [
    { percentage: 0, properties: { opacity: 0, y: 40 } },
    { percentage: 100, properties: { opacity: 1, y: 0 } },
  ],
};

function timingSelection(start: string, duration: string) {
  return {
    dataAttributes: { start, duration },
  };
}

function domSelection(element: HTMLElement): DomEditSelection {
  return {
    element,
    label: "selection",
    tagName: element.tagName.toLowerCase(),
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

describe("resolveMotionPresetTiming", () => {
  it("rebases relative preset motion around the user's placed position", () => {
    expect(rebaseMotionPresetKeyframes(openingPreset.keyframes, { x: 120, y: 240 })).toEqual([
      { percentage: 0, properties: { opacity: 0, y: 280 } },
      { percentage: 100, properties: { opacity: 1, y: 240 } },
    ]);
    expect(openingPreset.keyframes[0]?.properties.y).toBe(40);
  });

  it("anchors opening motion to the clip start", () => {
    expect(resolveMotionPresetTiming(timingSelection("2", "5"), openingPreset, 4)).toEqual({
      position: 2,
      duration: 1.2,
    });
  });

  it("anchors ending motion to the clip end", () => {
    expect(
      resolveMotionPresetTiming(
        timingSelection("2", "5"),
        { ...openingPreset, category: "ending", anchor: "clip-end", duration: 1.5 },
        3,
      ),
    ).toEqual({ position: 5.5, duration: 1.5 });
  });

  it("clamps playhead motion and duration inside short clips", () => {
    expect(
      resolveMotionPresetTiming(
        timingSelection("3", "0.8"),
        { ...openingPreset, category: "transition", anchor: "playhead", duration: 1.4 },
        9,
      ),
    ).toEqual({ position: 3, duration: 0.8 });
  });

  it("uses the nearest timed composition owner for nested elements", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <section class="clip" data-start="9.6" data-duration="3">
        <article id="card"><span>Nested content</span></article>
      </section>`;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    expect(
      resolveSemanticMotionTiming({ element: card, dataAttributes: {} }, "emphasis", 0.8),
    ).toEqual({ position: 9.6, duration: 0.8 });
    expect(resolveMotionTimelineSpan({ element: card, dataAttributes: {} }, 0.8)).toEqual({
      start: 9.6,
      end: 12.6,
      duration: 3,
      constrained: true,
    });
  });

  it("repairs a stale semantic motion position outside its current owner", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <section class="clip" data-start="15.6" data-duration="3">
        <div id="result-card"></div>
      </section>`;
    const card = window.document.getElementById("result-card") as unknown as HTMLElement;

    expect(
      resolveSemanticMotionTiming({ element: card, dataAttributes: {} }, "emphasis", 0.8, 0.1),
    ).toEqual({ position: 15.6, duration: 0.8 });
  });

  it("clamps semantic motion duration to a short owner", () => {
    expect(resolveSemanticMotionTiming(timingSelection("3", "0.5"), "enter", 1.2)).toEqual({
      position: 3,
      duration: 0.5,
    });
  });

  it("starts structured caption motion at the caption clip start", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <section class="clip" data-ipw-caption="true" data-start="6" data-duration="4">
        <span id="caption-text" data-ipw-caption-text="true">Animated caption</span>
      </section>`;
    const captionText = window.document.getElementById("caption-text") as unknown as HTMLElement;

    expect(
      resolveStructuredTextMotionTiming(
        { element: captionText, dataAttributes: {} },
        "emphasis",
        1.2,
      ),
    ).toEqual({ position: 6, duration: 1.2 });
  });

  it("keeps body structured text on normal phase timing", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <section class="clip" data-start="6" data-duration="4">
        <h2 id="headline">Animated headline</h2>
      </section>`;
    const headline = window.document.getElementById("headline") as unknown as HTMLElement;

    expect(
      resolveStructuredTextMotionTiming(
        { element: headline, dataAttributes: {} },
        "emphasis",
        1.2,
        6.5,
      ),
    ).toEqual({ position: 6.5, duration: 1.2 });
  });
});

describe("resolveMotionPresetSelection", () => {
  it("normalizes a generated caption owner to its actual text node", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="caption" data-ipw-caption="true">
        <span id="content" data-ipw-caption-text="true">Generated caption</span>
      </div>`;
    const owner = window.document.getElementById("caption") as unknown as HTMLElement;
    const content = window.document.getElementById("content") as unknown as HTMLElement;

    expect(resolveCaptionMotionTargetElement(owner)).toBe(content);
    expect(resolveCaptionMotionTargetElement(content)).toBe(content);
  });

  it("targets the editable content wrapper when a caption owner is selected", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="caption" data-ipw-caption="true">
        <span id="content" data-ipw-caption-content="true">Readable caption</span>
      </div>`;
    const owner = window.document.getElementById("caption") as unknown as HTMLElement;
    const content = window.document.getElementById("content") as unknown as HTMLElement;
    const result = resolveMotionPresetSelection(domSelection(owner), {
      ...openingPreset,
      category: "caption",
      targets: ["caption", "text"],
    });

    expect(result.compatible).toBe(true);
    expect(result.targetElement).toBe(content);
    expect(result.kinds).toContain("caption");
  });

  it("recognizes the canonical generated caption text marker", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="caption" data-ipw-caption="true">
        <span id="content" data-ipw-caption-text="true">Generated caption</span>
      </div>`;
    const owner = window.document.getElementById("caption") as unknown as HTMLElement;
    const content = window.document.getElementById("content") as unknown as HTMLElement;
    const result = resolveMotionPresetSelection(domSelection(owner), {
      ...openingPreset,
      category: "caption",
      targets: ["caption", "text"],
    });

    expect(result.compatible).toBe(true);
    expect(result.targetElement).toBe(content);
  });

  it("resolves a visible caption wrapper linked to a timed owner", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="caption" data-ipw-caption="true"></div>
      <div data-ipw-caption-owner="caption">
        <span id="content" data-ipw-caption-content="true">Linked caption</span>
      </div>`;
    const content = window.document.getElementById("content") as unknown as HTMLElement;
    const result = resolveMotionPresetSelection(domSelection(content), {
      ...openingPreset,
      category: "caption",
      targets: ["caption"],
    });

    expect(result.compatible).toBe(true);
    expect(result.targetElement).toBe(content);
  });

  it("rejects media for a caption-only preset", () => {
    const window = new Window();
    const image = window.document.createElement("img") as unknown as HTMLElement;
    const result = resolveMotionPresetSelection(domSelection(image), {
      ...openingPreset,
      category: "caption",
      targets: ["caption"],
    });

    expect(result.compatible).toBe(false);
    expect(result.kinds).toContain("image");
  });
});
