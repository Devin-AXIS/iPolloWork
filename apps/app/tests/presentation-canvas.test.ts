import { describe, expect, test } from "bun:test";

import {
  PRESENTATION_CANVAS_HEIGHT,
  PRESENTATION_CANVAS_WIDTH,
  presentationCanvasScale,
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
});
