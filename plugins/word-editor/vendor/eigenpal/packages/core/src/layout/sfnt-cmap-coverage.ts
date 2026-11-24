// Whether a face's own cmap maps a code point to a glyph.
//
// Shaping cannot answer this: HarfBuzz draws a missing U+2011 with the face's U+2010, and the
// export shaper takes a glyph fallback face. Both hide that the face itself has no glyph. Only
// the Unicode subtables count: (3,10) or (0,4+) format 12, else (3,1) or (0,0-3) format 4. Every
// read is bounds-checked, because the bytes come from a file.
import { trustedFontBytes, type ResolvedFont } from './font-resource.ts';

const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! * 0x1000000 + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!) >>> 0;

/** The chosen Unicode subtable: its format and offset in the font bytes. */
interface UnicodeSubtable {
  readonly format: 4 | 12;
  readonly offset: number;
}

/** The face's Unicode cmap subtable, or null when it has none this lookup reads. */
export function unicodeCmapSubtable(bytes: Uint8Array, faceIndex: number): UnicodeSubtable | null {
  const fits = (offset: number, length: number) => offset >= 0 && offset + length <= bytes.length;
  if (!fits(0, 12)) return null;
  const collection = u32(bytes, 0) === 0x74746366;
  if (collection && !fits(12 + faceIndex * 4, 4)) return null;
  const base = collection ? u32(bytes, 12 + faceIndex * 4) : 0;
  if (!fits(base, 12)) return null;
  const tables = u16(bytes, base + 4);
  for (let index = 0; index < tables; index += 1) {
    const record = base + 12 + index * 16;
    if (!fits(record, 16)) return null;
    if (u32(bytes, record) !== 0x636d6170) continue;
    const cmap = u32(bytes, record + 8);
    if (!fits(cmap, 4)) return null;
    let format4: number | null = null;
    let format12: number | null = null;
    const encodings = u16(bytes, cmap + 2);
    for (let entry = 0; entry < encodings; entry += 1) {
      const at = cmap + 4 + entry * 8;
      if (!fits(at, 8)) return null;
      const platform = u16(bytes, at);
      const encoding = u16(bytes, at + 2);
      const offset = cmap + u32(bytes, at + 4);
      if (!fits(offset, 2)) continue;
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (!unicode) continue;
      const format = u16(bytes, offset);
      if (format === 12 && format12 === null) format12 = offset;
      if (format === 4 && format4 === null) format4 = offset;
    }
    if (format12 !== null) return { format: 12, offset: format12 };
    if (format4 !== null) return { format: 4, offset: format4 };
    return null;
  }
  return null;
}

/** Whether `subtable` maps `codePoint` to a glyph other than notdef. */
export function cmapMapsCodePoint(
  bytes: Uint8Array,
  subtable: UnicodeSubtable,
  codePoint: number
): boolean {
  const fits = (offset: number, length: number) => offset >= 0 && offset + length <= bytes.length;
  const at = subtable.offset;
  if (subtable.format === 12) {
    if (!fits(at, 16)) return false;
    const groups = u32(bytes, at + 12);
    // Groups are sorted by start: a binary search reads at most log2(groups) records.
    let low = 0;
    let high = Math.min(groups, Math.floor((bytes.length - at - 16) / 12)) - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const group = at + 16 + middle * 12;
      const start = u32(bytes, group);
      const end = u32(bytes, group + 4);
      if (codePoint < start) high = middle - 1;
      else if (codePoint > end) low = middle + 1;
      else return u32(bytes, group + 8) + (codePoint - start) !== 0;
    }
    return false;
  }
  if (codePoint > 0xffff || !fits(at, 14)) return false;
  const segments = u16(bytes, at + 6) >>> 1;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  if (!fits(rangeOffsets, segments * 2)) return false;
  for (let segment = 0; segment < segments; segment += 1) {
    if (codePoint > u16(bytes, ends + segment * 2)) continue;
    const start = u16(bytes, starts + segment * 2);
    if (codePoint < start) return false;
    const delta = u16(bytes, deltas + segment * 2);
    const rangeOffsetAt = rangeOffsets + segment * 2;
    const rangeOffset = u16(bytes, rangeOffsetAt);
    if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
    const glyphAt = rangeOffsetAt + rangeOffset + (codePoint - start) * 2;
    if (!fits(glyphAt, 2)) return false;
    const glyph = u16(bytes, glyphAt);
    return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
  }
  return false;
}

const subtables = new WeakMap<ResolvedFont, UnicodeSubtable | null>();

/**
 * Whether the face's own cmap maps `codePoint`, or undefined when the face has no Unicode
 * subtable this lookup reads (a symbol face, for example).
 */
export function fontMapsCodePoint(font: ResolvedFont, codePoint: number): boolean | undefined {
  const bytes = trustedFontBytes(font);
  let subtable = subtables.get(font);
  if (subtable === undefined) {
    subtable = unicodeCmapSubtable(bytes, font.faceIndex);
    subtables.set(font, subtable);
  }
  return subtable ? cmapMapsCodePoint(bytes, subtable, codePoint) : undefined;
}
