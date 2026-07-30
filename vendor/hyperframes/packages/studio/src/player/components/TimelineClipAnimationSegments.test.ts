import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("timeline clip animation segment interaction", () => {
  test("keeps pointer preview local and performs one isolated release commit", () => {
    const source = readFileSync(
      new URL("./TimelineClipAnimationSegments.tsx", import.meta.url),
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
