// Paragraph indents from `w:ind`, bounded at the trust boundary. Split from
// paragraph-flow.ts, which re-exports these names so existing imports stay stable.

import {
  readTwipsMeasure,
  twips,
  twipsToPoints,
  type OoxmlProperty,
  type Twips,
} from '@docx-editor.dev/core/store';
import { paragraphIsRtl } from './rtl-paragraph.ts';

/**
 * Soft ceiling on an indent, in twips (31_680 ≈ 22"), matching the paragraph-spacing and
 * tab-position bounds. `w:ind` is attacker-controlled and flows straight into `rightEdge`
 * and the available line width, so an unbounded value reaches paint geometry.
 */
export const MAX_PARAGRAPH_INDENT_TWIPS = 31_680;

export function indentTwips(raw: string | undefined): Twips | null {
  // The shared reader accepts up to 9 integer digits, so an oversized authored value reaches
  // the clamp rather than being read as a measurement; a longer digit string is garbage.
  const authored = readTwipsMeasure(raw);
  if (authored === null) return null;
  if (authored > MAX_PARAGRAPH_INDENT_TWIPS) return twips(MAX_PARAGRAPH_INDENT_TWIPS);
  if (authored < -MAX_PARAGRAPH_INDENT_TWIPS) return twips(-MAX_PARAGRAPH_INDENT_TWIPS);
  return twips(authored);
}

export function paragraphIndent(props: readonly OoxmlProperty[]): {
  left: number;
  right: number;
} {
  let left = 0;
  let right = 0;
  const rtl = paragraphIsRtl(props);
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    // `w:left` and `w:start` are two spellings of the LEADING indent, and `w:right` and
    // `w:end` of the trailing one: in a right-to-left paragraph `w:left` indents from the
    // right margin (§17.3.1.12). The result is physical, so the sides swap there.
    const leading = property.attributes?.left ?? property.attributes?.start;
    const trailing = property.attributes?.right ?? property.attributes?.end;
    const rawLeft = rtl ? trailing : leading;
    const rawRight = rtl ? leading : trailing;
    const twipsLeft = indentTwips(rawLeft);
    const twipsRight = indentTwips(rawRight);
    if (twipsLeft !== null) left = twipsToPoints(twipsLeft);
    if (twipsRight !== null) right = twipsToPoints(twipsRight);
  }
  return { left, right };
}

/**
 * How far a paragraph's border box reaches past its text column on each physical side.
 *
 * The box opens where the first line starts when a hanging indent moves that line outward:
 * `w:left="1701" w:hanging="1701"` boxes from the margin, not from 1701 twips. A first-line
 * indent moves the line inward and leaves the box at the indent. The first line starts on
 * the paragraph's leading side, so a right-to-left paragraph reaches past its right edge,
 * also past the margin. The other side stays at its indent.
 */
export function paragraphBoxOutdent(
  indent: { readonly hanging: number; readonly firstLine: number },
  rtl: boolean
): { readonly left: number; readonly right: number } {
  const outward = Math.max(0, indent.hanging - indent.firstLine);
  return rtl ? { left: 0, right: outward } : { left: outward, right: 0 };
}
