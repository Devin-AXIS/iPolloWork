// A shaped run's glyph outlines as one path in points, for text drawn as a shape.
//
// HarfBuzz outlines are absolute M/L/Q/C/Z commands in font design units with y up. The run
// path puts each glyph at its pen position and flips y, so the result reads like layout:
// x right and y down from the run origin on the baseline.
import type { TextOutline } from './semantic-records.ts';
import type { ShapedRun } from './shaped-run.ts';

/** Path data budget for one run; a watermark phrase uses a small fraction of it. */
const MAX_RUN_PATH_LENGTH = 2_000_000;
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

const coordinate = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

/**
 * The run's ink as one path, or undefined when a glyph has no outline the path grammar can
 * read, a glyph is missing from the face (`.notdef`), or the path would exceed its budget.
 * @internal
 */
export function shapedRunOutline(
  run: ShapedRun,
  pointSize: number,
  fixedPointScale: number
): TextOutline | undefined {
  if (!(pointSize > 0) || !(fixedPointScale > 0)) return undefined;
  const parts: string[] = [];
  let length = 0;
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const glyph of run.glyphs) {
    if (glyph.id === 0) return undefined;
    const path = glyph.outline.path;
    const units = glyph.outline.unitsPerEm;
    if (!path) continue;
    if (!(units > 0) || !path.startsWith('M') || /[^MLQCZ0-9eE+.,\s-]/u.test(path))
      return undefined;
    const scale = (pointSize * (glyph.drawScale ?? 1)) / units;
    const originX = (glyph.originX + glyph.offsetX) / fixedPointScale;
    const originY = (glyph.originY + glyph.offsetY) / fixedPointScale;
    for (const command of path.matchAll(/([MLQCZ])([^MLQCZ]*)/gu)) {
      const letter = command[1]!;
      const values = command[2]!
        .trim()
        .split(/[\s,]+/u)
        .filter(Boolean)
        .map(Number);
      if (values.length !== ARITY[letter] || values.some((v) => !Number.isFinite(v)))
        return undefined;
      let out = letter;
      for (let at = 0; at < values.length; at += 2) {
        const x = originX + values[at]! * scale;
        const y = -(originY + values[at + 1]! * scale);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        out += `${at ? ' ' : ''}${coordinate(x)} ${coordinate(y)}`;
      }
      length += out.length;
      if (length > MAX_RUN_PATH_LENGTH) return undefined;
      parts.push(out);
    }
  }
  if (!parts.length || !(right > left) || !(bottom > top)) return undefined;
  return Object.freeze({
    path: parts.join(''),
    ink: Object.freeze({ left, top, right, bottom }),
  });
}
