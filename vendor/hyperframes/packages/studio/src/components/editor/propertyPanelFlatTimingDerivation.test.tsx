// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { FlatTimingRow } from "./propertyPanelFlatMotionSection";
import {
  clampPreviewTimeToElementRange,
  deriveElementTiming,
  resolveElementTimingEdit,
} from "./propertyPanelFlatTimingDerivation";

function createSelection(element = document.createElement("div")): DomEditSelection {
  return {
    id: "hero-orb",
    element,
    label: "Hero Orb",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: { start: "0", duration: "3.77" },
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

describe("element timing range editing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it("keeps the selected element visible when its end moves before the playhead", () => {
    const range = resolveElementTimingEdit(0, 3.77, "end", 3.22);
    expect(range).toEqual({ start: 0, end: 3.22, duration: 3.22 });
    if (!range) throw new Error("Expected a valid timing range");
    expect(clampPreviewTimeToElementRange(3.77, range)).toBeCloseTo(3.219);
  });

  it("keeps the opposite boundary fixed and rejects inverted ranges", () => {
    const range = resolveElementTimingEdit(0, 3.77, "start", 1.25);
    expect(range?.start).toBe(1.25);
    expect(range?.end).toBe(3.77);
    expect(range?.duration).toBeCloseTo(2.52);
    expect(resolveElementTimingEdit(0, 3.77, "start", 3.77)).toBeNull();
    expect(resolveElementTimingEdit(1, 3.77, "end", 1)).toBeNull();
  });

  it("shows only absolute start and end controls", () => {
    flushSync(() =>
      root.render(
        <FlatTimingRow
          element={createSelection()}
          currentTime={0}
          onSetAttribute={vi.fn()}
        />,
      ),
    );

    expect([...container.querySelectorAll("input")].map((input) => input.value)).toEqual([
      "0.00s",
      "3.77s",
    ]);
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("End");
    expect(container.textContent).not.toContain("Duration");
  });

  it("uses the real parent clip window before the element animation range", () => {
    const scene = document.createElement("section");
    scene.setAttribute("data-start", "5");
    scene.setAttribute("data-duration", "15");
    const lede = document.createElement("p");
    scene.append(lede);
    document.body.append(scene);

    const timing = deriveElementTiming(createSelection(lede), [
      {
        id: "lede-enter",
        targetSelector: ".lede",
        method: "to",
        position: 0.18,
        resolvedStart: 0.18,
        duration: 1.32,
        properties: { opacity: 1 },
      },
    ]);

    expect(timing).toEqual({ start: 5, duration: 15, inferred: false });
    scene.remove();
  });
});
