import { describe, it, expect } from "vitest";
import { float16ToPqRgb } from "./hdrCapture.js";

// IEEE 754 half-precision (float16) bit patterns used to feed
// `float16ToPqRgb`. Encoding rule: sign(1) | exp(5) | frac(10).
const F16_ZERO = 0x0000; // +0.0
const F16_HALF = 0x3800; // +0.5  (exp=14, frac=0 → 2^-1)
const F16_ONE = 0x3c00; // +1.0  (exp=15, frac=0 → 2^0  — SDR white)
// PQ caps at 10000 nits and SDR_NITS = 203, so the linear input must exceed
// ~58x SDR white before linearToPQ(L) clips at 1.0. 1024 is well above that.
const F16_OVERBRIGHT = 0x6400; // +1024.0  (exp=25, frac=0 → 2^10)

function makeFloat16Frame(
  width: number,
  height: number,
  pixel: { r: number; g: number; b: number; a: number },
  bytesPerRow: number = width * 8,
): Buffer {
  // Row-padded layout matches WebGPU readback: bytesPerRow ≥ width * 8 (4
  // channels × 2 bytes), with garbage bytes after each row's pixel data.
  const buf = Buffer.alloc(height * bytesPerRow);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * bytesPerRow + x * 8;
      buf.writeUInt16LE(pixel.r, idx);
      buf.writeUInt16LE(pixel.g, idx + 2);
      buf.writeUInt16LE(pixel.b, idx + 4);
      buf.writeUInt16LE(pixel.a, idx + 6);
    }
  }
  return buf;
}

describe("float16ToPqRgb", () => {
  it("returns a buffer of width * height * 6 bytes (rgb48le)", () => {
    const frame = makeFloat16Frame(4, 3, { r: 0, g: 0, b: 0, a: 0 });
    const out = float16ToPqRgb(frame, 32, 4, 3);
    expect(out.length).toBe(4 * 3 * 6);
  });

  it("encodes float16 black to PQ zero (linearToPQ(0) ≈ 0 after uint16 quantization)", () => {
    const frame = makeFloat16Frame(2, 2, {
      r: F16_ZERO,
      g: F16_ZERO,
      b: F16_ZERO,
      a: F16_ZERO,
    });
    const out = float16ToPqRgb(frame, 16, 2, 2);
    for (let i = 0; i < out.length; i += 2) {
      expect(out.readUInt16LE(i)).toBe(0);
    }
  });

  it("clamps overbright float16 input to PQ 65535 (linearToPQ(>>1.0) → 1.0)", () => {
    // ~1024 linear is well past the 58x-SDR PQ saturation point; output caps
    // at 1.0 → 65535 in uint16.
    const frame = makeFloat16Frame(2, 2, {
      r: F16_OVERBRIGHT,
      g: F16_OVERBRIGHT,
      b: F16_OVERBRIGHT,
      a: F16_ZERO,
    });
    const out = float16ToPqRgb(frame, 16, 2, 2);
    for (let pixel = 0; pixel < 4; pixel++) {
      const dst = pixel * 6;
      expect(out.readUInt16LE(dst)).toBe(65535);
      expect(out.readUInt16LE(dst + 2)).toBe(65535);
      expect(out.readUInt16LE(dst + 4)).toBe(65535);
    }
  });

  it("preserves channel ordering R, G, B (alpha is discarded)", () => {
    // Distinct float16 values per channel verify the function doesn't
    // mix them up. Alpha is set high but should not appear in the output.
    const frame = makeFloat16Frame(1, 1, {
      r: F16_ONE,
      g: F16_HALF,
      b: F16_ZERO,
      a: F16_ONE,
    });
    const out = float16ToPqRgb(frame, 8, 1, 1);
    const r = out.readUInt16LE(0);
    const g = out.readUInt16LE(2);
    const b = out.readUInt16LE(4);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBe(0);
  });

  it("is monotonic: higher float16 input produces higher PQ output", () => {
    const dark = makeFloat16Frame(1, 1, { r: F16_ZERO, g: 0, b: 0, a: 0 });
    const mid = makeFloat16Frame(1, 1, { r: F16_HALF, g: 0, b: 0, a: 0 });
    const bright = makeFloat16Frame(1, 1, { r: F16_ONE, g: 0, b: 0, a: 0 });
    const r0 = float16ToPqRgb(dark, 8, 1, 1).readUInt16LE(0);
    const r1 = float16ToPqRgb(mid, 8, 1, 1).readUInt16LE(0);
    const r2 = float16ToPqRgb(bright, 8, 1, 1).readUInt16LE(0);
    expect(r0).toBe(0);
    expect(r1).toBeGreaterThan(r0);
    expect(r2).toBeGreaterThan(r1);
  });

  it("is deterministic across calls with the same input", () => {
    const frame = makeFloat16Frame(3, 2, {
      r: F16_HALF,
      g: F16_ONE,
      b: F16_ZERO,
      a: F16_ONE,
    });
    const a = float16ToPqRgb(frame, 24, 3, 2);
    const b = float16ToPqRgb(frame, 24, 3, 2);
    expect(a.equals(b)).toBe(true);
  });

  it("handles padded bytesPerRow (WebGPU 256-byte alignment)", () => {
    // WebGPU readback pads rows to 256-byte multiples. For a 4-pixel-wide
    // frame the actual pixel data is 32 bytes but bytesPerRow is 256.
    const width = 4;
    const height = 2;
    const bytesPerRow = 256;
    const frame = makeFloat16Frame(
      width,
      height,
      { r: F16_HALF, g: F16_HALF, b: F16_HALF, a: 0 },
      bytesPerRow,
    );
    const out = float16ToPqRgb(frame, bytesPerRow, width, height);
    expect(out.length).toBe(width * height * 6);
    // Every R component should be the same non-zero value (uniform input).
    const expected = out.readUInt16LE(0);
    expect(expected).toBeGreaterThan(0);
    for (let pixel = 0; pixel < width * height; pixel++) {
      expect(out.readUInt16LE(pixel * 6)).toBe(expected);
    }
  });

  it("ignores garbage bytes in the row padding region", () => {
    // Stuff junk into the trailing padding to make sure the PQ encoder
    // walks via bytesPerRow stride and not via raw buffer position.
    const width = 2;
    const height = 2;
    const bytesPerRow = 64;
    const frame = makeFloat16Frame(
      width,
      height,
      { r: F16_ZERO, g: F16_ZERO, b: F16_ZERO, a: F16_ZERO },
      bytesPerRow,
    );
    for (let y = 0; y < height; y++) {
      const padStart = y * bytesPerRow + width * 8;
      for (let i = padStart; i < (y + 1) * bytesPerRow; i++) {
        frame[i] = 0xff;
      }
    }
    const out = float16ToPqRgb(frame, bytesPerRow, width, height);
    for (let i = 0; i < out.length; i += 2) {
      expect(out.readUInt16LE(i)).toBe(0);
    }
  });
});
