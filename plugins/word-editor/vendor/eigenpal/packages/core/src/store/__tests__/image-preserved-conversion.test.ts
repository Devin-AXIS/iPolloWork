// EMF and TIFF media render through the decode-port seam: the host rasterizes once,
// the converted bytes re-enter the full raster validation path, and the resource becomes
// an ordinary ready PNG. Without a converter the placeholder behavior stays.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createImageResourceCache, type ImageDecodePort } from '../package/image-resources.ts';
import { mintValidatedImageBytes } from '../package/validated-image-bytes.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { baselineRgbTiff, extentOnlyTiff } from './tiff-test-bytes.ts';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** Minimal EMF: `01 00 00 00` signature dword + 84 bytes of header padding. */
function emfBytes(): Uint8Array {
  const bytes = new Uint8Array(88);
  bytes[0] = 0x01;
  // " EMF" at offset 40, as real files carry.
  bytes[40] = 0x20;
  bytes[41] = 0x45;
  bytes[42] = 0x4d;
  bytes[43] = 0x46;
  return bytes;
}

function mediaPackage(extension: string, contentType: string, media: Uint8Array) {
  const parsed = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT_NS}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          `<Default Extension="${extension}" ContentType="${contentType}"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId7" Type="${IMAGE_REL}" Target="media/image1.${extension}"/></Relationships>`
      ),
      [`word/media/image1.${extension}`]: media,
    })
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(String(parsed.reason));
  return parsed.package;
}

const emfPackage = () => mediaPackage('emf', 'image/x-emf', emfBytes());
const tiffPackage = (bytes = baselineRgbTiff(8, 4)) => mediaPackage('tif', 'image/tiff', bytes);

function pngDecodingPort(convertPreserved?: ImageDecodePort['convertPreserved']): ImageDecodePort {
  return Object.freeze({
    async decode() {
      return Object.freeze({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 });
    },
    ...(convertPreserved ? { convertPreserved } : {}),
  });
}

describe('preserved media conversion through the decode port', () => {
  test('EMF resolves ready as PNG when the port converts it', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(async (bytes, mime) => {
        expect(mime).toBe('image/x-emf');
        expect(bytes[0]).toBe(0x01);
        return Object.freeze({ bytes: PNG_1X1, mime: 'image/png' as const });
      }),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;
    expect(state.mime).toBe('image/png');
    expect(state.pixelWidth).toBe(1);
    expect(state.pixelHeight).toBe(1);
    expect(mintValidatedImageBytes(state.validatedHandle, state.contentId)).toEqual(PNG_1X1);
  });

  test('EMF stays an unsupported-format placeholder without a converter', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({
      kind: 'unrenderable',
      mime: 'image/x-emf',
      reason: 'unsupported-format',
    });
  });

  test('a converter returning non-raster output is refused as decode-failed', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(async () =>
        Object.freeze({ bytes: strToU8('<script>alert(1)</script>'), mime: 'image/png' as const })
      ),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'decode-failed' });
  });

  test('a throwing converter is refused as decode-failed', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(async () => {
        throw new Error('bad metafile');
      }),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'decode-failed' });
  });

  test('a declining converter (null) keeps the unsupported-format placeholder', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(async () => null),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'unsupported-format' });
  });

  test('oversized converter output is refused as resource-limit', async () => {
    const huge = new Uint8Array(64 * 1024 * 1024 + 1);
    huge.set(PNG_1X1);
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: pngDecodingPort(async () =>
        Object.freeze({ bytes: huge, mime: 'image/png' as const })
      ),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'resource-limit' });
  });

  test('TIFF resolves ready as PNG when the port converts it', async () => {
    const cache = createImageResourceCache(tiffPackage(), {
      decodePort: pngDecodingPort(async (bytes, mime) => {
        expect(mime).toBe('image/tiff');
        expect(bytes[0]).toBe(0x49);
        return Object.freeze({ bytes: PNG_1X1, mime: 'image/png' as const });
      }),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;
    expect(state.mime).toBe('image/png');
    expect(mintValidatedImageBytes(state.validatedHandle, state.contentId)).toEqual(PNG_1X1);
  });

  test('big-endian TIFF reaches the converter too', async () => {
    const cache = createImageResourceCache(tiffPackage(baselineRgbTiff(8, 4, false)), {
      decodePort: pngDecodingPort(async (bytes) => {
        expect(bytes[0]).toBe(0x4d);
        return Object.freeze({ bytes: PNG_1X1, mime: 'image/png' as const });
      }),
    });
    expect((await cache.resolveEmbedded('/word/document.xml', 'rId7')).kind).toBe('ready');
  });

  test('TIFF stays an unsupported-format placeholder without a converter', async () => {
    const cache = createImageResourceCache(tiffPackage(), { decodePort: pngDecodingPort() });
    expect(await cache.resolveEmbedded('/word/document.xml', 'rId7')).toMatchObject({
      kind: 'unrenderable',
      mime: 'image/tiff',
      reason: 'unsupported-format',
    });
  });

  test('a TIFF signature with no readable directory never reaches the converter', async () => {
    let called = false;
    const truncated = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const cache = createImageResourceCache(tiffPackage(truncated), {
      decodePort: pngDecodingPort(async () => {
        called = true;
        return Object.freeze({ bytes: PNG_1X1, mime: 'image/png' as const });
      }),
    });
    expect(await cache.resolveEmbedded('/word/document.xml', 'rId7')).toMatchObject({
      kind: 'unrenderable',
      mime: 'image/tiff',
      reason: 'unsupported-format',
    });
    expect(called).toBe(false);
  });

  test('a TIFF declaring an out-of-range extent is refused before the converter runs', async () => {
    let called = false;
    const cache = createImageResourceCache(tiffPackage(extentOnlyTiff(1_000_000, 1_000_000)), {
      decodePort: pngDecodingPort(async () => {
        called = true;
        return Object.freeze({ bytes: PNG_1X1, mime: 'image/png' as const });
      }),
    });
    expect(await cache.resolveEmbedded('/word/document.xml', 'rId7')).toMatchObject({
      kind: 'unrenderable',
      mime: 'image/tiff',
      reason: 'resource-limit',
    });
    expect(called).toBe(false);
  });
});
