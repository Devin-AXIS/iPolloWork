import type { ResolvedFont } from '../layout/font-resource.ts';

const colorFaces = new WeakMap<ResolvedFont, boolean>();

/**
 * Whether a resolved face carries color glyphs: a `COLR` layer table, or `CBDT`/`sbix`
 * bitmap strikes. Read from the sfnt table directory only, so an eight-megabyte face costs
 * a few dozen bytes to classify, and remembered per face.
 */
export function hasColorGlyphTables(font: ResolvedFont): boolean {
  let known = colorFaces.get(font);
  if (known === undefined) {
    known = directoryHasColorTable(font.bytes, font.faceIndex);
    colorFaces.set(font, known);
  }
  return known;
}

const TAGS = new Set(['COLR', 'CBDT', 'sbix']);
const MAX_TABLES = 512;

function directoryHasColorTable(bytes: Uint8Array, faceIndex: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return false;
  let offset = 0;
  // A collection lists each face's offset table after its own 12-byte header.
  if (tag(bytes, 0) === 'ttcf') {
    const faces = view.getUint32(8);
    if (faceIndex < 0 || faceIndex >= faces || 12 + 4 * faceIndex + 4 > bytes.byteLength)
      return false;
    offset = view.getUint32(12 + 4 * faceIndex);
    if (offset + 12 > bytes.byteLength) return false;
  }
  const tables = Math.min(view.getUint16(offset + 4), MAX_TABLES);
  for (let index = 0; index < tables; index++) {
    const entry = offset + 12 + index * 16;
    if (entry + 4 > bytes.byteLength) return false;
    if (TAGS.has(tag(bytes, entry))) return true;
  }
  return false;
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|️/u;

/**
 * Whether a cluster asks for emoji presentation: a character whose default presentation is
 * emoji, or any character followed by the emoji variation selector U+FE0F.
 *
 * Word draws these from its color emoji face and everything else from a symbol face, so a
 * text-presentation dingbat such as a check mark stays a monochrome glyph while the same
 * character with U+FE0F, and every emoji-default pictograph, gets the color face.
 */
export function prefersEmojiPresentation(text: string): boolean {
  return EMOJI_PRESENTATION.test(text);
}

/**
 * The fallback faces in the order this cluster should try them: color faces first for
 * emoji presentation, last otherwise. The relative order within each group is kept.
 */
export function orderFallbackFacesForCluster(
  fonts: readonly ResolvedFont[],
  text: string
): readonly ResolvedFont[] {
  if (fonts.length < 2) return fonts;
  const color = fonts.filter(hasColorGlyphTables);
  if (color.length === 0 || color.length === fonts.length) return fonts;
  const mono = fonts.filter((font) => !color.includes(font));
  return prefersEmojiPresentation(text) ? [...color, ...mono] : [...mono, ...color];
}
