// The hAnsi face is independent of ascii. Keep authored properties and model
// ranges intact; only derived layout pieces select a different measurement face.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import { paintedFontFamilyName } from '../store/package/font-family-name.ts';
import { isEastAsiaHintSymbol, hasEastAsiaSymbolHint } from './east-asia-symbol-hint.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { segmentGraphemes } from './grapheme.ts';
import { withFontFamily, type ThemeFonts } from './run-style.ts';
import { isSymbolEncodedFamily } from './symbol-encoding.ts';
import { RUN_FONT_DEFAULTS } from './application-run-defaults.ts';

const LATIN_FACE_ATTRIBUTES = ['ascii', 'asciiTheme', 'hAnsi', 'hAnsiTheme'] as const;

function slotFace(
  attrs: Readonly<Record<string, string>> | undefined,
  theme: ThemeFonts | undefined
): string | undefined {
  const face =
    (theme ? themeFontFamilyOf(attrs?.hAnsiTheme, theme) : null) ??
    paintedFontFamilyName(attrs?.hAnsi);
  return face ?? undefined;
}

/**
 * The run's hAnsi face. A run that names an ascii face but no hAnsi face at any level takes
 * the document's slot default (`RUN_FONT_DEFAULTS`); one that names no Latin face at all keeps
 * its ascii face for both slots.
 */
function hAnsiFamily(props: readonly OoxmlProperty[], theme?: ThemeFonts): string | undefined {
  let family: string | undefined;
  let slotDefault: string | undefined;
  let namesLatin = false;
  let namesHAnsi = false;
  for (const prop of props) {
    const attrs = prop.attributes;
    if (prop.localName === RUN_FONT_DEFAULTS) {
      slotDefault = slotFace(attrs, theme) ?? slotDefault;
      continue;
    }
    if (prop.localName !== 'rFonts') continue;
    namesLatin ||= LATIN_FACE_ATTRIBUTES.some((name) => attrs?.[name] !== undefined);
    if (attrs?.hAnsi === undefined && attrs?.hAnsiTheme === undefined) continue;
    namesHAnsi = true;
    family = slotFace(attrs, theme) ?? family;
  }
  // A named hAnsi slot that resolves to no face keeps the run's ascii face, never the default.
  return family ?? (namesLatin && !namesHAnsi ? slotDefault : undefined);
}

/** The hAnsi ranges, after the East Asian pass has claimed the characters it draws. */
function usesHAnsi(code: number, hint: boolean): boolean {
  // The no-break space and the fixed-width spaces advance in the hAnsi face too.
  if (code < 0x80 || code > 0xffff) return false;
  if (
    (code >= 0x590 && code <= 0x7bf) ||
    (code >= 0xfb1d && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfefe)
  )
    return false;
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0x2ff0 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xdfff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xffef)
  )
    return false;
  if (
    hint &&
    (isEastAsiaHintSymbol(code) ||
      (code >= 0x2b0 && code <= 0x3cf) ||
      (code >= 0x400 && code <= 0x4ff) ||
      (code >= 0x2000 && code <= 0x27bf) ||
      (code >= 0x2e80 && code <= 0x2eff) ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0xfb00 && code <= 0xfb1c))
  )
    return false;
  // The hint's conditional ranges reach this pass only when the East Asian pass declined
  // them for the run's language and face, so they draw in the hAnsi face.
  return true;
}

/** Select hAnsi after the paragraph's existing East Asian slot pass. */
export function applyHAnsiFontSlots(
  pieces: FieldAwarePiece[],
  theme?: ThemeFonts
): FieldAwarePiece[] {
  const eligible = (piece: FieldAwarePiece) =>
    !piece.style.latinLane &&
    piece.fontSlot !== 'eastAsia' &&
    !isSymbolEncodedFamily(piece.style.fontFamily) &&
    !piece.positionalTab &&
    !piece.breakKind &&
    !piece.inlineDrawing &&
    !piece.anchoredAtom &&
    !piece.equation;
  // Skip Basic Latin and text which the previous pass already assigned to eastAsia.
  if (!pieces.some((piece) => eligible(piece) && /[^\u0000-\u007f]/.test(piece.text)))
    return pieces;
  let offset = 0;
  const text: string[] = [];
  const segments = pieces.map((piece) => {
    const participates = eligible(piece);
    const segment = participates && piece.text ? piece.text : '\u0000';
    const from = offset;
    offset += segment.length;
    text.push(segment);
    return {
      from,
      to: offset,
      eligible: participates,
      family: hAnsiFamily(piece.props, theme),
      hint: hasEastAsiaSymbolHint(piece.props),
    };
  });
  if (!segments.some((segment) => segment.eligible && segment.family)) return pieces;
  // Equal slots need no split. A mark at a run boundary can still inherit another face.
  if (
    !segments.some(
      (segment, index) =>
        segment.eligible &&
        segment.family &&
        (segment.family !== pieces[index]!.style.fontFamily ||
          (index > 0 && /^[\p{Mark}\u200d]/u.test(pieces[index]!.text)))
    )
  )
    return pieces;
  const rangesByPiece: { from: number; to: number; family: string | undefined }[][] = pieces.map(
    () => []
  );
  let first = 0;
  // Classify the complete stream once. A combining mark in another w:r must
  // keep the base character's face instead of starting another font cluster.
  for (const cluster of segmentGraphemes(text.join(''))) {
    while (first < segments.length && segments[first]!.to <= cluster.utf16From) first++;
    const base = segments[first];
    if (!base || !base.eligible) continue;
    const family = usesHAnsi(cluster.text.codePointAt(0)!, base.hint) ? base.family : undefined;
    for (
      let index = first;
      index < segments.length && segments[index]!.from < cluster.utf16To;
      index++
    ) {
      const segment = segments[index]!;
      if (!segment.eligible) continue;
      const from = Math.max(cluster.utf16From, segment.from) - segment.from;
      const to = Math.min(cluster.utf16To, segment.to) - segment.from;
      const ranges = rangesByPiece[index]!,
        tail = ranges.at(-1);
      if (tail && tail.family === family && tail.to === from) tail.to = to;
      else ranges.push({ from, to, family });
    }
  }
  let out: FieldAwarePiece[] | undefined;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!,
      ranges = rangesByPiece[index]!;
    const literal =
      !piece.projected &&
      !piece.fieldAtom &&
      !piece.noteNav &&
      piece.measureText === undefined &&
      piece.end - piece.start === piece.text.length;
    // A cached atomic field result draws its text per face like literal text, but every slice
    // keeps the atom's one model range.
    const atom =
      piece.projected === true &&
      piece.fieldAtom != null &&
      !piece.noteNav &&
      piece.measureText === undefined;
    if (
      !ranges.some((range) => range.family && range.family !== piece.style.fontFamily) ||
      (!literal && !atom && ranges.length !== 1)
    ) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    if (!literal && !atom) {
      out.push({
        ...piece,
        style: withFontFamily(piece.style, ranges[0]!.family!),
        fontSlot: 'hAnsi',
      });
      continue;
    }
    for (const range of ranges)
      out.push({
        ...piece,
        text: piece.text.slice(range.from, range.to),
        ...(literal ? { start: piece.start + range.from, end: piece.start + range.to } : {}),
        ...(range.family
          ? { style: withFontFamily(piece.style, range.family), fontSlot: 'hAnsi' as const }
          : {}),
      });
  }
  return out ?? pieces;
}
