import {
  assertValidatedResolvedFont,
  type FontRequest,
  type FontSubstitution,
  type ResolvedFont,
} from './font-resource.ts';

declare const FIXED_POINT: unique symbol;

/** Fixed-point coordinates are safe integers in units declared by ShapingEnvironment.fixedPointScale. */
export type FixedPoint = number & { readonly [FIXED_POINT]: true };

/**
 * Brand a safe integer as a {@link FixedPoint} coordinate.
 *
 * Fixed point rather than float throughout shaping so that two runs shaped identically compare
 * EQUAL — float accumulation would make the same text measure differently depending on how it was
 * split, and pagination is decided on those measurements.
 *
 * @throws RangeError when the value is not a safe integer.
 */
export const fixedPoint = (value: number): FixedPoint => {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Fixed-point value must be a safe integer');
  return value as FixedPoint;
};

/** Which way a run reads. The parity projection of its bidi embedding level. */
export type TextDirection = 'ltr' | 'rtl';

/** How fixed-point conversion breaks ties. Part of the shaping fingerprint. */
export type FixedPointRoundingMode = 'halfAwayFromZero' | 'halfToEven' | 'towardZero';

/** Which Unicode normalization is applied before shaping, if any. */
export type NormalizationPolicy = 'none' | 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

/**
 * The shaping library and its exact version.
 *
 * Versioned because a library upgrade can change glyph positioning, and a cached measurement
 * taken under the old one must not be reused under the new one.
 */
export interface VersionedShapingLibrary {
  readonly name: string;
  readonly version: string;
}

/**
 * Everything that determines how text shapes — the complete input to a
 * {@link ShapingEnvironment}.
 *
 * Exhaustive on purpose. Any field that could change a glyph's position belongs here, because the
 * environment's fingerprint is what decides whether a cached shaped run may be reused.
 */
export interface ShapingEnvironmentInput {
  readonly font: ResolvedFont;
  readonly variationAxes: Readonly<Record<string, number>>;
  readonly shapingLibrary: VersionedShapingLibrary;
  readonly unicodeDataVersion: string;
  readonly normalization: NormalizationPolicy;
  readonly script: string;
  readonly language: string;
  readonly direction: TextDirection;
  readonly features: Readonly<Record<string, number>>;
  readonly fallbackOrder: readonly ResolvedFont[];
  readonly fixedPointScale: number;
  readonly roundingMode: FixedPointRoundingMode;
}

/**
 * A validated {@link ShapingEnvironmentInput} — build one with `createShapingEnvironment`.
 *
 * Structurally identical to its input, but the nominal distinction is the point: holding one
 * means the tags, axes and fonts inside it have already been checked.
 */
export interface ShapingEnvironment extends ShapingEnvironmentInput {}

/** One shaping call: the text, its size, its bidi level, and the environment to shape it in. */
export interface ShapeInput {
  readonly text: string;
  readonly fontSizeHalfPoints: number;
  /** Exact UAX #9 embedding/isolate level; direction is its parity projection. */
  readonly bidiLevel: number;
  readonly environment: ShapingEnvironment;
  /**
   * Logical text around `text` that the shaper reads for contextual forms but never
   * shapes: HarfBuzz pre- and post-context. A word split across two formatting runs joins
   * across the split only when each half sees the other's letters. At most
   * {@link MAX_SHAPING_CONTEXT} UTF-16 units each; glyphs and clusters cover `text` alone.
   */
  readonly context?: ShapingContext;
}

/** Pre- and post-context for one shaping call. See {@link ShapeInput.context}. @public */
export interface ShapingContext {
  readonly before: string;
  readonly after: string;
}

/** Longest context on either side, in UTF-16 units. Joining needs only the nearest letters. @public */
export const MAX_SHAPING_CONTEXT = 16;

/**
 * One positioned glyph.
 *
 * `id` is a glyph index in its FACE, not a character — a ligature is one glyph spanning several
 * characters, and a single character may produce several glyphs. Use `cluster` to get back to
 * text.
 */
export interface ShapedGlyph {
  readonly id: number;
  /** Optional synthetic glyph-size factor; positions and advances already include it. */
  readonly drawScale?: number;
  /** UTF-16 text offset identifying the cluster that produced this glyph. */
  readonly cluster: number;
  /** Pen origin before this glyph's shaping offsets, in fixed-point run coordinates. */
  readonly originX: FixedPoint;
  readonly originY: FixedPoint;
  readonly advanceX: FixedPoint;
  readonly advanceY: FixedPoint;
  readonly offsetX: FixedPoint;
  readonly offsetY: FixedPoint;
  /** Exact monochrome outline returned by the admitted HarfBuzz face. */
  readonly outline: GlyphOutline;
}

/** A glyph's outline as SVG path data, in font design units. */
export interface GlyphOutline {
  readonly path: string;
  /** Design units per em — divide by this to scale the path to a point size. */
  readonly unitsPerEm: number;
}

/**
 * One cluster: the smallest indivisible text-to-glyph correspondence.
 *
 * The unit the CARET moves by. A cluster may be several characters (a ligature) or several glyphs
 * (a decomposed mark), so neither a character index nor a glyph index is a valid caret position —
 * `caretEdges` is, and it includes both endpoints.
 */
export interface ShapedCluster {
  /** Half-open logical UTF-16 range in ShapedRun.text. */
  readonly textStart: number;
  readonly textEnd: number;
  /** Half-open visual glyph range in ShapedRun.glyphs. */
  readonly glyphStart: number;
  readonly glyphEnd: number;
  readonly advance: FixedPoint;
  /** Fixed-point edges from this cluster's visual origin, including both endpoints. */
  readonly caretEdges: readonly FixedPoint[];
  /** Index into ShapedRun.fontSpans, preserving the exact fallback choice. */
  readonly fontSpan: number;
}

/** A run's vertical metrics, from the face that shaped it. Drives line height and baseline. */
export interface ShapedVerticalMetrics {
  readonly ascent: FixedPoint;
  readonly descent: FixedPoint;
  readonly lineGap: FixedPoint;
}

/**
 * A stretch of glyphs that came from ONE face.
 *
 * A run whose text needed fallback has several of these. Recording the exact face per span is
 * what lets a re-shape reproduce the same result rather than re-running fallback selection and
 * possibly choosing differently.
 */
export interface ShapedFontSpan {
  readonly glyphStart: number;
  readonly glyphEnd: number;
  readonly font: ResolvedFont;
  /** null denotes the primary font; otherwise this is the environment fallback-order index. */
  readonly fallbackIndex: number | null;
}

/**
 * One shaped run: text turned into positioned glyphs, with everything needed to measure it, paint
 * it, and put a caret in it.
 *
 * The engine's measurement unit. Layout never measures characters — it measures these.
 */
export interface ShapedRun {
  readonly text: string;
  readonly direction: TextDirection;
  readonly bidiLevel: number;
  readonly glyphs: readonly ShapedGlyph[];
  readonly clusters: readonly ShapedCluster[];
  readonly fontSpans: readonly ShapedFontSpan[];
  readonly metrics: ShapedVerticalMetrics;
  /**
   * The same horizontal advances as `glyphs[i].advanceX`, in the same fixed-point units, but
   * BEFORE the per-glyph rounding to the fixed-point grid. Parallel to `glyphs`.
   *
   * Measurement and line breaking read `advanceX` and must keep doing so: pagination is decided
   * on those numbers, and two runs shaped identically have to compare equal. A painter that
   * gives every glyph its own absolute position sums the advances instead, and a sum of ROUNDED
   * advances drifts by up to half a fixed-point unit per glyph — an error that only grows along
   * a line. Summing these and rounding once, at the position actually written, does not.
   *
   * Absent on runs an assembly path cannot state exactly; a reader falls back to `originX`.
   */
  readonly exactAdvancesX?: readonly number[];
}

/**
 * A {@link ShapedRun} reduced to the fields two shaping results must agree on to be considered
 * identical.
 *
 * Fonts appear as {@link FontFingerprintInputs} rather than whole `ResolvedFont` objects, so the
 * comparison is over VALUES and does not depend on object identity — which is what makes it work
 * across a reload or a worker boundary.
 */
export interface ShapedRunComparatorInputs {
  readonly text: string;
  readonly direction: TextDirection;
  readonly script: string;
  readonly language: string;
  readonly bidiLevel: number;
  readonly glyphs: readonly ShapedGlyph[];
  readonly clusters: readonly ShapedCluster[];
  readonly fontSpans: readonly {
    readonly glyphStart: number;
    readonly glyphEnd: number;
    readonly fallbackIndex: number | null;
    readonly font: FontFingerprintInputs;
  }[];
  readonly metrics: ShapedVerticalMetrics;
}

/**
 * The one thing layout needs from a shaping backend.
 *
 * Injected rather than imported, which is what keeps layout DOM-free and testable: a fixed-metric
 * shaper measures deterministically in a test, HarfBuzz measures for real in a browser, and
 * layout cannot tell the difference.
 */
export interface TextShaper {
  shape(input: ShapeInput): ShapedRun;
}

const facePreservingShapers = new WeakSet<TextShaper>();

/**
 * Record that `shaper` shapes every run in its environment's own face: with no fallback order,
 * each span of its runs carries that face. A shaper that substitutes a face for text the face
 * cannot draw (the export glyph fallback) is never marked, and neither is a host's own shaper.
 * @internal
 */
export function markFacePreservingShaper<T extends TextShaper>(shaper: T): T {
  facePreservingShapers.add(shaper);
  return shaper;
}

/** Whether `shaper` was marked by {@link markFacePreservingShaper}. @internal */
export function preservesShapingFace(shaper: TextShaper): boolean {
  return facePreservingShapers.has(shaper);
}

/**
 * A font reduced to the values that identify it for fingerprinting.
 *
 * Includes the content `hash` and `faceIndex`, so two faces with the same family name but
 * different bytes fingerprint differently — which is what stops a cached measurement being reused
 * against a substituted face.
 */
export interface FontFingerprintInputs {
  readonly identity: string;
  readonly id: string;
  readonly family: string;
  readonly request: FontRequest;
  readonly hash: string;
  readonly faceIndex: number;
  readonly byteLength: number;
  readonly substitution: FontSubstitution | null;
}

/**
 * A {@link ShapingEnvironment} reduced to comparable values.
 *
 * Records and axis maps become SORTED entry arrays, because two environments differing only in
 * key insertion order must fingerprint the same — otherwise a cache would miss on a difference
 * that changes no glyph.
 */
export interface ShapingEnvironmentFingerprintInputs {
  readonly font: FontFingerprintInputs;
  readonly variationAxes: readonly (readonly [string, number])[];
  readonly shapingLibrary: VersionedShapingLibrary;
  readonly unicodeDataVersion: string;
  readonly normalization: NormalizationPolicy;
  readonly script: string;
  readonly language: string;
  readonly direction: TextDirection;
  readonly features: readonly (readonly [string, number])[];
  readonly fallbackOrder: readonly FontFingerprintInputs[];
  readonly fixedPointScale: number;
  readonly roundingMode: FixedPointRoundingMode;
}

const assertNonBlank = (value: string, name: string): void => {
  if (value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${name} must be non-blank and contain no control characters`);
  }
};

const assertOpenTypeTag = (tag: string, name: string): void => {
  if (!/^[\x20-\x7e]{4}$/.test(tag)) throw new TypeError(`${name} must be a four-byte ASCII tag`);
};

const sortedNumericRecord = (
  values: Readonly<Record<string, number>>,
  name: string,
  integer: boolean
): Readonly<Record<string, number>> => {
  const entries = Object.entries(values).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const canonical: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, value] of entries) {
    assertOpenTypeTag(key, `${name} key`);
    if (!Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || value < 0))) {
      throw new RangeError(
        `${name} value must be ${integer ? 'a non-negative safe integer' : 'finite'}`
      );
    }
    if (integer && value > 0xffffffff) {
      throw new RangeError(`${name} value must fit an unsigned 32-bit integer`);
    }
    canonical[key] = value;
  }
  return Object.freeze(canonical);
};

const freezeRequest = (request: FontRequest): FontRequest =>
  Object.freeze({ family: request.family, weight: request.weight, style: request.style });

const freezeSubstitution = (
  substitution: FontSubstitution | null | undefined
): FontSubstitution | undefined =>
  substitution
    ? Object.freeze({
        requested: freezeRequest(substitution.requested),
        resolved: freezeRequest(substitution.resolved),
        ...(substitution.lineMetrics
          ? { lineMetrics: Object.freeze({ ...substitution.lineMetrics }) }
          : {}),
      })
    : undefined;

const shapingValidatedFonts = new WeakSet<object>();
const createdEnvironments = new WeakSet<object>();
const environmentFingerprints = new WeakMap<object, string>();

const assertFont = (font: ResolvedFont): void => {
  assertValidatedResolvedFont(font);
  if (shapingValidatedFonts.has(font)) return;
  if (font.identity !== `${font.hash}#${font.faceIndex}`) {
    throw new TypeError('Resolved font identity does not match hash and face index');
  }
  if (!Number.isSafeInteger(font.byteLength) || font.byteLength < 0) {
    throw new TypeError('Resolved font byte length is invalid');
  }
  shapingValidatedFonts.add(font);
};

const canonicalFont = (font: ResolvedFont): ResolvedFont => {
  assertFont(font);
  return font;
};

const fontFingerprintInputs = (font: ResolvedFont): FontFingerprintInputs => {
  assertFont(font);
  return Object.freeze({
    identity: font.identity,
    id: font.id,
    family: font.family,
    request: freezeRequest(font.request),
    hash: font.hash,
    faceIndex: font.faceIndex,
    byteLength: font.byteLength,
    substitution: freezeSubstitution(font.substitution) ?? null,
  });
};

/**
 * Validate and freeze a shaping environment.
 *
 * Checks every field that could silently corrupt a measurement: OpenType tags must be four ASCII
 * bytes, script and language must be non-blank and control-character free, fonts must already be
 * validated. Throws rather than coercing — a bad tag that shapes anyway produces a document that
 * measures wrong everywhere and looks fine.
 *
 * @throws TypeError on a malformed tag, name, or axis value.
 */
export const createShapingEnvironment = (input: ShapingEnvironmentInput): ShapingEnvironment => {
  // An environment this function built is deeply frozen, so validating it again yields an equal
  // object. Shaping re-enters here several times per call; the pass-through keeps that free.
  if (createdEnvironments.has(input)) return input as ShapingEnvironment;
  assertNonBlank(input.shapingLibrary.name, 'shaping library name');
  assertNonBlank(input.shapingLibrary.version, 'shaping library version');
  assertNonBlank(input.unicodeDataVersion, 'Unicode data version');
  if (!/^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(input.shapingLibrary.version)) {
    throw new TypeError('shaping library version must be a numeric version');
  }
  if (!/^\d+(?:\.\d+){1,2}$/.test(input.unicodeDataVersion)) {
    throw new TypeError('Unicode data version must be a dotted numeric version');
  }
  if (!/^[A-Z][a-z]{3}$/.test(input.script)) {
    throw new TypeError('script must be a four-letter ISO 15924 code');
  }
  assertNonBlank(input.language, 'language');
  if (!/^(?:und|[A-Za-z]{2,8})(?:-[A-Za-z0-9]{1,8})*$/.test(input.language)) {
    throw new TypeError('language must be a BCP 47 language tag');
  }
  if (input.direction !== 'ltr' && input.direction !== 'rtl') {
    throw new TypeError('direction must be ltr or rtl');
  }
  if (!['none', 'NFC', 'NFD', 'NFKC', 'NFKD'].includes(input.normalization)) {
    throw new TypeError('invalid normalization policy');
  }
  if (!['halfAwayFromZero', 'halfToEven', 'towardZero'].includes(input.roundingMode)) {
    throw new TypeError('invalid fixed-point rounding mode');
  }
  if (!Number.isSafeInteger(input.fixedPointScale) || input.fixedPointScale <= 0) {
    throw new RangeError('fixed-point scale must be a positive safe integer');
  }
  const font = canonicalFont(input.font);
  const fallbackOrder = input.fallbackOrder.map(canonicalFont);
  const seenFallbacks = new Set<string>();
  for (const font of fallbackOrder) {
    const key = JSON.stringify(fontFingerprintInputs(font));
    if (seenFallbacks.has(key)) throw new TypeError('fallback order contains a duplicate font');
    seenFallbacks.add(key);
  }
  const environment: ShapingEnvironment = Object.freeze({
    font,
    variationAxes: sortedNumericRecord(input.variationAxes, 'variation axis', false),
    shapingLibrary: Object.freeze({
      name: input.shapingLibrary.name,
      version: input.shapingLibrary.version,
    }),
    unicodeDataVersion: input.unicodeDataVersion,
    normalization: input.normalization,
    script: input.script,
    language: input.language,
    direction: input.direction,
    features: sortedNumericRecord(input.features, 'OpenType feature', true),
    fallbackOrder: Object.freeze([...fallbackOrder]),
    fixedPointScale: input.fixedPointScale,
    roundingMode: input.roundingMode,
  });
  createdEnvironments.add(environment);
  return environment;
};

/**
 * Reduce an environment to its comparable form, with records sorted so key order cannot affect
 * the result.
 */
export const shapingEnvironmentFingerprintInputs = (
  input: ShapingEnvironmentInput
): ShapingEnvironmentFingerprintInputs => {
  const environment = createShapingEnvironment(input);
  return Object.freeze({
    font: fontFingerprintInputs(environment.font),
    variationAxes: Object.freeze(
      Object.entries(environment.variationAxes).map((entry) => Object.freeze(entry))
    ),
    shapingLibrary: Object.freeze({
      name: environment.shapingLibrary.name,
      version: environment.shapingLibrary.version,
    }),
    unicodeDataVersion: environment.unicodeDataVersion,
    normalization: environment.normalization,
    script: environment.script,
    language: environment.language,
    direction: environment.direction,
    features: Object.freeze(
      Object.entries(environment.features).map((entry) => Object.freeze(entry))
    ),
    fallbackOrder: Object.freeze(environment.fallbackOrder.map(fontFingerprintInputs)),
    fixedPointScale: environment.fixedPointScale,
    roundingMode: environment.roundingMode,
  });
};

/** Canonical serialization of every shaping variable, including byte hash and provenance. */
export const shapingEnvironmentFingerprint = (environment: ShapingEnvironmentInput): string => {
  const cached = environmentFingerprints.get(environment);
  if (cached !== undefined) return cached;
  const fingerprint = JSON.stringify(shapingEnvironmentFingerprintInputs(environment));
  // Only a frozen environment built here can keep its fingerprint; a caller's input may change.
  if (createdEnvironments.has(environment)) environmentFingerprints.set(environment, fingerprint);
  return fingerprint;
};

const assertIndex = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
};

const checkedFixedPoint = (value: number): FixedPoint => {
  try {
    return fixedPoint(value);
  } catch {
    throw new RangeError('Shaped run contains a non-integer fixed-point value');
  }
};

const fontProvenanceKeys = new WeakMap<object, string>();

const fontProvenanceKey = (font: ResolvedFont): string => {
  const cached = fontProvenanceKeys.get(font);
  if (cached) return cached;
  assertFont(font);
  const key = JSON.stringify({
    identity: font.identity,
    id: font.id,
    family: font.family,
    request: font.request,
    hash: font.hash,
    faceIndex: font.faceIndex,
    byteLength: font.byteLength,
    substitution: font.substitution ?? null,
  });
  fontProvenanceKeys.set(font, key);
  return key;
};

/**
 * Validate and freeze a shaped run against the environment that produced it.
 *
 * Checks the internal consistency a shaper must satisfy: direction matches the environment,
 * cluster ranges tile the text without gaps or overlap, glyph ranges stay in bounds, font spans
 * cover every glyph, and caret edges are monotonic. A shaper that violates any of these produces
 * a caret that lands in the wrong place, which is far harder to diagnose downstream than here.
 *
 * @throws TypeError when the run and environment disagree, or the run is internally inconsistent.
 */
export const createShapedRun = (
  input: ShapedRun,
  environmentInput: ShapingEnvironmentInput
): ShapedRun => {
  const environment = createShapingEnvironment(environmentInput);
  if (input.direction !== 'ltr' && input.direction !== 'rtl') {
    throw new TypeError('Shaped run direction must be ltr or rtl');
  }
  if (input.direction !== environment.direction) {
    throw new TypeError('Shaped run direction does not match shaping environment');
  }
  assertIndex(input.bidiLevel, 'bidi level');
  if (((input.bidiLevel & 1) === 1) !== (input.direction === 'rtl')) {
    throw new TypeError('Shaped run direction does not match bidi level parity');
  }
  const ownedOutlines = new Map<GlyphOutline, GlyphOutline>();
  const glyphs = input.glyphs.map((glyph) => {
    assertIndex(glyph.id, 'glyph id');
    assertIndex(glyph.cluster, 'glyph cluster');
    let outline = ownedOutlines.get(glyph.outline);
    if (!outline) {
      if (!Number.isSafeInteger(glyph.outline.unitsPerEm) || glyph.outline.unitsPerEm <= 0) {
        throw new RangeError('Glyph outline units per em must be a positive safe integer');
      }
      outline = Object.isFrozen(glyph.outline)
        ? glyph.outline
        : Object.freeze({
            path: glyph.outline.path,
            unitsPerEm: glyph.outline.unitsPerEm,
          });
      ownedOutlines.set(glyph.outline, outline);
    }
    return Object.freeze({
      id: glyph.id,
      cluster: glyph.cluster,
      originX: checkedFixedPoint(glyph.originX),
      originY: checkedFixedPoint(glyph.originY),
      advanceX: checkedFixedPoint(glyph.advanceX),
      advanceY: checkedFixedPoint(glyph.advanceY),
      offsetX: checkedFixedPoint(glyph.offsetX),
      offsetY: checkedFixedPoint(glyph.offsetY),
      outline,
      // A synthesized small-caps glyph already has its advance scaled; the painter scales the
      // outline by this. Dropping it here painted full-size letters on 0.8 advances after a
      // mixed-face fallback rebuilt the run.
      ...(glyph.drawScale !== undefined ? { drawScale: glyph.drawScale } : {}),
    });
  });
  const fontSpans = input.fontSpans.map((span) => {
    assertIndex(span.glyphStart, 'font span start');
    assertIndex(span.glyphEnd, 'font span end');
    if (span.glyphEnd <= span.glyphStart || span.glyphEnd > glyphs.length) {
      throw new RangeError('Font span glyph range is invalid');
    }
    if (span.fallbackIndex !== null) assertIndex(span.fallbackIndex, 'fallback index');
    const font = canonicalFont(span.font);
    if (span.fallbackIndex === null) {
      if (fontProvenanceKey(font) !== fontProvenanceKey(environment.font)) {
        throw new TypeError('Shaped primary font does not match shaping environment');
      }
    } else {
      const expected = environment.fallbackOrder[span.fallbackIndex];
      if (!expected) throw new RangeError('Shaped fallback index is outside fallback order');
      if (fontProvenanceKey(font) !== fontProvenanceKey(expected)) {
        throw new TypeError('Shaped fallback font does not match shaping environment provenance');
      }
    }
    return Object.freeze({ ...span, font });
  });
  for (let index = 0; index < fontSpans.length; index += 1) {
    const expectedStart = index === 0 ? 0 : fontSpans[index - 1]!.glyphEnd;
    if (fontSpans[index]!.glyphStart !== expectedStart) {
      throw new RangeError('Font spans must cover glyphs contiguously');
    }
  }
  if (
    (glyphs.length === 0 && fontSpans.length !== 0) ||
    (glyphs.length > 0 && fontSpans.at(-1)?.glyphEnd !== glyphs.length)
  ) {
    throw new RangeError('Font spans must cover every glyph exactly once');
  }
  const clusters = input.clusters.map((cluster) => {
    assertIndex(cluster.textStart, 'cluster text start');
    assertIndex(cluster.textEnd, 'cluster text end');
    assertIndex(cluster.glyphStart, 'cluster glyph start');
    assertIndex(cluster.glyphEnd, 'cluster glyph end');
    assertIndex(cluster.fontSpan, 'cluster font span');
    if (
      cluster.textEnd <= cluster.textStart ||
      cluster.textEnd > input.text.length ||
      cluster.glyphEnd <= cluster.glyphStart ||
      cluster.glyphEnd > glyphs.length
    ) {
      throw new RangeError('Shaped cluster range is invalid');
    }
    const span = fontSpans[cluster.fontSpan];
    if (!span || cluster.glyphStart < span.glyphStart || cluster.glyphEnd > span.glyphEnd) {
      throw new RangeError('Shaped cluster does not belong to its declared font span');
    }
    return Object.freeze({
      textStart: cluster.textStart,
      textEnd: cluster.textEnd,
      glyphStart: cluster.glyphStart,
      glyphEnd: cluster.glyphEnd,
      advance: checkedFixedPoint(cluster.advance),
      caretEdges: Object.freeze(cluster.caretEdges.map(checkedFixedPoint)),
      fontSpan: cluster.fontSpan,
    });
  });
  const metrics = Object.freeze({
    ascent: checkedFixedPoint(input.metrics.ascent),
    descent: checkedFixedPoint(input.metrics.descent),
    lineGap: checkedFixedPoint(input.metrics.lineGap),
  });
  // Refused rather than dropped: an assembly path that reorders or regroups glyphs and forgets
  // to say so would otherwise paint one glyph's advance under another's.
  const exact = input.exactAdvancesX;
  if (exact !== undefined) {
    if (exact.length !== glyphs.length) {
      throw new RangeError('Exact advances must be parallel to the shaped glyphs');
    }
    if (exact.some((value) => !Number.isFinite(value))) {
      throw new RangeError('Exact advance must be a finite number');
    }
  }
  return Object.freeze({
    text: input.text,
    direction: input.direction,
    bidiLevel: input.bidiLevel,
    glyphs: Object.freeze(glyphs),
    clusters: Object.freeze(clusters),
    fontSpans: Object.freeze(fontSpans),
    metrics,
    ...(exact === undefined ? {} : { exactAdvancesX: Object.freeze([...exact]) }),
  });
};

/**
 * Reduce a shaped run to its comparable form, validating it on the way through.
 *
 * What the D9 determinism oracles compare: two shaping runs of the same text in the same
 * environment must produce byte-identical structures here.
 */
export const shapedRunComparatorInputs = (
  input: ShapedRun,
  environment: ShapingEnvironmentInput
): ShapedRunComparatorInputs => {
  const run = createShapedRun(input, environment);
  return Object.freeze({
    text: run.text,
    direction: run.direction,
    script: environment.script,
    language: environment.language,
    bidiLevel: run.bidiLevel,
    glyphs: run.glyphs,
    clusters: run.clusters,
    fontSpans: Object.freeze(
      run.fontSpans.map((span) =>
        Object.freeze({
          glyphStart: span.glyphStart,
          glyphEnd: span.glyphEnd,
          fallbackIndex: span.fallbackIndex,
          font: fontFingerprintInputs(span.font),
        })
      )
    ),
    metrics: run.metrics,
  });
};
