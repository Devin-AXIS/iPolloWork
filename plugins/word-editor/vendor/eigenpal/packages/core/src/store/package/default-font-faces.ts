// The faces a document uses when it names none, and which faces count as Chinese or East
// Asian fonts.
//
// Every table here was measured against reference output with anonymous probe documents:
// one run per case, the face read back from each drawn glyph. Keep them together so layout,
// font discovery and the notice read one answer.

import { isEastAsianCodePoint } from './east-asian-code-points.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** The face of a Latin slot (`w:ascii`, `w:hAnsi`) that no level names, under an authored `w:rPrDefault`. */
export const FORMAT_DEFAULT_LATIN_FAMILY = 'Times New Roman';

/** The East Asian face that no level names, under an authored `w:rPrDefault`. */
export const FORMAT_DEFAULT_EAST_ASIAN_FAMILY = 'SimSun';

/** East Asian script of the theme language when it names none. */
export const DEFAULT_EAST_ASIAN_SCRIPT = 'Hans';

interface ScriptFaces {
  readonly minor: ReadonlyMap<string, string>;
  readonly major: ReadonlyMap<string, string>;
}

/** An empty East Asian theme slot in a theme part, by the theme language's script. */
export const THEME_EAST_ASIAN_DEFAULTS: ScriptFaces = Object.freeze({
  minor: new Map([
    ['Hans', 'SimSun'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'MS Mincho'],
    ['Hang', 'Batang'],
  ]),
  major: new Map([
    ['Hans', 'SimHei'],
    ['Hant', 'MingLiU'],
    ['Jpan', 'MS Gothic'],
    ['Hang', 'Dotum'],
  ]),
});

/** The built-in theme's East Asian faces, used when the package has no theme part. */
export const BUILT_IN_EAST_ASIAN_FACES: ScriptFaces = Object.freeze({
  minor: new Map([
    ['Hans', 'DengXian'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'Yu Mincho'],
    ['Hang', 'Malgun Gothic'],
  ]),
  major: new Map([
    ['Hans', 'DengXian Light'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'Yu Gothic Light'],
    ['Hang', 'Malgun Gothic'],
  ]),
});

/**
 * Faces whose own character set is Simplified or Traditional Chinese, by lower-cased name.
 * A font's own character set decides; a font table `w:charset` does not override it.
 */
const CHINESE_FACES: ReadonlySet<string> = new Set([
  'simsun',
  'nsimsun',
  'simsun-extb',
  'simhei',
  'kaiti',
  'kaiti_gb2312',
  'fangsong',
  'fangsong_gb2312',
  'microsoft yahei',
  'microsoft yahei ui',
  'microsoft yahei light',
  'microsoft jhenghei',
  'microsoft jhenghei ui',
  'microsoft jhenghei light',
  'mingliu',
  'pmingliu',
  'mingliu_hkscs',
  'mingliu-extb',
  'pmingliu-extb',
  'dfkai-sb',
  'dengxian',
  'dengxian light',
  'lisu',
  'youyuan',
  'stsong',
  'stzhongsong',
  'stfangsong',
  'stkaiti',
  'stheiti',
  'stxihei',
  'stxingkai',
  'stliti',
  'sthupo',
  'stxinwei',
  'pingfang sc',
  'pingfang tc',
  'pingfang hk',
  'songti sc',
  'songti tc',
  'heiti sc',
  'heiti tc',
  'kaiti sc',
  'kaiti tc',
  '宋体',
  '新宋体',
  '黑体',
  '楷体',
  '仿宋',
  '微软雅黑',
  '微軟正黑體',
  '等线',
  '細明體',
  '新細明體',
  '標楷體',
  '华文楷体',
  '华文宋体',
  '华文黑体',
  '华文仿宋',
  '华文中宋',
  '华文细黑',
]);

/**
 * Common Latin faces: their own character set wins over the font table (probe
 * k-latin-ft86-ja gives a GB2312 table entry to Verdana).
 */
const LATIN_FACES: ReadonlySet<string> = new Set([
  'arial',
  'arial black',
  'arial narrow',
  'aptos',
  'aptos display',
  'book antiqua',
  'calibri',
  'calibri light',
  'cambria',
  'candara',
  'century gothic',
  'consolas',
  'constantia',
  'corbel',
  'courier new',
  'garamond',
  'georgia',
  'helvetica',
  'helvetica neue',
  'palatino linotype',
  'segoe ui',
  'tahoma',
  'times new roman',
  'trebuchet ms',
  'verdana',
]);

/**
 * Common Japanese and Korean faces, by lower-cased name. Their own character set wins over
 * the font table (probe c16 gives a GB2312 table entry to Meiryo).
 */
const JAPANESE_KOREAN_FACES: ReadonlySet<string> = new Set([
  'ms mincho',
  'ms gothic',
  'ms pmincho',
  'ms pgothic',
  'ms ui gothic',
  'meiryo',
  'meiryo ui',
  'yu mincho',
  'yu gothic',
  'yu gothic ui',
  'yu gothic light',
  'yu gothic medium',
  'hiragino mincho pron',
  'hiragino kaku gothic pron',
  'hiragino sans',
  'noto sans cjk jp',
  'ｍｓ 明朝',
  'ｍｓ ゴシック',
  'メイリオ',
  '游明朝',
  '游ゴシック',
  'malgun gothic',
  'batang',
  'batangche',
  'gulim',
  'gulimche',
  'dotum',
  'dotumche',
  'gungsuh',
  'gungsuhche',
  'apple sd gothic neo',
  'osaka',
  'osaka-mono',
  'nanum gothic',
  'nanumgothic',
  'klee medium',
  'klee one',
  '맑은 고딕',
  '바탕',
  '굴림',
  '돋움',
  '궁서',
]);

// `w:charset` values of the Chinese character sets: GB2312 and Big5.
const CHINESE_CHARSETS: ReadonlySet<string> = new Set(['86', '88']);
// `w:charset` values of the East Asian character sets: Shift JIS, Hangul, GB2312, and Big5.
const EAST_ASIAN_CHARSETS: ReadonlySet<string> = new Set(['80', '81', '86', '88']);

/**
 * Whether an East Asian face is a Chinese font. A known face answers by its own character set.
 * Any other face, typically one the reader lacks, answers by the font table's `w:charset`.
 * A vertical-writing name (`@SimSun`) is not one, and surrounding spaces do not count.
 */
export function isChineseFace(
  face: string | null | undefined,
  fontTableChineseFaces: readonly string[] | undefined
): boolean {
  const name = face?.trim().toLowerCase();
  if (!name || name.startsWith('@')) return false;
  if (CHINESE_FACES.has(name)) return true;
  if (LATIN_FACES.has(name) || JAPANESE_KOREAN_FACES.has(name)) return false;
  return fontTableChineseFaces?.includes(name) ?? false;
}

/**
 * Whether a face is an East Asian font: Chinese, Japanese, or Korean. A known face answers by
 * its own character set, also when it is not installed. Any other face answers by the font
 * table's `w:charset`. A vertical-writing name is not one.
 */
export function isEastAsianFace(
  face: string | null | undefined,
  fontTableEastAsianFaces: readonly string[] | undefined
): boolean {
  const name = face?.trim().toLowerCase();
  if (!name || name.startsWith('@')) return false;
  if (CHINESE_FACES.has(name) || JAPANESE_KOREAN_FACES.has(name)) return true;
  if (LATIN_FACES.has(name)) return false;
  return fontTableEastAsianFaces?.includes(name) ?? false;
}

/**
 * East Asian system families of macOS that a document default does not make an East Asian
 * face: Hiragino, PingFang, and Heiti, named in Latin letters. They still draw East Asian
 * text and still count for a font pick.
 */
function isUncountedSystemFamily(name: string): boolean {
  return (
    name.startsWith('hiragino') ||
    name.startsWith('pingfang') ||
    name === 'heiti sc' ||
    name === 'heiti tc'
  );
}

/**
 * Whether the East Asian face of the document defaults is an East Asian font, the gate of
 * punctuation and kana compression, hanging punctuation, and justified-space shrinking. It is
 * `isEastAsianFace`, and also counts a name written in East Asian or full-width characters.
 * The macOS system families of `isUncountedSystemFamily` count only by the font table. The
 * compatibility mode does not change the answer.
 */
export function isDefaultEastAsianFace(
  face: string | null | undefined,
  fontTableEastAsianFaces: readonly string[] | undefined
): boolean {
  const name = face?.trim().toLowerCase();
  if (!name || name.startsWith('@')) return false;
  if (isUncountedSystemFamily(name)) return fontTableEastAsianFaces?.includes(name) ?? false;
  return (
    isEastAsianFace(name, fontTableEastAsianFaces) ||
    [...name].some((character) => isEastAsianCodePoint(character.codePointAt(0)!))
  );
}

/**
 * Localized names that documents saved in a Chinese, Japanese, or Korean locale write for
 * common East Asian families, each mapped to the family's English name. Both name one face.
 * A `Map`, not an object: the key is file-derived.
 */
export const LOCALIZED_EAST_ASIAN_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['宋体', 'SimSun'],
  ['新宋体', 'NSimSun'],
  ['黑体', 'SimHei'],
  ['仿宋', 'FangSong'],
  ['楷体', 'KaiTi'],
  ['等线', 'DengXian'],
  ['微软雅黑', 'Microsoft YaHei'],
  ['微軟正黑體', 'Microsoft JhengHei'],
  ['新細明體', 'PMingLiU'],
  ['細明體', 'MingLiU'],
  ['ＭＳ 明朝', 'MS Mincho'],
  ['ＭＳ Ｐ明朝', 'MS PMincho'],
  ['ＭＳ ゴシック', 'MS Gothic'],
  ['ＭＳ Ｐゴシック', 'MS PGothic'],
  ['ＭＳ ＵＩ Ｇｏｔｈｉｃ', 'MS UI Gothic'],
  ['メイリオ', 'Meiryo'],
  ['游ゴシック', 'Yu Gothic'],
  ['游明朝', 'Yu Mincho'],
  ['맑은 고딕', 'Malgun Gothic'],
  ['바탕', 'Batang'],
  ['굴림', 'Gulim'],
  ['돋움', 'Dotum'],
]);

/** The English name of a family: a localized East Asian name maps to it, others stay. */
export function englishFamily(family: string): string {
  const trimmed = family.trim();
  return LOCALIZED_EAST_ASIAN_FAMILIES.get(trimmed) ?? trimmed;
}

/**
 * Whether two family names name one face: equal apart from case and surrounding spaces, or a
 * localized East Asian name and its English name (`メイリオ` and `Meiryo`).
 */
export function sameFontFamily(a: string, b: string): boolean {
  if (a === b) return true;
  return englishFamily(a).toLowerCase() === englishFamily(b).toLowerCase();
}

/**
 * Region words East Asian family names carry (`Noto Sans Mono CJK SC`, `BIZ UDGothic JP`).
 * Not `SC`, `TC`, or `HK`: Latin names use them too (`Alegreya SC`, `HK Grotesk`).
 */
const EAST_ASIAN_NAME_TOKENS = /(?:^|\s)(?:cjk|jp|kr)(?:\s|$)/;

/**
 * Prefixes of East Asian families a host commonly serves that no document font table names:
 * the regional Noto and Source Han families and the platform CJK faces. Lower-cased.
 */
const EAST_ASIAN_FAMILY_PREFIXES: readonly string[] = [
  'noto sans cjk',
  'noto serif cjk',
  'noto sans jp',
  'noto sans sc',
  'noto sans tc',
  'noto sans hk',
  'noto sans kr',
  'noto serif jp',
  'noto serif sc',
  'noto serif tc',
  'noto serif hk',
  'noto serif kr',
  'source han',
  'lxgw',
  'sarasa',
  'ipaex',
  'ipa gothic',
  'ipa mincho',
  'ipa p',
  'wenquanyi',
  'zen kaku',
  'zen maru',
  'zen old mincho',
  'zen kurenaido',
  'zen antique',
  'm plus 1',
  'm plus 2',
  'm plus rounded',
  'kosugi',
  'sawarabi',
  'biz ud',
  'klee',
  'toppan',
  'tsukushi',
  'yu ',
  'meiryo',
  'microsoft yahei',
  'microsoft jhenghei',
  'apple sd',
  'apple ligothic',
  'lihei',
  'lisong',
  'baoli',
  'hannotate',
  'hanzipen',
  'libian',
  'weibei',
  'xingkai',
  'yuanti',
  'wawati',
  'lantinghei',
  'pingfang',
  'hiragino',
  'heiti',
  'songti',
  'stheiti',
  'stsong',
  'stkaiti',
  'stfangsong',
  'nanum',
];

/**
 * Whether a family a user PICKS is an East Asian font, so the pick also applies to East Asian
 * text: a known East Asian face, a family named in CJK or full-width characters, or a common
 * East Asian family a host serves. By NAME only, never by the font table's `w:charset`:
 * CJK-locale files give Latin fonts an East Asian charset too, and a Latin pick that reached
 * `w:eastAsia` would redraw the ideographs in a fallback face.
 */
export function isEastAsianFontFamily(family: string): boolean {
  const name = family.trim().toLowerCase();
  if (!name || name.startsWith('@')) return false;
  return (
    isEastAsianFace(name, undefined) ||
    [...name].some((character) => isEastAsianCodePoint(character.codePointAt(0)!)) ||
    EAST_ASIAN_NAME_TOKENS.test(name) ||
    EAST_ASIAN_FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** Lower-cased names of the font table entries that declare a Chinese `w:charset`. */
export function fontTableChineseFaces(fontTableRoot: OoxmlElement | null): readonly string[] {
  return fontTableFacesWithCharset(fontTableRoot, CHINESE_CHARSETS);
}

/** Lower-cased names of the font table entries that declare an East Asian `w:charset`. */
export function fontTableEastAsianFaces(fontTableRoot: OoxmlElement | null): readonly string[] {
  return fontTableFacesWithCharset(fontTableRoot, EAST_ASIAN_CHARSETS);
}

function fontTableFacesWithCharset(
  fontTableRoot: OoxmlElement | null,
  charsets: ReadonlySet<string>
): readonly string[] {
  if (!fontTableRoot) return [];
  const names: string[] = [];
  for (const font of fontTableRoot.children as readonly OoxmlNode[]) {
    if (!isElement(font) || font.localName !== 'font') continue;
    const name = font.attributes.find((attribute) => attribute.localName === 'name')?.value;
    if (!name || name.length > 128) continue;
    for (const child of font.children as readonly OoxmlNode[]) {
      if (!isElement(child) || child.localName !== 'charset') continue;
      const value = child.attributes.find((attribute) => attribute.localName === 'val')?.value;
      if (value && charsets.has(value.toLowerCase())) {
        names.push(name.trim().toLowerCase());
      }
    }
    if (names.length >= 256) break;
  }
  return Object.freeze(names);
}
