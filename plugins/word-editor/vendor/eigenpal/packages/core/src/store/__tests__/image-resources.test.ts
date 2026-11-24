import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  createImageResourceCache,
  hasBoundedSvgRoot,
  imageResourceLookupFor,
  liveDrawingReferenceCount,
  MAX_SVG_ROOT_SCAN_BYTES,
  MAX_SVG_SNIFF_BYTES,
  resolveSvgIntrinsicSize,
  sniffImageMime,
  validateBmpHeader,
  validateGifHeader,
  validateJpegHeader,
  validatePngHeader,
  validateRasterHeader,
  validateTiffHeader,
  validateWebpHeader,
  type ImageDecodePort,
  type ImageResourceState,
} from '../package/image-resources.ts';
import {
  bmp24,
  bmpCore,
  bmpWithBitCount,
  bmpWithDibSize,
  bmpWithPlanes,
  webpExtended,
  webpLossless,
  webpLossy,
  webpLossyWithoutStartCode,
  webpUnknownChunk,
} from './raster-format-bytes.ts';
import {
  baselineRgbTiff,
  buildTiff,
  extentOnlyTiff,
  TIFF_FIELD_LONG,
  TIFF_FIELD_RATIONAL,
  TIFF_FIELD_SHORT,
} from './tiff-test-bytes.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { withRelationship } from '../package/package-edit.ts';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { resolveImageResourceLimits } from '../runtime/limits.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const JPEG_1X1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xd9,
]);

const JPEG_PREFIX_ONLY = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const GIF_1X1 = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
]);

const GIF_PREFIX_ONLY = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

const SVG_MIN = strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const SVG_SIZED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90" viewBox="0 0 180 90"></svg>';
const XML_NOT_SVG = strToU8('<?xml version="1.0"?><root></root>');
const TIFF_MIN = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const EMF_MIN = new Uint8Array([0x01, 0x00, 0x00, 0x00, ...new Array(40).fill(0)]);
const WMF_MIN = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, ...new Array(40).fill(0)]);

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockDecodePort(
  impl?: ImageDecodePort['decode']
): ImageDecodePort & { calls: number; lastBytes: Uint8Array | null } {
  const calls = { n: 0, last: null as Uint8Array | null };
  return {
    get calls() {
      return calls.n;
    },
    get lastBytes() {
      return calls.last;
    },
    decode: async (bytes, mime, limits) => {
      calls.n += 1;
      calls.last = bytes;
      if (impl) return impl(bytes, mime, limits);
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('structural header required in mock decode');
      return { ...header, dpiX: 96, dpiY: 96 };
    },
  };
}

function contentTypes(extra = ''): string {
  return (
    `<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Default Extension="bmp" ContentType="image/bmp"/>' +
    '<Default Extension="webp" ContentType="image/webp"/>' +
    '<Default Extension="svg" ContentType="image/svg+xml"/>' +
    '<Default Extension="tif" ContentType="image/tiff"/>' +
    '<Default Extension="emf" ContentType="image/x-emf"/>' +
    '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    extra +
    '</Types>'
  );
}

function drawingXml(options: { embed?: string | null; link?: string } = {}): string {
  const embed = options.embed === undefined ? 'rId2' : options.embed;
  const linkAttr = options.link ? ` r:link="${options.link}"` : '';
  const embedAttr = embed === null ? '' : ` r:embed="${embed}"`;
  return (
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}">` +
    `<wp:extent cx="914400" cy="914400"/>` +
    `<wp:docPr id="1" name="pic"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    // `nvPicPr` is minOccurs="1" in CT_Picture, so a fixture without it is not a picture.
    `<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip${embedAttr}${linkAttr}/></pic:blipFill>` +
    `<pic:spPr/>` +
    `</pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

function buildPackage(
  options: {
    readonly media?: Record<string, Uint8Array>;
    readonly includeDefaultMedia?: boolean;
    readonly docRels?: string;
    readonly document?: string;
    readonly header?: { readonly name: string; readonly rels: string; readonly xml: string };
  } = {}
) {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes()),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      options.document ??
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawingXml()}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      options.docRels ??
        `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.png"/>` +
          '</Relationships>'
    ),
  };
  if (options.includeDefaultMedia !== false) {
    entries['word/media/image1.png'] = options.media?.['word/media/image1.png'] ?? PNG_1X1;
  }
  for (const [name, bytes] of Object.entries(options.media ?? {})) {
    entries[name] = bytes;
  }
  if (options.header) {
    entries[options.header.name] = strToU8(options.header.xml);
    entries[`word/_rels/${options.header.name.slice('word/'.length)}.rels`] = strToU8(
      options.header.rels
    );
    entries['[Content_Types].xml'] = strToU8(
      contentTypes(
        `<Override PartName="/${options.header.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
      )
    );
  }
  return readOoxmlPackage(zipSync(entries));
}

function withPartBytes(pkg: OoxmlPackage, partName: string, bytes: Uint8Array): OoxmlPackage {
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(partName, bytes);
  return Object.freeze({ ...pkg, partBytes });
}

function pngWithIhdr(
  colorType: number,
  bitDepth: number,
  compression = 0,
  filter = 0,
  interlace = 0
): Uint8Array {
  const out = new Uint8Array(PNG_1X1);
  out[24] = bitDepth;
  out[25] = colorType;
  out[26] = compression;
  out[27] = filter;
  out[28] = interlace;
  return out;
}

function forgedPng(wrongChunkLength: boolean): Uint8Array {
  const out = new Uint8Array(PNG_1X1);
  if (wrongChunkLength) {
    out[11] = 0x0e;
  }
  return out;
}

function pngWithPhysicalDensity(pixelsPerMeter: number, unit = 1): Uint8Array {
  const phys = Uint8Array.from([
    0,
    0,
    0,
    9,
    0x70,
    0x48,
    0x59,
    0x73,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    unit,
    0,
    0,
    0,
    0,
  ]);
  for (const offset of [8, 12]) {
    phys[offset] = (pixelsPerMeter >>> 24) & 0xff;
    phys[offset + 1] = (pixelsPerMeter >>> 16) & 0xff;
    phys[offset + 2] = (pixelsPerMeter >>> 8) & 0xff;
    phys[offset + 3] = pixelsPerMeter & 0xff;
  }
  const out = new Uint8Array(PNG_1X1.length + phys.length);
  out.set(PNG_1X1.subarray(0, 33));
  out.set(phys, 33);
  out.set(PNG_1X1.subarray(33), 33 + phys.length);
  return out;
}

describe('image resource validation and cache (task 4)', () => {
  describe('signature sniffing', () => {
    test.each([
      ['png', PNG_1X1, 'image/png'],
      ['jpeg', JPEG_1X1, 'image/jpeg'],
      ['gif', GIF_1X1, 'image/gif'],
      ['svg', SVG_MIN, 'image/svg+xml'],
      ['tiff', TIFF_MIN, 'image/tiff'],
      ['emf', EMF_MIN, 'image/x-emf'],
      ['wmf', WMF_MIN, 'image/x-wmf'],
    ] as const)('%s signature', (_label, bytes, expected) => {
      expect(sniffImageMime(bytes)).toBe(expected);
    });

    test('truncated PNG prefix is unknown', () => {
      expect(sniffImageMime(PNG_1X1.slice(0, 4))).toBe('unknown');
    });

    test('XML declaration without svg root is not SVG', () => {
      expect(hasBoundedSvgRoot(XML_NOT_SVG)).toBe(false);
      expect(sniffImageMime(XML_NOT_SVG)).toBe('unknown');
    });

    test('svg root after sniff bound is unknown and scan stays bounded', () => {
      const padding = new Uint8Array(MAX_SVG_SNIFF_BYTES + 64).fill(0x20);
      const tail = strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const oversized = new Uint8Array(padding.length + tail.length);
      oversized.set(padding, 0);
      oversized.set(tail, padding.length);
      expect(hasBoundedSvgRoot(oversized)).toBe(false);
      expect(sniffImageMime(oversized)).toBe('unknown');
    });
  });

  describe('structural raster headers', () => {
    test('PNG IHDR validates 1x1 dimensions', () => {
      expect(validatePngHeader(PNG_1X1)).toEqual({ pixelWidth: 1, pixelHeight: 1 });
    });

    test('PNG pHYs supplies bounded physical density', () => {
      const header = validatePngHeader(pngWithPhysicalDensity(5669));
      expect(header?.dpiX).toBeCloseTo(144, 1);
      expect(header?.dpiY).toBeCloseTo(144, 1);
    });

    test('PNG pHYs ignores aspect-only and excessive density', () => {
      expect(validatePngHeader(pngWithPhysicalDensity(5669, 0))?.dpiX).toBeUndefined();
      expect(validatePngHeader(pngWithPhysicalDensity(1))?.dpiX).toBeUndefined();
      expect(validatePngHeader(pngWithPhysicalDensity(100_000))?.dpiX).toBeUndefined();
    });

    test('GIF logical screen validates nonzero dimensions', () => {
      expect(validateGifHeader(GIF_1X1)).toEqual({ pixelWidth: 1, pixelHeight: 1 });
    });

    test('JPEG SOF marker validates nonzero dimensions', () => {
      expect(validateJpegHeader(JPEG_1X1)).toEqual({ pixelWidth: 1, pixelHeight: 1 });
    });

    test.each([
      [0, 1],
      [0, 16],
      [2, 8],
      [2, 16],
      [3, 4],
      [4, 8],
      [6, 16],
    ] as const)('PNG IHDR accepts color type %i bit depth %i', (colorType, bitDepth) => {
      expect(validatePngHeader(pngWithIhdr(colorType, bitDepth))).toEqual({
        pixelWidth: 1,
        pixelHeight: 1,
      });
    });

    test.each([
      [1, 8],
      [5, 8],
      [7, 8],
      [2, 4],
      [3, 16],
      [0, 3],
    ] as const)(
      'PNG IHDR rejects reserved/invalid color type %i bit depth %i',
      (colorType, bitDepth) => {
        expect(validatePngHeader(pngWithIhdr(colorType, bitDepth))).toBeNull();
      }
    );

    test.each([
      ['bad compression', pngWithIhdr(2, 8, 1)],
      ['bad filter', pngWithIhdr(2, 8, 0, 1)],
      ['bad interlace', pngWithIhdr(2, 8, 0, 0, 2)],
    ] as const)('PNG IHDR rejects %s', (_label, bytes) => {
      expect(validatePngHeader(bytes)).toBeNull();
    });

    test.each([
      ['png forged chunk length', forgedPng(true)],
      ['png truncated', PNG_1X1.slice(0, 20)],
      ['gif prefix only', GIF_PREFIX_ONLY],
      ['jpeg prefix only', JPEG_PREFIX_ONLY],
    ] as const)('rejects adversarial %s before decode', async (_label, bytes) => {
      const loaded = buildPackage({ media: { 'word/media/image1.png': bytes } });
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('unrenderable');
      expect(decode.calls).toBe(0);
    });

    test.each([true, false] as const)(
      'TIFF first-directory extent reads in %s byte order',
      (littleEndian) => {
        expect(validateTiffHeader(baselineRgbTiff(96, 64, littleEndian))).toEqual({
          pixelWidth: 96,
          pixelHeight: 64,
        });
        expect(validateTiffHeader(extentOnlyTiff(7, 300, littleEndian))).toEqual({
          pixelWidth: 7,
          pixelHeight: 300,
        });
      }
    );

    test('TIFF extent tags may be SHORT as well as LONG', () => {
      const bytes = buildTiff({
        entries: [
          { tag: 256, fieldType: TIFF_FIELD_SHORT, count: 1, value: 640 },
          { tag: 257, fieldType: TIFF_FIELD_SHORT, count: 1, value: 480 },
        ],
      });
      expect(validateTiffHeader(bytes)).toEqual({ pixelWidth: 640, pixelHeight: 480 });
    });

    test.each([
      [
        'a signature with no directory',
        new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      ],
      ['an unknown byte-order mark', buildTiff({ byteOrderMark: 'XX', entries: [] })],
      ['BigTIFF, whose directory layout differs', buildTiff({ magic: 43, entries: [] })],
      ['a directory offset past the end', buildTiff({ entries: [], directoryOffset: 0xffff })],
      ['a directory offset inside the header', buildTiff({ entries: [], directoryOffset: 4 })],
      ['an empty directory', buildTiff({ entries: [] })],
      ['an entry count beyond the ceiling', buildTiff({ entries: [], entryCount: 5000 })],
      [
        'an entry count the file cannot back',
        buildTiff({
          entries: [{ tag: 256, fieldType: TIFF_FIELD_LONG, count: 1, value: 4 }],
          entryCount: 40,
        }),
      ],
      [
        'no height tag',
        buildTiff({ entries: [{ tag: 256, fieldType: TIFF_FIELD_LONG, count: 1, value: 4 }] }),
      ],
      ['a zero extent', extentOnlyTiff(0, 4)],
      [
        'a multi-valued extent tag',
        buildTiff({
          entries: [
            { tag: 256, fieldType: TIFF_FIELD_LONG, count: 2, value: 4 },
            { tag: 257, fieldType: TIFF_FIELD_LONG, count: 1, value: 4 },
          ],
        }),
      ],
      [
        'an extent tag of a non-integer field type',
        buildTiff({
          entries: [
            { tag: 256, fieldType: TIFF_FIELD_RATIONAL, count: 1, value: 4 },
            { tag: 257, fieldType: TIFF_FIELD_LONG, count: 1, value: 4 },
          ],
        }),
      ],
    ] as const)('TIFF header rejects %s', (_label, bytes) => {
      expect(validateTiffHeader(bytes)).toBeNull();
    });

    test('BMP reads its extent from either DIB header', () => {
      expect(validateBmpHeader(bmp24(4, 3))).toEqual({ pixelWidth: 4, pixelHeight: 3 });
      expect(validateBmpHeader(bmpCore(3, 5))).toEqual({ pixelWidth: 3, pixelHeight: 5 });
    });

    test('a top-down BMP has a negative height, not a malformed one', () => {
      // Word-era encoders write these routinely; read as unsigned it is ~4 billion tall.
      expect(validateBmpHeader(bmp24(4, -3))).toEqual({ pixelWidth: 4, pixelHeight: 3 });
    });

    test.each([
      ['not a bitmap', Uint8Array.from([0x42, 0x4e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ['truncated before the DIB header', bmp24(4, 3).slice(0, 20)],
      ['a zero extent', bmp24(0, 3)],
      ['an unknown DIB header size', bmpWithDibSize(24)],
      ['a bit count no BMP defines', bmpWithBitCount(7)],
      ['a plane count other than one', bmpWithPlanes(2)],
    ] as const)('BMP header rejects %s', (_label, bytes) => {
      expect(validateBmpHeader(bytes)).toBeNull();
    });

    test.each([
      ['lossy VP8', webpLossy(32, 16), { pixelWidth: 32, pixelHeight: 16 }],
      ['lossless VP8L', webpLossless(16, 8), { pixelWidth: 16, pixelHeight: 8 }],
      ['extended VP8X', webpExtended(100, 50), { pixelWidth: 100, pixelHeight: 50 }],
    ] as const)('WebP reads its extent from %s', (_label, bytes, expected) => {
      expect(validateWebpHeader(bytes)).toEqual(expected);
    });

    test.each([
      ['a truncated container', webpLossy().slice(0, 20)],
      ['an unknown body chunk', webpUnknownChunk()],
      ['a lossy frame with no start code', webpLossyWithoutStartCode()],
    ] as const)('WebP header rejects %s', (_label, bytes) => {
      expect(validateWebpHeader(bytes)).toBeNull();
    });

    test('sniffing recognizes both without help from the content type', () => {
      expect(sniffImageMime(bmp24())).toBe('image/bmp');
      expect(sniffImageMime(webpLossy())).toBe('image/webp');
      expect(sniffImageMime(webpLossless())).toBe('image/webp');
      // `RIFF` alone is not WebP — it is also WAV and AVI.
      const riffOnly = Uint8Array.from(webpLossy());
      riffOnly[8] = 0x57;
      riffOnly[9] = 0x41;
      riffOnly[10] = 0x56;
      riffOnly[11] = 0x45;
      expect(sniffImageMime(riffOnly)).toBe('unknown');
    });

    test('validateRasterHeader dispatches the new formats', () => {
      expect(validateRasterHeader(bmp24(4, 3), 'image/bmp')).toEqual({
        pixelWidth: 4,
        pixelHeight: 3,
      });
      expect(validateRasterHeader(webpLossless(16, 8), 'image/webp')).toEqual({
        pixelWidth: 16,
        pixelHeight: 8,
      });
    });
  });

  describe('embedded resolve', () => {
    test.each([
      ['bmp', bmp24(4, 3), 'image/bmp', { width: 4, height: 3 }],
      ['webp', webpLossless(16, 8), 'image/webp', { width: 16, height: 8 }],
    ] as const)(
      'an embedded %s resolves ready through the ordinary raster path',
      async (extension, bytes, mime, extent) => {
        const part = `word/media/image1.${extension}`;
        const loaded = buildPackage({
          includeDefaultMedia: false,
          media: { [part]: bytes },
          docRels:
            `<Relationships xmlns="${REL_NS}">` +
            `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.${extension}"/>` +
            '</Relationships>',
        });
        if (!loaded.ok) throw new Error(loaded.reason);
        const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
        const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
        expect(state.kind).toBe('ready');
        if (state.kind !== 'ready') return;
        expect(state.mime).toBe(mime);
        expect(state.pixelWidth).toBe(extent.width);
        expect(state.pixelHeight).toBe(extent.height);
      }
    );

    // Mislabeled rasters decode from their signatures, not the declared content type
    // (Image Part, ECMA-376 Part 1 §15.2.14).
    test.each([
      ['declared png, jpeg bytes', 'png', JPEG_1X1, 'image/jpeg', 1, 1],
      ['declared png, gif bytes', 'png', GIF_1X1, 'image/gif', 1, 1],
      ['declared gif, png bytes', 'gif', PNG_1X1, 'image/png', 1, 1],
      ['declared jpg, bmp bytes', 'jpg', bmp24(4, 3), 'image/bmp', 4, 3],
      ['declared bmp, webp bytes', 'bmp', webpLossless(16, 8), 'image/webp', 16, 8],
    ] as const)(
      'intra-raster mismatch renders from the signature: %s',
      async (_label, extension, bytes, sniffed, width, height) => {
        const loaded = buildPackage({
          includeDefaultMedia: false,
          media: { [`word/media/image1.${extension}`]: bytes },
          docRels:
            `<Relationships xmlns="${REL_NS}">` +
            `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.${extension}"/>` +
            '</Relationships>',
        });
        if (!loaded.ok) throw new Error(loaded.reason);
        const cache = imageResourceLookupFor(loaded.package, { decodePort: mockDecodePort() });
        const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
        expect(state.kind).toBe('ready');
        if (state.kind !== 'ready') return;
        expect(state.mime).toBe(sniffed);
        expect(state.pixelWidth).toBe(width);
        expect(state.pixelHeight).toBe(height);
      }
    );

    test('declared png with unsniffable bytes stays a signature mismatch', async () => {
      const loaded = buildPackage({ media: { 'word/media/image1.png': XML_NOT_SVG } });
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state).toEqual(
        expect.objectContaining({
          kind: 'unrenderable',
          reason: 'signature-mismatch',
          mime: 'image/png',
        })
      );
      expect(decode.calls).toBe(0);
    });

    test('declared preserved MIME with raster sniff is signature-mismatch', async () => {
      const loaded = buildPackage({
        media: { 'word/media/image.svg': PNG_1X1 },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image.svg"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state).toEqual(
        expect.objectContaining({
          kind: 'unrenderable',
          reason: 'signature-mismatch',
          mime: 'image/png',
        })
      );
      expect(decode.calls).toBe(0);
    });

    test.each([
      ['declared png, svg bytes', 'word/media/image1.png', SVG_MIN, 'image/png', 'image/svg+xml'],
      ['declared png, tiff bytes', 'word/media/image1.png', TIFF_MIN, 'image/png', 'image/tiff'],
      ['declared png, emf bytes', 'word/media/image1.png', EMF_MIN, 'image/png', 'image/x-emf'],
      ['declared png, wmf bytes', 'word/media/image1.png', WMF_MIN, 'image/png', 'image/x-wmf'],
      ['declared svg, png bytes', 'word/media/image.svg', PNG_1X1, 'image/svg+xml', 'image/png'],
      ['declared tiff, jpeg bytes', 'word/media/image.tif', JPEG_1X1, 'image/tiff', 'image/jpeg'],
      ['declared tiff, emf bytes', 'word/media/image.tif', EMF_MIN, 'image/tiff', 'image/x-emf'],
    ] as const)(
      'MIME mismatch table: %s → signature-mismatch before unsupported-format',
      async (_label, path, bytes, _claimed, sniffedMime) => {
        const file = path.split('/').pop()!;
        const loaded = buildPackage({
          media: { [path]: bytes },
          docRels:
            `<Relationships xmlns="${REL_NS}">` +
            `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/${file}"/>` +
            '</Relationships>',
        });
        if (!loaded.ok) throw new Error(loaded.reason);
        const decode = mockDecodePort();
        const cache = imageResourceLookupFor(loaded.package, { decodePort: decode });
        const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
        expect(state).toEqual(
          expect.objectContaining({
            kind: 'unrenderable',
            reason: 'signature-mismatch',
            mime: sniffedMime,
          })
        );
        expect(decode.calls).toBe(0);
      }
    );

    test('oversized encoded bytes refuse before decode', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, {
        decodePort: decode,
        limits: { maxEncodedBytes: 8 },
      });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('unrenderable');
      expect(decode.calls).toBe(0);
    });

    test('header dimension limits refuse before decode', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, {
        limits: { maxDecodedBytes: 3 },
        decodePort: decode,
      });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state).toEqual(
        expect.objectContaining({ kind: 'unrenderable', reason: 'resource-limit' })
      );
      expect(decode.calls).toBe(0);
    });

    test('decoder dimension mismatch yields decode-failed', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, {
        decodePort: mockDecodePort(async () => ({
          pixelWidth: 2,
          pixelHeight: 2,
          dpiX: 96,
          dpiY: 96,
        })),
      });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state).toEqual(
        expect.objectContaining({ kind: 'unrenderable', reason: 'decode-failed' })
      );
    });

    test('decoder failure yields decode-failed', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, {
        decodePort: mockDecodePort(async () => {
          throw new Error('decode boom');
        }),
      });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state).toEqual(
        expect.objectContaining({ kind: 'unrenderable', reason: 'decode-failed' })
      );
    });

    test('ready PNG resolves with opaque resourceKey and no byte accessor', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('ready');
      if (state.kind !== 'ready') return;
      expect(state.resourceKey).toContain('sha256:');
      expect('validatedBytesFor' in cache).toBe(false);
      expect(Object.isFrozen(state)).toBe(true);
    });

    test('ready PNG prefers physical header density over decoder defaults', async () => {
      const loaded = buildPackage({
        media: { 'word/media/image1.png': pngWithPhysicalDensity(5669) },
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('ready');
      if (state.kind !== 'ready') return;
      expect(state.dpiX).toBeCloseTo(144, 1);
      expect(state.dpiY).toBeCloseTo(144, 1);
    });

    test('decoder receives a copy; package bytes and hash stay stable after mutation', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const original = loaded.package.partBytes.get('/word/media/image1.png')!;
      const originalHash = sha256FontBytes(original);
      const decode = mockDecodePort(async (bytes) => {
        bytes.fill(0xaa);
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      });
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(decode.lastBytes).not.toBe(original);
      expect([...original]).toEqual([...PNG_1X1]);
      expect(sha256FontBytes(original)).toBe(originalHash);
    });

    test('cache identity shares decode for same bytes and relationship', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const first = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      const second = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(first).toBe(second);
      expect(decode.calls).toBe(1);
    });

    test('concurrent resolves decode exactly once', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const gate = deferred<void>();
      const decode = mockDecodePort(async (bytes) => {
        await gate.promise;
        const header = validateRasterHeader(bytes, 'image/png');
        if (!header) throw new Error('bad header');
        return { ...header, dpiX: 96, dpiY: 96 };
      });
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const first = cache.resolveEmbedded('/word/document.xml', 'rId2');
      const second = cache.resolveEmbedded('/word/document.xml', 'rId2');
      gate.resolve();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(decode.calls).toBe(1);
    });

    test('dispose during decode does not publish stale cache entries', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const gate = deferred<void>();
      const decode = mockDecodePort(async (bytes) => {
        await gate.promise;
        const header = validateRasterHeader(bytes, 'image/png');
        if (!header) throw new Error('bad header');
        return { ...header, dpiX: 96, dpiY: 96 };
      });
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const pending = cache.resolveEmbedded('/word/document.xml', 'rId2');
      cache.dispose();
      gate.resolve();
      await expect(pending).rejects.toThrow('stale');
      expect(() => cache.resolveEmbedded('/word/document.xml', 'rId2')).toThrow('disposed');
    });

    test('preserved formats remain unrenderable without decode', async () => {
      for (const [path, bytes, mime] of [
        ['word/media/image.tif', TIFF_MIN, 'image/tiff'],
        ['word/media/image.emf', EMF_MIN, 'image/x-emf'],
        ['word/media/image.wmf', WMF_MIN, 'image/x-wmf'],
      ] as const) {
        const file = path.split('/').pop()!;
        const loaded = buildPackage({
          media: { [path]: bytes },
          docRels:
            `<Relationships xmlns="${REL_NS}">` +
            `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/${file}"/>` +
            '</Relationships>',
        });
        if (!loaded.ok) throw new Error(loaded.reason);
        const decode = mockDecodePort();
        const cache = createImageResourceCache(loaded.package, { decodePort: decode });
        const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
        expect(state.kind).toBe('unrenderable');
        if (state.kind === 'unrenderable') {
          expect(state.mime).toBe(mime);
          expect(state.reason).toBe('unsupported-format');
        }
        expect(decode.calls).toBe(0);
      }
    });

    test('SVG resolves ready without touching the decode port', async () => {
      const loaded = buildPackage({
        media: { 'word/media/art.svg': strToU8(SVG_SIZED) },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/art.svg"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('ready');
      if (state.kind === 'ready') {
        expect(state.mime).toBe('image/svg+xml');
        expect(state.pixelWidth).toBe(180);
        expect(state.pixelHeight).toBe(90);
        expect(state.dpiX).toBe(96);
      }
      // No raster decode: an SVG never round-trips through createImageBitmap.
      expect(decode.calls).toBe(0);
    });

    test('SVG bytes declared as TIFF are a signature mismatch, not a render', async () => {
      const loaded = buildPackage({
        media: { 'word/media/image.tif': strToU8(SVG_SIZED) },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image.tif"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
      const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
      expect(state.kind).toBe('unrenderable');
      if (state.kind === 'unrenderable') expect(state.reason).toBe('signature-mismatch');
    });
  });

  describe('SVG intrinsic sizing', () => {
    const limits = resolveImageResourceLimits();
    const sizeOf = (markup: string) => resolveSvgIntrinsicSize(strToU8(markup), limits);

    test('absolute width and height win', () => {
      expect(sizeOf('<svg width="180" height="90"/>')).toEqual({
        pixelWidth: 180,
        pixelHeight: 90,
      });
    });

    test('absolute units convert to CSS pixels', () => {
      expect(sizeOf('<svg width="1in" height="72pt"/>')).toEqual({
        pixelWidth: 96,
        pixelHeight: 96,
      });
    });

    test('viewBox supplies the missing axis through the aspect ratio', () => {
      expect(sizeOf('<svg width="200" viewBox="0 0 100 50"/>')).toEqual({
        pixelWidth: 200,
        pixelHeight: 100,
      });
      expect(sizeOf('<svg height="50" viewBox="0 0 100 50"/>')).toEqual({
        pixelWidth: 100,
        pixelHeight: 50,
      });
    });

    test('viewBox alone is the intrinsic size', () => {
      expect(sizeOf('<svg viewBox="0,0,120,60"/>')).toEqual({ pixelWidth: 120, pixelHeight: 60 });
    });

    test('percentage sizes are not intrinsic and fall back', () => {
      expect(sizeOf('<svg width="100%" height="100%"/>')).toEqual({
        pixelWidth: 300,
        pixelHeight: 150,
      });
      expect(sizeOf('<svg width="100%" height="100%" viewBox="0 0 40 20"/>')).toEqual({
        pixelWidth: 40,
        pixelHeight: 20,
      });
    });

    test('no sizing attributes falls back to the CSS replaced-element default', () => {
      expect(sizeOf('<svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({
        pixelWidth: 300,
        pixelHeight: 150,
      });
    });

    test('an out-of-range viewBox is clamped, never refused', () => {
      const size = sizeOf(`<svg viewBox="0 0 ${limits.maxDimension * 4} 10"/>`);
      expect(size).not.toBeNull();
      expect(size!.pixelWidth).toBe(limits.maxDimension);
    });

    test('degenerate values fall back rather than producing a zero or NaN size', () => {
      expect(sizeOf('<svg width="0" height="0"/>')).toEqual({
        pixelWidth: 300,
        pixelHeight: 150,
      });
      expect(sizeOf('<svg viewBox="0 0 nope 10"/>')).toEqual({
        pixelWidth: 300,
        pixelHeight: 150,
      });
    });

    test('a root element longer than the scan window is refused, not guessed', () => {
      const padding = ' '.repeat(MAX_SVG_ROOT_SCAN_BYTES);
      expect(sizeOf(`<svg data-pad="${padding}" width="10" height="10"/>`)).toBeNull();
    });

    test('non-svg bytes have no intrinsic size', () => {
      expect(resolveSvgIntrinsicSize(PNG_1X1, limits)).toBeNull();
    });
  });

  describe('package snapshot cache registry', () => {
    test('distinct package snapshots resolve independently without manual invalidation', async () => {
      const pngA = PNG_1X1;
      const pngB = Uint8Array.from(PNG_1X1);
      pngB[pngB.length - 2] = 0x00;
      const loaded = buildPackage({
        media: {
          'word/media/a.png': pngA,
          'word/media/b.png': pngB,
        },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/a.png"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);

      const rels = new Map(loaded.package.relationships);
      rels.set('/word/document.xml', [
        Object.freeze({
          ownerPart: '/word/document.xml',
          id: 'rId2',
          type: IMAGE_REL,
          rawTarget: 'media/b.png',
          targetMode: 'Internal' as const,
          order: 0,
        }),
      ]);
      const retargeted = Object.freeze({
        ...loaded.package,
        relationships: rels,
      });

      const decode = mockDecodePort();
      const cacheA = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const cacheB = imageResourceLookupFor(retargeted, { decodePort: decode });
      const first = await cacheA.resolveEmbedded('/word/document.xml', 'rId2');
      const second = await cacheB.resolveEmbedded('/word/document.xml', 'rId2');
      const firstAgain = await cacheA.resolveEmbedded('/word/document.xml', 'rId2');

      expect(first.kind).toBe('ready');
      expect(second.kind).toBe('ready');
      expect(firstAgain).toBe(first);
      if (first.kind === 'ready' && second.kind === 'ready') {
        expect(second.contentId).not.toBe(first.contentId);
      }
      expect(decode.calls).toBe(2);
      expect('replacePackage' in cacheA).toBe(false);
    });

    test('withPartBytes snapshot never reuses prior cache or in-flight decode', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const gate = deferred<void>();
      const decode = mockDecodePort(async (bytes) => {
        await gate.promise;
        const header = validateRasterHeader(bytes, 'image/png');
        if (!header) throw new Error('bad header');
        return { ...header, dpiX: 96, dpiY: 96 };
      });
      const cacheA = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const pendingA = cacheA.resolveEmbedded('/word/document.xml', 'rId2');

      const mutated = withPartBytes(loaded.package, '/word/media/image1.png', forgedPng(true));
      const cacheB = imageResourceLookupFor(mutated, { decodePort: decode });
      const pendingB = cacheB.resolveEmbedded('/word/document.xml', 'rId2');
      gate.resolve();
      const [stateA, stateB] = await Promise.all([pendingA, pendingB]);
      expect(stateA.kind).toBe('ready');
      expect(stateB.kind).toBe('unrenderable');
      expect(decode.calls).toBe(1);
    });

    test('withRelationship on new snapshot does not affect prior snapshot cache', async () => {
      const missing = buildPackage({
        includeDefaultMedia: false,
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/missing.png"/>` +
          '</Relationships>',
      });
      if (!missing.ok) throw new Error(missing.reason);
      const decode = mockDecodePort();
      const cacheMissing = imageResourceLookupFor(missing.package, { decodePort: decode });
      expect((await cacheMissing.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe(
        'missing'
      );

      const present = withPartBytes(missing.package, '/word/media/missing.png', PNG_1X1);
      const cachePresent = imageResourceLookupFor(present, { decodePort: decode });
      expect((await cachePresent.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe('ready');
      expect((await cacheMissing.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe(
        'missing'
      );
      expect(decode.calls).toBe(1);
    });

    test('external and internal package snapshots resolve independently', async () => {
      const external = buildPackage({
        includeDefaultMedia: false,
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="https://example.invalid/pixel.png" TargetMode="External"/>` +
          '</Relationships>',
      });
      if (!external.ok) throw new Error(external.reason);
      const internal = buildPackage();
      if (!internal.ok) throw new Error(internal.reason);
      const decode = mockDecodePort();
      const cacheExternal = imageResourceLookupFor(external.package, { decodePort: decode });
      const cacheInternal = imageResourceLookupFor(internal.package, { decodePort: decode });
      expect((await cacheExternal.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe(
        'external'
      );
      expect((await cacheInternal.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe(
        'ready'
      );
      expect(decode.calls).toBe(1);
    });

    test('same snapshot identity returns shared lookup; dispose drops registry entry', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const first = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const second = imageResourceLookupFor(loaded.package, { decodePort: decode });
      expect(first).toBe(second);
      await first.resolveEmbedded('/word/document.xml', 'rId2');
      first.dispose();
      const third = imageResourceLookupFor(loaded.package, { decodePort: decode });
      expect(third).not.toBe(first);
      await third.resolveEmbedded('/word/document.xml', 'rId2');
      expect(decode.calls).toBe(2);
    });

    test('permissive lookup created first does not relax strict limits on later lookup', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const permissive = imageResourceLookupFor(loaded.package, { decodePort: decode });
      expect((await permissive.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe('ready');
      expect(decode.calls).toBe(1);

      const strict = imageResourceLookupFor(loaded.package, {
        decodePort: decode,
        limits: { maxEncodedBytes: 8 },
      });
      expect(strict).not.toBe(permissive);
      expect(await strict.resolveEmbedded('/word/document.xml', 'rId2')).toEqual(
        expect.objectContaining({ kind: 'unrenderable', reason: 'resource-limit' })
      );
      expect(decode.calls).toBe(1);
    });

    test('distinct decodePort objects each decode independently for same package', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decodeA = mockDecodePort();
      const decodeB = mockDecodePort();
      const lookupA = imageResourceLookupFor(loaded.package, { decodePort: decodeA });
      const lookupB = imageResourceLookupFor(loaded.package, { decodePort: decodeB });
      expect(lookupA).not.toBe(lookupB);
      await lookupA.resolveEmbedded('/word/document.xml', 'rId2');
      await lookupB.resolveEmbedded('/word/document.xml', 'rId2');
      expect(decodeA.calls).toBe(1);
      expect(decodeB.calls).toBe(1);
    });

    test('semantically identical normalized limits reuse the same lookup', () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const explicit = imageResourceLookupFor(loaded.package, {
        decodePort: decode,
        limits: { maxEncodedBytes: 32 * 1024 * 1024 },
      });
      const defaulted = imageResourceLookupFor(loaded.package, { decodePort: decode });
      expect(explicit).toBe(defaulted);
    });

    test('repeated dispose of replaced lookup does not remove the replacement', async () => {
      const loaded = buildPackage();
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const first = imageResourceLookupFor(loaded.package, { decodePort: decode });
      first.dispose();
      const replacement = imageResourceLookupFor(loaded.package, { decodePort: decode });
      expect(replacement).not.toBe(first);
      first.dispose();
      expect(replacement).toBe(imageResourceLookupFor(loaded.package, { decodePort: decode }));
      await replacement.resolveEmbedded('/word/document.xml', 'rId2');
      expect(decode.calls).toBe(1);
      await expect(first.resolveEmbedded('/word/document.xml', 'rId2')).rejects.toThrow('disposed');
    });

    test('withRelationship mints fresh snapshot for added image rel', async () => {
      const pngB = Uint8Array.from(PNG_1X1);
      pngB[pngB.length - 2] = 0x00;
      const loaded = buildPackage({
        media: {
          'word/media/a.png': PNG_1X1,
          'word/media/b.png': pngB,
        },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/a.png"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const added = withRelationship(
        loaded.package,
        '/word/document.xml',
        IMAGE_REL,
        'media/b.png'
      );
      expect(added.ok).toBe(true);
      const decode = mockDecodePort();
      const cacheOriginal = imageResourceLookupFor(loaded.package, { decodePort: decode });
      const cacheAdded = imageResourceLookupFor(added.pkg, { decodePort: decode });
      const viaOriginal = await cacheOriginal.resolveEmbedded('/word/document.xml', 'rId2');
      const viaNewRel = await cacheAdded.resolveEmbedded(
        '/word/document.xml',
        added.relationshipId
      );
      expect(viaOriginal.kind).toBe('ready');
      expect(viaNewRel.kind).toBe('ready');
      if (viaOriginal.kind === 'ready' && viaNewRel.kind === 'ready') {
        expect(viaNewRel.contentId).not.toBe(viaOriginal.contentId);
      }
      expect(decode.calls).toBe(2);
    });
  });

  describe('resolveLinked', () => {
    test('only External image relationships return kind external with real sinkSafe', () => {
      const loaded = buildPackage({
        includeDefaultMedia: false,
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="javascript:alert(1)" TargetMode="External"/>` +
          '</Relationships>',
        document: `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawingXml({ link: 'rId2', embed: null })}</w:body></w:document>`,
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
      const state = cache.resolveLinked('/word/document.xml', 'rId2');
      expect(state).toEqual({ kind: 'external', relationshipId: 'rId2', sinkSafe: false });
    });

    test('internal linked relationship is unrenderable, never external', () => {
      const loaded = buildPackage({
        document: `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawingXml({ link: 'rId2', embed: null })}</w:body></w:document>`,
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
      const state = cache.resolveLinked('/word/document.xml', 'rId2');
      expect(state.kind).toBe('unrenderable');
      expect(state.kind).not.toBe('external');
    });

    test('r:link projection resolves external without decode', async () => {
      const loaded = buildPackage({
        includeDefaultMedia: false,
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rIdLink" Type="${IMAGE_REL}" Target="https://example.invalid/pixel.png" TargetMode="External"/>` +
          '</Relationships>',
        document: `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawingXml({ link: 'rIdLink', embed: null })}</w:body></w:document>`,
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const decode = mockDecodePort();
      const cache = createImageResourceCache(loaded.package, { decodePort: decode });
      const projections = projectDrawingsInPackage(loaded.package);
      expect(projections[0]?.picture?.linkedRelationshipId).toBe('rIdLink');
      const state = await cache.resolveForProjection(projections[0]!);
      expect(state.kind).toBe('external');
      expect(decode.calls).toBe(0);
    });
  });

  describe('never fetches external image resources', () => {
    test('external embed, link, projection, and save perform zero fetch/decode', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error('fetch must not run');
      }) as typeof fetch;
      try {
        const loaded = buildPackage({
          docRels:
            `<Relationships xmlns="${REL_NS}">` +
            `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="https://example.invalid/pixel.png" TargetMode="External"/>` +
            '</Relationships>',
          document: `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawingXml({ embed: 'rId2' })}</w:body></w:document>`,
        });
        if (!loaded.ok) throw new Error(loaded.reason);

        const decode = mockDecodePort();
        const cache = createImageResourceCache(loaded.package, { decodePort: decode });
        expect((await cache.resolveEmbedded('/word/document.xml', 'rId2')).kind).toBe('external');
        expect(decode.calls).toBe(0);

        for (const projection of projectDrawingsInPackage(loaded.package)) {
          expect((await cache.resolveForProjection(projection)).kind).toBe('external');
        }
        expect(decode.calls).toBe(0);

        const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
        if (!reopened.ok) throw new Error(reopened.reason);
        expect(reopened.package.externalTargets[0]?.rawTarget).toBe(
          'https://example.invalid/pixel.png'
        );
        expect(decode.calls).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe('table-driven limits defaults', () => {
  test('defaults match task 4 specification', () => {
    const limits = resolveImageResourceLimits();
    expect(limits.maxEncodedBytes).toBe(32 * 1024 * 1024);
    expect(limits.maxDecodedBytes).toBe(400 * 1024 * 1024);
    expect(limits.maxPixels).toBe(100_000_000);
    expect(limits.maxDimension).toBe(32_768);
    expect(limits.maxPolygonPoints).toBe(4096);
    expect(limits.maxExternalRedirects).toBe(8);
  });
});

function assertReady(
  state: ImageResourceState
): asserts state is Extract<ImageResourceState, { kind: 'ready' }> {
  expect(state.kind).toBe('ready');
}

describe('drawing resources package integration', () => {
  test('embedded relationship resolves relative to document and header owners', async () => {
    const loaded = buildPackage({
      header: {
        name: 'word/header1.xml',
        rels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId5" Type="${IMAGE_REL}" Target="media/header.png"/>` +
          '</Relationships>',
        xml: `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${drawingXml({ embed: 'rId5' })}</w:hdr>`,
      },
      media: {
        'word/media/image1.png': PNG_1X1,
        'word/media/header.png': PNG_1X1,
      },
    });
    if (!loaded.ok) throw new Error(loaded.reason);
    const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
    assertReady(await cache.resolveEmbedded('/word/document.xml', 'rId2'));
    assertReady(await cache.resolveEmbedded('/word/header1.xml', 'rId5'));
  });

  test('missing part yields missing', async () => {
    const loaded = buildPackage({
      includeDefaultMedia: false,
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/missing.png"/>` +
        '</Relationships>',
    });
    if (!loaded.ok) throw new Error(loaded.reason);
    const cache = createImageResourceCache(loaded.package, { decodePort: mockDecodePort() });
    expect(await cache.resolveEmbedded('/word/document.xml', 'rId2')).toEqual({
      kind: 'missing',
      relationshipId: 'rId2',
    });
  });

  test('SVG/TIFF/EMF/WMF bytes survive save/reopen', () => {
    for (const [file, bytes] of [
      ['word/media/image.svg', SVG_MIN],
      ['word/media/image.tif', TIFF_MIN],
      ['word/media/image.emf', EMF_MIN],
      ['word/media/image.wmf', WMF_MIN],
    ] as const) {
      const loaded = buildPackage({
        media: { [file]: bytes },
        docRels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/${file.split('/').pop()}"/>` +
          '</Relationships>',
      });
      if (!loaded.ok) throw new Error(loaded.reason);
      const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(reopened.package.partBytes.get(`/${file}`)).toEqual(bytes);
    }
  });

  test('shared media part across document and header owners with distinct relationship ids', () => {
    const loaded = buildPackage({
      header: {
        name: 'word/header1.xml',
        rels:
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId5" Type="${IMAGE_REL}" Target="media/shared.png"/>` +
          '</Relationships>',
        xml: `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${drawingXml({ embed: 'rId5' })}</w:hdr>`,
      },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/shared.png"/>` +
        '</Relationships>',
      media: { 'word/media/shared.png': PNG_1X1 },
    });
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(liveDrawingReferenceCount(loaded.package, '/word/media/shared.png')).toBe(2);
  });

  test('external targets never call the decode port', async () => {
    const decode = mockDecodePort();
    const loaded = buildPackage({
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="https://example.invalid/pixel.png" TargetMode="External"/>` +
        '</Relationships>',
    });
    if (!loaded.ok) throw new Error(loaded.reason);
    const cache = createImageResourceCache(loaded.package, { decodePort: decode });
    await cache.resolveEmbedded('/word/document.xml', 'rId2');
    for (const projection of projectDrawingsInPackage(loaded.package)) {
      await cache.resolveForProjection(projection);
    }
    expect(decode.calls).toBe(0);
  });

  test('relationship owner mismatch does not resolve from another owner rels bucket', async () => {
    const loaded = buildPackage();
    if (!loaded.ok) throw new Error(loaded.reason);
    const rels = new Map(loaded.package.relationships);
    rels.delete('/word/document.xml');
    rels.set('/word/header1.xml', [
      Object.freeze({
        ownerPart: '/word/header1.xml',
        id: 'rId2',
        type: IMAGE_REL,
        rawTarget: 'media/image1.png',
        targetMode: 'Internal' as const,
        order: 0,
      }),
    ]);
    const pkg = Object.freeze({ ...loaded.package, relationships: rels });
    const cache = imageResourceLookupFor(pkg, { decodePort: mockDecodePort() });
    expect(await cache.resolveEmbedded('/word/document.xml', 'rId2')).toEqual({
      kind: 'missing',
      relationshipId: 'rId2',
    });
  });
});
