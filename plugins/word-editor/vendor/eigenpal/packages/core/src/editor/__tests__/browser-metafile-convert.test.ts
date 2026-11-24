// The browser decode port rasterizes metafiles through the installed metafile renderer. Without
// one it uses the converter directly and declines invalid metafiles.

import { afterEach, expect, test } from 'bun:test';
import { convertBrowserMetafile } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
  metafileRasterOptions,
} from '../../store/package/drawing-renderers.ts';

const LIMITS = resolveImageResourceLimits();
const installed = drawingRenderers().metafile;
afterEach(() => installDrawingRenderers({ metafile: installed }));

test('without a metafile renderer the port declines invalid input', async () => {
  installDrawingRenderers({ metafile: undefined });
  expect(await convertBrowserMetafile(new Uint8Array(88), 'image/x-emf', LIMITS)).toBeNull();
});

test('the port rasterizes through the installed renderer', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const calls: unknown[] = [];
  installDrawingRenderers({
    metafile: {
      replay: async () => null,
      rasterize: async (bytes, mime, options) => {
        calls.push([bytes.length, mime, options.maxEdge]);
        return { bytes: png, mime: 'image/png' };
      },
    },
  });
  const converted = await convertBrowserMetafile(new Uint8Array(12), 'image/x-wmf', LIMITS);
  expect(converted).toEqual({ bytes: png, mime: 'image/png' });
  expect(calls).toEqual([[12, 'image/x-wmf', 2048]]);
});

test('metafile raster options bound both dimensions while allowing fourfold rendering', () => {
  expect(metafileRasterOptions(4096)).toEqual({
    dpiScale: 4,
    maxWidth: 2048,
    maxHeight: 2048,
  });
  expect(metafileRasterOptions(512.9)).toEqual({
    dpiScale: 4,
    maxWidth: 512,
    maxHeight: 512,
  });
  expect(metafileRasterOptions(0)).toEqual({ dpiScale: 4, maxWidth: 1, maxHeight: 1 });
});
