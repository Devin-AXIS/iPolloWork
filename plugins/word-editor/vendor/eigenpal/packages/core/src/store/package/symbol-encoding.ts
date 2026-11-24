// Legacy symbol-font encoding (U+F020–U+F0FF) → Unicode, for list markers.
//
// Word writes a Symbol/Wingdings bullet as the font's own byte PLUS 0xF000: the default
// bullet is `<w:lvlText w:val=""/>` with `<w:rFonts w:ascii="Symbol"/>`, not U+2022.
// Those codepoints are in the Private Use Area, so they mean "glyph 0xB7 of THIS font" and
// nothing at all to any other font. A (3,0) symbol-cmap Symbol/Wingdings resolves them; a
// Unicode-cmap font of the same name (macOS ships one) does not, and the reader gets a tofu
// box where every Word-authored bullet should be.
//
// The mapping is a FALLBACK, not a substitution policy: when the caller can prove the
// authored family is really available, the file's own codepoint is left alone so the
// intended typeface draws it. Pure and DOM-free — no font loading happens here.

/** PUA offset Word adds to a symbol font's byte value. */
const SYMBOL_PUA_BASE = 0xf000;

const SYMBOL_PUA_END = 0xf0ff;

/**
 * Adobe Symbol high-range glyphs used as bullets, by byte value.
 *
 * Only entries whose Unicode equivalent is the SAME glyph are listed; an approximate match
 * would trade a tofu box for a wrong character, which is not an improvement.
 */
const SYMBOL_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0xa7, '♣'], // clubsuit ♣
  [0xa8, '♦'], // diamondsuit ♦
  [0xa9, '♥'], // heartsuit ♥
  [0xaa, '♠'], // spadesuit ♠
  [0xae, '→'], // arrowright →
  [0xb0, '°'], // degree °
  [0xb4, '×'], // multiply ×
  [0xb7, '•'], // bulletmath • — Word's default level-0 bullet
  [0xde, '⇒'], // arrowdblright ⇒
]);

/**
 * Wingdings glyphs used for bullets and form check boxes, by byte value.
 *
 * Each entry was compared with the glyph the face itself draws for that byte.
 */
const WINGDINGS_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x3f, '\u270d'], // writing hand ✍
  [0x45, '\u261c'], // white left pointing index ☜
  [0x6c, '\u25cf'], // 'l' — black circle ●
  [0x6e, '\u25a0'], // 'n' — black square ■
  [0x6f, '\u25a1'], // 'o' — white square □
  [0x71, '\u2751'], // 'q' — lower right shadowed white square ❑
  [0x72, '\u2752'], // 'r' — upper right shadowed white square ❒
  [0xa7, '\u25aa'], // small black square ▪ — Word's default level-2 bullet
  [0xa8, '\u25fb'], // white medium square ◻
  [0xd8, '\u27a2'], // three-D arrowhead ➢
  [0xfb, '\u2717'], // ballot X ✗
  [0xfc, '\u2714'], // heavy check mark ✔
  [0xfd, '\u2718'], // heavy ballot X ✘
  [0xfe, '\u2611'], // ballot box with check ☑
]);

/** Wingdings 2 glyphs used for bullets and form check boxes, compared with the face. */
const WINGDINGS2_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x2a, '\u25ab'], // white small square ▫
  [0x30, '\u25af'], // white vertical rectangle ▯
  [0x35, '\u25a2'], // white square with rounded corners ▢
  [0x4f, '\u2717'], // ballot X ✗
  [0x50, '\u2713'], // check mark ✓
  [0x52, '\u2611'], // ballot box with check ☑
  [0x53, '\u2612'], // ballot box with X ☒
  [0x9a, '\u2b58'], // heavy circle ⭘
  [0xa3, '\u25a1'], // white square □
  [0xa7, '\u25a3'], // white square containing black small square ▣
  [0xb7, '\u25c6'], // black diamond ◆
]);

/** Wingdings 3 arrows, compared with the face. */
const WINGDINGS3_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0xa7, '\u2b05'], // leftwards black arrow ⬅
]);

/**
 * Webdings glyphs, compared with the face. Its encoding is its own: the window buttons that
 * forms use as check boxes sit on the digits.
 */
const WEBDINGS_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x30, '\u{1f5d5}'], // minimize 🗕
  [0x31, '\u{1f5d6}'], // maximize 🗖
  [0x32, '\u{1f5d7}'], // overlap 🗗
  [0x63, '\u25a1'], // white square □
  [0x6e, '\u25cf'], // black circle ●
  [0x72, '\u{1f5d9}'], // cancellation X 🗙
]);

/**
 * Family name → its byte-to-Unicode table.
 *
 * Keys are lowercased because `w:rFonts` casing is authored, not canonical.
 */
const SYMBOL_FAMILIES: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map([
  ['symbol', SYMBOL_TO_UNICODE],
  ['wingdings', WINGDINGS_TO_UNICODE],
  ['wingdings 2', WINGDINGS2_TO_UNICODE],
  ['wingdings 3', WINGDINGS3_TO_UNICODE],
  ['webdings', WEBDINGS_TO_UNICODE],
]);

/** Longest family name we will even look up — the value is file-derived. */
const MAX_FAMILY_LENGTH = 64;

/**
 * Every legacy symbol-encoded family, case-folded.
 *
 * This is the CLOSED set an availability oracle can ever be asked about, because
 * {@link mapSymbolPuaText} consults its oracle only after {@link isSymbolEncodedFamily}
 * passes. A caller probing these names therefore probes a fixed list of five, never a
 * file-derived one. Derived from the table so the two cannot drift; font requests fold
 * case, so the folded spelling reaches the same face as the document's own.
 */
export const SYMBOL_ENCODED_FAMILIES: readonly string[] = Object.freeze([
  ...SYMBOL_FAMILIES.keys(),
]);

/** True when the family is one of the legacy symbol-encoded fonts. */
export function isSymbolEncodedFamily(fontFamily: string | null | undefined): boolean {
  if (!fontFamily || fontFamily.length > MAX_FAMILY_LENGTH) return false;
  return SYMBOL_FAMILIES.has(fontFamily.toLowerCase());
}

/** Unicode twin → face byte, per table, built on first use. */
const unicodeToByteByTable = new Map<ReadonlyMap<number, string>, ReadonlyMap<number, number>>();

/**
 * The byte of a symbol-encoded face that one character stands for, or null.
 *
 * The inverse of {@link mapSymbolPuaText}: a private-use code names its byte directly, a
 * Unicode twin that mapping produced names the byte it came from, and a bare byte (U+0020–
 * U+00FF) is the byte itself, which is how the face reads it. Twins win over bare bytes,
 * because mapping is the only producer of a twin inside that range (`×` from Symbol 0xB4).
 * Anything else is no byte of the face.
 */
export function symbolFaceByteOf(codePoint: number, fontFamily: string): number | null {
  if (!isSymbolEncodedFamily(fontFamily)) return null;
  if (codePoint >= SYMBOL_PUA_BASE + 0x20 && codePoint <= SYMBOL_PUA_END)
    return codePoint - SYMBOL_PUA_BASE;
  const table = SYMBOL_FAMILIES.get(fontFamily.toLowerCase())!;
  let inverse = unicodeToByteByTable.get(table);
  if (!inverse) {
    const built = new Map<number, number>();
    for (const [byte, twin] of table) built.set(twin.codePointAt(0)!, byte);
    unicodeToByteByTable.set(table, built);
    inverse = built;
  }
  const twin = inverse.get(codePoint);
  if (twin !== undefined) return twin;
  return codePoint >= 0x20 && codePoint <= 0xff ? codePoint : null;
}

/** True when the text contains a codepoint from the symbol-font private-use range. */
export function hasSymbolPua(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code >= SYMBOL_PUA_BASE && code <= SYMBOL_PUA_END) return true;
  }
  return false;
}

/**
 * Rewrite private-use symbol-font codepoints to their Unicode equivalents.
 *
 * Applies only to a known symbol-encoded family, only to the U+F020–U+F0FF range, and only
 * to codepoints with an exact Unicode counterpart — anything else is returned untouched, so
 * an unrecognised glyph is never replaced by a wrong one. Returns the input string by
 * identity when nothing changes.
 *
 * `isFamilyAvailable` is the escape hatch: a host that KNOWS the authored font is present
 * should return true, and the file's own codepoint is kept so the real typeface draws it.
 * Absent, the fallback applies, because an unmapped PUA codepoint renders as a tofu box in
 * every font that is not the symbol-encoded original.
 *
 * Called without the oracle it is also the EXTRACTION answer: the text a symbol glyph should
 * read as when the drawn glyph stays the authored one. A PDF exporter maps the drawn private
 * codepoint back through this for its `ToUnicode` table, so copying a Word bullet out of the
 * page yields a bullet rather than a private-use character.
 *
 * @public
 */
export function mapSymbolPuaText(
  text: string,
  fontFamily: string | null | undefined,
  isFamilyAvailable?: (family: string) => boolean
): string {
  if (text.length === 0 || !isSymbolEncodedFamily(fontFamily)) return text;
  const table = SYMBOL_FAMILIES.get(fontFamily!.toLowerCase())!;
  if (isFamilyAvailable?.(fontFamily!) === true) return text;
  let out = '';
  let changed = false;
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code >= SYMBOL_PUA_BASE && code <= SYMBOL_PUA_END) {
      const mapped = table.get(code - SYMBOL_PUA_BASE);
      if (mapped !== undefined) {
        out += mapped;
        changed = true;
        continue;
      }
    }
    out += glyph;
  }
  return changed ? out : text;
}

/** Resolve single-byte Symbol and Wingdings bullets through their known glyph mapping. */
export function mapSymbolBulletText(
  text: string,
  fontFamily: string | null | undefined,
  isFamilyAvailable?: (family: string) => boolean
): string {
  if (text.length === 1 && isSymbolEncodedFamily(fontFamily)) {
    const family = fontFamily!.toLowerCase();
    if (family === 'symbol' || family === 'wingdings') {
      const mapped = SYMBOL_FAMILIES.get(family)!.get(text.charCodeAt(0));
      if (mapped !== undefined && isFamilyAvailable?.(fontFamily!) !== true) return mapped;
    }
  }
  return mapSymbolPuaText(text, fontFamily, isFamilyAvailable);
}
