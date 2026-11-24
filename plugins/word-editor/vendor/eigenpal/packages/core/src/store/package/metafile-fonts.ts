// Faces named by the EMF and WMF pictures in a package.
//
// A metafile draws its text in the faces its own font records name, which no story names,
// so the font collectors never see them. This reads only the font records: the EMF
// `EMR_EXTCREATEFONTINDIRECTW` and the WMF `META_CREATEFONTINDIRECT`. Every walk is bounded,
// and each name passes the same validation as a run's font family.

import type { OoxmlPackage } from './ooxml-package.ts';

const MAX_PARTS = 64;
const MAX_RECORDS = 100_000;
const MAX_FAMILIES = 16;
const EMR_HEADER = 1;
const EMR_EOF = 14;
const EMR_EXTCREATEFONTINDIRECTW = 82;
const WMF_PLACEABLE_KEY = 0x9ac6cdd7;
const META_CREATEFONTINDIRECT = 0x02fb;

/** The UTF-16LE text of `bytes` up to its first NUL. */
function utf16(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let at = start; at + 1 < start + length && at + 1 < bytes.length; at += 2) {
    const code = bytes[at]! | (bytes[at + 1]! << 8);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/** The single-byte text of `bytes` up to its first NUL, read as Latin-1. */
function latin1(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let at = start; at < start + length && at < bytes.length; at++) {
    if (bytes[at] === 0) break;
    out += String.fromCharCode(bytes[at]!);
  }
  return out;
}

function emfFaces(bytes: Uint8Array, add: (face: string) => void): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0, true) !== EMR_HEADER) return;
  let at = 0;
  for (let count = 0; count < MAX_RECORDS && at + 8 <= bytes.length; count++) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (size < 8 || size % 4 !== 0 || at + size > bytes.length) return;
    // The record, the font handle, then a LOGFONTW whose face name starts 28 bytes in.
    if (type === EMR_EXTCREATEFONTINDIRECTW && size >= 12 + 28 + 64) add(utf16(bytes, at + 40, 64));
    if (type === EMR_EOF) return;
    at += size;
  }
}

function wmfFaces(bytes: Uint8Array, add: (face: string) => void): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = bytes.length >= 22 && view.getUint32(0, true) === WMF_PLACEABLE_KEY ? 22 : 0;
  if (at + 18 > bytes.length) return;
  const headerWords = view.getUint16(at + 2, true);
  if (headerWords !== 9) return;
  at += 18;
  for (let count = 0; count < MAX_RECORDS && at + 6 <= bytes.length; count++) {
    const words = view.getUint32(at, true);
    const fn = view.getUint16(at + 4, true);
    if (words < 3 || at + words * 2 > bytes.length) return;
    // The record, then a LOGFONT whose face name starts 18 bytes in.
    if (fn === META_CREATEFONTINDIRECT && words * 2 >= 6 + 18 + 1)
      add(latin1(bytes, at + 6 + 18, Math.min(32, words * 2 - 6 - 18)));
    if (fn === 0) return;
    at += words * 2;
  }
}

/** Faces the package's EMF and WMF pictures name, in part order. */
export function metafileFontFamilies(
  pkg: Pick<OoxmlPackage, 'partBytes'>,
  validate: (raw: string) => string | null
): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (raw: string): void => {
    // `System` names the device's stock font, not a face a resolver can find.
    if (raw.trim().toLowerCase() === 'system') return;
    const family = validate(raw.trim());
    if (family === null || byFold.size >= MAX_FAMILIES) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  let parts = 0;
  for (const [name, bytes] of pkg.partBytes) {
    const lower = name.toLowerCase();
    // Only pictures a story can show: not the package thumbnail or the glossary's own media.
    if (!lower.startsWith('/word/') || lower.startsWith('/word/glossary/')) continue;
    const emf = lower.endsWith('.emf'),
      wmf = lower.endsWith('.wmf');
    if (!emf && !wmf) continue;
    if (++parts > MAX_PARTS || byFold.size >= MAX_FAMILIES) break;
    if (emf) emfFaces(bytes, add);
    else wmfFaces(bytes, add);
  }
  return [...byFold.values()];
}
