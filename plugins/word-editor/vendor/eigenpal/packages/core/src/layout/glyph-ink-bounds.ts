// Conservative horizontal bounds of HarfBuzz's absolute M/L/Q/C/Z outlines.
// Bézier curves stay within their control points, so these bounds never trim ink.
import type { GlyphOutline, ShapedRun } from './shaped-run.ts';

export interface GlyphInkBounds {
  readonly left: number;
  readonly right: number;
}

const cached = new WeakMap<GlyphOutline, GlyphInkBounds | null>();
function outlineBounds(outline: GlyphOutline): GlyphInkBounds | undefined {
  const hit = cached.get(outline);
  if (hit !== undefined) return hit ?? undefined;
  const path = outline.path;
  // The shaper already bounds outlines. Retain an independent limit for custom shapers.
  if (!path.startsWith('M') || path.length > 1_000_000 || /[^MLQCZ0-9eE+.,\s-]/u.test(path))
    return undefined;
  let left = Infinity;
  let right = -Infinity;
  const commands = path.matchAll(/([MLQCZ])([^MLQCZ]*)/gu);
  for (const command of commands) {
    const expected = command[1] === 'Z' ? 0 : command[1] === 'C' ? 6 : command[1] === 'Q' ? 4 : 2;
    const coordinates = command[2]!
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number);
    if (coordinates.length !== expected || coordinates.some((value) => !Number.isFinite(value))) {
      cached.set(outline, null);
      return undefined;
    }
    for (let at = 0; at < coordinates.length; at += 2) {
      left = Math.min(left, coordinates[at]!);
      right = Math.max(right, coordinates[at]!);
    }
  }
  const result = Number.isFinite(left) && Number.isFinite(right) ? { left, right } : undefined;
  cached.set(outline, result ?? null);
  return result;
}

/** One cluster only: authored tracking follows it and does not displace its ink. */
export function shapedClusterInkBounds(
  run: ShapedRun,
  pointSize: number,
  fixedPointScale: number,
  horizontalScale: number
): GlyphInkBounds | undefined {
  if (run.clusters.length !== 1 || run.glyphs.length === 0) return undefined;
  let left = Infinity;
  let right = -Infinity;
  for (const glyph of run.glyphs) {
    if (glyph.id === 0) return undefined;
    const bounds = outlineBounds(glyph.outline);
    const units = glyph.outline.unitsPerEm;
    if (!bounds || !(units > 0)) return undefined;
    const origin = (glyph.originX + glyph.offsetX) / fixedPointScale;
    left = Math.min(left, origin + (bounds.left * pointSize * (glyph.drawScale ?? 1)) / units);
    right = Math.max(right, origin + (bounds.right * pointSize * (glyph.drawScale ?? 1)) / units);
  }
  const bounds = { left: left * horizontalScale, right: right * horizontalScale };
  return Number.isFinite(bounds.left) && Number.isFinite(bounds.right) ? bounds : undefined;
}
