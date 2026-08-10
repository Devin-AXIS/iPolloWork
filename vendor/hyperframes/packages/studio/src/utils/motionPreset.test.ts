import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { RegistryMotionPreset } from "@hyperframes/core/registry";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { resolveMotionPresetSelection, resolveMotionPresetTiming } from "./motionPreset";

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
});

describe("resolveMotionPresetSelection", () => {
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
