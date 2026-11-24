// A face that lists the CJK code pages takes a line of 1.3 times its own box (ascent plus
// descent). Its own leading is absorbed, and the extra space is split above and below the
// glyphs. A face with a one-em box takes at least that line in every role. A taller face takes it only
// when it draws as the family that the run names: a packaged stand-in for a missing family, or
// a glyph fallback, keeps its own box, which is not the box of the face it replaces.
import { trustedFontBytes, type ResolvedFont } from './font-resource.ts';

const cjkFaces = new WeakMap<ResolvedFont, boolean>();
function hasCjkCodePages(font: ResolvedFont): boolean {
  const cached = cjkFaces.get(font);
  if (cached !== undefined) return cached;
  const bytes = trustedFontBytes(font);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let supported = false;
  // Admission validates the selected sfnt/TTC directory. These checks also bound
  // reads of optional OS/2 fields that old fonts can omit.
  const base = view.getUint32(0) === 0x74746366 ? view.getUint32(12 + font.faceIndex * 4) : 0;
  const count = view.getUint16(base + 4);
  for (let index = 0; index < count; index++) {
    const record = base + 12 + index * 16;
    if (view.getUint32(record) !== 0x4f532f32) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (length >= 86 && offset <= bytes.byteLength - length && view.getUint16(offset) >= 1) {
      // Windows code pages 932, 936, 949, and 950 (OS/2 bits 17–20).
      supported = (view.getUint32(offset + 78) & 0x001e0000) !== 0;
    }
    break;
  }
  cjkFaces.set(font, supported);
  return supported;
}

/** The line of a CJK face: 1.3 times its face box. */
const CJK_LINE_BOX_FACTOR = 1.3;

/**
 * The single-spaced line of `font` at `sizePt`, with the CJK line rule applied.
 *
 * @param metrics - the face box plus `lineGap`, with the baseline below the gap.
 * @param drawnAsNamedFace - true when `font` is the family the run names, not a substitute
 *   for it and not a glyph fallback.
 */
export function cjkLineMetrics(
  font: ResolvedFont,
  sizePt: number,
  metrics: { height: number; baseline: number },
  lineGap: number,
  roundingTolerance: number,
  drawnAsNamedFace = false
): { height: number; baseline: number } {
  const faceBox = metrics.height - lineGap;
  const oneEm = Math.abs(faceBox - sizePt) <= roundingTolerance;
  if ((!oneEm && !drawnAsNamedFace) || !hasCjkCodePages(font)) return metrics;
  // MS Gothic lines at 11pt occupy 14.28pt before paragraph spacing, and SimSun lines at 12pt
  // (a one-em box plus 0.14em of its own leading) occupy 15.6pt. A taller face scales its own
  // box: Noto Sans CJK JP (1.448em) takes 1.882em, Malgun Gothic (1.33em) takes 1.729em, and
  // Yu Gothic (1.102em plus 0.5em of leading) takes 1.433em, below its box plus leading.
  const height = drawnAsNamedFace
    ? faceBox * CJK_LINE_BOX_FACTOR
    : Math.max(metrics.height, sizePt * CJK_LINE_BOX_FACTOR);
  const ascent = metrics.baseline - lineGap;
  return { height, baseline: ascent + (height - faceBox) / 2 };
}
