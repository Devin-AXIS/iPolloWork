import { revisionMarkupSourcesEqual } from './revision-markup-style.ts';
import { layoutDerivedSpacingSourcesEqual } from './layout-derived-spacing.ts';
// The accepted run property boundary, resolved for layout (task 7.2).
//
// Raw `w:rPr` children are authored OOXML: half-points, twips, percentages, toggle elements
// whose absence means "inherit" and whose `w:val="0"` means "off". Layout needs typed values
// in one unit system, and it needs them ONCE per run rather than re-derived by every
// consumer — the measurer, the style span and the painter must agree exactly or a caret
// lands where no glyph is.
//
// Every field here is resolved from the run's own properties. Style and document-default
// inheritance is a separate layer (the style resolver); this is the direct-formatting half,
// which is what the D8 boundary covers.

import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import { paintedFontFamilyName } from '../store/package/font-family-name.ts';
import { RUN_FONT_DEFAULTS } from './application-run-defaults.ts';
import { resolveOoxmlShadingFill } from './ooxml-shading.ts';
import { resolveTextOutline } from './run-text-outline.ts';
import { resolveRunLigatures } from './run-ligatures.ts';
import { borderEdgeFromAttributes, type ParagraphBorderEdge } from './paragraph-style.ts';
// One reading of `CT_OnOff` for the whole lane. The style cascade combines toggle levels with
// it and this resolver reads the combined result with it, so the two cannot drift apart.
import { styleToggleIsOn as toggle } from './style-toggles.ts';

/** `w:vertAlign` — script position, which also scales the run's effective size. */
export type VerticalAlign = 'baseline' | 'superscript' | 'subscript';

/** A resolved underline: its variant, and its colour when it does not follow the text. */
export interface ResolvedUnderline {
  /** The authored `ST_Underline` variant. */
  readonly variant: string;
  /** RRGGBB, or null when the underline follows the text colour. */
  readonly color: string | null;
}

/**
 * A run's character properties after the full cascade, in the units layout works in.
 *
 * Points rather than half-points, RRGGBB rather than theme references — everything already
 * resolved, so measurement and paint never re-run the cascade per glyph.
 */
export interface ResolvedRunStyle {
  readonly fontFamily: string | null;
  /**
   * The `eastAsia` slot's typeface (`w:rFonts w:eastAsia`/`w:eastAsiaTheme`), or null when
   * no level authors one.
   *
   * OOXML picks a run's face per SCRIPT: `fontFamily` covers the ascii/hAnsi slots, and
   * ideographic/kana/hangul text resolves through this one instead. Kept beside — not
   * folded into — `fontFamily`, because a mixed run needs both at once and the split into
   * slot-homogeneous pieces happens downstream (`piecesOfParagraph`).
   */
  readonly fontFamilyEastAsia: string | null;
  /**
   * True when a `w:rFonts` in the cascade (run, style, or authored `w:rPrDefault`) names the
   * East Asian face, not only a format, application, or theme default.
   * @internal
   */
  readonly eastAsianFontAuthored?: true;
  /**
   * Present only on a `w:rtl` or `w:cs` run: the LATIN lane that the complex-script values
   * replaced in `fontFamily`, `fontSizePt`, `bold` and `italic`. Nothing draws with it; it
   * lets a copy of the formatting (the format painter) write each lane back separately.
   */
  readonly latinLane?: {
    readonly fontFamily: string | null;
    readonly fontFamilyEastAsia: string | null;
    readonly fontSizePt: number;
    readonly bold: boolean;
    readonly italic: boolean;
  };
  /**
   * The complex-script lane as the cascade states it, on every resolved run: the values a
   * `w:rtl` or `w:cs` run draws with, and what a copy of the formatting writes to `w:bCs`,
   * `w:iCs`, `w:szCs` and `w:rFonts/@w:cs`. `fontFamily` is null when no level names a face.
   */
  readonly complexLane?: {
    readonly fontFamily: string | null;
    readonly fontSizePt: number;
    readonly bold: boolean;
    readonly italic: boolean;
  };
  /** Script and paragraph-resolved direction for shaping and visual placement. */
  readonly shaping?: {
    readonly script: string;
    readonly direction: 'ltr' | 'rtl';
    readonly level: number;
    readonly baseLevel: number;
    /** Resolved w:rtl context; absent when authored Unicode controls govern the paragraph. */
    readonly runDirection?: 'ltr' | 'rtl';
    /** A `w:bdo` override: every character reads in this direction, whatever its class. */
    readonly override?: 'ltr' | 'rtl';
    readonly wordSpacingPt?: number;
    /** The run-direction group comes from a `w:dir` or `w:bdo` wrapper, not the run. */
    readonly wrapperGroup?: true;
    /** Neighbouring text a joining script reads across a formatting-run boundary. */
    readonly context?: import('./shaped-run.ts').ShapingContext;
  };
  /** Points. `w:sz` is half-points, so 22 becomes 11. */
  readonly fontSizePt: number;
  /** RRGGBB, or null for the inherited/automatic colour. */
  readonly color: string | null;
  readonly bold: boolean;
  /** Opaque solid `w14:textOutline`, in points; paint only, never a font-weight change. */
  readonly textOutline?: { readonly widthPt: number; readonly color: string };
  /** Character border; adjacent runs with matching edges share one outline. */
  readonly border?: ParagraphBorderEdge;
  readonly italic: boolean;
  readonly underline: ResolvedUnderline | null;
  readonly strike: boolean;
  readonly doubleStrike: boolean;
  /** An `ST_HighlightColor` name, or null. */
  readonly highlight: string | null;
  /**
   * Character shading fill (`w:rPr/w:shd`), validated RRGGBB, or null.
   *
   * Paint applies this as the glyph-box background; a recognised highlight overrides it.
   * Measurement ignores shading.
   */
  readonly shading: string | null;
  readonly verticalAlign: VerticalAlign;
  /** `w:position`, in points. Positive raises the baseline. */
  readonly baselineShiftPt: number;
  readonly caps: boolean;
  readonly smallCaps: boolean;
  /** `w:spacing`, in points. Added to every advance. */
  readonly characterSpacingPt: number;
  /** `w:w`, as a percentage. 100 is unscaled. */
  readonly horizontalScalePercent: number;
  /** `w:kern`, in points: the size at or above which kerning applies. */
  readonly kerningMinPt: number;
  /** Explicit kerning selection; a zero threshold disables it. Absent uses a positive threshold. */
  readonly kerningEnabled?: boolean;
  /** Resolved optional OpenType substitutions; required script ligatures are independent. */
  readonly ligatures?: {
    readonly standard: boolean;
    readonly contextual: boolean;
    readonly historical: boolean;
    readonly discretionary: boolean;
  };
  /**
   * `w:vanish` (ECMA-376 §17.3.2.45): the run is hidden text.
   *
   * Word does not draw it AND does not paginate it — hidden index or comment text takes no
   * space at all. So this cannot be a paint-time opacity: a hidden run that is still measured
   * pushes every following line, and every following page break, to the wrong place. Layout
   * drops the content instead (see `piecesOfParagraph`).
   *
   * `w:specVanish` (§17.3.2.36) is a different property — an always-hidden paragraph mark on
   * a heading — and never sets this.
   */
  readonly hidden: boolean;
}

/** The style a run inherits when it authors nothing. */
export const DEFAULT_RUN_STYLE: ResolvedRunStyle = Object.freeze({
  fontFamily: null,
  fontFamilyEastAsia: null,
  // OOXML leaves the terminal fallback application-defined when no level in the style
  // hierarchy authors `w:sz`. Microsoft Word uses 10pt; 11pt comes from modern Normal
  // templates explicitly authoring `w:sz="22"`, not from the absence of a size.
  fontSizePt: 10,
  color: null,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  doubleStrike: false,
  highlight: null,
  shading: null,
  verticalAlign: 'baseline',
  baselineShiftPt: 0,
  caps: false,
  smallCaps: false,
  characterSpacingPt: 0,
  horizontalScalePercent: 100,
  kerningMinPt: 0,
  hidden: false,
});

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

function integer(raw: string | undefined, allowNegative = false): number | null {
  if (raw === undefined) return null;
  if (!(allowNegative ? /^-?\d{1,7}$/ : /^\d{1,7}$/).test(raw)) return null;
  return Number(raw);
}

function hexColor(raw: string | undefined): string | null {
  if (raw === undefined || raw === 'auto') return null;
  return HEX_COLOR.test(raw) ? raw.toUpperCase() : null;
}

/**
 * The theme part's typefaces, for resolving `w:rFonts` theme attributes.
 *
 * Structurally identical to the binding lane's `DocumentThemeFonts` and assignable from it.
 * Declared here so this lane reads validated strings rather than the theme tree.
 */
export interface ThemeFonts {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
  /** `a:majorFont` east asian typeface (`a:ea`) — headings. Optional for back-compat. */
  readonly majorEastAsia?: string | null;
  /** `a:minorFont` east asian typeface (`a:ea`) — body text. Optional for back-compat. */
  readonly minorEastAsia?: string | null;
  /** Complex-script heading and body theme faces. */
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

/** A document with no theme part: every theme reference falls back to its explicit name. */
export const NO_THEME_FONTS: ThemeFonts = {
  major: null,
  minor: null,
  majorEastAsia: null,
  minorEastAsia: null,
};

/**
 * Complex-script values when no level authors them. Word sizes an unsized complex-script
 * run at 10pt whatever `w:sz` says, and draws it in Times New Roman when no level names a
 * `w:cs` face or `w:cstheme` resolves to one.
 */
interface ComplexScriptLane {
  fontFamily: string;
  /** A level named the face, rather than the Times New Roman default standing in. */
  fontFamilyAuthored: boolean;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  /** `w:rtl` is on. */
  rtl: boolean;
  /** `w:cs` is on. */
  forced: boolean;
}

const COMPLEX_SCRIPT_DEFAULTS: Readonly<ComplexScriptLane> = Object.freeze({
  fontFamily: 'Times New Roman',
  fontFamilyAuthored: false,
  fontSizePt: 10,
  bold: false,
  italic: false,
  rtl: false,
  forced: false,
});

/**
 * Resolve one run's direct formatting.
 *
 * Unrecognised values are DROPPED rather than guessed: a `w:sz` of `"large"` leaves the
 * default size rather than inventing one, because a wrong measurement moves every glyph
 * after it and a missing one is visible immediately.
 *
 * `themeFonts` resolves `w:rFonts` theme references. Absent, a theme-only `rFonts` leaves
 * the family inherited — which is what every run of a theme-fonted document does, so the
 * whole document falls back to the surface default face.
 */
export function resolveRunStyle(
  props: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts
): ResolvedRunStyle {
  const style: {
    -readonly [K in keyof ResolvedRunStyle]: ResolvedRunStyle[K];
  } = { ...DEFAULT_RUN_STYLE };

  // Theme references resolve through the document's theme language only; the run's own
  // language never selects a theme face.
  let hasLatinFontReference = false;
  // The complex-script lane, resolved beside the Latin one and chosen at the end.
  const complex: ComplexScriptLane = { ...COMPLEX_SCRIPT_DEFAULTS };
  for (const property of props) {
    switch (property.localName) {
      case RUN_FONT_DEFAULTS: {
        // The document's slot defaults, beneath every authored level. Only the ascii and East
        // Asian slots are read here; `applyHAnsiFontSlots` reads the hAnsi one.
        const attributes = property.attributes;
        const family =
          (themeFonts ? themeFontFamilyOf(attributes?.eastAsiaTheme, themeFonts) : null) ??
          paintedFontFamilyName(attributes?.eastAsia);
        if (family) style.fontFamilyEastAsia = family;
        const ascii = paintedFontFamilyName(attributes?.ascii);
        if (ascii) style.fontFamily = ascii;
        break;
      }
      case 'rFonts': {
        // `w:ascii` is the Latin face; `w:hAnsi` is the fallback this lane uses when it is
        // the only one authored. A theme attribute OVERRIDES the explicit one beside it
        // (§17.3.2.26): Word writes both, the concrete name only so legacy readers have
        // something to use, and following it would ignore a retheme the author can see.
        // An unresolvable theme slot falls back to that explicit name rather than to
        // nothing, because a stale face still beats no face at all.
        const attributes = property.attributes;
        hasLatinFontReference ||= ['ascii', 'hAnsi', 'asciiTheme', 'hAnsiTheme'].some((name) =>
          Boolean(attributes?.[name])
        );
        // Each theme attribute overrides only its own slot: an explicit `w:ascii` keeps the
        // ascii face beside an `w:hAnsiTheme`, which `applyHAnsiFontSlots` applies.
        const theme = (token: string | undefined) =>
          themeFonts ? themeFontFamilyOf(token, themeFonts) : null;
        const family =
          theme(attributes?.asciiTheme) ??
          paintedFontFamilyName(attributes?.ascii) ??
          theme(attributes?.hAnsiTheme) ??
          paintedFontFamilyName(attributes?.hAnsi);
        if (family) style.fontFamily = family;
        // A theme reference with no theme face to resolve to still replaces the format
        // default beneath it, so the run takes the surface default face. (The reference
        // application uses its built-in theme here, Aptos; probe n01.)
        else if (attributes?.asciiTheme !== undefined || attributes?.hAnsiTheme !== undefined)
          style.fontFamily = null;
        // The eastAsia slot resolves independently, on the same theme-over-explicit rule.
        // An rFonts that authors only Latin faces leaves an inherited eastAsia face alone,
        // which is how the docDefaults' `w:eastAsiaTheme` survives a style chain that only
        // ever re-states `w:ascii`.
        const themedEastAsia = themeFonts
          ? themeFontFamilyOf(attributes?.eastAsiaTheme, themeFonts)
          : null;
        const familyEastAsia = themedEastAsia ?? paintedFontFamilyName(attributes?.eastAsia);
        if (familyEastAsia) {
          style.fontFamilyEastAsia = familyEastAsia;
          style.eastAsianFontAuthored = true;
        }
        const themedComplex = themeFonts
          ? themeFontFamilyOf(attributes?.cstheme, themeFonts)
          : null;
        // `||`: an Office theme's `a:cs` is usually empty, which names no face.
        const familyComplex = themedComplex || paintedFontFamilyName(attributes?.cs);
        if (familyComplex) {
          complex.fontFamily = familyComplex;
          complex.fontFamilyAuthored = true;
        }
        break;
      }
      case 'sz': {
        const halfPoints = integer(property.attributes?.val);
        if (halfPoints !== null && halfPoints > 0) style.fontSizePt = halfPoints / 2;
        break;
      }
      case 'szCs': {
        const halfPoints = integer(property.attributes?.val);
        if (halfPoints !== null && halfPoints > 0) complex.fontSizePt = halfPoints / 2;
        break;
      }
      case 'bCs':
        complex.bold = toggle(property);
        break;
      case 'iCs':
        complex.italic = toggle(property);
        break;
      case 'rtl':
        complex.rtl = toggle(property);
        break;
      case 'cs':
        complex.forced = toggle(property);
        break;
      case 'color': {
        style.color = hexColor(property.attributes?.val);
        break;
      }
      case 'b':
        style.bold = toggle(property);
        break;
      case 'textOutline':
        style.textOutline = resolveTextOutline(property);
        break;
      case 'bdr':
        style.border = borderEdgeFromAttributes(property.attributes);
        break;
      case 'i':
        style.italic = toggle(property);
        break;
      case 'u': {
        // Without `w:val` the element sets no underline of its own: it keeps an inherited one.
        const variant = property.attributes?.val ?? style.underline?.variant ?? 'none';
        style.underline =
          variant === 'none' || !toggle(property)
            ? null
            : { variant, color: hexColor(property.attributes?.color) };
        break;
      }
      case 'strike':
        style.strike = toggle(property);
        break;
      case 'dstrike':
        style.doubleStrike = toggle(property);
        break;
      case 'highlight': {
        const value = property.attributes?.val;
        style.highlight = value && value !== 'none' ? value : null;
        break;
      }
      case 'shd': {
        // Strict hex fill, with a pattern mixed into one colour. Paint lets highlight
        // override this colour when both are present.
        style.shading = resolveOoxmlShadingFill(property.attributes) ?? null;
        break;
      }
      case 'vertAlign': {
        const value = property.attributes?.val;
        if (value === 'superscript' || value === 'subscript') style.verticalAlign = value;
        else if (value === 'baseline') style.verticalAlign = 'baseline';
        break;
      }
      case 'position': {
        // Half-points, signed: positive raises.
        const halfPoints = integer(property.attributes?.val, true);
        if (halfPoints !== null) style.baselineShiftPt = halfPoints / 2;
        break;
      }
      case 'caps':
        style.caps = toggle(property);
        break;
      case 'smallCaps':
        style.smallCaps = toggle(property);
        break;
      case 'spacing': {
        // Twips, signed. Inside `w:rPr` this is CHARACTER spacing; the identically named
        // child of `w:pPr` is paragraph spacing, which is why the two are resolved by
        // different functions rather than one shared reader.
        const twips = readTwipsMeasure(property.attributes?.val);
        // Seven digits, as every other run measurement here: a larger value is not spacing.
        if (twips !== null && Math.abs(twips) <= 9_999_999) {
          style.characterSpacingPt = twips / 20;
        }
        break;
      }
      case 'w': {
        const percent = integer(property.attributes?.val);
        if (percent !== null && percent > 0) style.horizontalScalePercent = percent;
        break;
      }
      case 'kern': {
        const halfPoints = integer(property.attributes?.val);
        if (halfPoints !== null && halfPoints >= 0) {
          style.kerningMinPt = halfPoints / 2;
          style.kerningEnabled = halfPoints > 0;
        }
        break;
      }
      case 'ligatures': {
        const value = resolveRunLigatures(property.attributes?.val);
        if (value) style.ligatures = value;
        break;
      }
      case 'vanish':
        // A toggle like `w:b`, so a later `w:val="0"` from direct formatting un-hides text a
        // character style hid. `w:specVanish` is deliberately not folded in here.
        style.hidden = toggle(property);
        break;
      default:
        break;
    }
  }
  // An omitted Latin slot inherits the body theme after all authored defaults/styles.
  // Preserve the existing fallback for an authored but unresolved theme reference.
  if (!hasLatinFontReference) style.fontFamily ??= themeFonts?.minor ?? null;
  // A cascade that never names this slot, not even through the document defaults, takes
  // the document body East Asian face.
  style.fontFamilyEastAsia ??= themeFonts?.minorEastAsia ?? null;
  style.complexLane = {
    fontFamily: complex.fontFamilyAuthored ? complex.fontFamily : null,
    fontSizePt: complex.fontSizePt,
    bold: complex.bold,
    italic: complex.italic,
  };
  if (complex.rtl || complex.forced) {
    // Word formats a `w:rtl` or `w:cs` run ENTIRELY from its complex-script properties,
    // Latin letters and digits included, and ignores `w:sz`, `w:b`, `w:i` and the Latin
    // face there. A run with neither uses the Latin properties even for Arabic or Hebrew
    // characters. Verified against Word 16 PDF output (`w:rtl w:val="0"` turns it off).
    style.latinLane = {
      fontFamily: style.fontFamily,
      fontFamilyEastAsia: style.fontFamilyEastAsia,
      fontSizePt: style.fontSizePt,
      bold: style.bold,
      italic: style.italic,
    };
    style.fontFamily = complex.fontFamily;
    // The eastAsia split must not reclaim CJK characters from a complex-script run.
    style.fontFamilyEastAsia = complex.fontFamily;
    style.fontSizePt = complex.fontSizePt;
    style.bold = complex.bold;
    style.italic = complex.italic;
  }
  return style;
}

const derivedFamilyStyles = new WeakMap<ResolvedRunStyle, Map<string, ResolvedRunStyle>>();

/**
 * `style` with `family` as its effective `fontFamily`, memoized per (style, family).
 *
 * The one sanctioned way to derive a style that differs only in face: measurers amortize
 * font resolution and width caches over STYLE OBJECT IDENTITY, so a fresh derived object
 * per call would re-resolve the face on every measurement probe. Serves the font-slot
 * resolution at the measurer boundary ({@link styleForFontSlot} in `script-itemization.ts`)
 * and the equation face in `equation-layout.ts` — one memo, not one per caller.
 */
export function withFontFamily(style: ResolvedRunStyle, family: string): ResolvedRunStyle {
  if (style.fontFamily === family) return style;
  let byFamily = derivedFamilyStyles.get(style);
  if (!byFamily) {
    byFamily = new Map();
    derivedFamilyStyles.set(style, byFamily);
  }
  let derived = byFamily.get(family);
  if (!derived) {
    derived = Object.freeze({ ...style, fontFamily: family });
    byFamily.set(family, derived);
  }
  return derived;
}

/** The text as it is DRAWN, after case transforms. Measurement must use this, not the source. */
export function displayText(text: string, style: ResolvedRunStyle): string {
  // A literal U+00AD in `w:t` draws as a visible hyphen and is not a break opportunity. An
  // optional hyphen element measures from its own empty `measureText` instead.
  const shown = text.includes('\u00ad') ? text.replaceAll('\u00ad', '-') : text;
  if (style.caps) return shown.toUpperCase();
  // Small caps changes glyph selection rather than the characters, so uppercasing here would
  // corrupt the text a copy produces. Resolving it belongs to the shaper, which requests the
  // `smcp` feature when the face carries small-cap glyphs and hands the run to the CSS
  // measurer when it does not (`shaped-measurer.ts`). That decision is per FACE, so a span
  // and every prefix of it measure from one source and the caret edges inside a run agree
  // with the painted span.
  return shown;
}

/** Measure run text the way layout breaks lines and paints glyphs (caps/small-caps aware). */
export function measureDisplayText(
  text: string,
  style: ResolvedRunStyle,
  measurer: import('./semantic-records.ts').TextMeasurer
): number {
  return measurer.measure(displayText(text, style), style);
}

/** Whether two resolved styles are identical, for span merging and cache keys. */
export function runStylesEqual(a: ResolvedRunStyle, b: ResolvedRunStyle): boolean {
  return (
    revisionMarkupSourcesEqual(a, b) &&
    layoutDerivedSpacingSourcesEqual(a, b) &&
    a.shaping?.script === b.shaping?.script &&
    a.shaping?.direction === b.shaping?.direction &&
    a.shaping?.level === b.shaping?.level &&
    a.shaping?.baseLevel === b.shaping?.baseLevel &&
    a.shaping?.runDirection === b.shaping?.runDirection &&
    a.shaping?.override === b.shaping?.override &&
    a.shaping?.wordSpacingPt === b.shaping?.wordSpacingPt &&
    a.shaping?.context?.before === b.shaping?.context?.before &&
    a.shaping?.context?.after === b.shaping?.context?.after &&
    a.fontFamily === b.fontFamily &&
    a.fontFamilyEastAsia === b.fontFamilyEastAsia &&
    a.eastAsianFontAuthored === b.eastAsianFontAuthored &&
    a.latinLane?.fontFamily === b.latinLane?.fontFamily &&
    a.latinLane?.fontFamilyEastAsia === b.latinLane?.fontFamilyEastAsia &&
    a.latinLane?.fontSizePt === b.latinLane?.fontSizePt &&
    a.latinLane?.bold === b.latinLane?.bold &&
    a.latinLane?.italic === b.latinLane?.italic &&
    a.complexLane?.fontFamily === b.complexLane?.fontFamily &&
    a.complexLane?.fontSizePt === b.complexLane?.fontSizePt &&
    a.complexLane?.bold === b.complexLane?.bold &&
    a.complexLane?.italic === b.complexLane?.italic &&
    a.fontSizePt === b.fontSizePt &&
    a.color === b.color &&
    a.textOutline?.widthPt === b.textOutline?.widthPt &&
    a.textOutline?.color === b.textOutline?.color &&
    a.border?.val === b.border?.val &&
    a.border?.color === b.border?.color &&
    a.border?.widthPt === b.border?.widthPt &&
    a.border?.spacePt === b.border?.spacePt &&
    a.border?.shadow === b.border?.shadow &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.doubleStrike === b.doubleStrike &&
    a.highlight === b.highlight &&
    a.shading === b.shading &&
    a.verticalAlign === b.verticalAlign &&
    a.baselineShiftPt === b.baselineShiftPt &&
    a.caps === b.caps &&
    a.smallCaps === b.smallCaps &&
    a.characterSpacingPt === b.characterSpacingPt &&
    a.horizontalScalePercent === b.horizontalScalePercent &&
    a.kerningMinPt === b.kerningMinPt &&
    a.kerningEnabled === b.kerningEnabled &&
    a.ligatures?.standard === b.ligatures?.standard &&
    a.ligatures?.contextual === b.ligatures?.contextual &&
    a.ligatures?.historical === b.ligatures?.historical &&
    a.ligatures?.discretionary === b.ligatures?.discretionary &&
    a.hidden === b.hidden &&
    a.underline?.variant === b.underline?.variant &&
    a.underline?.color === b.underline?.color
  );
}

/**
 * How far a run's glyphs are lifted off the line's baseline, in points. Positive is up.
 *
 * Super and subscript move the GLYPHS without moving the run's box, so the box keeps tiling
 * the line and the selection band stays continuous. Anything drawing at the glyphs — the
 * painter, and the caret — has to apply this itself, and from one place, or the two drift.
 */
export function baselineShiftPtOf(style: ResolvedRunStyle): number {
  if (style.verticalAlign === 'superscript') return style.baselineShiftPt + style.fontSizePt * 0.33;
  if (style.verticalAlign === 'subscript') return style.baselineShiftPt - style.fontSizePt * 0.16;
  return style.baselineShiftPt;
}

/**
 * Shared glyph-size factor for baseline, superscript, and subscript text.
 *
 * The 65% script scale follows the common Word font metrics (Arial, Calibri, Times New
 * Roman) and improves the saved Word reference at 10pt and 11pt. It is a uniform policy;
 * per-face script metrics and Word's output-device rounding are not modeled here.
 * Layout, surface paint, and exporters must apply the same factor to avoid caret drift.
 * @public
 */
export function glyphSizeFactorOf(style: ResolvedRunStyle): number {
  return style.verticalAlign === 'baseline' ? 1 : 0.65;
}
