// Text in a face that carries a (3,0) symbol cmap.
//
// Symbol, Wingdings and the other legacy symbol faces map their glyphs at U+F020–U+F0FF. A file
// may still write a plain byte in such a face, a bullet level `w:lvlText="q"` in Wingdings for
// example, and the reference draws that face's glyph for it (❑), not the letter: a face with a
// symbol cmap answers U+0020–U+00FF at U+F000 plus the code. The shaper does not, even when the
// face also lists the byte in a Unicode subtable, so the text is moved before shaping. A face
// with no symbol cmap (the macOS Symbol face maps Unicode only) keeps its own mapping.

import type { ResolvedFont } from './font-resource.ts';

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

/** Does the face carry a (3,0) symbol cmap subtable? Bounds-checked: the bytes are untrusted. */
export function hasSymbolCmap(bytes: Uint8Array, faceIndex: number): boolean {
  const fits = (offset: number, length: number) => offset >= 0 && offset + length <= bytes.length;
  if (!fits(0, 12)) return false;
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const collection = signature === 'ttcf' && fits(12 + faceIndex * 4, 4);
  const base = collection ? readUint32(bytes, 12 + faceIndex * 4) : 0;
  if (!fits(base, 12)) return false;
  const tables = readUint16(bytes, base + 4);
  for (let index = 0; index < tables; index += 1) {
    const record = base + 12 + index * 16;
    if (!fits(record, 16)) return false;
    const isCmap =
      bytes[record] === 0x63 &&
      bytes[record + 1] === 0x6d &&
      bytes[record + 2] === 0x61 &&
      bytes[record + 3] === 0x70;
    if (!isCmap) continue;
    const cmap = readUint32(bytes, record + 8);
    if (!fits(cmap, 4)) return false;
    const encodings = readUint16(bytes, cmap + 2);
    for (let entry = 0; entry < encodings; entry += 1) {
      const at = cmap + 4 + entry * 8;
      if (!fits(at, 4)) return false;
      if (readUint16(bytes, at) === 3 && readUint16(bytes, at + 2) === 0) return true;
    }
    return false;
  }
  return false;
}

const symbolCmapByFont = new WeakMap<ResolvedFont, boolean>();

/** {@link hasSymbolCmap} for a resolved face, read once per face. */
export function fontHasSymbolCmap(font: ResolvedFont, bytes: Uint8Array): boolean {
  let known = symbolCmapByFont.get(font);
  if (known === undefined) {
    known = hasSymbolCmap(bytes, font.faceIndex);
    symbolCmapByFont.set(font, known);
  }
  return known;
}

/** U+0020–U+00FF moved to U+F020–U+F0FF, the codes a symbol cmap answers. Same length. */
export function toSymbolCmapText(text: string): string {
  let out = '';
  let changed = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0xff) {
      out += String.fromCharCode(0xf000 + code);
      changed = true;
    } else out += text[index];
  }
  return changed ? out : text;
}
