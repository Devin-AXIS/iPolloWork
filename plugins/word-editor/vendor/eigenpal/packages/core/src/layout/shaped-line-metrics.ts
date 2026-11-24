import { cjkLineMetrics } from './cjk-line-metrics.ts';
import type { ResolvedFont } from './font-resource.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import {
  layoutRunHalfPointsOf,
  shapeLayoutStyleRun,
  type LayoutShapingEnvironment,
} from './layout-run-shape.ts';
import type { TextShaper } from './shaped-run.ts';
import { faceLineGapPt, takesLegacyLineGap } from './times-new-roman-leading.ts';
import { sameFontFamily } from '../store/package/default-font-faces.ts';

/** Half-point keys are integers, so a half step marks the named-face entry of a size. */
const NAMED_FACE_KEY = 0.5;

/**
 * True when `font` is the family that `style` names, not a substitute or a glyph fallback. A
 * localized East Asian name and its English name name one family (`メイリオ` and `Meiryo`).
 */
function drawsAsNamedFace(font: ResolvedFont, style: ResolvedRunStyle): boolean {
  if (style.fontFamily === null) return false;
  // A bold or italic request answered by the same family's regular face (a synthesized
  // style) still draws as the named family. A stand-in from another family does not.
  const substitution = font.substitution;
  if (
    substitution !== null &&
    (substitution.lineMetrics !== undefined ||
      !sameFontFamily(substitution.requested.family, substitution.resolved.family))
  )
    return false;
  // The exact comparison answers almost every call on this per-span path without allocating.
  return font.family === style.fontFamily || sameFontFamily(font.family, style.fontFamily);
}

/** Cached face metrics, independent of the glyph fallback selected by a run. */
export function createShapedLineMetrics(
  shaper: TextShaper,
  baseEnvironment: LayoutShapingEnvironment,
  fallback: TextMeasurer,
  maxFaceBoxEm: number,
  maxLineGapFaceBoxes: number
): (font: ResolvedFont, style: ResolvedRunStyle) => { height: number; baseline: number } {
  const linesByFont = new WeakMap<
    ResolvedFont,
    Map<number, { height: number; baseline: number }>
  >();
  return (font, style) => {
    const factor = glyphSizeFactorOf(style);
    let bySize = linesByFont.get(font);
    if (!bySize) {
      bySize = new Map();
      linesByFont.set(font, bySize);
    }
    const halfPoints = layoutRunHalfPointsOf(style);
    // The legacy gap depends on the run, not only the face, so it keys the cache too.
    const legacyGap = takesLegacyLineGap(style);
    // So does the CJK line rule for a taller face: it applies to the family the run names,
    // not to a substitute for it or to a glyph fallback that the same font object serves.
    const namedFace = drawsAsNamedFace(font, style);
    const key = (legacyGap ? halfPoints : -halfPoints) + (namedFace ? NAMED_FACE_KEY : 0);
    const cached = bySize.get(key);
    if (cached) {
      return factor === 1
        ? cached
        : { height: cached.height * factor, baseline: cached.baseline * factor };
    }

    let metrics: { height: number; baseline: number };
    let scalable = true;
    const substitutionMetrics = font.substitution?.lineMetrics;
    if (substitutionMetrics) {
      const baseSizePt = halfPoints / 2;
      metrics = {
        height: substitutionMetrics.heightEm * baseSizePt,
        baseline: substitutionMetrics.baselineEm * baseSizePt,
      };
    } else {
      try {
        // Vertical metrics are a property of the FACE, not of the text, so NO text is what
        // this asks for. It used to shape a single space, which is cheap but not neutral:
        // a shaper that substitutes a face for text it cannot draw — the exporter's glyph
        // fallback does exactly that — answers with the SUBSTITUTE's extents. A legacy
        // symbol face is the case that exposes it, because its cmap need not carry U+0020
        // at all, so every Symbol and Wingdings line was sized by one shared fallback face
        // instead of by the two different faces the document actually names. An empty run
        // shapes to no glyphs, which no fallback can improve on, so the extents that come
        // back are this face's own.
        const shaped = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, '');
        const ascent = shaped.metrics.ascent / baseEnvironment.fixedPointScale;
        const descent = shaped.metrics.descent / baseEnvironment.fixedPointScale;
        // Word's single-spaced line box is ascent + descent + lineGap. External leading
        // precedes the baseline; placing it below shifted Arial text upward at every size.
        // Dropping the gap is what made a 10 pt Arial line 11.17 pt where Word draws 11.50
        // (Liberation Sans and Liberation Serif both carry Arial's and Times New Roman's own
        // gap, so both land on Word's 1.1499 em). Faces with no gap — Carlito, Caladea,
        // Liberation Mono — are unaffected, which is why the error only showed on the two
        // faces that have one.
        //
        // BOUNDED IN THE EM, because all three numbers are `hhea` int16 read from a font a
        // DOCX can embed and nothing downstream bounds a line box. The shaper admits any
        // safe integer over any `upem > 0`, so `ascender = 32767` over `upem = 16` is a face
        // box of ~2048 em on its own — bounding the gap against the face box alone would
        // have clamped one attacker-controlled number against another.
        //
        // The face box is clamped first, absolutely, against the drawn size. Ascent and
        // descent scale together so the baseline stays where it sits inside the box. Then
        // the gap: non-negative, because external leading is non-negative on Windows and in
        // GDI and a face declaring `lineGap = -(ascender - descender) + 1` would otherwise
        // give every run in that family a one-unit line that the `height > 0` guard does not
        // catch; and at most half a face box above.
        const baseSizePt = halfPoints / 2;
        const rawFaceBox = ascent + descent;
        const faceBoxCeiling = baseSizePt * maxFaceBoxEm;
        const squeeze = rawFaceBox > faceBoxCeiling ? faceBoxCeiling / rawFaceBox : 1;
        const faceBox = rawFaceBox * squeeze;
        const ownGap = shaped.metrics.lineGap / baseEnvironment.fixedPointScale;
        const lineGap = Math.min(
          Math.max(0, faceLineGapPt(font.family, ascent, descent, ownGap, baseSizePt, legacyGap)),
          faceBox * maxLineGapFaceBoxes
        );
        const height = faceBox + lineGap;
        if (height > 0) {
          metrics = cjkLineMetrics(
            font,
            baseSizePt,
            { height, baseline: ascent * squeeze + lineGap },
            lineGap,
            2 / baseEnvironment.fixedPointScale,
            namedFace
          );
        } else {
          metrics = fallback.lineMetrics(style);
          scalable = false;
        }
      } catch {
        metrics = fallback.lineMetrics(style);
        scalable = false;
      }
    }
    // Fallback answers are already at the drawn size; only face metrics shaped at the base
    // size are cached and rescaled.
    if (!scalable) return metrics;
    bySize.set(key, metrics);
    return factor === 1
      ? metrics
      : { height: metrics.height * factor, baseline: metrics.baseline * factor };
  };
}
