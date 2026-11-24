import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createImageResourceCache, validateJpegHeader } from '../package/image-resources.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';

// Synthetic headers, not a decodable photograph. The decode-port tests below
// independently return the browser's orientation-adjusted dimensions.
function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return join([Uint8Array.of(0xff, marker, length >> 8, length & 255), payload]);
}

function frame(marker = 0xc0): Uint8Array {
  return segment(marker, Uint8Array.of(8, 0, 20, 0, 40, 1, 1, 0x11, 0));
}

function jpeg(parts: readonly Uint8Array[]): Uint8Array {
  return join([Uint8Array.of(0xff, 0xd8), ...parts, Uint8Array.of(0xff, 0xd9)]);
}

function exif(orientation: number, little = true): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, little ? 0x4949 : 0x4d4d);
  view.setUint16(8, 42, little);
  view.setUint32(10, 8, little);
  view.setUint16(14, 1, little);
  view.setUint16(16, 0x112, little);
  view.setUint16(18, 3, little);
  view.setUint32(20, 1, little);
  view.setUint16(24, orientation, little);
  return bytes;
}

const landscape = { pixelWidth: 40, pixelHeight: 20 };
const portrait = { pixelWidth: 20, pixelHeight: 40 };

describe('JPEG metadata before the frame header', () => {
  test('skips large APP/ICC payloads beyond the former 64 KiB prefix', () => {
    const bytes = jpeg([
      segment(0xe2, new Uint8Array(65_533)),
      segment(0xe2, new Uint8Array(65_533)),
      frame(),
    ]);
    expect(validateJpegHeader(bytes)).toEqual(landscape);
  });

  for (const little of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      test(`reads ${little ? 'little' : 'big'}-endian EXIF orientation ${orientation}`, () => {
        expect(
          validateJpegHeader(jpeg([segment(0xe1, exif(orientation, little)), frame()]))
        ).toEqual(orientation >= 5 ? portrait : landscape);
      });
    }
  }

  test('reads progressive frames and byte-offset views', () => {
    const bytes = jpeg([segment(0xe1, exif(6)), frame(0xc2)]);
    const padded = join([new Uint8Array(7), bytes, new Uint8Array(11)]);
    expect(validateJpegHeader(padded.subarray(7, 7 + bytes.length))).toEqual(portrait);
  });

  test('does not read orientation outside its APP1 segment', () => {
    const malformed: Uint8Array[] = [];
    for (const [offset, value, width] of [
      [8, 41, 2], // TIFF magic
      [10, 0xfffffff0, 4], // IFD offset
      [14, 4097, 2], // excessive entry count
      [14, 2, 2], // truncated entries
      [18, 4, 2], // wrong orientation type
      [20, 2, 4], // wrong orientation count
      [24, 9, 2], // invalid orientation value
    ]) {
      const bytes = exif(6);
      const view = new DataView(bytes.buffer);
      if (width === 4) view.setUint32(offset!, value!, true);
      else view.setUint16(offset!, value!, true);
      malformed.push(bytes);
    }
    malformed.push(exif(6).subarray(0, 18));
    for (const bytes of malformed) {
      expect(validateJpegHeader(jpeg([segment(0xe1, bytes), frame()]))).toEqual(landscape);
    }
  });

  test('ignores non-EXIF APP1 and finds a subsequent valid orientation', () => {
    expect(
      validateJpegHeader(jpeg([segment(0xe1, strToU8('XMP')), segment(0xe1, exif(8)), frame()]))
    ).toEqual(portrait);
  });

  test('takes the first APP1 that yields an orientation, as decoders do', () => {
    // Regression guard for existing behavior: the first Exif block carries one entry that
    // is not 0x0112, so it declares no orientation; decoders (Skia, Blink, WebKit) keep
    // scanning and rotate by the second block, and so does this reader.
    const unoriented = exif(6);
    new DataView(unoriented.buffer).setUint16(16, 0x11a, true);
    expect(
      validateJpegHeader(jpeg([segment(0xe1, unoriented), segment(0xe1, exif(6)), frame()]))
    ).toEqual(portrait);
    // An orientation the first Exif block DOES carry wins over a later one.
    expect(
      validateJpegHeader(jpeg([segment(0xe1, exif(6)), segment(0xe1, exif(1)), frame()]))
    ).toEqual(portrait);
    // A bare six-byte `Exif\0\0` stub yields nothing and the next block is read.
    expect(
      validateJpegHeader(
        jpeg([segment(0xe1, strToU8('Exif\0\0')), segment(0xe1, exif(6)), frame()])
      )
    ).toEqual(portrait);
  });

  test('rejects invalid marker lengths, truncated frames, and zero dimensions', () => {
    const zero = frame();
    zero[8] = 0;
    const invalidComponents = frame();
    invalidComponents[9] = 2;
    for (const bytes of [
      Uint8Array.of(0xff, 0xe1, 0, 1),
      Uint8Array.of(0xff, 0xe1, 0xff, 0xff),
      segment(0xc0, Uint8Array.of(8, 0, 20, 0, 40)),
      zero,
      invalidComponents,
    ]) {
      expect(validateJpegHeader(jpeg([bytes]))).toBeNull();
    }
  });

  test('does not search compressed scan data for a frame', () => {
    for (const marker of [0, 0xda, 0xd9]) {
      expect(validateJpegHeader(jpeg([Uint8Array.of(0xff, marker, 0, 2), frame()]))).toBeNull();
    }
  });

  test('bounds marker count and padding separately from payload size', () => {
    const small = Array.from({ length: 4096 }, () => segment(0xe0, new Uint8Array(0)));
    expect(validateJpegHeader(jpeg(small.concat([frame()])))).toBeNull();
    expect(validateJpegHeader(jpeg([new Uint8Array(4098).fill(255), frame()]))).toBeNull();
    expect(validateJpegHeader(jpeg([Uint8Array.of(255, 255, 1), frame()]))).toEqual(landscape);
  });

  test('an oriented embedded photo resolves once and saves its original bytes', async () => {
    const bytes = jpeg([segment(0xe2, new Uint8Array(65_533)), segment(0xe1, exif(6)), frame()]);
    const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const loaded = readOoxmlPackage(
      zipSync(
        {
          '[Content_Types].xml': strToU8(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
              '<Default Extension="jpg" ContentType="image/jpeg"/>' +
              '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
          ),
          '_rels/.rels': strToU8(
            `<Relationships xmlns="${rel}"><Relationship Id="doc" Type="${officeRel}/officeDocument" Target="word/document.xml"/></Relationships>`
          ),
          'word/document.xml': strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'
          ),
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${rel}"><Relationship Id="photo" Type="${officeRel}/image" Target="media/photo.jpg"/></Relationships>`
          ),
          'word/media/photo.jpg': bytes,
        },
        { level: 0 }
      )
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    let calls = 0;
    const cache = createImageResourceCache(loaded.package, {
      decodePort: {
        decode: async (input) => {
          calls += 1;
          expect(input).toEqual(bytes);
          return { ...portrait, dpiX: 96, dpiY: 96 };
        },
      },
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'photo');
    expect(state).toMatchObject({ kind: 'ready', ...portrait });
    expect(await cache.resolveEmbedded('/word/document.xml', 'photo')).toBe(state);
    expect(calls).toBe(1);
    const saved = writeOoxmlPackage(loaded.package);
    expect(unzipSync(saved)['word/media/photo.jpg']).toEqual(bytes);
    cache.dispose();
  });
});
