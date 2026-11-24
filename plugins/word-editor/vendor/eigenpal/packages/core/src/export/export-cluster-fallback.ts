// Bounded last-resort composition when no admitted face covers an entire run.
import type { ResolvedFont } from '../layout/font-resource.ts';
import {
  createShapedRun,
  createShapingEnvironment,
  fixedPoint,
  type ShapeInput,
  type ShapedRun,
  type ShapedGlyph,
  type ShapedCluster,
  type ShapedFontSpan,
  type TextShaper,
} from '../layout/shaped-run.ts';
import { synthesizeExportSmallCaps } from './export-small-caps.ts';
import { orderFallbackFacesForCluster } from './export-color-font.ts';

/** Keep fragmented fallback work bounded independently of the original shaping limit. */
const MAX_FALLBACK_CLUSTERS = 2048;

export function shapeExportClusterFallback(
  shaper: TextShaper,
  input: ShapeInput,
  primary: ShapedRun,
  fonts: readonly ResolvedFont[]
): ShapedRun | null {
  if (!primary.clusters.length || primary.clusters.length > MAX_FALLBACK_CLUSTERS) return null;
  const shape = (font: ResolvedFont, text: string) => {
    // A group is a slice of the run, so the run's context does not border it. Groups shape
    // without context; joining scripts never take this path.
    const { context: _context, ...plain } = input;
    const next = {
      ...plain,
      text,
      environment: createShapingEnvironment({ ...input.environment, font }),
    };
    return synthesizeExportSmallCaps(shaper, next, shaper.shape(next));
  };
  const groups: { start: number; end: number; font: ResolvedFont }[] = [];
  const selected = new Map<string, ResolvedFont>();
  for (const cluster of [...primary.clusters].sort((a, b) => a.textStart - b.textStart)) {
    let font = input.environment.font;
    const text = input.text.slice(cluster.textStart, cluster.textEnd);
    // A variation selector belongs to the character before it. The primary shaping puts it
    // in a cluster of its own, so it is folded into the previous group, whose face then
    // shapes the pair together and can honour the emoji or text presentation it asks for.
    const previousGroup = groups.at(-1);
    if (/^[\uFE0E\uFE0F]$/.test(text) && previousGroup && previousGroup.end === cluster.textStart) {
      previousGroup.end = cluster.textEnd;
      continue;
    }
    // A space between Hebrew words that fell back stays with them, so the words keep the
    // fallback face's line height; punctuation still takes the authored face.
    if (
      input.environment.script === 'Hebr' &&
      /^\s+$/u.test(text) &&
      previousGroup &&
      previousGroup.font !== input.environment.font &&
      previousGroup.end === cluster.textStart
    ) {
      previousGroup.end = cluster.textEnd;
      continue;
    }
    if (
      primary.glyphs.slice(cluster.glyphStart, cluster.glyphEnd).some((glyph) => glyph.id === 0)
    ) {
      // The selector that follows decides the presentation, so it takes part in the order.
      const presentation = input.text.slice(cluster.textStart, cluster.textEnd + 1);
      const found =
        selected.get(text) ??
        orderFallbackFacesForCluster(fonts, presentation).find((candidate) => {
          try {
            return !shape(candidate, text).glyphs.some((glyph) => glyph.id === 0);
          } catch {
            return false;
          }
        });
      if (!found) return null;
      selected.set(text, found);
      font = found;
    }
    const previous = groups.at(-1);
    if (previous && previous.font === font && previous.end === cluster.textStart)
      previous.end = cluster.textEnd;
    else groups.push({ start: cluster.textStart, end: cluster.textEnd, font });
  }
  const glyphs: ShapedGlyph[] = [],
    clusters: ShapedCluster[] = [],
    fontSpans: ShapedFontSpan[] = [],
    exactAdvancesX: number[] = [];
  // Advances are per glyph, so composition just concatenates them in glyph order. One group
  // that cannot state them drops the whole array, and paint falls back to the rounded origins.
  let exact = true;
  let penX = 0,
    penY = 0,
    ascent = 0,
    descent = 0,
    lineGap = 0;
  for (const group of input.environment.direction === 'rtl' ? groups.reverse() : groups) {
    const run = shape(group.font, input.text.slice(group.start, group.end));
    if (run.glyphs.some((glyph) => glyph.id === 0)) return null;
    const first = glyphs.length,
      fontSpan = fontSpans.length;
    for (const glyph of run.glyphs)
      glyphs.push({
        ...glyph,
        cluster: group.start + glyph.cluster,
        originX: fixedPoint(penX + glyph.originX),
        originY: fixedPoint(penY + glyph.originY),
      });
    if (run.exactAdvancesX === undefined) exact = false;
    else for (const advance of run.exactAdvancesX) exactAdvancesX.push(advance);
    for (const cluster of run.clusters)
      clusters.push({
        ...cluster,
        textStart: group.start + cluster.textStart,
        textEnd: group.start + cluster.textEnd,
        glyphStart: first + cluster.glyphStart,
        glyphEnd: first + cluster.glyphEnd,
        fontSpan,
      });
    if (run.glyphs.length)
      fontSpans.push({
        font: group.font,
        glyphStart: first,
        glyphEnd: glyphs.length,
        fallbackIndex: group.font === input.environment.font ? null : fonts.indexOf(group.font),
      });
    penX += run.glyphs.reduce((sum, glyph) => sum + glyph.advanceX, 0);
    penY += run.glyphs.reduce((sum, glyph) => sum + glyph.advanceY, 0);
    ascent = Math.max(ascent, run.metrics.ascent);
    descent = Math.max(descent, run.metrics.descent);
    lineGap = Math.max(lineGap, run.metrics.lineGap);
  }
  return createShapedRun(
    {
      ...primary,
      glyphs,
      clusters,
      fontSpans,
      exactAdvancesX: exact && exactAdvancesX.length === glyphs.length ? exactAdvancesX : undefined,
      metrics: {
        ascent: fixedPoint(ascent),
        descent: fixedPoint(descent),
        lineGap: fixedPoint(lineGap),
      },
    },
    { ...input.environment, fallbackOrder: fonts }
  );
}
