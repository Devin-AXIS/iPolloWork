// The first frame of a TIFF as RGBA, for the hosts that convert TIFF pictures to PNG. DOM-free:
// the browser port encodes the frame with a canvas, the server port without one.

import type { ImageResourceLimits } from '../runtime/limits.ts';

/** The slice of the TIFF decoder this reads. IFDs are read before any pixels are touched. */
interface TiffImageDirectory {
  readonly width: number;
  readonly height: number;
  readonly [tag: string]: unknown;
}

interface TiffDecoderModule {
  decode(buffer: ArrayBuffer): TiffImageDirectory[];
  decodeImage(buffer: ArrayBuffer, ifd: TiffImageDirectory): void;
  toRGBA8(ifd: TiffImageDirectory): Uint8Array;
}

/** First element of a TIFF tag value, when it is a positive integer. */
function tiffTagInteger(directory: TiffImageDirectory, tag: string): number | null {
  const value = directory[tag];
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = Number(value[0]);
  return Number.isSafeInteger(first) && first > 0 ? first : null;
}

/** Byte size of one value of each TIFF field type, BYTE through IFD. */
const TIFF_FIELD_SIZES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

/**
 * Tags the decoder follows as further directories: SubIFDs, EXIF, GPS, DNG private data,
 * the maker note, and a vendor directory. It follows them with no visited set, and the first
 * page needs none of them.
 */
const TIFF_DIRECTORY_TAGS: ReadonlySet<number> = new Set([330, 34665, 34853, 37500, 50740, 61440]);

/**
 * Rewrites `bytes` in place so the decoder can read only the first directory, within the
 * buffer. The decoder walks the next-directory chain and nested directories with no visited
 * set, and loops over each entry's file-supplied value count; a directory that points back
 * at itself never ends. So the first directory's next pointer is zeroed, the tags that open
 * nested directories become an inert tag 0, and an entry whose values run past the end has
 * its count zeroed. False when the header or the first directory lies outside the bytes.
 */
function confineToFirstDirectory(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mark = String.fromCharCode(bytes[0]!, bytes[1]!);
  if (mark !== 'II' && mark !== 'MM') return false;
  const little = mark === 'II';
  if (view.getUint16(2, little) !== 42) return false;
  const directoryAt = view.getUint32(4, little);
  if (directoryAt < 8 || directoryAt + 2 > bytes.length) return false;
  const count = view.getUint16(directoryAt, little);
  const nextAt = directoryAt + 2 + count * 12;
  if (nextAt + 4 > bytes.length) return false;
  view.setUint32(nextAt, 0, little);
  for (let index = 0; index < count; index += 1) {
    const at = directoryAt + 2 + index * 12;
    if (TIFF_DIRECTORY_TAGS.has(view.getUint16(at, little))) view.setUint16(at, 0, little);
    const size = TIFF_FIELD_SIZES[view.getUint16(at + 2, little)];
    if (size === undefined) continue;
    const length = view.getUint32(at + 4, little) * size;
    if (length > 4 && view.getUint32(at + 8, little) + length > bytes.length) {
      view.setUint32(at + 4, 0, little);
    }
  }
  return true;
}

/** A decoded TIFF frame. */
export interface DecodedTiffFrame {
  readonly rgba: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * First TIFF frame as RGBA, lazily importing the decoder so only documents that contain
 * one load it. Null when the bytes carry no decodable image or exceed the limits.
 *
 * The declared extent is read from the first IFD and checked against the resource limits
 * before any pixel buffer is allocated, and the decoded buffer must match that extent
 * exactly — a decoder that reports one size and returns another is refused rather than
 * trusted. Only the first image is read: a multi-page TIFF shows its first page, and the
 * decoder sees a copy confined to that directory (`confineToFirstDirectory`).
 */
export async function decodeTiffFrame(
  bytes: Uint8Array,
  limits: ImageResourceLimits
): Promise<DecodedTiffFrame | null> {
  // One copy, not two: `slice` already detaches from the caller's buffer and rebases to 0,
  // so its `buffer` is exactly the region the decoder should see. TIFFs run to megabytes.
  const copy = bytes.slice();
  if (!confineToFirstDirectory(copy)) return null;
  const buffer = copy.buffer;
  const imported = (await import('utif2')) as unknown as TiffDecoderModule & {
    default?: TiffDecoderModule;
  };
  const decoder = imported.default ?? imported;

  const page = decoder.decode(buffer)[0];
  if (!page) return null;
  const pixelWidth = tiffTagInteger(page, 't256');
  const pixelHeight = tiffTagInteger(page, 't257');
  if (pixelWidth === null || pixelHeight === null) return null;
  if (pixelWidth > limits.maxDimension || pixelHeight > limits.maxDimension) return null;
  if (pixelWidth > limits.maxPixels / pixelHeight) return null;
  const pixelCount = pixelWidth * pixelHeight;
  if (pixelCount * 4 > limits.maxDecodedBytes) return null;

  decoder.decodeImage(buffer, page);
  if (page.width !== pixelWidth || page.height !== pixelHeight) return null;
  const rgba = decoder.toRGBA8(page);
  if (rgba.length !== pixelCount * 4) return null;
  return Object.freeze({ rgba, pixelWidth, pixelHeight });
}
