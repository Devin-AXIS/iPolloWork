import { describe, expect, test } from "bun:test";

import {
  MAX_PRESENTATION_CANVAS_ZOOM,
  MIN_PRESENTATION_CANVAS_ZOOM,
  PRESENTATION_CANVAS_HEIGHT,
  PRESENTATION_CANVAS_WIDTH,
  presentationCanvasScale,
  presentationCanvasStageSize,
  presentationCanvasWheelZoom,
  presentationCanvasZoomedScale,
} from "../src/react-app/domains/session/design/presentation-canvas";

describe("Presentation canvas", () => {
  test("uses one fixed 16:9 layout and only scales it to fit the preview", () => {
    expect(PRESENTATION_CANVAS_WIDTH / PRESENTATION_CANVAS_HEIGHT).toBeCloseTo(16 / 9);
    expect(presentationCanvasScale(1600, 900)).toBe(1);
    expect(presentationCanvasScale(390, 844)).toBeCloseTo(390 / 1600);
    expect(presentationCanvasScale(2400, 900)).toBe(1);
  });

  test("waits for a real preview viewport before exposing the canvas", () => {
    expect(presentationCanvasScale(0, 900)).toBe(0);
    expect(presentationCanvasScale(1600, 0)).toBe(0);
  });

  test("clamps modifier-wheel zoom and combines it with the fit scale", () => {
    expect(presentationCanvasWheelZoom(1, -1)).toBeCloseTo(1.1);
    expect(presentationCanvasWheelZoom(1, 1)).toBeCloseTo(1 / 1.1);
    expect(presentationCanvasWheelZoom(MIN_PRESENTATION_CANVAS_ZOOM, 1)).toBe(MIN_PRESENTATION_CANVAS_ZOOM);
    expect(presentationCanvasWheelZoom(MAX_PRESENTATION_CANVAS_ZOOM, -1)).toBe(MAX_PRESENTATION_CANVAS_ZOOM);
    expect(presentationCanvasZoomedScale(0.5, 2)).toBe(1);
    expect(presentationCanvasZoomedScale(0.5, 1)).toBe(0.5);
  });

  test("keeps enough scrollable stage space for a zoomed canvas", () => {
    expect(presentationCanvasStageSize(640, 360, 0.4)).toEqual({ width: 640, height: 360 });
    expect(presentationCanvasStageSize(640, 360, 0.6)).toEqual({ width: 960, height: 540 });
  });
});
