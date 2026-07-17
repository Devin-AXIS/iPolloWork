/**
 * Audit test: Uint16Array vs Buffer.read/writeUInt16LE alignment.
 *
 * Captures the migration hazard documented in the HDR follow-up plan:
 * "Uint16Array over readUInt16LE / writeUInt16LE — ~105 touch points in the
 * hot path with an alignment-correctness concern (odd byteOffset on sliced
 * Buffers throws)."
 *
 * The hot path in `alphaBlit.ts` and `shaderTransitions.ts` reads/writes 16-bit
 * channels via `Buffer.readUInt16LE` / `Buffer.writeUInt16LE`. Those methods
 * accept arbitrary byte offsets — odd offsets are fine. A future perf PR may
 * migrate to `Uint16Array` views for ~2× throughput, but `Uint16Array` requires
 * 2-byte alignment of the underlying ArrayBuffer offset. If the source `Buffer`
 * was sliced from a parent at an odd byte offset, constructing a `Uint16Array`
 * view directly will throw `RangeError`.
 *
 * These tests pin down the contract so the migration PR can:
 *   1. Verify the migration is safe (current sub-buffers always start at even
 *      byte offsets) — see `rgb48le row stride` test.
 *   2. Provide a reference safe-wrap pattern when alignment is not guaranteed.
 */
import { describe, expect, it } from "vitest";

describe("Uint16 alignment audit", () => {
  describe("Buffer.read/writeUInt16LE — current API", () => {
    it("accepts odd byte offsets without throwing", () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt16LE(0xabcd, 1);
      expect(buf.readUInt16LE(1)).toBe(0xabcd);
      buf.writeUInt16LE(0x1234, 3);
      expect(buf.readUInt16LE(3)).toBe(0x1234);
    });

    it("preserves values across non-aligned slice round-trips", () => {
      const buf = Buffer.alloc(10);
      buf.writeUInt16LE(0xdead, 1);
      buf.writeUInt16LE(0xbeef, 5);
      const sub = buf.subarray(1);
      expect(sub.readUInt16LE(0)).toBe(0xdead);
      expect(sub.readUInt16LE(4)).toBe(0xbeef);
    });
  });

  describe("Uint16Array — migration hazard", () => {
    it("throws RangeError when byteOffset is odd", () => {
      const ab = new ArrayBuffer(8);
      expect(() => new Uint16Array(ab, 1, 2)).toThrow(RangeError);
      expect(() => new Uint16Array(ab, 3, 1)).toThrow(RangeError);
    });

    it("succeeds when byteOffset is even", () => {
      const ab = new ArrayBuffer(8);
      expect(() => new Uint16Array(ab, 0, 4)).not.toThrow();
      expect(() => new Uint16Array(ab, 2, 3)).not.toThrow();
    });

    it("a Buffer sliced at an odd offset cannot back a Uint16Array view directly", () => {
      const parent = Buffer.alloc(8);
      const odd = parent.subarray(1);
      expect(odd.byteOffset % 2).toBe(1);
      expect(
        () => new Uint16Array(odd.buffer, odd.byteOffset, Math.floor(odd.byteLength / 2)),
      ).toThrow(RangeError);
    });

    it("safe-wrap pattern: copy to a fresh aligned Buffer when offset is odd", () => {
      const parent = Buffer.alloc(8);
      parent.writeUInt16LE(0xfeed, 1);
      const odd = parent.subarray(1, 3);

      // Pattern the migration PR should use when alignment is not guaranteed:
      // realign by copying into a freshly allocated Buffer (always page-aligned).
      const aligned = odd.byteOffset % 2 === 0 ? odd : Buffer.from(odd);
      expect(aligned.byteOffset % 2).toBe(0);
      const view = new Uint16Array(
        aligned.buffer,
        aligned.byteOffset,
        Math.floor(aligned.byteLength / 2),
      );
      expect(view[0]).toBe(0xfeed);
    });
  });

  describe("HDR canvas/row alignment invariants", () => {
    it("rgb48le canvas row strides are always even-byte multiples", () => {
      // A row of an rgb48le canvas is `width * 6` bytes (3 channels × 2 bytes).
      // For any width, the row stride is even, so per-row subarrays inherit
      // even byte offsets when sliced from a Buffer whose byteOffset is also
      // even (true for `Buffer.alloc(N)`, which is fresh-allocator-aligned).
      for (const width of [1, 7, 33, 256, 1920]) {
        const stride = width * 6;
        expect(stride % 2).toBe(0);
      }
    });

    it("Buffer.alloc canvases produce subarrays with even byte offsets", () => {
      // This is the invariant the alphaBlit hot path relies on: as long as the
      // working canvas is built with `Buffer.alloc(width * height * 6)`, each
      // row subarray (`canvas.subarray(y * stride, (y + 1) * stride)`) starts
      // at an even byte offset, so a future Uint16Array migration is safe
      // without any realignment copy.
      const width = 17; // odd width; stride = 102 (still even)
      const height = 4;
      const canvas = Buffer.alloc(width * height * 6);
      const stride = width * 6;
      for (let y = 0; y < height; y++) {
        const row = canvas.subarray(y * stride, (y + 1) * stride);
        expect(row.byteOffset % 2).toBe(0);
      }
    });

    it("a 3-byte rgb24 stride would NOT be alignment-safe (counter-example)", () => {
      // Documents why the rgb48le format is migration-friendly: an rgba8 or
      // rgb24 canvas with odd width produces sub-buffers at odd byte offsets.
      // If a future PR wants to use Uint16Array views, it must keep the data
      // in an even-stride format (rgb48le ✓) or pay for a realignment copy.
      const width = 3;
      const height = 2;
      const rgb24 = Buffer.alloc(width * height * 3); // stride = 9, odd!
      const stride = width * 3;
      const row1 = rgb24.subarray(stride, stride * 2);
      expect(row1.byteOffset % 2).toBe(1);
    });
  });
});
