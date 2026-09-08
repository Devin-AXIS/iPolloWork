import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { prepareImageSelection } from "./image-selection.js";

async function png(data: number[], width = data.length / 4, height = 1) {
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("exact image selection", () => {
  test("naturally blends inward without changing protected pixels, holes, or the edited centre", async () => {
    const width = 80, height = 60;
    const source = Buffer.alloc(width * height * 4), generated = Buffer.alloc(source.length), mask = Buffer.alloc(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      source.set([40, 60, 80, 255], i); generated.set([220, 180, 160, 255], i);
      const selected = (x >= 10 && x < 70 && y >= 10 && y < 50 && !(x >= 17 && x < 22 && y >= 20 && y < 25)) || (x === 3 && y >= 10 && y < 20);
      mask.set([0, 0, 0, selected ? (x === 3 && y === 10 ? 127 : 0) : 255], i);
    }
    const encode = (data: Buffer) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const selection = await prepareImageSelection(await encode(source), await encode(mask), "natural");
    const output = await sharp(await selection.composite(await encode(generated))).raw().toBuffer();
    for (let i = 0; i < mask.length; i += 4) if (mask[i + 3] === 255) expect(output.subarray(i, i + 4)).toEqual(source.subarray(i, i + 4));
    const red = (x: number, y: number) => output[(y * width + x) * 4];
    expect(red(45, 10)).toBe(40); // No colour jump at the outer edge.
    expect(red(45, 11)).toBeGreaterThanOrEqual(40);
    expect(red(45, 15)).toBeGreaterThan(red(45, 11));
    expect(red(45, 15)).toBeLessThan(220);
    expect(red(45, 30)).toBe(220); // The subject core remains fully edited.
    expect(red(22, 22)).toBe(40); // Subtracted hole also gets an inward transition.
    expect(red(3, 10)).toBe(130); // Soft pixel in a disconnected thin region.
    expect(red(3, 11)).toBe(220); // Tiny regions are not erased by the large region's band.
    const strict = await prepareImageSelection(await encode(source), await encode(mask), "strict");
    expect((await sharp(await strict.composite(await encode(generated))).raw().toBuffer())[(10 * width + 45) * 4]).toBe(220);
  });

  test("natural blending keeps tiny selections and whole-image edits effective", async () => {
    const source = await png([40, 60, 80, 255, 40, 60, 80, 255]);
    const generated = await png([220, 180, 160, 255, 220, 180, 160, 255]);
    for (const mask of [[0, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]) {
      const selection = await prepareImageSelection(source, await png(mask), "natural");
      const output = await sharp(await selection.composite(generated)).raw().toBuffer();
      expect(output[4]).toBe(220);
      expect(output[0]).toBe(mask[3] === 255 ? 40 : 220);
    }
  });

  test("preserves unselected pixels, subtract holes, disconnected regions and soft alpha", async () => {
    const source = [30, 50, 70, 255, 30, 50, 70, 255, 30, 50, 70, 255, 30, 50, 70, 255, 30, 50, 70, 255];
    const mask = [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 127, 0, 0, 0, 0];
    const selection = await prepareImageSelection(await png(source), await png(mask));
    const generated = await sharp({ create: { width: 10, height: 2, channels: 4, background: { r: 230, g: 150, b: 170, alpha: 1 } } }).png().toBuffer();
    const pixels = [...await sharp(await selection.composite(generated)).raw().toBuffer()];
    expect(pixels.slice(0, 4)).toEqual(source.slice(0, 4));
    expect(pixels.slice(8, 12)).toEqual(source.slice(8, 12));
    expect(pixels.slice(4, 8)).toEqual([230, 150, 170, 255]);
    expect(pixels.slice(12, 16)).toEqual([130, 100, 120, 255]);
    expect(pixels.slice(16, 20)).toEqual([230, 150, 170, 255]);
    const guide = [...await sharp(selection.guide).raw().toBuffer()];
    expect(guide).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });

  test("keeps transparent unselected RGBA and handles a one-pixel selection", async () => {
    const source = [14, 25, 36, 0, 14, 25, 36, 128];
    const selection = await prepareImageSelection(await png(source), await png([0, 0, 0, 255, 0, 0, 0, 0]));
    expect([...await sharp(await selection.composite(await png([90, 80, 70, 255, 90, 80, 70, 255]))).raw().toBuffer()])
      .toEqual([14, 25, 36, 0, 90, 80, 70, 255]);
  });

  test("rejects invalid, empty and mismatched masks before model work", async () => {
    const source = await png([10, 20, 30, 255]);
    await expect(prepareImageSelection(source, Buffer.from("not-png"))).rejects.toMatchObject({ code: "invalid_image" });
    await expect(prepareImageSelection(source, await png([0, 0, 0, 255]))).rejects.toMatchObject({ code: "empty_selection" });
    await expect(prepareImageSelection(source, await png([0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toMatchObject({ code: "invalid_mask" });
    const selection = await prepareImageSelection(source, await png([0, 0, 0, 0]));
    await expect(selection.composite(Buffer.from("bad provider output"))).rejects.toMatchObject({ code: "invalid_image" });
  });

  test.each(["jpeg", "webp"] as const)("normalizes %s input while preserving decoded source pixels", async (format) => {
    const source = await sharp(await png([30, 50, 70, 255, 90, 100, 110, 255])).toFormat(format).toBuffer();
    const decoded = await sharp(source).ensureAlpha().raw().toBuffer();
    const selection = await prepareImageSelection(source, await png([0, 0, 0, 255, 0, 0, 0, 0]));
    const output = await sharp(await selection.composite(await png([230, 150, 170, 255, 230, 150, 170, 255]))).raw().toBuffer();
    expect(output.subarray(0, 4)).toEqual(decoded.subarray(0, 4));
  });
});
