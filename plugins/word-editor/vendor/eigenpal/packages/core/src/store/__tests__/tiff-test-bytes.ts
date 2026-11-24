// Deterministic TIFF bytes for tests.
//
// `baselineRgbTiff` is a real, decodable baseline TIFF — uncompressed RGB in a single
// strip, the shape `e2e/fixtures/images-tiff.docx` carries. `buildTiff` exposes the
// header knobs the structural validator is supposed to refuse: byte order, magic,
// directory offset, entry count, and the field type of the extent tags.

export interface TiffDirectoryEntry {
  readonly tag: number;
  readonly fieldType: number;
  readonly count: number;
  /** Inline value, or `{ external: bytes }` when it does not fit the 4-byte field. */
  readonly value: number | { readonly external: Uint8Array };
}

export interface BuildTiffOptions {
  readonly entries: readonly TiffDirectoryEntry[];
  readonly littleEndian?: boolean;
  /** TIFF version magic. 42 is baseline; 43 is BigTIFF, which has another layout. */
  readonly magic?: number;
  /** Byte-order mark, for the "not a TIFF at all" cases. */
  readonly byteOrderMark?: string;
  /** Overrides the offset written into the header, to point it past the end. */
  readonly directoryOffset?: number;
  /** Overrides the entry count written into the directory, to disagree with `entries`. */
  readonly entryCount?: number;
  /** Strip payload placed at offset 8, referenced by StripOffsets. */
  readonly pixels?: Uint8Array;
}

const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
export const TIFF_FIELD_SHORT = 3;
export const TIFF_FIELD_LONG = 4;
export const TIFF_FIELD_RATIONAL = 5;

export function buildTiff(options: BuildTiffOptions): Uint8Array {
  const littleEndian = options.littleEndian ?? true;
  const pixels = options.pixels ?? new Uint8Array(0);
  const entries = options.entries;
  const directoryAt = 8 + pixels.length;
  const externalAt = directoryAt + 2 + entries.length * 12 + 4;

  const external: Uint8Array[] = [];
  let externalLength = 0;
  const directory = new DataView(new ArrayBuffer(2 + entries.length * 12 + 4));
  directory.setUint16(0, options.entryCount ?? entries.length, littleEndian);
  entries.forEach((entry, index) => {
    const at = 2 + index * 12;
    directory.setUint16(at, entry.tag, littleEndian);
    directory.setUint16(at + 2, entry.fieldType, littleEndian);
    directory.setUint32(at + 4, entry.count, littleEndian);
    if (typeof entry.value === 'number') {
      // A SHORT that fits inline occupies the first half of the value field.
      if (entry.fieldType === TIFF_FIELD_SHORT)
        directory.setUint16(at + 8, entry.value, littleEndian);
      else directory.setUint32(at + 8, entry.value, littleEndian);
      return;
    }
    directory.setUint32(at + 8, externalAt + externalLength, littleEndian);
    external.push(entry.value.external);
    externalLength += entry.value.external.length;
  });

  const header = new DataView(new ArrayBuffer(8));
  const mark = options.byteOrderMark ?? (littleEndian ? 'II' : 'MM');
  header.setUint8(0, mark.charCodeAt(0));
  header.setUint8(1, mark.charCodeAt(1));
  header.setUint16(2, options.magic ?? 42, littleEndian);
  header.setUint32(4, options.directoryOffset ?? directoryAt, littleEndian);

  const out = new Uint8Array(8 + pixels.length + directory.byteLength + externalLength);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(pixels, 8);
  out.set(new Uint8Array(directory.buffer), directoryAt);
  let at = externalAt;
  for (const chunk of external) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A real baseline TIFF: uncompressed RGB, one strip, four flat colour quadrants. */
export function baselineRgbTiff(width: number, height: number, littleEndian = true): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      pixels[at] = x * 2 < width ? 0xe0 : 0x20;
      pixels[at + 1] = y * 2 < height ? 0xc0 : 0x30;
      pixels[at + 2] = 0x80;
    }
  }
  const bitsPerSample = new Uint8Array(6);
  const bitsView = new DataView(bitsPerSample.buffer);
  for (let index = 0; index < 3; index += 1) bitsView.setUint16(index * 2, 8, littleEndian);
  return buildTiff({
    littleEndian,
    pixels,
    entries: [
      { tag: TAG_IMAGE_WIDTH, fieldType: TIFF_FIELD_LONG, count: 1, value: width },
      { tag: TAG_IMAGE_LENGTH, fieldType: TIFF_FIELD_LONG, count: 1, value: height },
      {
        tag: TAG_BITS_PER_SAMPLE,
        fieldType: TIFF_FIELD_SHORT,
        count: 3,
        value: { external: bitsPerSample },
      },
      { tag: TAG_COMPRESSION, fieldType: TIFF_FIELD_SHORT, count: 1, value: 1 },
      { tag: TAG_PHOTOMETRIC, fieldType: TIFF_FIELD_SHORT, count: 1, value: 2 },
      { tag: TAG_STRIP_OFFSETS, fieldType: TIFF_FIELD_LONG, count: 1, value: 8 },
      { tag: TAG_SAMPLES_PER_PIXEL, fieldType: TIFF_FIELD_SHORT, count: 1, value: 3 },
      { tag: TAG_ROWS_PER_STRIP, fieldType: TIFF_FIELD_LONG, count: 1, value: height },
      {
        tag: TAG_STRIP_BYTE_COUNTS,
        fieldType: TIFF_FIELD_LONG,
        count: 1,
        value: pixels.length,
      },
    ],
  });
}

/** Only the extent tags, for header-validation cases that do not need a decodable image. */
export function extentOnlyTiff(width: number, height: number, littleEndian = true): Uint8Array {
  return buildTiff({
    littleEndian,
    entries: [
      { tag: TAG_IMAGE_WIDTH, fieldType: TIFF_FIELD_LONG, count: 1, value: width },
      { tag: TAG_IMAGE_LENGTH, fieldType: TIFF_FIELD_LONG, count: 1, value: height },
    ],
  });
}
