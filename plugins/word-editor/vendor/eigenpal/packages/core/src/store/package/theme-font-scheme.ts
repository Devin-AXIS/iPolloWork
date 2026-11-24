// The `w:rFonts` theme-token table, shared by every lane that resolves one.
//
// ECMA-376 §17.18.96 (ST_Theme) names eight tokens; each is a (major|minor) × (ascii|
// hAnsi|eastAsia|bidi) pair pointing into the theme part's font scheme. The layout lane
// (`layout/run-style.ts`) and the binding lane (`binding/document-run-defaults.ts`,
// `binding/document-catalog.ts`) each resolve these tokens, and until this module they
// each kept a private copy of the mapping — copies that drifted the moment one lane
// learned the `a:ea` faces. Lives beside `theme-color-resolution.ts` for the same reason
// that table does: theme resolution is package material both lanes may read.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import {
  BUILT_IN_EAST_ASIAN_FACES,
  DEFAULT_EAST_ASIAN_SCRIPT,
  fontTableChineseFaces,
  fontTableEastAsianFaces,
  THEME_EAST_ASIAN_DEFAULTS,
} from './default-font-faces.ts';

/**
 * The faces a theme's font scheme offers, per script slot.
 *
 * Structurally satisfied by both lanes' theme-font shapes (`DocumentThemeFonts`,
 * layout's `ThemeFonts`). The East Asian faces are optional so callers that have not
 * harvested them yet still type-check; an absent face resolves to null, which every
 * caller already treats as "fall back to the explicit attribute".
 */
export interface ThemeSchemeFaces {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
  /** `a:majorFont` east asian typeface (`a:ea`). */
  readonly majorEastAsia?: string | null;
  /** `a:minorFont` east asian typeface (`a:ea`). */
  readonly minorEastAsia?: string | null;
  /** Complex-script heading and body faces (`a:cs`). */
  readonly majorBidi?: string | null;
  readonly minorBidi?: string | null;
  /** Language-specific theme faces, keyed by ISO 15924 script. */
  readonly majorSupplemental?: Readonly<Record<string, string>>;
  readonly minorSupplemental?: Readonly<Record<string, string>>;
  /** Lower-cased font table names that declare a Chinese character set. */
  readonly chineseFontTableFaces?: readonly string[];
  /** Lower-cased font table names that declare an East Asian character set. */
  readonly eastAsianFontTableFaces?: readonly string[];
}

/** The theme's font slots, fully resolved, for resolving `w:rFonts` theme attributes. */
export interface DocumentThemeFonts extends ThemeSchemeFaces {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
  /** `a:majorFont` east asian typeface (`a:ea`) — headings. */
  readonly majorEastAsia: string | null;
  /** `a:minorFont` east asian typeface (`a:ea`) — body text. */
  readonly minorEastAsia: string | null;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function child(parent: OoxmlElement, localName: string): OoxmlElement | null {
  for (const candidate of parent.children) {
    if (isElement(candidate) && candidate.localName === localName) return candidate;
  }
  return null;
}

function firstDescendant(root: OoxmlElement, localName: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isElement(current)) continue;
    if (current.localName === localName) return current;
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      stack.push(current.children[index]!);
    }
  }
  return null;
}

const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

function schemeTypeface(
  scheme: OoxmlElement,
  slot: 'majorFont' | 'minorFont',
  face: 'latin' | 'ea' | 'cs'
): string | null {
  const font = child(scheme, slot);
  const element = font ? child(font, face) : null;
  const raw = element?.attributes.find((attribute) => attribute.localName === 'typeface')?.value;
  return raw !== undefined && FONT_NAME.test(raw) ? raw : null;
}

// Canonical trees are immutable. Keep script maps stable when a body edit changes
// the package identity without changing its theme part.
const schemeFacesMemo = new WeakMap<OoxmlElement, DocumentThemeFonts>();

/** Collect every font face consumed by live and headless layout from one canonical theme tree. */
function collectRawThemeSchemeFaces(themeRoot: OoxmlElement | null): DocumentThemeFonts {
  const cached = themeRoot ? schemeFacesMemo.get(themeRoot) : undefined;
  if (cached) return cached;
  const scheme = themeRoot ? firstDescendant(themeRoot, 'fontScheme') : null;
  if (!scheme) {
    return EMPTY_THEME_FACES;
  }
  const faces = Object.freeze({
    major: schemeTypeface(scheme, 'majorFont', 'latin'),
    minor: schemeTypeface(scheme, 'minorFont', 'latin'),
    majorEastAsia: schemeTypeface(scheme, 'majorFont', 'ea'),
    minorEastAsia: schemeTypeface(scheme, 'minorFont', 'ea'),
    majorBidi: schemeTypeface(scheme, 'majorFont', 'cs'),
    minorBidi: schemeTypeface(scheme, 'minorFont', 'cs'),
    ...supplementalFaces(scheme),
  });
  if (themeRoot) schemeFacesMemo.set(themeRoot, faces);
  return faces;
}

// Settings and theme roots are immutable. Body edits reuse this resolved answer.
const languageFacesMemo = new WeakMap<
  OoxmlElement,
  WeakMap<DocumentThemeFonts, DocumentThemeFonts>
>();
const EMPTY_THEME_FACES: DocumentThemeFonts = Object.freeze({
  major: null,
  minor: null,
  majorEastAsia: null,
  minorEastAsia: null,
});

// Theme faces resolved without a themeFontLang element, per raw face set.
const noLanguageFacesMemo = new WeakMap<DocumentThemeFonts, DocumentThemeFonts>();
// Resolved faces with the font table's Chinese faces attached, per font table root.
const fontTableFacesMemo = new WeakMap<
  OoxmlElement,
  WeakMap<DocumentThemeFonts, DocumentThemeFonts>
>();

/**
 * Resolve document theme languages. ISO/IEC 29500-1 themeFontLang maps val, eastAsia, and
 * bidi to separate theme slots.
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.themefontlanguages
 *
 * The East Asian slots resolve through the theme language only, never the run's own
 * language: Simplified Chinese when the theme language names no East Asian script. A slot
 * the theme leaves empty takes the script's default face (`default-font-faces.ts`), or the
 * built-in theme's face when the package has no theme part. The font table's Chinese faces
 * ride along for the East Asian hint (`isChineseFace`), and its East Asian faces for the
 * default-face check of punctuation compression (`isDefaultEastAsianFace`).
 */
export function collectThemeSchemeFaces(
  themeRoot: OoxmlElement | null,
  settingsRoot: OoxmlElement | null = null,
  fontTableRoot: OoxmlElement | null = null
): DocumentThemeFonts {
  const resolved = resolveThemeLanguages(themeRoot, settingsRoot);
  if (!fontTableRoot) return resolved;
  const chinese = fontTableChineseFaces(fontTableRoot);
  const eastAsian = fontTableEastAsianFaces(fontTableRoot);
  if (eastAsian.length === 0) return resolved;
  let byFaces = fontTableFacesMemo.get(fontTableRoot);
  if (!byFaces) fontTableFacesMemo.set(fontTableRoot, (byFaces = new WeakMap()));
  const cached = byFaces.get(resolved);
  if (cached) return cached;
  const withTable = Object.freeze({
    ...resolved,
    ...(chinese.length > 0 ? { chineseFontTableFaces: chinese } : {}),
    eastAsianFontTableFaces: eastAsian,
  });
  byFaces.set(resolved, withTable);
  return withTable;
}

function resolveThemeLanguages(
  themeRoot: OoxmlElement | null,
  settingsRoot: OoxmlElement | null
): DocumentThemeFonts {
  const faces = themeRoot ? collectRawThemeSchemeFaces(themeRoot) : EMPTY_THEME_FACES;
  const languages = settingsRoot ? child(settingsRoot, 'themeFontLang') : null;
  let byTheme = noLanguageFacesMemo;
  if (languages && settingsRoot) {
    byTheme = languageFacesMemo.get(settingsRoot) ?? new WeakMap();
    languageFacesMemo.set(settingsRoot, byTheme);
  }
  const cached = byTheme.get(faces);
  if (cached) return cached;
  const language = (slot: string) =>
    languages?.attributes.find((attribute) => attribute.localName === slot)?.value;
  const latinScript = themeLanguageScript(language('val'));
  const bidiScript = themeLanguageScript(language('bidi'));
  const eastAsiaLanguage = language('eastAsia');
  const eastAsiaScript = eastAsianScript(eastAsiaLanguage);
  const selected = (major: boolean, script: string | null, fallback: string | null | undefined) =>
    (script && (major ? faces.majorSupplemental : faces.minorSupplemental)?.[script]) ||
    fallback ||
    null;
  const defaults =
    faces === EMPTY_THEME_FACES ? BUILT_IN_EAST_ASIAN_FACES : THEME_EAST_ASIAN_DEFAULTS;
  const script = eastAsiaScript ?? DEFAULT_EAST_ASIAN_SCRIPT;
  // Without a theme language the authored `a:ea` face comes first, then the Simplified
  // Chinese supplemental face.
  const eastAsia = (major: boolean, face: string | null | undefined) =>
    (eastAsiaScript
      ? selected(major, eastAsiaScript, face)
      : face || selected(major, DEFAULT_EAST_ASIAN_SCRIPT, null)) ||
    (major ? defaults.major : defaults.minor).get(script) ||
    null;
  // Each setting selects its own token slot, independent of the run attribute
  // carrying that token.
  const resolved = Object.freeze({
    major: selected(true, latinScript, faces.major),
    minor: selected(false, latinScript, faces.minor),
    majorEastAsia: eastAsia(true, faces.majorEastAsia),
    minorEastAsia: eastAsia(false, faces.minorEastAsia),
    majorBidi: selected(true, bidiScript, faces.majorBidi),
    minorBidi: selected(false, bidiScript, faces.minorBidi),
    ...(eastAsiaLanguage === undefined
      ? { majorSupplemental: faces.majorSupplemental, minorSupplemental: faces.minorSupplemental }
      : {}),
  });
  byTheme.set(faces, resolved);
  return resolved;
}

// A Map, not an object literal: the token is file content, and `__proto__` must answer
// undefined — the same rule `theme-color-resolution.ts` applies to its tables.
const TOKEN_FACE: ReadonlyMap<string, (faces: ThemeSchemeFaces) => string | null> = new Map([
  ['minorAscii', (faces: ThemeSchemeFaces) => faces.minor],
  ['minorHAnsi', (faces: ThemeSchemeFaces) => faces.minor],
  ['majorAscii', (faces: ThemeSchemeFaces) => faces.major],
  ['majorHAnsi', (faces: ThemeSchemeFaces) => faces.major],
  // The East Asian tokens are legal on the LATIN theme attributes too: Word's "use East
  // Asian fonts also on Latin text" writes `w:asciiTheme="minorEastAsia"`, and both
  // scripts then paint in the East Asian face. The token decides the face; which
  // attribute carried it does not.
  ['minorEastAsia', (faces: ThemeSchemeFaces) => faces.minorEastAsia ?? null],
  ['majorEastAsia', (faces: ThemeSchemeFaces) => faces.majorEastAsia ?? null],
  ['minorBidi', (faces: ThemeSchemeFaces) => faces.minorBidi ?? null],
  ['majorBidi', (faces: ThemeSchemeFaces) => faces.majorBidi ?? null],
]);

/** A `w:rFonts` theme token resolved to its theme face, or null when it names none we hold. */
export function themeFontFamilyOf(
  token: string | undefined,
  faces: ThemeSchemeFaces,
  eastAsiaLanguage?: string
): string | null {
  if (token === undefined) return null;
  const face = TOKEN_FACE.get(token)?.(faces) ?? null;
  if (face !== null) return face;
  const script = eastAsianScript(eastAsiaLanguage);
  if (!script) return null;
  const supplemental =
    token === 'majorEastAsia'
      ? faces.majorSupplemental
      : token === 'minorEastAsia'
        ? faces.minorSupplemental
        : undefined;
  return supplemental?.[script] ?? null;
}

/** Only CJK scripts participate in the East Asian slot. Explicit script beats region. */
export function eastAsianScript(language: string | undefined): string | null {
  if (!language || language.length > 85) return null;
  const parts = language.toLowerCase().split('-');
  if (parts[0] === 'ja') return 'Jpan';
  if (parts[0] === 'ko') return 'Hang';
  if (parts[0] !== 'zh') return null;
  if (parts.includes('hant')) return 'Hant';
  if (parts.includes('hans')) return 'Hans';
  return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'Hant' : 'Hans';
}

// These complex-script language tags select supplemental Office theme faces. Explicit scripts
// also cover less common document languages without host-locale inference.
const THEME_LANGUAGE_SCRIPTS = new Map([
  ['ar', 'Arab'],
  ['fa', 'Arab'],
  ['ur', 'Arab'],
  ['ps', 'Arab'],
  ['he', 'Hebr'],
  ['yi', 'Hebr'],
  ['dv', 'Thaa'],
  ['syr', 'Syrc'],
]);

function themeLanguageScript(language: string | undefined): string | null {
  if (!language || language.length > 85) return null;
  const parts = language.toLowerCase().split('-');
  // A script subtag precedes region and extension subtags.
  if (parts[1] && /^[a-z]{4}$/.test(parts[1]))
    return parts[1][0]!.toUpperCase() + parts[1].slice(1);
  return eastAsianScript(language) ?? THEME_LANGUAGE_SCRIPTS.get(parts[0]!) ?? null;
}

function supplementalFaces(scheme: OoxmlElement): Partial<ThemeSchemeFaces> {
  const result: {
    majorSupplemental?: Record<string, string>;
    minorSupplemental?: Record<string, string>;
  } = {};
  for (const [slot, key] of [
    ['majorFont', 'majorSupplemental'],
    ['minorFont', 'minorSupplemental'],
  ] as const) {
    const faces: Record<string, string> = Object.create(null);
    for (const node of child(scheme, slot)?.children ?? []) {
      if (!isElement(node) || node.localName !== 'font') continue;
      const script = node.attributes.find((a) => a.localName === 'script')?.value;
      const face = node.attributes.find((a) => a.localName === 'typeface')?.value;
      if (script && /^[A-Z][a-z]{3}$/.test(script) && face && FONT_NAME.test(face))
        faces[script] = face;
    }
    if (Object.keys(faces).length) result[key] = Object.freeze(faces);
  }
  return result;
}
