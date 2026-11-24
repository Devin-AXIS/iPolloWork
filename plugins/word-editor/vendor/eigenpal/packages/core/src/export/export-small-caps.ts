import { fixedPoint } from '../layout/shaped-run.ts';
// Synthetic small caps for export faces without an OpenType smcp substitution.
// The same scaled glyph advances feed layout and the exporter. Source Unicode stays intact.
import type {
  ShapeInput,
  ShapedRun,
  TextShaper,
  ShapedGlyph,
  ShapedCluster,
} from '../layout/shaped-run.ts';

/**
 * The scale of a synthesized small capital: 0.8 of the run size, rounded to a whole
 * half-point. An 11pt run draws its small capitals at 9pt, and so does an 11.5pt run.
 */
export function syntheticSmallCapsScale(fontSizeHalfPoints: number): number {
  if (!Number.isFinite(fontSizeHalfPoints) || fontSizeHalfPoints <= 0) return 0.8;
  return Math.max(1, Math.round(fontSizeHalfPoints * 0.8)) / fontSizeHalfPoints;
}

export function synthesizeExportSmallCaps(
  shaper: TextShaper,
  input: ShapeInput,
  featured: ShapedRun
): ShapedRun {
  // Spaces take the small capital size too, between capitals as well; digits and punctuation
  // keep the run size.
  if (input.environment.features.smcp !== 1 || !/[\p{Ll} ]/u.test(input.text)) return featured;
  const plainInput = {
    ...input,
    environment: { ...input.environment, features: { ...input.environment.features, smcp: 0 } },
  };
  const plain = shaper.shape(plainInput);
  if (
    featured.glyphs.length !== plain.glyphs.length ||
    featured.glyphs.some((glyph, i) => glyph.id !== plain.glyphs[i]?.id)
  )
    return featured;
  const groups: { text: string; start: number; lower: boolean }[] = [];
  let offset = 0;
  for (const char of input.text) {
    const lower = char === ' ' || char.toUpperCase() !== char;
    const previous = groups.at(-1);
    if (previous && (previous.lower === lower || /\p{M}/u.test(char))) previous.text += char;
    else groups.push({ text: char, start: offset, lower });
    offset += char.length;
  }
  const glyphs: ShapedGlyph[] = [],
    clusters: ShapedCluster[] = [],
    exactAdvancesX: number[] = [];
  let exact = true;
  let pen = 0;
  const lowerScale = syntheticSmallCapsScale(input.fontSizeHalfPoints);
  // Small caps apply to cased scripts. The surrounding bidi direction remains unchanged.
  for (const group of input.environment.direction === 'rtl' ? groups.reverse() : groups) {
    const scale = group.lower ? lowerScale : 1;
    const starts: number[] = [],
      ends: number[] = [];
    let text = '',
      logical = group.start;
    for (const char of group.text) {
      const drawn = group.lower ? char.toUpperCase() : char;
      for (let i = 0; i < drawn.length; i++) {
        starts.push(logical);
        ends.push(logical + char.length);
      }
      text += drawn;
      logical += char.length;
    }
    const run = shaper.shape({ ...plainInput, text });
    const first = glyphs.length;
    for (const [index, glyph] of run.glyphs.entries()) {
      // The synthetic scale multiplies the advance, so it multiplies the unrounded one too.
      const advance = run.exactAdvancesX?.[index];
      if (advance === undefined) exact = false;
      else exactAdvancesX.push(advance * scale);
      glyphs.push({
        ...glyph,
        cluster: starts[glyph.cluster] ?? group.start,
        originX: fixedPoint(pen + Math.round(glyph.originX * scale)),
        originY: fixedPoint(Math.round(glyph.originY * scale)),
        offsetX: fixedPoint(Math.round(glyph.offsetX * scale)),
        offsetY: fixedPoint(Math.round(glyph.offsetY * scale)),
        advanceX: fixedPoint(Math.round(glyph.advanceX * scale)),
        advanceY: fixedPoint(Math.round(glyph.advanceY * scale)),
        drawScale: scale,
      });
    }
    for (const cluster of run.clusters) {
      const textStart = starts[cluster.textStart] ?? group.start,
        textEnd = ends[cluster.textEnd - 1] ?? logical;
      const advance = fixedPoint(Math.round(cluster.advance * scale));
      const last = clusters.at(-1);
      if (last && last.textStart === textStart && last.textEnd === textEnd) {
        clusters[clusters.length - 1] = {
          ...last,
          glyphEnd: first + cluster.glyphEnd,
          advance: fixedPoint(last.advance + advance),
          caretEdges: [fixedPoint(0), fixedPoint(last.advance + advance)],
        };
      } else
        clusters.push({
          ...cluster,
          textStart,
          textEnd,
          glyphStart: first + cluster.glyphStart,
          glyphEnd: first + cluster.glyphEnd,
          advance,
          caretEdges: cluster.caretEdges.map((value) => fixedPoint(Math.round(value * scale))),
          fontSpan: 0,
        });
    }
    pen += run.glyphs.reduce((sum, glyph) => sum + Math.round(glyph.advanceX * scale), 0);
  }
  return {
    ...featured,
    glyphs,
    clusters,
    fontSpans: [{ ...featured.fontSpans[0]!, glyphStart: 0, glyphEnd: glyphs.length }],
    // This does not run through createShapedRun, so the inherited array has to be replaced or
    // cleared here: `featured` was shaped as one piece and its advances are not these.
    exactAdvancesX: exact && exactAdvancesX.length === glyphs.length ? exactAdvancesX : undefined,
  };
}
