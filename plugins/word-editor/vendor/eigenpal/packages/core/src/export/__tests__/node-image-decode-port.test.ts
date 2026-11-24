import { expect, test } from 'bun:test';
import { createNodeImageDecodePort } from '../node-image-decode-port.ts';

test('the Node image port reads validated dimensions without allocating pixels', async () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  png.set([0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0], 16);
  const decoded = await createNodeImageDecodePort().decode(png, 'image/png', {
    maxEncodedBytes: 1024,
    maxDecodedBytes: 1024,
    maxDimension: 100,
    maxPixels: 10_000,
    maxPolygonPoints: 100,
    maxExternalRedirects: 2,
  });
  expect(decoded).toEqual({ pixelWidth: 2, pixelHeight: 3, dpiX: 96, dpiY: 96 });
});
