// Deterministic BMP and WebP bytes for tests.
//
// `bmp24` is a real, decodable 1x1 bitmap. The WebP builders are HEADER fixtures: each of
// the three body chunks stores its extent differently, and the extent is all the structural
// validator reads — a real VP8 bitstream would add nothing to what is under test.

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** A real 24-bit BMP: 14-byte file header, 40-byte BITMAPINFOHEADER, one padded pixel row. */
export function bmp24(width = 1, height = 1): Uint8Array {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixels = new Array<number>(rowStride * Math.abs(height)).fill(0x40);
  return Uint8Array.from([
    ...ascii('BM'),
    ...u32(54 + pixels.length),
    ...u32(0),
    ...u32(54),
    ...u32(40), // BITMAPINFOHEADER
    ...u32(width),
    ...u32(height), // signed: negative is a top-down bitmap
    ...u16(1), // planes
    ...u16(24), // bit count
    ...u32(0), // BI_RGB
    ...u32(pixels.length),
    ...u32(2835),
    ...u32(2835),
    ...u32(0),
    ...u32(0),
    ...pixels,
  ]);
}

/** BMP with the 12-byte `BITMAPCOREHEADER`, whose extent is 16-bit rather than 32-bit. */
export function bmpCore(width = 3, height = 5): Uint8Array {
  const pixels = new Array<number>(12).fill(0);
  return Uint8Array.from([
    ...ascii('BM'),
    ...u32(26 + pixels.length),
    ...u32(0),
    ...u32(26),
    ...u32(12),
    ...u16(width),
    ...u16(height),
    ...u16(1),
    ...u16(24),
    ...pixels,
  ]);
}

/** A 24-bit BMP whose DIB header claims a size no BMP revision defines. */
export function bmpWithDibSize(dibSize: number): Uint8Array {
  const bytes = bmp24(4, 3);
  new DataView(bytes.buffer).setUint32(14, dibSize, true);
  return bytes;
}

/** A BMP declaring a bit depth outside the set BITMAPINFOHEADER allows. */
export function bmpWithBitCount(bitCount: number): Uint8Array {
  const bytes = bmp24(4, 3);
  new DataView(bytes.buffer).setUint16(28, bitCount, true);
  return bytes;
}

/** A BMP declaring a plane count other than the mandatory 1. */
export function bmpWithPlanes(planes: number): Uint8Array {
  const bytes = bmp24(4, 3);
  new DataView(bytes.buffer).setUint16(26, planes, true);
  return bytes;
}

function webpContainer(chunk: string, body: readonly number[]): Uint8Array {
  const bytes = [
    ...ascii('RIFF'),
    ...u32(4 + 8 + body.length),
    ...ascii('WEBP'),
    ...ascii(chunk),
    ...u32(body.length),
    ...body,
  ];
  // The structural validator refuses anything under 30 bytes, which every real file clears.
  while (bytes.length < 30) bytes.push(0);
  return Uint8Array.from(bytes);
}

/** Lossy `VP8 `: key-frame start code, then 14-bit width and height. */
export function webpLossy(width = 32, height = 16): Uint8Array {
  return webpContainer('VP8 ', [
    0x00,
    0x00,
    0x00, // frame tag
    0x9d,
    0x01,
    0x2a, // start code
    ...u16(width),
    ...u16(height),
  ]);
}

/** Lossless `VP8L`: signature byte, then two 14-bit "minus one" extents packed together. */
export function webpLossless(width = 16, height = 8): Uint8Array {
  const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return webpContainer('VP8L', [0x2f, ...u32(packed >>> 0)]);
}

/** A WebP container whose body chunk is none of the three that carry an extent. */
export function webpUnknownChunk(): Uint8Array {
  return webpContainer('ANIM', new Array<number>(16).fill(0));
}

/** Lossy WebP whose key-frame start code is missing — a truncated or forged frame. */
export function webpLossyWithoutStartCode(): Uint8Array {
  const bytes = webpLossy();
  bytes[23] = 0;
  bytes[24] = 0;
  bytes[25] = 0;
  return bytes;
}

/** Extended `VP8X`: canvas extent as two 24-bit "minus one" values. */
export function webpExtended(width = 100, height = 50): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return webpContainer('VP8X', [
    0x10, // flags
    0x00,
    0x00,
    0x00, // reserved
    w & 0xff,
    (w >>> 8) & 0xff,
    (w >>> 16) & 0xff,
    h & 0xff,
    (h >>> 8) & 0xff,
    (h >>> 16) & 0xff,
  ]);
}
