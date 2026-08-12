import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  computeThumbnailStrip,
  MAX_CONCURRENT_TIMELINE_THUMBNAIL_TASKS,
  MAX_THUMBNAIL_TILES,
  scheduleTimelineThumbnailTask,
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

  test("bounds expensive thumbnail work and starts the next queued task on release", () => {
    const started: number[] = [];
    const releases = [1, 2, 3].map((id) => scheduleTimelineThumbnailTask(() => started.push(id)));

    expect(started).toEqual(
      Array.from({ length: MAX_CONCURRENT_TIMELINE_THUMBNAIL_TASKS }, (_, index) => index + 1),
    );
    releases[0]();
    expect(started).toEqual([1, 2, 3]);
    releases.slice(1).forEach((release) => release());
  });

  test("defers offscreen timeline preview work and avoids synchronous video encoding", () => {
    const compositionSource = readFileSync(
      new URL("./CompositionThumbnail.tsx", import.meta.url),
      "utf8",
    );
    const videoSource = readFileSync(new URL("./VideoThumbnail.tsx", import.meta.url), "utf8");

    for (const source of [compositionSource, videoSource]) {
      expect(source).toContain("new IntersectionObserver");
      expect(source).toContain("window.requestIdleCallback");
      expect(source).toContain("scheduleTimelineThumbnailTask");
    }
    expect(compositionSource).toContain('backgroundRepeat: "repeat-x"');
    expect(videoSource).toContain("canvas.toBlob(");
    expect(videoSource).not.toContain("canvas.toDataURL(");
  });
});
