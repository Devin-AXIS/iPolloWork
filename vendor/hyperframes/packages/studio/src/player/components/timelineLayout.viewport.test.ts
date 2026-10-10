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
  getTimelineFitPps,
  getTimelineScrollLeftForZoomTransition,
} from "./timelineLayout";
import { getNextTimelineZoomPercent, getTimelinePixelsPerSecond } from "./timelineZoom";

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

  test("culls time with the upstream half viewport overscan while preserving full geometry", () => {
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

    expect(window.startTime).toBe(55);
    expect(window.endTime).toBe(75);
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

describe("fit the complete timeline", () => {
  test.each([10, 14, 180, 3600])("fits a %ds composition plus headroom inside the measured viewport", (duration) => {
    const viewportWidth = 875;
    const gutterWidth = 255;
    const available = viewportWidth - gutterWidth - TRACKS_LEFT_PAD - 2;
    const fit = getTimelineFitPps(viewportWidth, duration, gutterWidth);
    const zoom = getNextTimelineZoomPercent("in", "fit", 100);
    expect(getTimelinePixelsPerSecond(fit, "manual", zoom)).toBeGreaterThan(fit);
    const pps = getTimelinePixelsPerSecond(fit, "fit", zoom);
    expect(duration * pps).toBeCloseTo(available / 1.2);
    expect(getTimelineScrollLeftForZoomTransition("manual", "fit", 525)).toBe(0);
  });

  test("recalculates fit after the sidebar or layer gutter changes size", () => {
    const wide = getTimelineFitPps(1100, 10, 255);
    const narrow = getTimelineFitPps(875, 10, 320);
    expect(narrow).toBeLessThan(wide);
    expect(narrow * 12).toBeCloseTo(875 - 320 - TRACKS_LEFT_PAD - 2);
  });
});
