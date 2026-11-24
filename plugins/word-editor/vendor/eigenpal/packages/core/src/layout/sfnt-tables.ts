// Range-checked reads of one face's sfnt table directory.
//
// Font bytes are file-supplied, so every offset is checked against the buffer before it is read.

const TTC_TAG = 0x74746366;
/** Most table records one face may declare. A directory is file-supplied. */
const MAX_TABLE_RECORDS = 4096;

export const HEAD_TAG = 0x68656164;
export const OS2_TAG = 0x4f532f32;

/** Where the table directory of face `faceIndex` starts, or null for a malformed file. */
export function tableDirectoryBase(
  view: DataView,
  byteLength: number,
  faceIndex: number
): number | null {
  if (byteLength < 12) return null;
  if (view.getUint32(0) !== TTC_TAG) return 0;
  const index = Number.isSafeInteger(faceIndex) && faceIndex > 0 ? faceIndex : 0;
  const entry = 12 + index * 4;
  if (entry + 4 > byteLength) return null;
  const base = view.getUint32(entry);
  return base + 12 <= byteLength ? base : null;
}

/**
 * Where table `tag` starts, or null when the face has no such table, or the table is shorter
 * than `minimumLength` or runs past the bytes.
 */
export function tableOffset(
  view: DataView,
  byteLength: number,
  base: number,
  tag: number,
  minimumLength: number
): number | null {
  const count = view.getUint16(base + 4);
  if (count > MAX_TABLE_RECORDS || base + 12 + count * 16 > byteLength) return null;
  for (let index = 0; index < count; index += 1) {
    const record = base + 12 + index * 16;
    if (view.getUint32(record) !== tag) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (length < minimumLength || offset + length > byteLength) return null;
    return offset;
  }
  return null;
}
