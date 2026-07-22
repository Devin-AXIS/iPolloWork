import { describe, expect, it } from "vitest";

import { resolveBoundedOverlayPosition } from "./boundedOverlay";

describe("resolveBoundedOverlayPosition", () => {
  const host = { left: 100, top: 50, right: 700, bottom: 450, width: 600, height: 400 };

  it("keeps an oversized toolbar inside the left and right edges", () => {
    const position = resolveBoundedOverlayPosition(
      { left: 101, top: 180, right: 141, bottom: 200, width: 40, height: 20 },
      host,
      { width: 700, height: 40 },
      { edgePadding: 12, gap: 8 },
    );

    expect(position.left).toBe(12);
    expect(position.maxWidth).toBe(576);
    expect(position.left + Math.min(700, position.maxWidth)).toBeLessThanOrEqual(588);
  });

  it("flips below a selection near the top edge", () => {
    const position = resolveBoundedOverlayPosition(
      { left: 300, top: 52, right: 360, bottom: 72, width: 60, height: 20 },
      host,
      { width: 320, height: 80 },
      { edgePadding: 12, gap: 8 },
    );

    expect(position.placement).toBe("below");
    expect(position.top).toBe(30);
  });

  it("keeps a tall toolbar inside the bottom edge", () => {
    const position = resolveBoundedOverlayPosition(
      { left: 640, top: 420, right: 690, bottom: 440, width: 50, height: 20 },
      host,
      { width: 320, height: 500 },
      { edgePadding: 12, gap: 8 },
    );

    expect(position.top).toBe(12);
    expect(position.maxHeight).toBe(376);
  });
});
