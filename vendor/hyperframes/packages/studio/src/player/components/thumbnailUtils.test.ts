import { describe, expect, test } from "vitest";
import {
  computeThumbnailStrip,
  MAX_THUMBNAIL_TILES,
  THUMBNAIL_CLIP_HEIGHT,
} from "./thumbnailUtils";

describe("timeline thumbnail strip", () => {
  test("uses the compact media body height", () => {
    expect(THUMBNAIL_CLIP_HEIGHT).toBe(24);
  });

  test("caps DOM tiles while still filling wide clips", () => {
    const layout = computeThumbnailStrip(10_000, 16 / 9);
    expect(layout.frameCount).toBe(MAX_THUMBNAIL_TILES);
    expect(layout.frameW * layout.frameCount).toBeCloseTo(10_000);
  });

});

test("keeps a full poster in narrow clips and fits tiles after zooming", () => {
  for (const width of [6, 20, 51, 52, 120, 400]) {
    const layout = computeThumbnailStrip(width, 16 / 9, 40);
    expect(layout.frameW * layout.frameCount).toBeCloseTo(width);
    expect(layout.frameW).toBeLessThanOrEqual(width);
    if (width < 52) expect(layout.frameCount).toBe(1);
  }
});
