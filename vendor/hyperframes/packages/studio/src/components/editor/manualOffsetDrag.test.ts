// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  applyManualOffsetDragMatrix,
  measureManualOffsetDragScreenToOffsetMatrix,
} from "./manualOffsetDrag";

describe("manual offset drag coordinate measurement", () => {
  it("measures nested transforms on the first drag instead of assuming canvas scale", () => {
    const element = document.createElement("div");
    element.style.translate = "7px 9px";
    document.body.append(element);
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        const [x = 0, y = 0] = element.style
          .getPropertyValue("translate")
          .split(/\s+/)
          .map((value) => Number.parseFloat(value));
        // Simulate a scaled/skewed ancestor. A scale-only shortcut cannot
        // invert this response, while a real movement probe can.
        const left = 40 + 2 * x + y;
        const top = 20 + 0.5 * x + 3 * y;
        return { left, top, width: 100, height: 50 };
      },
    });

    const measured = measureManualOffsetDragScreenToOffsetMatrix(
      element,
      { x: 0, y: 0 },
      { scaleX: 0.5, scaleY: 0.5 },
    );
    if (!measured.ok) throw new Error(measured.reason);

    const offset = applyManualOffsetDragMatrix(measured.matrix, { x: 30, y: 20 });
    expect(offset.x).toBeCloseTo(12.727, 3);
    expect(offset.y).toBeCloseTo(4.545, 3);
    expect(element.style.translate).toBe("7px 9px");
  });
});
