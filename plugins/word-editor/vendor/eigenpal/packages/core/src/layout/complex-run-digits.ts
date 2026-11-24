// European digits in a complex-script run.
//
// A `w:rtl` or `w:cs` run takes its face, size and weight from the complex-script lane, but its
// European digits draw in the run's Latin face. Measured with ascii/hAnsi Liberation Sans and cs
// Noto Sans Arabic at 12pt: "15 15 15" in a `w:rtl` run steps 13.7937pt with the digits in
// Liberation Sans, bold or not, with or without `w:rtl`; the same digits beside Arabic letters
// keep Liberation Sans while the letters take Noto Sans Arabic and its 25.34pt line. Spaces,
// even between digit groups, ASCII punctuation and Latin letters all stay in the complex-script
// face; a space adds no line height, so "15 15 15" keeps the Latin face's line. Only the face
// changes here: the digits keep the run's complex-script size and weight.
//
// Measured with an Arabic bidi language (`w:lang w:bidi="ar-JO"`). Hebrew text kept its digits
// in the complex-script face across the corpus, so the rule applies to Arabic-script languages.

import type { FieldAwarePiece } from './field-pieces.ts';
import { withFontFamily } from './run-style.ts';
import { isSymbolEncodedFamily } from './symbol-encoding.ts';
import { arabicScriptLanguage } from './arabic-script-language.ts';

const isEuropeanDigit = (code: number) => code >= 0x30 && code <= 0x39;

/** Split each complex-script piece so its European digits measure and paint in the Latin face. */
export function applyComplexRunDigitFaces(pieces: FieldAwarePiece[]): FieldAwarePiece[] {
  let out: FieldAwarePiece[] | undefined;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const latin = piece.style.latinLane?.fontFamily;
    const literal =
      !piece.projected &&
      !piece.fieldAtom &&
      !piece.noteNav &&
      !piece.positionalTab &&
      !piece.breakKind &&
      !piece.inlineDrawing &&
      !piece.anchoredAtom &&
      !piece.equation &&
      piece.measureText === undefined &&
      piece.end - piece.start === piece.text.length;
    if (
      !latin ||
      latin === piece.style.fontFamily ||
      !literal ||
      isSymbolEncodedFamily(piece.style.fontFamily) ||
      isSymbolEncodedFamily(latin) ||
      !/[0-9]/.test(piece.text) ||
      !arabicScriptLanguage(piece.props)
    ) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    const latinStyle = withFontFamily(piece.style, latin);
    const latinAt = Array.from(piece.text, (_, at) => isEuropeanDigit(piece.text.charCodeAt(at)));
    let from = 0;
    while (from < piece.text.length) {
      const digits = latinAt[from]!;
      let to = from + 1;
      while (to < piece.text.length && latinAt[to] === digits) to++;
      out.push({
        ...piece,
        text: piece.text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
        ...(digits ? { style: latinStyle, fontSlot: 'ascii' as const } : {}),
      });
      from = to;
    }
  }
  return out ?? pieces;
}
