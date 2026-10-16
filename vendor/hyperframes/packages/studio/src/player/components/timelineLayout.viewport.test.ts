import { getTimelineClipRect } from "./timelineMarquee";
import { describe, expect, test } from "vitest";
import {
  type TimelinePresentationRow,
  formatTimelineTickLabel,
  generateTicks,
  getTimelinePresentationTrackOrder,
  getTimelineLogicalRowFromY,
  getTimelineInsertPresentationIndex,
  getTimelineRowTop,
  getTimelineCanvasHeight,
  resolveTimelineAssetDrop,
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


describe("expanded layer presentation geometry", () => {
  const rows: TimelinePresentationRow[] = [
    {kind:"layer",key:"title",track:0,elementKey:"title"},
    {kind:"group",key:"title:transform",track:0,elementKey:"title",label:"Transform"},
    {kind:"group",key:"title:position",track:0,elementKey:"title",label:"Position"},
    {kind:"property",key:"title:x",track:0,elementKey:"title",property:"x",label:"X"},
    {kind:"property",key:"title:y",track:0,elementKey:"title",property:"y",label:"Y"},
    {kind:"property",key:"title:scale",track:0,elementKey:"title",property:"scale",label:"Scale"},
    {kind:"property",key:"title:opacity",track:0,elementKey:"title",property:"opacity",label:"Opacity"},
    {kind:"layer",key:"image",track:4,elementKey:"image"},
  ];
  const rowOrder = getTimelinePresentationTrackOrder(rows);
  test("property rows resolve to their parent lane, without arming interior insertion boundaries", () => {
    expect(getTimelineLogicalRowFromY(getTimelineRowTop(3) + 20, rows, [0,4])).toBe(0.5);
    expect(getTimelineLogicalRowFromY(getTimelineRowTop(0) + TRACK_H - 1, rows, [0,4])).toBe(0.5);
    expect(getTimelineLogicalRowFromY(getTimelineRowTop(7) + 20, rows, [0,4])).toBeCloseTo(1 + 20 / TRACK_H);
    expect(getTimelineInsertPresentationIndex(1, rows, [0,4])).toBe(7);
    expect(getTimelineInsertPresentationIndex(2, rows, [0,4])).toBe(8);
  });
  test("clip reveal and marquee hit boxes use layer tops after expanded children", () => {
    const clip = getTimelineClipRect({start:2,duration:3,track:4}, rowOrder, 100, DEFAULT_TIMELINE_GUTTER_WIDTH);
    expect(clip?.top).toBe(getTimelineRowTop(7) + 3);
    expect(clip?.height).toBe(TRACK_H - 6);
    expect(rowOrder).toEqual([0,0,0,0,0,0,0,4]);
    expect(getTimelineCanvasHeight(rows.length)).toBeGreaterThan(getTimelineRowTop(7) + TRACK_H);
  });
  test("asset drop on a property row uses its parent track, while the next layer keeps its authored identity", () => {
    const input = {rectLeft:0,rectTop:0,scrollLeft:0,scrollTop:0,pixelsPerSecond:100,duration:10,trackHeight:TRACK_H,trackOrder:rowOrder,gutterWidth:DEFAULT_TIMELINE_GUTTER_WIDTH};
    expect(resolveTimelineAssetDrop(input,500,getTimelineRowTop(3) + 20).track).toBe(0);
    expect(resolveTimelineAssetDrop(input,500,getTimelineRowTop(7) + 20).track).toBe(4);
    expect(resolveTimelineAssetDrop(input,500,getTimelineRowTop(8) + 20).track).toBe(5);
  });
  test("vertical virtualization counts presentation rows on the common ruler", () => {
    const window = getTimelineVisibleWindow({scrollLeft:0,scrollTop:getTimelineRowTop(4),viewportWidth:900,viewportHeight:TRACK_H * 2,pps:100,trackCount:rows.length,displayDuration:10,gutterWidth:DEFAULT_TIMELINE_GUTTER_WIDTH,verticalOverscanRows:0});
    expect(window.firstTrackIndex).toBe(4);
    expect(window.lastTrackIndexExclusive).toBe(6);
  });
});

test("zoomed ruler ticks align to frames and carry into the next second", () => {
  const ticks = generateTicks(65, 300, 30);
  for (const time of [...ticks.major, ...ticks.minor]) expect(time * 30).toBeCloseTo(Math.round(time * 30), 4);
  expect(formatTimelineTickLabel(11 + 29 / 30, 65, 0.5, 30)).toBe("00:11:29");
  expect(formatTimelineTickLabel(11 + 29.9 / 30, 65, 0.5, 30)).toBe("00:12:00");
  expect(formatTimelineTickLabel(11, 65, 1, 30)).toBe("00:11");
});
