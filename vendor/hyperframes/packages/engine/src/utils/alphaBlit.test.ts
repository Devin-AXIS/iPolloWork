import { describe, expect, it } from "vitest";
import { averagePngFrames, decodePng, encodeRgbaPng } from "./alphaBlit.js";
import { extractPngMetadataFromBuffer } from "./ffprobe.js";

const pixel = (r: number, g: number, b: number, a = 255) =>
  encodeRgbaPng(1, 1, Uint8Array.of(r, g, b, a));

describe("temporal shutter integration", () => {
  it("averages radiance in linear light, rather than darkening into an sRGB blend", () => {
    expect([...decodePng(averagePngFrames([pixel(0, 0, 0), pixel(255, 255, 255)])).data])
      .toEqual([188, 188, 188, 255]);
  });

  it("premultiplies alpha so an invisible colored sample cannot tint the film", () => {
    expect([...decodePng(averagePngFrames([pixel(255, 0, 0, 0), pixel(0, 0, 255)])).data])
      .toEqual([0, 0, 255, 128]);
  });

  it("keeps stationary readable pixels identical and emits a CRC-valid PNG", () => {
    const frame = pixel(19, 111, 207);
    const average = averagePngFrames([frame, frame, frame, frame]);
    expect(decodePng(average).data).toEqual(decodePng(frame).data);
    expect(extractPngMetadataFromBuffer(average)).toMatchObject({ width: 1, height: 1 });
  });

  it("bounds sample count and pixel budget and rejects incompatible captures", () => {
    expect(() => averagePngFrames([])).toThrow("sample count");
    expect(() => averagePngFrames(Array(9).fill(pixel(0, 0, 0)))).toThrow("sample count");
    expect(() => averagePngFrames([pixel(0, 0, 0), encodeRgbaPng(2, 1, new Uint8Array(8))]))
      .toThrow("dimensions differ");
    expect(() => encodeRgbaPng(5000, 5000, new Uint8Array(0))).toThrow("4K capture budget");
  });
});
