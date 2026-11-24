// OOXML East Asian typography policy. Settings travel with the style cascade so its
// producer fingerprint invalidates all stories when document typography changes.
// References: ECMA-376 §17.3.1.16, §17.3.1.21, §17.15.1.18, §17.15.1.58–59, §17.15.1.82.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { isDefaultEastAsianFace } from '../store/package/default-font-faces.ts';
import { omittedDocDefaults } from '../store/package/application-doc-defaults.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { resolveRunStyle, type ThemeFonts } from './run-style.ts';
import { opensWithWidenedSpaces } from './balanced-line-start.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Document-wide East Asian line-break and whitespace policy. @public */
export interface CjkTypographySettings {
  /** Apply the strict Japanese small-kana and prolonged-sound-mark restrictions. */
  readonly strict: boolean;
  /** Disable adjacent full-width punctuation compression when false. */
  readonly punctuationKerning?: boolean;
  /** The document defaults explicitly select an East Asian face as the East Asian font. */
  readonly sourceEastAsianFont?: boolean;
  /**
   * False when the document defaults turn off inter-character East Asian justification on
   * justified lines and automatic spacing between East Asian and other text
   * ({@link defaultsTypography}). Absent means both apply.
   * @internal
   */
  readonly eastAsianSpacing?: false;
  /**
   * A legacy compatibility mode (`lineEndPunctuationAtEveryAlignment`): line-end punctuation
   * hangs at every paragraph alignment, and the paragraph kinsoku switch does not stop it.
   * @internal
   */
  readonly legacyLineEndPunctuation?: true;
  /**
   * The compatibility setting `w:balanceSingleByteDoubleByteWidth`: a space beside East Asian
   * text, and each space of a run of spaces, takes the balanced width (`balanced-space-widths.ts`).
   * Lines in a legacy mode keep their natural inter-word spaces, also with punctuation
   * compression.
   * @internal
   */
  readonly balancedWidths?: true;
  /**
   * `balancedWidths` in a modern compatibility mode (`balancedSpaceShrink`): a space at the
   * balanced width keeps it when a justified or distributed line shrinks its spaces.
   * @internal
   */
  readonly balancedSpaceShrink?: true;
  /**
   * The compatibility setting `w:useWord97LineBreakRules`. With `balancedWidths`, lines in a
   * legacy mode keep natural inter-word spaces in proportional faces.
   * @internal
   */
  readonly word97LineBreaks?: true;
  /** Whitespace compression selected by `w:characterSpacingControl`. */
  readonly compression:
    'doNotCompress' | 'compressPunctuation' | 'compressPunctuationAndJapaneseKana';
  /** Custom no-line-start characters, keyed by normalized language tag. */
  readonly before: Readonly<Record<string, string>>;
  /** Custom no-line-end characters, keyed by normalized language tag. */
  readonly after: Readonly<Record<string, string>>;
}

export interface CjkParagraphTypography {
  readonly settings?: CjkTypographySettings;
  readonly kinsoku: boolean;
  /** Authored `w:overflowPunct` switch. */
  readonly overflowPunctuation: boolean;
  /**
   * Line-end punctuation may hang past the margin: the authored switch is on, and either the
   * paragraph is distributed, or the document defaults name an East Asian face
   * (`sourceEastAsianFont`) and the paragraph is justified. Legacy compatibility modes hang at
   * every alignment then (`legacyLineEndPunctuation`). Absent (no paragraph properties
   * resolved) means the authored switch decides.
   */
  readonly hangingPunctuation?: boolean;
  /** `w:wordWrap` is off: lines may open between any two characters, not only between words. */
  readonly characterWrap: boolean;
  /**
   * Character wrapping keeps Latin words whole in Korean text: the paragraph mark and the run
   * on both sides of a boundary resolve to a Korean East Asian language. Set only with
   * `characterWrap`.
   * @internal
   */
  readonly koreanWordWrap?: true;
  /** Automatic spacing at number/East Asian boundaries; absent means enabled. */
  readonly autoSpaceDN?: boolean;
  /** Automatic spacing at Latin/East Asian boundaries; absent means enabled. */
  readonly autoSpaceDE?: boolean;
  /**
   * Automatic spacing opens only beside East Asian text whose run authors an East Asian font
   * (`ResolvedRunStyle.eastAsianFontAuthored`): a distributed paragraph whose document defaults
   * turn East Asian spacing off.
   * @internal
   */
  readonly automaticSpacingNeedsEastAsianFont?: true;
  /**
   * Kana may compress to pull a line-start-prohibited character onto a full line
   * (`compressPunctuationAndJapaneseKana`): the paragraph is distributed, or the document
   * defaults name an East Asian face and the paragraph is justified, or any alignment in a
   * legacy compatibility mode.
   * @internal
   */
  readonly kanaLineFit?: true;
}

export const DEFAULT_CJK_TYPOGRAPHY: CjkParagraphTypography = Object.freeze({
  kinsoku: true,
  overflowPunctuation: true,
  characterWrap: false,
});

const on = (value: string | undefined): boolean => !['0', 'false', 'off'].includes(value ?? '');
// The `w:jc` values that justify a line (see `paragraphAlignment`).
const JUSTIFIED = new Set([
  'both',
  'distribute',
  'lowKashida',
  'mediumKashida',
  'highKashida',
  'thaiDistribute',
]);
export function cjkTypographyFromSettings(root: OoxmlElement | null): CjkTypographySettings {
  let strict = false;
  let punctuationKerning = true;
  let compression: CjkTypographySettings['compression'] = 'doNotCompress';
  let balancedWidths = false;
  let word97LineBreaks = false;
  const before: Record<string, string> = Object.create(null);
  const after: Record<string, string> = Object.create(null);
  for (const child of root?.children ?? []) {
    if (!('localName' in child)) continue;
    if (child.namespaceUri !== 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
      continue;
    const value = child.attributes.find(
      (attribute) => attribute.localName === 'val' && attribute.namespaceUri === child.namespaceUri
    )?.value;
    if (child.localName === 'strictFirstAndLastChars') strict = on(value);
    if (child.localName === 'compat') {
      balancedWidths = compatFlag(child, 'balanceSingleByteDoubleByteWidth');
      word97LineBreaks = compatFlag(child, 'useWord97LineBreakRules');
    }
    if (child.localName === 'noPunctuationKerning') punctuationKerning = !on(value);
    if (
      child.localName === 'characterSpacingControl' &&
      (value === 'doNotCompress' ||
        value === 'compressPunctuation' ||
        value === 'compressPunctuationAndJapaneseKana')
    )
      compression = value;
    if (child.localName !== 'noLineBreaksBefore' && child.localName !== 'noLineBreaksAfter')
      continue;
    const language = child.attributes
      .find(
        (attribute) =>
          attribute.localName === 'lang' && attribute.namespaceUri === child.namespaceUri
      )
      ?.value.toLowerCase();
    // Bound file-derived policy storage independently of XML parser limits.
    if (!language || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/.test(language)) continue;
    const target = child.localName === 'noLineBreaksBefore' ? before : after;
    if (Object.keys(target).length < 64 || Object.hasOwn(target, language))
      target[language] = (value ?? '').slice(0, 4096);
  }
  return Object.freeze({
    strict,
    punctuationKerning,
    compression,
    ...(balancedWidths ? { balancedWidths: true as const } : {}),
    ...(word97LineBreaks ? { word97LineBreaks: true as const } : {}),
    before: Object.freeze(before),
    after: Object.freeze(after),
  });
}

/** Whether a `w:compat` element turns the on/off setting `name` on. */
function compatFlag(compat: OoxmlElement, name: string): boolean {
  for (const child of compat.children) {
    if (!('localName' in child) || child.localName !== name) continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const value = child.attributes.find(
      (attribute) => attribute.localName === 'val' && attribute.namespaceUri === child.namespaceUri
    )?.value;
    return on(value);
  }
  return false;
}

/**
 * Whether cascaded run properties name Korean as their East Asian language. Only
 * `w:lang/@w:eastAsia` counts here: a Korean `w:val` alone does not make text Korean for
 * character wrapping, and a `w:val` in another language does not cancel an inherited
 * Korean `w:eastAsia`.
 */
export function eastAsiaIsKorean(props: readonly OoxmlProperty[]): boolean {
  let korean = false;
  for (const prop of props) {
    const eastAsia = prop.localName === 'lang' ? prop.attributes?.eastAsia : undefined;
    if (eastAsia) korean = /^ko(?:-|$)/i.test(eastAsia);
  }
  return korean;
}

/**
 * `markRunProperties` is the paragraph mark's cascaded run properties: its East Asian language
 * decides whether character wrapping keeps Latin words whole (`koreanWordWrap`).
 */
export function resolveCjkTypography(
  props: readonly OoxmlProperty[],
  settings?: CjkTypographySettings,
  markRunProperties?: readonly OoxmlProperty[]
): CjkParagraphTypography {
  let { kinsoku, overflowPunctuation, characterWrap } = DEFAULT_CJK_TYPOGRAPHY;
  let justified = false;
  let distributed = false;
  let autoSpaceDN = true;
  let autoSpaceDE = true;
  for (const prop of props) {
    if (prop.localName === 'autoSpaceDN') autoSpaceDN = on(prop.attributes?.val);
    if (prop.localName === 'autoSpaceDE') autoSpaceDE = on(prop.attributes?.val);
    if (prop.localName === 'kinsoku') kinsoku = on(prop.attributes?.val);
    if (prop.localName === 'overflowPunct') overflowPunctuation = on(prop.attributes?.val);
    if (prop.localName === 'wordWrap') characterWrap = !on(prop.attributes?.val);
    if (prop.localName === 'jc') {
      justified = JUSTIFIED.has(prop.attributes?.val ?? '');
      distributed = prop.attributes?.val === 'distribute';
    }
  }
  // Document defaults that turn East Asian spacing off override the paragraph switches. A
  // distributed paragraph, which then spreads every character, keeps automatic spacing beside
  // runs that author an East Asian font.
  const spacingOff = settings?.eastAsianSpacing === false;
  if (spacingOff && !distributed) autoSpaceDN = autoSpaceDE = false;
  // Punctuation hangs in justified paragraphs, full-width and Latin alike. Left, centered, and
  // right-aligned lines keep line-end punctuation inside the margin, except in legacy modes. A
  // document whose defaults name no East Asian face hangs punctuation in distributed
  // paragraphs only.
  const eastAsianDefaults = settings?.sourceEastAsianFont === true;
  const hangingAlignment =
    justified || settings?.legacyLineEndPunctuation === true ? eastAsianDefaults : false;
  return {
    settings,
    kinsoku,
    overflowPunctuation,
    hangingPunctuation:
      overflowPunctuation && settings !== undefined && (distributed || hangingAlignment),
    characterWrap,
    ...(characterWrap && markRunProperties && eastAsiaIsKorean(markRunProperties)
      ? { koreanWordWrap: true as const }
      : {}),
    autoSpaceDN,
    autoSpaceDE,
    ...(spacingOff && distributed ? { automaticSpacingNeedsEastAsianFont: true as const } : {}),
    ...(settings?.compression === 'compressPunctuationAndJapaneseKana' &&
    (distributed || hangingAlignment)
      ? { kanaLineFit: true as const }
      : {}),
  };
}

/**
 * Whether a mark may hang at the end of this line: the paragraph allows it, and the line does
 * not open with spaces that balanced widths widen (`opensWithWidenedSpaces`).
 */
export function lineEndMarksMayHang(
  typography: CjkParagraphTypography,
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): boolean {
  if (!(typography.hangingPunctuation ?? typography.overflowPunctuation)) return false;
  return !(typography.settings?.balancedWidths === true && opensWithWidenedSpaces(spans, measurer));
}

/**
 * Whether a Korean paragraph-final mark other than `。` or `、` may hang. A legacy compatibility
 * mode that compresses punctuation starts the next line with it instead.
 */
export function koreanFinalMarkHangs(settings: CjkTypographySettings | undefined): boolean {
  return !(settings?.legacyLineEndPunctuation === true && settings.compression !== 'doNotCompress');
}

const CJK_LANGUAGE = /^(ja|zh|ko)(-|$)/i;

export function eastAsianLanguage(props: readonly OoxmlProperty[]): string | undefined {
  let language: string | undefined;
  for (const prop of props) {
    if (prop.localName !== 'lang') continue;
    const eastAsia = prop.attributes?.eastAsia;
    // A later explicit East Asian language replaces an inherited one, a non-CJK one too: an
    // `en-US` run in a Chinese document breaks and hangs as English text.
    if (eastAsia) language = CJK_LANGUAGE.test(eastAsia) ? eastAsia.toLowerCase() : undefined;
    else {
      const value = prop.attributes?.val;
      if (value && CJK_LANGUAGE.test(value)) language = value.toLowerCase();
    }
  }
  return language;
}

// Language-specific default tables from §17.3.1.16. Custom sets replace one direction.
const JA_BEFORE = '!%),.:;?]}¢°’”‰′″℃、。々〉》」』】〕゛゜ゝゞ・ヽヾ！％），．：；？］｝｡｣､･ﾞﾟ￠';
const JA_AFTER = '$([\\{£¥‘“〈《「『【〔＄（［｛｢￡￥';
const ZH_BEFORE =
  '!%),.:;>?]}¢¨°·ˇˉ―‖’”…‰′″›℃∶、。〃〉》」』】〕〗〞︶︺︾﹀﹄﹚﹜﹞！＂％＇），．：；？］｀｜｝～￠';
const ZH_AFTER = '$([{£¥·‘“〈《「『【〔〖〝﹙﹛﹝＄（．［｛￡￥';
const ZH_TRAD_BEFORE =
  '! ),.:;?]}¢·–—’”•‥…‧′╴、。〉》」』】〕〞︰︱︳︴︶︸︺︼︾﹀﹂﹄﹏﹐﹑﹒﹔﹕﹖﹗﹚﹜﹞！），．：；？］｜｝､'.replace(
    ' ',
    ''
  );
const ZH_TRAD_AFTER = '([{£¥‘“‵〈《「『【〔〝︵︷︹︻︽︿﹁﹃﹙﹛﹝（｛';
const KO_BEFORE = '!%),.:;?]}¢°’”′″℃〉》」』】〕！％），．：；？］｝￠';
const KO_AFTER = '$([\\{£¥‘“〈《「『【〔＄（［｛￡￥￦';
export const STRICT_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶーｧｨｩｪｫｬｭｮｯｰ';

export function kinsokuCharacters(
  language: string,
  settings?: CjkTypographySettings
): { before: string; after: string } {
  const family = language.split('-')[0];
  const traditional = /^zh-(tw|hk|mo|hant)(-|$)/.test(language);
  let before =
    family === 'zh'
      ? traditional
        ? ZH_TRAD_BEFORE
        : ZH_BEFORE
      : family === 'ko'
        ? KO_BEFORE
        : JA_BEFORE;
  let after =
    family === 'zh'
      ? traditional
        ? ZH_TRAD_AFTER
        : ZH_AFTER
      : family === 'ko'
        ? KO_AFTER
        : JA_AFTER;
  if (family === 'ja' && settings?.strict) before += STRICT_KANA;
  before = settings?.before[language] ?? before;
  after = settings?.after[language] ?? after;
  return { before, after };
}

/**
 * Whether the authored document defaults select an East Asian face as the East Asian font.
 * Adjacent full-width punctuation compression needs one. Only `w:rPrDefault` counts: an
 * application or theme fallback alone does not. The resolved face must be a Chinese,
 * Japanese, or Korean font (`isDefaultEastAsianFace`). An empty theme slot resolves to a built-in
 * East Asian face.
 */
export function defaultsSelectEastAsianFace(
  defaultRun: readonly OoxmlProperty[],
  themeFonts: ThemeFonts
): boolean {
  if (!namesEastAsianFont(defaultRun)) return false;
  const face = resolveRunStyle(defaultRun, themeFonts).fontFamilyEastAsia;
  return isDefaultEastAsianFace(face, themeFonts.eastAsianFontTableFaces);
}

/** Whether run defaults name an East Asian face slot (`w:eastAsia` or `w:eastAsiaTheme`). */
function namesEastAsianFont(defaultRun: readonly OoxmlProperty[]): boolean {
  return defaultRun.some(
    (prop) =>
      prop.localName === 'rFonts' &&
      Boolean(prop.attributes?.eastAsia || prop.attributes?.eastAsiaTheme)
  );
}

/**
 * The East Asian typography the styles part's document defaults select. East Asian spacing
 * (inter-character justification on justified lines, and automatic spacing between East Asian
 * and other text) applies when the styles part omits `w:rPrDefault`, or when `w:rPrDefault`
 * names an East Asian font in `w:rFonts`. Any other `w:rPrDefault`, even an empty one, turns
 * it off, in every compatibility mode. Fonts set on styles or runs do not count.
 */
export function defaultsTypography(
  stylesRoot: OoxmlElement,
  defaultRun: readonly OoxmlProperty[],
  themeFonts: ThemeFonts
): Pick<CjkTypographySettings, 'sourceEastAsianFont' | 'eastAsianSpacing'> {
  const sourceEastAsianFont = defaultsSelectEastAsianFace(defaultRun, themeFonts);
  const spacing =
    stylesRoot.namespaceUri !== WML_NAMESPACE_URI ||
    omittedDocDefaults(stylesRoot).run ||
    namesEastAsianFont(defaultRun);
  return spacing ? { sourceEastAsianFont } : { sourceEastAsianFont, eastAsianSpacing: false };
}
