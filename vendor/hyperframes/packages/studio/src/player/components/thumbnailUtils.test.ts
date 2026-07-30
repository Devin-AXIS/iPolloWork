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
    expect(layout.frameW * layout.frameCount).toBeGreaterThanOrEqual(10_000);
  });
});
