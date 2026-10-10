import { describe, expect, it } from "vitest";
import { applyMask, refineHumanEdges } from "./inference";

function edgeFixture(foreground: number[], background: number[]) {
  const width = 24,
    height = 12;
  const rgb = Buffer.alloc(width * height * 3);
  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const alpha = x < 10 ? 1 : x < 14 ? (14 - x) / 5 : 0;
      mask[i] = x < 10 ? 255 : x < 14 ? 225 : 0;
      for (let c = 0; c < 3; c++)
        rgb[i * 3 + c] = Math.round(alpha * foreground[c]! + (1 - alpha) * background[c]!);
    }
  const rgba = applyMask(rgb, mask, Buffer.alloc(width * height * 4), null, width * height).fg;
  return { width, height, rgb, mask, rgba };
}

describe("human cutout edge refinement", () => {
  it("removes pale background spill while retaining a gradual alpha edge", () => {
    const frame = edgeFixture([25, 50, 80], [245, 245, 245]);
    const input = Buffer.from(frame.rgb),
      mask = Buffer.from(frame.mask);
    refineHumanEdges(frame.rgb, frame.mask, frame.rgba, frame.width, frame.height);
    const alphas = [];
    for (let x = 10; x < 14; x++) {
      const at = (6 * frame.width + x) * 4;
      expect(Math.abs(frame.rgba[at]! - 25)).toBeLessThanOrEqual(3);
      expect(Math.abs(frame.rgba[at + 2]! - 80)).toBeLessThanOrEqual(3);
      alphas.push(frame.rgba[at + 3]);
    }
    expect(alphas).toEqual([204, 153, 102, 51]);
    expect(frame.rgb).toEqual(input);
    expect(frame.mask).toEqual(mask);
    expect([...frame.rgba.subarray(0, 4)]).toEqual([25, 50, 80, 255]);
    expect(frame.rgba[(6 * frame.width + 20) * 4 + 3]).toBe(0);
  });

  it("preserves pale clothing and removes colored spill without assuming a white background", () => {
    const frame = edgeFixture([245, 245, 240], [10, 120, 180]);
    refineHumanEdges(frame.rgb, frame.mask, frame.rgba, frame.width, frame.height);
    const at = (6 * frame.width + 12) * 4;
    expect(frame.rgba[at]).toBeGreaterThan(240);
    expect(frame.rgba[at + 1]).toBeGreaterThan(240);
    expect(frame.rgba[at + 3]).toBeGreaterThan(95);
    expect(frame.rgba[at + 3]).toBeLessThan(110);
  });

  it("leaves ambiguous low-contrast edges and frames without both sample classes unchanged", () => {
    for (const colors of [
      [
        [240, 240, 240],
        [245, 245, 245],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    ]) {
      const frame = edgeFixture(colors[0]!, colors[1]!);
      const before = Buffer.from(frame.rgba);
      refineHumanEdges(frame.rgb, frame.mask, frame.rgba, frame.width, frame.height);
      expect(frame.rgba).toEqual(before);
    }
    const rgba = Buffer.from([20, 40, 60, 255]);
    refineHumanEdges(Buffer.from([20, 40, 60]), Buffer.from([255]), rgba, 1, 1);
    expect([...rgba]).toEqual([20, 40, 60, 255]);
  });
});
