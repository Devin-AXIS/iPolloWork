import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import type { ThemeFonts } from './run-style.ts';
import { isChineseFace } from '../store/package/default-font-faces.ts';

/** Last specified hint wins across the already-cascaded run properties. */
export function hasEastAsiaSymbolHint(properties: readonly OoxmlProperty[]): boolean {
  let hint: string | undefined;
  let cs = false;
  let rtl = false;
  for (const property of properties) {
    if (property.localName === 'rFonts' && property.attributes?.hint !== undefined) {
      hint = property.attributes.hint;
    } else if (property.localName === 'cs' || property.localName === 'rtl') {
      const enabled = !['0', 'false', 'off'].includes(property.attributes?.val ?? '1');
      if (property.localName === 'cs') cs = enabled;
      else rtl = enabled;
    }
  }
  return hint === 'eastAsia' && !cs && !rtl;
}

/**
 * MS-OI29500 2.1.88: Word ignores `hint="eastAsia"` when the East Asian face is Times New
 * Roman AND the ascii and hAnsi faces are the same.
 *
 * `eastAsiaFace` is the run's RESOLVED East Asian face, so a theme slot that resolves to
 * Times New Roman counts. The Latin faces are read from the same cascaded properties as
 * {@link hasEastAsiaSymbolHint}, last specified value per attribute winning (§17.3.2.26),
 * and compared as resolved faces through `themeFonts`, the way Word compares them. When a
 * theme token has no resolved or explicit fallback face, or a face is left unspecified,
 * the comparison falls back to the exception (hint ignored), which is the conservative
 * pre-widening behavior.
 */
export function hasTimesNewRomanEastAsiaException(
  properties: readonly OoxmlProperty[],
  eastAsiaFace: string | null,
  themeFonts?: ThemeFonts
): boolean {
  if (eastAsiaFace?.toLowerCase() !== 'times new roman') return false;
  let ascii: string | null | undefined;
  let hAnsi: string | null | undefined;
  const face = (token: string | undefined, explicit: string | undefined): string | null =>
    ((themeFonts ? themeFontFamilyOf(token, themeFonts) : null) ?? explicit)?.toLowerCase() ?? null;
  for (const property of properties) {
    if (property.localName !== 'rFonts') continue;
    const attributes = property.attributes;
    if (attributes?.asciiTheme !== undefined || attributes?.ascii !== undefined) {
      ascii = face(attributes.asciiTheme, attributes.ascii);
    }
    if (attributes?.hAnsiTheme !== undefined || attributes?.hAnsi !== undefined) {
      hAnsi = face(attributes.hAnsiTheme, attributes.hAnsi);
    }
  }
  // Missing faces and unresolved tokens cannot establish a difference.
  if (ascii == null || hAnsi == null) return true;
  return ascii === hAnsi;
}

/**
 * MS-OI29500 2.1.88: the code points that resolve through the East Asian face
 * unconditionally under `hint="eastAsia"`.
 *
 * Latin-1 keeps only the symbol exceptions; ASCII and the language/charset-dependent
 * accented letters are deliberately excluded. Greek and Cyrillic use the exact table
 * ranges. The CJK radicals at U+2E80-U+2EFF are in the same table but already classify as strong East
 * Asian text without a hint, so they are not repeated here.
 *
 * Two parts of the table are left out on purpose. Combining marks and format characters
 * (U+0300-U+036F, U+200B-U+200F, U+2028-U+202F, U+2060-U+206F, U+20D0-U+20FF) must stay in
 * the font of the base character they attach to: slicing them into their own span splits a
 * grapheme cluster across two faces. The Private Use Area (U+E000-U+F8FF) is where symbol
 * fonts (Wingdings, Symbol) keep their glyphs, and those runs are already routed by
 * `symbol-run.ts`; sending them to the East Asian face paints notdef boxes.
 */
export function isEastAsiaHintSymbol(codePoint: number): boolean {
  return (
    codePoint === 0xa1 ||
    codePoint === 0xa4 ||
    (codePoint >= 0xa7 && codePoint <= 0xa8) ||
    codePoint === 0xaa ||
    codePoint === 0xad ||
    codePoint === 0xaf ||
    (codePoint >= 0xb0 && codePoint <= 0xb4) ||
    (codePoint >= 0xb6 && codePoint <= 0xba) ||
    (codePoint >= 0xbc && codePoint <= 0xbf) ||
    codePoint === 0xd7 ||
    codePoint === 0xf7 ||
    // Spacing modifier letters (not the combining marks that follow them).
    (codePoint >= 0x2b0 && codePoint <= 0x2ff) ||
    (codePoint >= 0x370 && codePoint <= 0x3cf) ||
    (codePoint >= 0x400 && codePoint <= 0x4ff) ||
    // General punctuation through Dingbats, minus format characters and combining marks:
    // quotes, dashes, arrows, enclosed alphanumerics, box drawing, geometric shapes.
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    (codePoint >= 0x2010 && codePoint <= 0x2027) ||
    // The narrow no-break space is a space, not a format character.
    codePoint === 0x202f ||
    (codePoint >= 0x2030 && codePoint <= 0x205f) ||
    (codePoint >= 0x2070 && codePoint <= 0x20cf) ||
    (codePoint >= 0x2100 && codePoint <= 0x27bf) ||
    // Alphabetic presentation forms up to, not including, the Hebrew ligatures.
    (codePoint >= 0xfb00 && codePoint <= 0xfb1c)
  );
}

/** Where a hinted run's conditional characters go: decided by its language and face. */
export interface EastAsiaHintScope {
  /** The run's East Asian language is Chinese, or it names none. */
  readonly chineseLanguage: boolean;
  /** The run's East Asian face is a Chinese font. */
  readonly chineseFace: boolean;
}

/** Latin-1 accented letters that follow the hint only for a Chinese East Asian language. */
const LANGUAGE_CONDITIONAL_LATIN1: ReadonlySet<number> = new Set([
  0xe0, 0xe1, 0xe8, 0xe9, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf9, 0xfa, 0xfc,
]);

/**
 * Whether a code point resolves through the East Asian face under `hint="eastAsia"`.
 *
 * `true` hints only the unconditional table ({@link isEastAsiaHintSymbol}). A scope adds the
 * conditional ranges: the Latin-1 letters above and Latin Extended Additional follow the hint
 * when the run's East Asian language is Chinese or absent; Latin Extended-A and -B and the
 * IPA letters also follow it when the East Asian face is a Chinese font (`isChineseFace`).
 */
export function isEastAsiaHinted(
  codePoint: number,
  scope: boolean | EastAsiaHintScope | undefined
): boolean {
  if (!scope) return false;
  if (isEastAsiaHintSymbol(codePoint)) return true;
  if (scope === true) return false;
  if (LANGUAGE_CONDITIONAL_LATIN1.has(codePoint) || (codePoint >= 0x1e00 && codePoint <= 0x1eff))
    return scope.chineseLanguage;
  if (codePoint >= 0x100 && codePoint <= 0x2af) return scope.chineseLanguage || scope.chineseFace;
  return false;
}

/** The hint scope of cascaded run properties and their resolved East Asian face. */
export function eastAsiaHintScope(
  properties: readonly OoxmlProperty[],
  eastAsiaFace: string | null,
  themeFonts?: ThemeFonts
): EastAsiaHintScope {
  let language: string | undefined;
  for (const property of properties) {
    if (property.localName === 'lang' && property.attributes?.eastAsia !== undefined)
      language = property.attributes.eastAsia;
  }
  return {
    chineseLanguage: !language || /^zh(?:-|$)/i.test(language),
    chineseFace: isChineseFace(eastAsiaFace, themeFonts?.chineseFontTableFaces),
  };
}
