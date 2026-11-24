// Skip JPEG metadata payloads by their declared lengths, not by scanning their bytes.
// Large EXIF/ICC blocks are valid; work is bounded independently of their total size.
const MAX_MARKERS = 4096;
const MAX_PADDING_BYTES = 4096;
const MAX_EXIF_ENTRIES = 4096;

function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (
    end - start < 14 ||
    bytes[start] !== 0x45 ||
    bytes[start + 1] !== 0x78 ||
    bytes[start + 2] !== 0x69 ||
    bytes[start + 3] !== 0x66 ||
    bytes[start + 4] !== 0 ||
    bytes[start + 5] !== 0
  )
    return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return null;
  // The view is confined to this APP1 segment, including for subarray inputs.
  const view = new DataView(bytes.buffer, bytes.byteOffset + tiff, end - tiff);
  if (view.getUint16(2, little) !== 42) return null;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > view.byteLength) return null;
  const entries = view.getUint16(ifd, little);
  if (entries > MAX_EXIF_ENTRIES || ifd + 2 + entries * 12 > view.byteLength) return null;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) {
      return null;
    }
    const orientation = view.getUint16(entry + 8, little);
    return orientation >= 1 && orientation <= 8 ? orientation : null;
  }
  return null;
}

/** Bounded header validation, with the extent a browser reports after EXIF orientation. */
export function validateJpegHeader(
  bytes: Uint8Array
): Readonly<{ pixelWidth: number; pixelHeight: number }> | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let padding = 0;
  let orientation: number | null = null;
  for (let markers = 0; markers < MAX_MARKERS && offset + 1 < bytes.length; markers += 1) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) {
      if (++padding > MAX_PADDING_BYTES) return null;
      offset += 1;
    }
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    // Never interpret entropy-coded scan data as marker metadata.
    if (marker === 0 || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    const end = offset + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xe1 && orientation === null) {
      orientation = exifOrientation(bytes, offset + 2, end);
    }
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) return null;
      const components = bytes[offset + 7]!;
      if (components === 0 || length !== 8 + 3 * components) return null;
      const pixelHeight = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const pixelWidth = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (pixelWidth === 0 || pixelHeight === 0) return null;
      // Do not rotate or rewrite the payload: the decoder/painter applies EXIF once.
      return orientation !== null && orientation >= 5
        ? { pixelWidth: pixelHeight, pixelHeight: pixelWidth }
        : { pixelWidth, pixelHeight };
    }
    offset = end;
  }
  return null;
}
