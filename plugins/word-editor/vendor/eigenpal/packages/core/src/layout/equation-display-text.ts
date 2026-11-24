// OMML stores ordinary letters and a separate mathematical style. Transform only
// the display string, so canonical text, editing offsets, and saves stay unchanged.
import type { EquationExpression } from '@docx-editor.dev/core/store';

type TextExpression = Extract<EquationExpression, { readonly kind: 'text' }>;
type MathStyle = 'p' | 'b' | 'i' | 'bi';

const GREEK_SYMBOLS = new Map([
  [0x3f4, 17],
  [0x2207, 25],
  [0x2202, 51],
  [0x3f5, 52],
  [0x3d1, 53],
  [0x3f0, 54],
  [0x3d5, 55],
  [0x3f1, 56],
  [0x3d6, 57],
]);

// The math face draws a hyphen-minus as the minus sign and an asterisk as the asterisk
// operator, so both have the width and height of the other binary operators.
const MATH_OPERATOR_GLYPHS = new Map([
  [0x2d, 0x2212],
  [0x2a, 0x2217],
]);

function mathOperatorText(value: string): string {
  return value.replace(/[-*]/g, (character) => (character === '-' ? '−' : '∗'));
}

function styledCodePoint(code: number, style: Exclude<MathStyle, 'p'>): number {
  const operator = MATH_OPERATOR_GLYPHS.get(code);
  if (operator !== undefined) return operator;
  const latin = style === 'b' ? 0x1d400 : style === 'i' ? 0x1d434 : 0x1d468;
  if (code >= 0x41 && code <= 0x5a) return latin + code - 0x41;
  if (code >= 0x61 && code <= 0x7a) {
    // Mathematical italic small h occupies the older letterlike-symbol slot.
    if (style === 'i' && code === 0x68) return 0x210e;
    return latin + 26 + code - 0x61;
  }
  if (style === 'i' && code === 0x131) return 0x1d6a4;
  if (style === 'i' && code === 0x237) return 0x1d6a5;
  if (style !== 'i' && code >= 0x30 && code <= 0x39) return 0x1d7ce + code - 0x30;
  const greek = style === 'b' ? 0x1d6a8 : style === 'i' ? 0x1d6e2 : 0x1d71c;
  if (code >= 0x391 && code <= 0x3a9 && code !== 0x3a2) return greek + code - 0x391;
  if (code >= 0x3b1 && code <= 0x3c9) return greek + 26 + code - 0x3b1;
  const symbol = GREEK_SYMBOLS.get(code);
  return symbol === undefined ? code : greek + symbol;
}

/** Internal display derivation; it does not change the source expression. */
export function equationDisplayText(
  expression: TextExpression,
  fontFamily: string | null
): {
  readonly text: string;
  readonly mathStyle: MathStyle | null;
  readonly mathematicalGlyphs: boolean;
} {
  const format = expression.format;
  if (format?.normalText)
    return { text: expression.value, mathStyle: null, mathematicalGlyphs: false };
  // m:sty defaults to i. Run bold and italic select faces of the run font; they
  // do not replace this mathematical style.
  const mathStyle = format?.mathStyle ?? 'i';
  if (mathStyle === 'p') {
    // Plain math keeps the authored face. The math face has no bold or italic
    // face, so only another family takes run bold and italic.
    const mathFace = fontFamily?.trim().toLowerCase() === 'cambria math';
    return mathFace
      ? { text: mathOperatorText(expression.value), mathStyle: 'p', mathematicalGlyphs: false }
      : { text: expression.value, mathStyle: null, mathematicalGlyphs: false };
  }
  // Text faces supply ordinary digits and their styled font programs in the
  // default italic style. Mathematical alphanumeric letters still use the math
  // face, including beside these digits. Bold math styles keep mathematical bold
  // digits from the math face.
  if (
    mathStyle === 'i' &&
    fontFamily &&
    fontFamily.trim().toLowerCase() !== 'cambria math' &&
    /^(?:[0-9]\p{M}*)+$/u.test(expression.value)
  ) {
    return { text: expression.value, mathStyle, mathematicalGlyphs: false };
  }
  // Styled letters become mathematical alphanumerics for every run face. The
  // caller draws them in the math face, because text faces lack these glyphs.
  const mathematicalGlyphs = true;
  const text = Array.from(expression.value, (character) =>
    String.fromCodePoint(styledCodePoint(character.codePointAt(0)!, mathStyle))
  ).join('');
  return { text, mathStyle, mathematicalGlyphs };
}
