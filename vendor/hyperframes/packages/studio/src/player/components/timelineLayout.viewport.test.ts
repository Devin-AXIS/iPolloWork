import { describe, expect, test } from "vitest";
import {
  DEFAULT_TIMELINE_GUTTER_WIDTH,
  MAX_TIMELINE_GUTTER_WIDTH,
  MIN_TIMELINE_GUTTER_WIDTH,
  RULER_H,
  TRACK_H,
  TRACKS_LEFT_PAD,
  clampTimelineGutterWidth,
  getTimelineGutterMaxWidth,
  getTimelineVisibleWindow,
} from "./timelineLayout";

describe("timeline visible window", () => {
  test("keeps only visible tracks plus vertical overscan", () => {
    const window = getTimelineVisibleWindow({
      scrollLeft: 0,
      scrollTop: RULER_H + TRACK_H * 50,
      viewportWidth: 900,
      viewportHeight: TRACK_H * 10,
      pps: 100,
      trackCount: 200,
      displayDuration: 300,
      gutterWidth: DEFAULT_TIMELINE_GUTTER_WIDTH,
      verticalOverscanRows: 3,
      horizontalOverscanViewports: 0,
    });

    expect(window.firstTrackIndex).toBe(47);
    expect(window.lastTrackIndexExclusive).toBe(63);
  });

  test("culls time with one viewport of overscan while preserving full geometry", () => {
    const viewportWidth = 1_000;
    const pps = 100;
    const window = getTimelineVisibleWindow({
      scrollLeft: DEFAULT_TIMELINE_GUTTER_WIDTH + TRACKS_LEFT_PAD + 60 * pps,
      scrollTop: 0,
      viewportWidth,
      viewportHeight: 600,
      pps,
      trackCount: 20,
      displayDuration: 180,
      gutterWidth: DEFAULT_TIMELINE_GUTTER_WIDTH,
    });

    expect(window.startTime).toBe(50);
    expect(window.endTime).toBe(80);
  });

  test("falls back to the full timeline before the viewport is measured", () => {
    expect(
      getTimelineVisibleWindow({
        scrollLeft: 0,
        scrollTop: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        pps: 100,
        trackCount: 8,
        displayDuration: 60,
        gutterWidth: DEFAULT_TIMELINE_GUTTER_WIDTH,
      }),
    ).toEqual({
      firstTrackIndex: 0,
      lastTrackIndexExclusive: 8,
      startTime: 0,
      endTime: 60,
    });
  });
});

describe("timeline layer gutter width", () => {
  test("uses the product minimum and maximum on a wide viewport", () => {
    expect(clampTimelineGutterWidth(100, 1_200)).toBe(MIN_TIMELINE_GUTTER_WIDTH);
    expect(clampTimelineGutterWidth(800, 1_200)).toBe(MAX_TIMELINE_GUTTER_WIDTH);
  });

  test("preserves at least 360px for timeline content", () => {
    expect(getTimelineGutterMaxWidth(680)).toBe(320);
    expect(clampTimelineGutterWidth(420, 680)).toBe(320);
  });
});
