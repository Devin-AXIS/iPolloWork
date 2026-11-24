// The server image port converts a TIFF picture to PNG, so an export draws it.

import { describe, expect, test } from 'bun:test';
import { unzlibSync } from 'fflate';
import { createNodeImageDecodePort } from '../node-image-decode-port.ts';
import { encodeRgbaPng } from '../raster-png.ts';
import { sniffImageMime, validatePngHeader } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { baselineRgbTiff } from '../../store/__tests__/tiff-test-bytes.ts';

const LIMITS = resolveImageResourceLimits();

/** The IHDR depth and colour type, and the inflated scanlines. */
function pngParts(png: Uint8Array): { depth: number; colour: number; raw: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idatLength = view.getUint32(33);
  return {
    depth: png[24]!,
    colour: png[25]!,
    raw: unzlibSync(png.subarray(41, 41 + idatLength)),
  };
}

describe('server TIFF conversion', () => {
  test('a TIFF converts to a PNG of the same extent', async () => {
    const port = createNodeImageDecodePort();
    const converted = await port.convertPreserved!(baselineRgbTiff(96, 64), 'image/tiff', LIMITS);
    expect(converted?.mime).toBe('image/png');
    expect(sniffImageMime(converted!.bytes)).toBe('image/png');
    expect(validatePngHeader(converted!.bytes)).toMatchObject({ pixelWidth: 96, pixelHeight: 64 });
  });

  test('metafiles are left to the caller', async () => {
    const port = createNodeImageDecodePort();
    expect(await port.convertPreserved!(new Uint8Array(64), 'image/x-emf', LIMITS)).toBeNull();
  });

  test('a caller converter replaces the built-in one', async () => {
    const port = createNodeImageDecodePort({ convertPreserved: async () => null });
    expect(await port.convertPreserved!(baselineRgbTiff(8, 8), 'image/tiff', LIMITS)).toBeNull();
  });
});

describe('RGBA to PNG', () => {
  test('black and white pixels encode as 1-bit grey', () => {
    // A 10 × 1 row: white, black, then white.
    const rgba = new Uint8Array(40).fill(255);
    rgba.fill(0, 4, 7);
    const { depth, colour, raw } = pngParts(encodeRgbaPng(rgba, 10, 1));
    expect([depth, colour]).toEqual([1, 0]);
    expect([...raw]).toEqual([0, 0b10111111, 0b11000000]);
  });

  test('opaque grey pixels encode as 8-bit grey', () => {
    const rgba = new Uint8Array([128, 128, 128, 255, 255, 255, 255, 255]);
    const { depth, colour, raw } = pngParts(encodeRgbaPng(rgba, 2, 1));
    expect([depth, colour]).toEqual([8, 0]);
    expect([...raw]).toEqual([0, 128, 255]);
  });

  test('colour or transparency keeps RGBA', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]);
    const { depth, colour, raw } = pngParts(encodeRgbaPng(rgba, 2, 1));
    expect([depth, colour]).toEqual([8, 6]);
    expect([...raw]).toEqual([0, ...rgba]);
  });
});
