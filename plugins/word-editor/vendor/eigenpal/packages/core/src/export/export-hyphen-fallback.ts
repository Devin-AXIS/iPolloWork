// Word can use a face's ordinary hyphen for a missing nonbreaking-hyphen glyph.
// Preserve the source character and clusters: its no-break semantics stay in Core layout.
import {
  createShapedRun,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
} from '../layout/shaped-run.ts';

export function shapeExportHyphenFallback(
  shaper: TextShaper,
  input: ShapeInput,
  primary: ShapedRun
): ShapedRun {
  if (!input.text.includes('\u2011')) return primary;
  const missing = new Set(
    primary.glyphs.filter((glyph) => glyph.id === 0).map((glyph) => glyph.cluster)
  );
  if (!missing.size) return primary;
  const text = input.text.replace(/\u2011/g, (character, offset: number) =>
    missing.has(offset) ? '-' : character
  );
  if (text === input.text) return primary;
  try {
    const replacement = shaper.shape({ ...input, text });
    return createShapedRun({ ...replacement, text: input.text }, input.environment);
  } catch {
    return primary;
  }
}
