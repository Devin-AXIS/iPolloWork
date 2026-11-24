const MAX_PNG_METADATA_SCAN = 65_536;
const MIN_RASTER_DPI = 10;
const MAX_RASTER_DPI = 2_400;

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  );
}

/** Read PNG `pHYs` density before `IDAT`, under a fixed prefix scan bound. */
export function readPngPhysicalDensity(
  bytes: Uint8Array
): { readonly dpiX: number; readonly dpiY: number } | null {
  const scanLimit = Math.min(bytes.length, MAX_PNG_METADATA_SCAN);
  let offset = 33;
  while (offset + 12 <= scanLimit) {
    const length = readUint32Be(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > scanLimit) return null;
    const typeOffset = offset + 4;
    const isIdat =
      bytes[typeOffset] === 0x49 &&
      bytes[typeOffset + 1] === 0x44 &&
      bytes[typeOffset + 2] === 0x41 &&
      bytes[typeOffset + 3] === 0x54;
    const isIend =
      bytes[typeOffset] === 0x49 &&
      bytes[typeOffset + 1] === 0x45 &&
      bytes[typeOffset + 2] === 0x4e &&
      bytes[typeOffset + 3] === 0x44;
    if (isIdat || isIend) return null;
    const isPhys =
      bytes[typeOffset] === 0x70 &&
      bytes[typeOffset + 1] === 0x48 &&
      bytes[typeOffset + 2] === 0x59 &&
      bytes[typeOffset + 3] === 0x73;
    if (isPhys && length === 9 && bytes[offset + 16] === 1) {
      const dpiX = readUint32Be(bytes, offset + 8) * 0.0254;
      const dpiY = readUint32Be(bytes, offset + 12) * 0.0254;
      if (
        dpiX >= MIN_RASTER_DPI &&
        dpiX <= MAX_RASTER_DPI &&
        dpiY >= MIN_RASTER_DPI &&
        dpiY <= MAX_RASTER_DPI
      ) {
        return { dpiX, dpiY };
      }
      return null;
    }
    offset = chunkEnd;
  }
  return null;
}
