// Geometry of an `m:d`: arguments between characters that grow to their height.

import type { EquationExpression } from '@docx-editor.dev/core/store';
import type { EquationGeometry, EquationTextGeometry } from './equation-layout.ts';
import { equationInk } from './equation-ink.ts';
import { box, shifted } from './equation-scripts.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

type DelimiterExpression = Extract<EquationExpression, { readonly kind: 'delimiter' }>;

/**
 * A character drawn scaled vertically by `scale` about the line `originY` below the top of
 * its box. The box keeps the font box of the unscaled character.
 */
export interface EquationStretch {
  /** The vertical scale, above 1. */
  readonly scale: number;
  /** The line that keeps its place, in points below the top of the box. */
  readonly originY: number;
}

export interface EquationDelimiterGeometry {
  readonly kind: 'delimiter';
  readonly box: LayoutBox;
  /** Baseline measured from this node's top edge. */
  readonly baseline: number;
  /**
   * The opening, separator, and closing characters that draw, in drawing order. A grown
   * character carries its `stretch`.
   */
  readonly fences: readonly EquationTextGeometry[];
  /** The arguments, in source order. */
  readonly items: readonly EquationGeometry[];
}

/**
 * The characters that grow: brackets, braces, and vertical bars. A grown glyph scales
 * vertically, which keeps these shapes. Any other character, such as a letter, an operator,
 * a slash, or an arrow, keeps its own size.
 */
const GROWING_CHARACTERS: ReadonlySet<string> = new Set([
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '‖', // ‖ double vertical line
  '∣', // ∣ divides
  '∥', // ∥ parallel to
  '⌈', // ⌈ left ceiling
  '⌉', // ⌉ right ceiling
  '⌊', // ⌊ left floor
  '⌋', // ⌋ right floor
  '⟦', // ⟦ left white square bracket
  '⟧', // ⟧ right white square bracket
  '⟨', // ⟨ left angle bracket
  '⟩', // ⟩ right angle bracket
  '⟪', // ⟪ left double angle bracket
  '⟫', // ⟫ right double angle bracket
]);

/**
 * Stretch `fence` so that its ink spans from `bottom` to `top`, heights above its baseline.
 * The character keeps its own size when its ink is already as tall.
 */
function grown(
  fence: EquationTextGeometry,
  top: number,
  bottom: number,
  measurer: TextMeasurer
): EquationTextGeometry {
  const ink = equationInk(fence, measurer);
  const height = ink.ascent + ink.descent;
  const scale = (top - bottom) / height;
  if (!(height > 0) || !(scale > 1)) return fence;
  // Scaling about this height above the baseline moves the ink bottom to `bottom` and the
  // ink top to `top`.
  const fixed = (bottom + ink.descent * scale) / (1 - scale);
  return Object.freeze({
    ...fence,
    stretch: Object.freeze({ scale, originY: fence.baseline - fixed }),
  });
}

/**
 * Lay out `items` between the characters that `fence` draws, on one baseline. A bracket,
 * brace, or bar grows to the ink of the arguments when `expression.grow` is on: centred on the math axis
 * `axis`, or matched to the ink when `expression.shape` is `match`.
 */
export function layoutDelimiter(
  expression: DelimiterExpression,
  items: readonly EquationGeometry[],
  fence: (character: string) => EquationTextGeometry,
  axis: number,
  measurer: TextMeasurer
): EquationDelimiterGeometry {
  let inkAscent = 0;
  let inkDescent = 0;
  for (const item of items) {
    const ink = equationInk(item, measurer);
    inkAscent = Math.max(inkAscent, ink.ascent);
    inkDescent = Math.max(inkDescent, ink.descent);
  }
  const half = Math.max(inkAscent - axis, inkDescent + axis);
  const [top, bottom] =
    expression.shape === 'match' ? [inkAscent, -inkDescent] : [axis + half, axis - half];
  const character = (value: string) => {
    if (!value) return null;
    const drawn = fence(value);
    return expression.grow && GROWING_CHARACTERS.has(value)
      ? grown(drawn, top, bottom, measurer)
      : drawn;
  };
  // Drawing order: the opening character, each argument after its separator, the closing one.
  const parts: { readonly node: EquationGeometry; readonly fence: boolean }[] = [];
  const push = (node: EquationGeometry | null, isFence: boolean) => {
    if (node) parts.push({ node, fence: isFence });
  };
  push(character(expression.opening), true);
  items.forEach((item, index) => {
    if (index > 0) push(character(expression.separator), true);
    push(item, false);
  });
  push(character(expression.closing), true);
  let ascent = 0;
  let descent = 0;
  for (const { node, fence: isFence } of parts) {
    ascent = Math.max(ascent, node.baseline);
    descent = Math.max(descent, node.box.height - node.baseline);
    if (isFence) {
      // A grown character reaches past its font box.
      const ink = equationInk(node, measurer);
      ascent = Math.max(ascent, ink.ascent);
      descent = Math.max(descent, ink.descent);
    }
  }
  let x = 0;
  const fences: EquationTextGeometry[] = [];
  const placed: EquationGeometry[] = [];
  for (const { node, fence: isFence } of parts) {
    const moved = shifted(node, x, ascent - node.baseline);
    if (isFence) fences.push(moved as EquationTextGeometry);
    else placed.push(moved);
    x += node.box.width;
  }
  return Object.freeze({
    kind: 'delimiter',
    box: box(0, 0, x, ascent + descent),
    baseline: ascent,
    fences: Object.freeze(fences),
    items: Object.freeze(placed),
  });
}
