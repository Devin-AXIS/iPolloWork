// The browser decode port rasterizes TIFF before handing it back as PNG. Encoding needs a
// real Canvas, which headless DOMs lack, so these tests cover the decode half — the part
// that reads attacker-controlled bytes — plus the port's never-invalid-bytes-out contract.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { convertBrowserTiff, decodeTiffFrame } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { baselineRgbTiff, extentOnlyTiff } from '../../store/__tests__/tiff-test-bytes.ts';

const LIMITS = resolveImageResourceLimits();
const FIXTURES_DIR = resolve(import.meta.dir, '../../../../../e2e/fixtures');

function fixtureMedia(name: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name))));
}

describe('browser TIFF decode', () => {
  test.each([true, false] as const)(
    'baseline RGB decodes to the declared extent in %s byte order',
    async (littleEndian) => {
      const frame = await decodeTiffFrame(baselineRgbTiff(96, 64, littleEndian), LIMITS);
      expect(frame).not.toBeNull();
      if (!frame) return;
      expect(frame.pixelWidth).toBe(96);
      expect(frame.pixelHeight).toBe(64);
      expect(frame.rgba.length).toBe(96 * 64 * 4);
      // Top-left quadrant of the generated pattern, opaque.
      expect([...frame.rgba.slice(0, 4)]).toEqual([0xe0, 0xc0, 0x80, 0xff]);
      // Bottom-right quadrant.
      expect([...frame.rgba.slice(-4)]).toEqual([0x20, 0x30, 0x80, 0xff]);
    }
  );

  test('the checked-in fixture media decodes', async () => {
    const media = fixtureMedia('images-tiff.docx');
    for (const name of ['word/media/tiff-le.tif', 'word/media/tiff-be.tif']) {
      const frame = await decodeTiffFrame(media[name]!, LIMITS);
      expect(frame?.pixelWidth).toBe(96);
      expect(frame?.pixelHeight).toBe(64);
    }
    expect(await decodeTiffFrame(media['word/media/tiff-bad.tif']!, LIMITS)).toBeNull();
  });

  test('an extent past the pixel cap is declined before any buffer is allocated', async () => {
    expect(await decodeTiffFrame(extentOnlyTiff(200_000, 200_000), LIMITS)).toBeNull();
  });

  test('a directory with an extent but no strip tags throws, so the lane reports decode-failed', () => {
    // A refusal must be distinguishable from a decline: the resource layer turns a throw
    // into `decode-failed` ("could not be decoded") and a null into `unsupported-format`.
    expect(decodeTiffFrame(extentOnlyTiff(8, 8), LIMITS)).rejects.toThrow();
  });

  test('garbage input never yields bytes', async () => {
    const outcome = await convertBrowserTiff(
      document,
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      LIMITS
    ).then(
      (converted) => converted,
      () => null
    );
    expect(outcome).toBeNull();
  });

  test('without a working canvas the port declines or fails — never returns bytes', async () => {
    const outcome = await convertBrowserTiff(document, baselineRgbTiff(8, 4), LIMITS).then(
      (converted) => ({ converted, threw: false }),
      () => ({ converted: null, threw: true })
    );
    if (!outcome.threw && outcome.converted !== null) {
      // If the environment does provide a canvas, the output must be a real PNG.
      expect(outcome.converted.mime).toBe('image/png');
      expect(outcome.converted.bytes[0]).toBe(0x89);
    }
  });
});
