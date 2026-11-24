// The browser decode port reports the extent `createImageBitmap` produces, and the JPEG
// header validation reports the extent AFTER EXIF orientation. The two agree only when the
// bitmap is asked for oriented pixels explicitly, so the option is part of the contract.

import { expect, test } from 'bun:test';
import { tryCreateBrowserImageDecodePort } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';

const LIMITS = resolveImageResourceLimits();

function fakeDocument(createImageBitmap?: (...args: unknown[]) => Promise<unknown>): Document {
  return { defaultView: { createImageBitmap } } as unknown as Document;
}

test('decode asks createImageBitmap for EXIF-oriented pixels', async () => {
  const calls: unknown[][] = [];
  let closed = 0;
  const port = tryCreateBrowserImageDecodePort(
    fakeDocument(async (...args) => {
      calls.push(args);
      return { width: 20, height: 40, close: () => (closed += 1) };
    })
  );
  expect(port).not.toBeNull();
  const result = await port!.decode(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 'image/jpeg', LIMITS);
  expect(result).toEqual({ pixelWidth: 20, pixelHeight: 40, dpiX: 96, dpiY: 96 });
  expect(calls).toHaveLength(1);
  expect(calls[0]![0]).toBeInstanceOf(Blob);
  expect(calls[0]![1]).toEqual({ imageOrientation: 'from-image' });
  expect(closed).toBe(1);
});

test('an engine that rejects the orientation option is retried without it', async () => {
  const calls: unknown[][] = [];
  let closed = 0;
  const port = tryCreateBrowserImageDecodePort(
    fakeDocument(async (...args) => {
      calls.push(args);
      if (args.length > 1) {
        const error = new Error('not a valid enumeration value');
        error.name = 'TypeError';
        throw error;
      }
      return { width: 40, height: 20, close: () => (closed += 1) };
    })
  )!;
  const result = await port.decode(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 'image/jpeg', LIMITS);
  expect(result).toEqual({ pixelWidth: 40, pixelHeight: 20, dpiX: 96, dpiY: 96 });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toHaveLength(1);
  expect(closed).toBe(1);
});

test('a decode failure that is not the option rejection is not retried', async () => {
  let calls = 0;
  const port = tryCreateBrowserImageDecodePort(
    fakeDocument(async () => {
      calls += 1;
      throw new Error('The source image could not be decoded.');
    })
  )!;
  await expect(port.decode(Uint8Array.of(0xff, 0xd8), 'image/jpeg', LIMITS)).rejects.toThrow(
    'could not be decoded'
  );
  expect(calls).toBe(1);
});

test('a bitmap past the pixel cap is refused and still closed', async () => {
  let closed = 0;
  const port = tryCreateBrowserImageDecodePort(
    fakeDocument(async () => ({ width: 200_000, height: 200_000, close: () => (closed += 1) }))
  )!;
  await expect(port.decode(Uint8Array.of(0xff, 0xd8), 'image/jpeg', LIMITS)).rejects.toThrow();
  expect(closed).toBe(1);
});

test('a document without createImageBitmap gets no browser port', () => {
  expect(tryCreateBrowserImageDecodePort(fakeDocument())).toBeNull();
});
