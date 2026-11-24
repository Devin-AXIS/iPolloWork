// RGBA pixels as PNG bytes without a canvas, for the server image port. A frame that is only
// black and white encodes as 1-bit grey and an opaque grey one as 8-bit grey, so a scanned
// page stays small.

import { zlibSync } from 'fflate';

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

type PixelForm = 'bilevel' | 'grey' | 'rgba';

function pixelForm(rgba: Uint8Array): PixelForm {
  let bilevel = true;
  for (let at = 0; at < rgba.length; at += 4) {
    const r = rgba[at]!;
    if (rgba[at + 3] !== 255 || rgba[at + 1] !== r || rgba[at + 2] !== r) return 'rgba';
    if (r !== 0 && r !== 255) bilevel = false;
  }
  return bilevel ? 'bilevel' : 'grey';
}

/** Filter-0 scanlines of the frame in its smallest form, with the PNG bit depth and colour type. */
function scanlines(
  rgba: Uint8Array,
  width: number,
  height: number,
  form: PixelForm
): { raw: Uint8Array; depth: number; colour: number } {
  const stride = form === 'bilevel' ? Math.ceil(width / 8) : form === 'grey' ? width : width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1) + 1;
    const source = y * width * 4;
    if (form === 'rgba') {
      raw.set(rgba.subarray(source, source + width * 4), row);
    } else if (form === 'grey') {
      for (let x = 0; x < width; x += 1) raw[row + x] = rgba[source + x * 4]!;
    } else {
      for (let x = 0; x < width; x += 1) {
        if (rgba[source + x * 4] === 255) raw[row + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return form === 'rgba'
    ? { raw, depth: 8, colour: 6 }
    : { raw, depth: form === 'bilevel' ? 1 : 8, colour: 0 };
}

/** Encode `width` × `height` RGBA pixels as a PNG. */
export function encodeRgbaPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const { raw, depth, colour } = scanlines(rgba, width, height, pixelForm(rgba));
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = depth;
  header[9] = colour;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
