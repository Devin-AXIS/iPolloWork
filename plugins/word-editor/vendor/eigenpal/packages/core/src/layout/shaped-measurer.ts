import { withAuthoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { authoredLineBox } from './authored-line-boxes.ts';
import { createResolvedCjkAutoSpacingGapMetric } from './sfnt-auto-spacing-metrics.ts';
import { isRunKerningEnabled } from './run-kerning.ts';
import { runLigatureFeatureKey } from './run-ligatures.ts';
import { fontMapsCodePoint } from './sfnt-cmap-coverage.ts';
import { createShapedLineMetrics } from './shaped-line-metrics.ts';
import { withSymbolFaceMetrics } from './symbol-face-metrics.ts';
import {
  countAsciiSpaces,
  fallbackCaretAdvances,
  shapedCaretAdvances,
} from './shaped-caret-advances.ts';
// Exact line metrics and advances, from the font itself (task 7.7).
//
// Every host-side measurement is a fraction out, and the fraction is not cosmetic. Word
// derives single line spacing from the face's ascent, descent AND `hhea.lineGap` — the same
// total GDI reports as `tmHeight + tmExternalLeading`. Dropping the gap makes every line of a
// face that has one a fraction too short, and that fraction accumulates until text paginates
// later than Word.
//
// The font bytes carry the exact numbers, and the shaper already reads them. This adapts
// that shaper to the semantic layout lane's `TextMeasurer` port, so the lane stays DOM-free
// and becomes exact at the same time: advances are summed glyph advances, not estimated
// character widths, and line height is Word's own formula over the real table values.
//
// Order of operations follows Word, and matches the fixed measurer so the two are
// substitutable: shaped advance, then horizontal scaling, then character spacing as an
// absolute per-character addition the scaling does not multiply.

import type { FontResourceSnapshot, ResolvedFont } from './font-resource.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { shapedRunOutline } from './text-outline.ts';
import { shapedClusterInkBounds } from './glyph-ink-bounds.ts';
import { segmentGraphemes } from './grapheme.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import { sfntStrikeoutStrokeEm, type StrikeoutStrokeEm } from './sfnt-strikeout-metrics.ts';
import type { OperationSnapshot } from './resolved-cache.ts';
import {
  SYNTHETIC_BOLD_ADVANCE_EM,
  isSyntheticBold,
  syntheticBoldAdvancePt,
  syntheticBoldGraphemeStarts,
  syntheticBoldGlyphCount,
  syntheticBoldGlyphStarts,
  withSyntheticBoldCaretAdvances,
} from './synthetic-bold.ts';
import {
  layoutFaceHasSmallCaps,
  layoutRunHalfPointsOf,
  shapeLayoutStyleRun,
  type LayoutShapingEnvironment,
} from './layout-run-shape.ts';
import {
  preservesShapingFace,
  type FixedPointRoundingMode,
  type NormalizationPolicy,
  type TextShaper,
  type VersionedShapingLibrary,
} from './shaped-run.ts';

export type { LayoutShapingEnvironment } from './layout-run-shape.ts';

/**
 * A fully resolved shaping bundle: fonts, shaper, and the environment they were admitted
 * under. Produced by the editor lane's font configuration (`createLayoutShaping`) and
 * consumed to build shaped measurers. Lived in the legacy `metrics.ts` until the legacy
 * layout lane was deleted; the type is the surviving contract between the two lanes.
 */
export interface LayoutShapingOptions {
  readonly fonts: FontResourceSnapshot;
  readonly shaper: TextShaper;
  readonly defaultFont: {
    readonly family: string;
    readonly sizeHalfPoints: number;
  };
  readonly environment: LayoutShapingEnvironment;
  readonly ligatureCaretPolicy: 'cluster-edges-only';
  readonly operation: OperationSnapshot;
}

/**
 * How the shaped measurer resolves fonts and bounds its work.
 *
 * Font resolution is the HOST's: returning null means "not available" and measurement falls back
 * rather than throwing, because a document naming a font nobody has must still lay out.
 */
export interface ShapedMeasurerOptions {
  readonly shaper: TextShaper;
  /**
   * The font a run should be measured with.
   *
   * Returning null means "not available", and measurement falls back rather than throwing:
   * a document naming a font nobody has must still lay out. Resolution is the host's,
   * because which bytes stand in for `Calibri` is a packaging decision, not a layout one.
   */
  readonly resolveFont: (style: ResolvedRunStyle) => ResolvedFont | null;
  /** Used when no font resolves. */
  readonly fallback: TextMeasurer;
  readonly shapingLibrary: VersionedShapingLibrary;
  readonly unicodeDataVersion: string;
  /** Fixed-point units per point in the shaper's output. */
  readonly fixedPointScale?: number;
  /** ISO 15924 script and BCP 47 language for shaping. Latin/English by default. */
  readonly script?: string;
  readonly language?: string;
  /** Optional low-level shaping controls; omitted values preserve the released defaults. */
  readonly normalization?: NormalizationPolicy;
  readonly features?: Readonly<Record<string, number>>;
  readonly roundingMode?: FixedPointRoundingMode;
}

/** Environment-bound production options that cannot drift from layout cache identity. @public */
export interface LayoutEnvironmentShapedMeasurerOptions {
  /** Shaper from the same admitted layout operation. */
  readonly shaper: TextShaper;
  /** Resolve a run to an admitted face, or null to use the bounded fallback. */
  readonly resolveFont: (style: ResolvedRunStyle) => ResolvedFont | null;
  /** Bounded measurement fallback when no admitted face resolves. */
  readonly fallback: TextMeasurer;
  /** Fingerprinted shaping environment; all geometry-affecting controls come from here. */
  readonly environment: LayoutShapingOptions['environment'];
}

/**
 * Ceiling on `hhea.lineGap`, as a multiple of the face's own ascent + descent.
 *
 * The gap is file-derived, signed, and unbounded in the format, so an embedded font is a
 * lever on every line box in the document. Measured over all twenty faces this engine ships,
 * the largest real gap is Liberation Serif's 87/2268 = 0.038 face boxes; Liberation Sans is
 * 0.029 and Carlito, Caladea and Liberation Mono declare none at all. Even a font with
 * unusually generous leading is a few percent, not a multiple.
 *
 * 0.5 therefore clears the largest face this engine ships by 13x — no real document can
 * reach it — while capping the worst case an attacker can produce at 1.5x the face box. A
 * full face box would have allowed 2x, which is a usable layout blow-up from a file.
 */
const MAX_LINE_GAP_FACE_BOXES = 0.5;

/** Bound on cached coverage answers per face; a file controls which characters are asked. */
const MAX_COVERAGE_ENTRIES_PER_FONT = 4096;

/**
 * Ceiling on a face's own ascent + descent, as a multiple of the size it is drawn at.
 *
 * Measured over the twenty faces this engine ships plus the test corpus, the largest face
 * box is Carlito's 1.2207 em; Caladea is 1.15, Liberation Mono 1.1328, Liberation Sans
 * 1.1172, Liberation Serif 1.1074. Faces built for scripts with tall ascenders reach about
 * 2 em, so 4 clears every real face by a wide margin — it exists only so a font declaring a
 * huge `hhea.ascender` over a tiny `head.unitsPerEm` cannot make one run a page. With the
 * gap ceiling above it, the worst line box a file can ask for is 6 em.
 */
const MAX_FACE_BOX_EM = 4;

// One measurer belongs to one editor/export session, but a large document can still ask it to
// measure hundreds of thousands of distinct line-break prefixes. Keeping every prefix made the
// measurement cache larger than the published layout it accelerated. A fixed-size clock keeps
// the hot working set while giving every session a hard retention bound.
const MAX_CACHED_SHAPED_WIDTHS = 4_096;

/**
 * A {@link TextMeasurer} that measures through the shaper rather than through a canvas.
 *
 * The accurate path: advances come from the same shaping run that will position the glyphs, so
 * measurement and paint cannot disagree. Falls back per-run when a font is unavailable rather than
 * throwing, because a document naming a font nobody has must still lay out.
 */
export function createShapedMeasurer(options: ShapedMeasurerOptions): TextMeasurer;
export function createShapedMeasurer(options: LayoutEnvironmentShapedMeasurerOptions): TextMeasurer;
export function createShapedMeasurer(
  options: ShapedMeasurerOptions | LayoutEnvironmentShapedMeasurerOptions
): TextMeasurer {
  const environment = 'environment' in options ? options.environment : undefined;
  const explicit = 'environment' in options ? undefined : options;
  const { shaper, resolveFont } = options;
  // An unavailable symbol-encoded face keeps its own line box and advances.
  const fallback = withSymbolFaceMetrics(options.fallback);
  const baseEnvironment: LayoutShapingEnvironment =
    environment ??
    ({
      shapingLibrary: explicit!.shapingLibrary,
      unicodeDataVersion: explicit!.unicodeDataVersion,
      script: explicit?.script ?? 'Latn',
      fixedPointScale: explicit?.fixedPointScale ?? 1000,
      normalization: explicit?.normalization ?? 'none',
      features: explicit?.features ?? {},
      roundingMode: explicit?.roundingMode ?? 'halfToEven',
      language: explicit?.language ?? 'en',
      variationAxes: {},
    } satisfies LayoutShapingEnvironment);

  // Nested by font object and half-point size rather than by one concatenated string key:
  // `measure` runs once per word-boundary probe of every line break in the document, and
  // building (then hashing) a `identity|size|text` string per call made the KEYS a
  // measurable slice of a large document's cold open. The font level is a WeakMap so a
  // font-epoch swap releases its subtree.
  // Two roots, not one keyed string: the same text and face have different advances with
  // `smcp`, so a plain run must not reuse a small-cap run's shaped width or the reverse.
  const widthsByFont = new WeakMap<ResolvedFont, Map<number, Map<string, number>>>();
  const smallCapsWidthsByFont = new WeakMap<ResolvedFont, Map<number, Map<string, number>>>();
  // Sampled once: a shaper's runs keep their environment's face for its whole life.
  const facePreserving = preservesShapingFace(shaper);
  const faceLineMetrics = createShapedLineMetrics(
    shaper,
    baseEnvironment,
    fallback,
    MAX_FACE_BOX_EM,
    MAX_LINE_GAP_FACE_BOXES
  );
  // Style objects live inside cached broken lines, so one resolution per style OBJECT
  // amortizes the family/weight lookup across every probe of the runs that share it.
  const fontsByStyle = new WeakMap<ResolvedRunStyle, ResolvedFont | null>();
  const smallCapsSupportByFont = new WeakMap<ResolvedFont, boolean>();
  const widthClock = new Array<
    | {
        readonly cache: Map<string, number>;
        readonly text: string;
      }
    | undefined
  >(MAX_CACHED_SHAPED_WIDTHS);
  let widthClockCursor = 0;

  const cacheWidth = (cache: Map<string, number>, text: string, advance: number): void => {
    const evicted = widthClock[widthClockCursor];
    if (evicted) evicted.cache.delete(evicted.text);
    cache.set(text, advance);
    widthClock[widthClockCursor] = { cache, text };
    widthClockCursor = (widthClockCursor + 1) % MAX_CACHED_SHAPED_WIDTHS;
  };

  const resolveFontCached = (style: ResolvedRunStyle): ResolvedFont | null => {
    // A stored `null` ("no font resolves") comes back as null, not undefined, so the
    // negative answer is cached too.
    const cached = fontsByStyle.get(style);
    if (cached !== undefined) return cached;
    const font = resolveFont(style);
    fontsByStyle.set(style, font);
    return font;
  };

  const automaticTextSpacingGap = createResolvedCjkAutoSpacingGapMetric(resolveFontCached);

  const widthsFor = (
    font: ResolvedFont,
    halfPoints: number,
    smallCaps: boolean
  ): Map<string, number> => {
    const root = smallCaps ? smallCapsWidthsByFont : widthsByFont;
    let bySize = root.get(font);
    if (!bySize) {
      bySize = new Map();
      root.set(font, bySize);
    }
    let byText = bySize.get(halfPoints);
    if (!byText) {
      byText = new Map();
      bySize.set(halfPoints, byText);
    }
    return byText;
  };

  const fallbackStyles = new WeakMap<ResolvedRunStyle, ResolvedRunStyle>();
  const withoutWordSpacing = (style: ResolvedRunStyle): ResolvedRunStyle => {
    if (!style.shaping?.wordSpacingPt) return style;
    let natural = fallbackStyles.get(style);
    if (!natural) {
      natural = { ...style, shaping: { ...style.shaping, wordSpacingPt: undefined } };
      fallbackStyles.set(style, natural);
    }
    return natural;
  };
  const wordSpacingAdvance = (text: string, style: ResolvedRunStyle): number =>
    style.shaping?.wordSpacingPt ? countAsciiSpaces(text) * style.shaping.wordSpacingPt : 0;
  const fallbackWidth = (text: string, style: ResolvedRunStyle): number =>
    fallback.measure(text, withoutWordSpacing(style)) + wordSpacingAdvance(text, style);

  const fallbackAdvances = (
    text: string,
    style: ResolvedRunStyle
  ): readonly number[] | undefined => {
    const naturalWidth = Math.max(0, fallback.measure(text, withoutWordSpacing(style)));
    const source =
      fallback.caretAdvances?.(text, withoutWordSpacing(style)) ??
      fallbackCaretAdvances(text, naturalWidth);
    if (!source || source.length !== text.length + 1)
      return fallbackCaretAdvances(text, fallbackWidth(text, style));
    const total = Math.max(0, fallbackWidth(text, style));
    let previous = 0;
    let spaces = 0;
    return source.map((advance, offset) => {
      if (offset === 0) return 0;
      if (text[offset - 1] === ' ') spaces++;
      const adjusted = advance + spaces * (style.shaping?.wordSpacingPt ?? 0);
      previous = Math.max(
        previous,
        Math.min(total, Number.isFinite(adjusted) ? adjusted : previous)
      );
      return offset === text.length ? total : previous;
    });
  };

  // Text the face cannot shape, for a missing glyph or a missing small-caps feature, keeps the
  // extra advance of a bold the face synthesizes, once for each grapheme, as paint spaces it
  // (`syntheticBoldGraphemeStarts`).
  const syntheticBoldExtraPt = (style: ResolvedRunStyle): number =>
    syntheticBoldAdvancePt(style) * (style.horizontalScalePercent / 100);
  const unshapedWidth = (text: string, style: ResolvedRunStyle, syntheticBold: boolean): number =>
    fallbackWidth(text, style) +
    (syntheticBold ? syntheticBoldGraphemeStarts(text).length * syntheticBoldExtraPt(style) : 0);
  const unshapedAdvances = (
    text: string,
    style: ResolvedRunStyle,
    syntheticBold: boolean
  ): readonly number[] | undefined => {
    const advances = fallbackAdvances(text, style);
    return advances && syntheticBold
      ? withSyntheticBoldCaretAdvances(
          advances,
          syntheticBoldGraphemeStarts(text),
          syntheticBoldExtraPt(style)
        )
      : advances;
  };

  // Static face numbers, so one read per face serves every size: the em fractions scale.
  const strikeoutByFont = new WeakMap<ResolvedFont, StrikeoutStrokeEm | null>();
  // Coverage answers per face and text; the callers ask about single hinted characters.
  const coverageByFont = new WeakMap<ResolvedFont, Map<string, boolean>>();

  const measurer: TextMeasurer = {
    hasResolvedFont(style) {
      return resolveFontCached(style) !== null;
    },
    syntheticBold(style) {
      const font = resolveFontCached(style);
      return font !== null && isSyntheticBold(style, font);
    },
    faceCovers(text, style) {
      const font = resolveFontCached(style);
      if (!font) return undefined;
      let byText = coverageByFont.get(font);
      if (!byText) {
        byText = new Map();
        coverageByFont.set(font, byText);
      }
      const known = byText.get(text);
      if (known !== undefined) return known;
      // The face's own cmap answers: shaping would report HarfBuzz's own substitutes (a
      // missing U+2011 shapes as U+2010) and the export glyph fallback as covered.
      let covered = true;
      for (const character of text) {
        const mapped = fontMapsCodePoint(font, character.codePointAt(0)!);
        if (mapped === undefined) return undefined;
        if (!mapped) {
          covered = false;
          break;
        }
      }
      if (byText.size < MAX_COVERAGE_ENTRIES_PER_FONT) byText.set(text, covered);
      return covered;
    },
    strikeoutMetrics(style) {
      const font = resolveFontCached(style);
      if (!font) return undefined;
      let stroke = strikeoutByFont.get(font);
      if (stroke === undefined) {
        stroke = sfntStrikeoutStrokeEm(font.bytes, font.faceIndex);
        strikeoutByFont.set(font, stroke);
      }
      if (!stroke) return undefined;
      const sizePt = (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style);
      return {
        offsetPt: stroke.offsetEm * sizePt,
        thicknessPt: stroke.thicknessEm * sizePt,
      };
    },
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = resolveFontCached(style);
      if (!font) return fallbackWidth(text, style);

      const byText = widthsFor(font, layoutRunHalfPointsOf(style), style.smallCaps);
      const context = style.shaping?.context;
      const shapingKey = style.shaping
        ? `1:${JSON.stringify(
            context
              ? [style.shaping.script, style.shaping.direction, text, context.before, context.after]
              : [style.shaping.script, style.shaping.direction, text]
          )}`
        : `0:${text}`;
      const syntheticBold = isSyntheticBold(style, font);
      const widthKey = `${isRunKerningEnabled(style) ? 1 : 0}:${syntheticBold ? 1 : 0}:${runLigatureFeatureKey(style)}:${shapingKey}`;
      let advance = byText.get(widthKey);
      if (advance === undefined) {
        let total = 0;
        try {
          // Per FACE, so this span and every prefix of it answer the same way.
          if (
            style.smallCaps &&
            !layoutFaceHasSmallCaps(shaper, baseEnvironment, font, style, smallCapsSupportByFont)
          ) {
            return unshapedWidth(text, style, syntheticBold);
          }
          const shaped = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
          // Missing-glyph advances do not describe the browser's fallback ink.
          if (shaped.glyphs.some((glyph) => glyph.id === 0))
            return unshapedWidth(text, style, syntheticBold);
          for (const glyph of shaped.glyphs) total += glyph.advanceX;
          // A face without bold widens each inked glyph when it draws the bold itself.
          if (syntheticBold)
            total +=
              syntheticBoldGlyphCount(shaped) *
              (layoutRunHalfPointsOf(style) / 2) *
              SYNTHETIC_BOLD_ADVANCE_EM *
              baseEnvironment.fixedPointScale;
        } catch {
          // Shaping refuses malformed or oversized input by design. Falling back keeps a
          // hostile font from taking the document down with it.
          return unshapedWidth(text, style, syntheticBold);
        }
        advance = total / baseEnvironment.fixedPointScale;
        cacheWidth(byText, widthKey, advance);
      }
      // Base-size advance scaled to the drawn size; the cache stays keyed on the base size,
      // so baseline and super/subscript runs of one face share entries.
      return (
        advance * glyphSizeFactorOf(style) * (style.horizontalScalePercent / 100) +
        text.length * style.characterSpacingPt +
        wordSpacingAdvance(text, style)
      );
    },

    inkBounds(text, style) {
      if (
        !text ||
        text.length > 2 ||
        style.shaping?.direction === 'rtl' ||
        segmentGraphemes(text).length !== 1
      )
        return undefined;
      const font = resolveFontCached(style);
      if (!font) return fallback.inkBounds?.(text, style);
      try {
        if (
          style.smallCaps &&
          !layoutFaceHasSmallCaps(shaper, baseEnvironment, font, style, smallCapsSupportByFont)
        )
          return fallback.inkBounds?.(text, style);
        const run = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
        return shapedClusterInkBounds(
          run,
          layoutRunHalfPointsOf(style) / 2,
          baseEnvironment.fixedPointScale,
          (glyphSizeFactorOf(style) * style.horizontalScalePercent) / 100
        );
      } catch {
        return undefined;
      }
    },
    textOutline(text, style) {
      const font = resolveFontCached(style);
      if (!font) return fallback.textOutline?.(text, style);
      try {
        const run = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
        return (
          shapedRunOutline(
            run,
            // Base size, like the run's positions; text art never sets a script size.
            layoutRunHalfPointsOf(style) / 2,
            baseEnvironment.fixedPointScale
          ) ?? fallback.textOutline?.(text, style)
        );
      } catch {
        return fallback.textOutline?.(text, style);
      }
    },
    caretAdvances(text, style) {
      const font = resolveFontCached(style);
      if (!font) return fallbackAdvances(text, style);
      const syntheticBold = isSyntheticBold(style, font);
      try {
        if (
          style.smallCaps &&
          !layoutFaceHasSmallCaps(shaper, baseEnvironment, font, style, smallCapsSupportByFont)
        )
          return unshapedAdvances(text, style, syntheticBold);
        const run = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
        if (run.glyphs.some((glyph) => glyph.id === 0))
          return unshapedAdvances(text, style, syntheticBold);
        const advances =
          shapedCaretAdvances(
            text,
            run,
            (glyphSizeFactorOf(style) * (style.horizontalScalePercent / 100)) /
              baseEnvironment.fixedPointScale,
            style.characterSpacingPt,
            style.shaping?.wordSpacingPt ?? 0
          ) ??
          fallbackCaretAdvances(
            text,
            (run.glyphs.reduce((sum, glyph) => sum + glyph.advanceX, 0) *
              glyphSizeFactorOf(style) *
              (style.horizontalScalePercent / 100)) /
              baseEnvironment.fixedPointScale +
              text.length * style.characterSpacingPt +
              wordSpacingAdvance(text, style)
          );
        if (!advances || !syntheticBold) return advances;
        return withSyntheticBoldCaretAdvances(
          advances,
          syntheticBoldGlyphStarts(run),
          syntheticBoldExtraPt(style)
        );
      } catch {
        return unshapedAdvances(text, style, syntheticBold);
      }
    },

    lineMetrics(style, text) {
      const font = resolveFontCached(style);
      // No face of its own: a recorded family keeps its authored box on the fallback face.
      if (!font) return authoredLineBox(style) ?? fallback.lineMetrics(style, text);
      if (!text || /^[\t\n\r\f ]*$/.test(text)) return faceLineMetrics(font, style);
      // A shaper that never substitutes a face shapes this text in `font` alone, so its band
      // is the answer; shaping each word again only to read the face back was a third of
      // line breaking. Composed as the span loop below composes one span, to the same bits.
      if (facePreserving) {
        const metrics = faceLineMetrics(font, style);
        const baseline = Math.max(0, metrics.baseline);
        const descent = Math.max(0, metrics.height - metrics.baseline);
        return baseline + descent > 0 ? { height: baseline + descent, baseline } : metrics;
      }
      try {
        // Width and paint can select a fallback face. The same face must set the
        // line's ascent/descent, otherwise tall fallback glyphs overlap later lines.
        const run = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
        let baseline = 0;
        let descent = 0;
        for (const span of run.fontSpans) {
          const metrics = faceLineMetrics(span.font, style);
          baseline = Math.max(baseline, metrics.baseline);
          descent = Math.max(descent, metrics.height - metrics.baseline);
        }
        if (baseline + descent > 0) return { height: baseline + descent, baseline };
      } catch {
        // Font/shaping failures retain the bounded primary-face fallback.
      }
      return faceLineMetrics(font, style);
    },
  };
  return withAuthoredCjkGapMetric(measurer, automaticTextSpacingGap!);
}

/**
 * Bind measurement directly to the environment whose operation identity keys layout caches.
 * Production browser/server hosts use this adapter so fingerprinted and executed shaping cannot
 * drift through independently forwarded fields.
 * @public
 */
export function createLayoutShapedMeasurer(
  shaping: LayoutShapingOptions,
  options: Pick<ShapedMeasurerOptions, 'resolveFont' | 'fallback'>
): TextMeasurer {
  return createShapedMeasurer({
    ...options,
    shaper: shaping.shaper,
    environment: shaping.environment,
  });
}
