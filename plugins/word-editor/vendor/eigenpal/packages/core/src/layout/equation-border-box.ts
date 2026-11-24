// Geometry of an `m:borderBox`: the body inside a ruled rectangle, with optional strikes.

import type { EquationExpression } from '@docx-editor.dev/core/store';
import type { EquationBorderBoxGeometry, EquationGeometry } from './equation-layout.ts';
import { equationInk } from './equation-ink.ts';
import { box, shifted } from './equation-scripts.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

/** The stroke of a box edge or strike, in ems of the structure size. */
const BOX_RULE_THICKNESS = 133 / 2048;
/** The gap between an edge and the ink of the body. */
const BOX_GAP = 345 / 2048;

type BorderBoxExpression = Extract<EquationExpression, { readonly kind: 'borderBox' }>;

/**
 * Lay out `body` inside the box. Each shown edge adds its gap and rule outside the body's
 * ink, so a shown edge can make the line taller, and a hidden edge adds nothing. The side
 * rules and the strikes span the whole box; the diagonals join its corners.
 */
export function layoutBorderBox(
  expression: BorderBoxExpression,
  body: EquationGeometry,
  em: number,
  measurer: TextMeasurer
): EquationBorderBoxGeometry {
  const thickness = BOX_RULE_THICKNESS * em;
  const pad = (hidden: boolean) => (hidden ? 0 : BOX_GAP * em + thickness);
  const { hidden, strikes } = expression;
  const ink = equationInk(body, measurer);
  // Offsets from the body baseline, downward.
  const frameTop = -(ink.ascent + pad(hidden.top));
  const frameBottom = ink.descent + pad(hidden.bottom);
  const top = Math.min(-body.baseline, frameTop);
  const bottom = Math.max(body.box.height - body.baseline, frameBottom);
  const left = pad(hidden.left);
  const width = left + body.box.width + pad(hidden.right);
  const y0 = frameTop - top;
  const y1 = frameBottom - top;
  const rules: LayoutBox[] = [];
  if (!hidden.top) rules.push(box(0, y0, width, thickness));
  if (!hidden.bottom) rules.push(box(0, y1 - thickness, width, thickness));
  if (!hidden.left) rules.push(box(0, y0, thickness, y1 - y0));
  if (!hidden.right) rules.push(box(width - thickness, y0, thickness, y1 - y0));
  if (strikes.horizontal) rules.push(box(0, (y0 + y1 - thickness) / 2, width, thickness));
  if (strikes.vertical) rules.push(box((width - thickness) / 2, y0, thickness, y1 - y0));
  const diagonals = [];
  if (strikes.bottomLeftToTopRight) diagonals.push(Object.freeze({ x1: 0, y1, x2: width, y2: y0 }));
  if (strikes.topLeftToBottomRight)
    diagonals.push(Object.freeze({ x1: 0, y1: y0, x2: width, y2: y1 }));
  return Object.freeze({
    kind: 'borderBox',
    body: shifted(body, left, -body.baseline - top),
    rules: Object.freeze(rules),
    diagonals: Object.freeze(diagonals),
    thickness,
    box: box(0, 0, width, bottom - top),
    baseline: -top,
  });
}
