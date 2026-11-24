// The style and layout inputs of one paragraph-level equation atom.

import type { OmmlEquationProjection } from '@docx-editor.dev/core/store';
import { equationRunStyle, type EquationLayoutInput } from './equation-layout.ts';
import type { ResolvedRunStyle } from './run-style.ts';

/** An equation atom: its run style and the fields its layout piece carries. */
export interface EquationAtom {
  readonly style: ResolvedRunStyle;
  readonly extras: {
    readonly equation: OmmlEquationProjection;
    readonly equationLayout: EquationLayoutInput;
  };
}

/**
 * Describe the equation atom projected as `equation`, among text styled `text`. `display` is
 * true for an `m:oMathPara` and for an equation that is the only visible content of its
 * paragraph; it selects the display placement of n-ary limits and fractions. Runs
 * that share one default `w:sz` size the equation; otherwise it takes the text size.
 * Structures without a control size take the text size either way. The inputs that do not
 * live on the shared projection travel as data on the piece, so a piece whose style is
 * rebuilt, as bidi resolution does, keeps them.
 */
export function equationAtom(
  equation: OmmlEquationProjection,
  text: ResolvedRunStyle,
  display: boolean
): EquationAtom {
  const { fontSizePt } = equation;
  const equationLayout: EquationLayoutInput = Object.freeze({
    display,
    surroundingSizePt: text.fontSizePt,
    textFontFamily: text.fontFamily,
  });
  return {
    style: equationRunStyle(fontSizePt === undefined ? text : { ...text, fontSizePt }),
    extras: { equation, equationLayout },
  };
}
