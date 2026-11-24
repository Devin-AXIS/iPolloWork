// A horizontal rule takes the width of the line it sits on.
//
// The projection carries the rule with no width; the paragraph lays it out at its available
// width, as a bar or a shaded groove. The widened projection is cached per width, so layout
// caches keyed by projection identity see the same object on every pass.

import type {
  DrawingProjection,
  VectorShapeProjection,
} from '../store/package/drawing-projection.ts';
import { RULE_SHADE_HEX } from '../store/package/legacy-vml-rule.ts';
import type { InlineDrawingLayoutInput } from './drawing-layout.ts';

const EMU_PER_POINT = 12_700;
const widened = new WeakMap<InlineDrawingLayoutInput, Map<number, InlineDrawingLayoutInput>>();

function band(left: number, right: number, top: number, bottom: number, fillHex: string) {
  return Object.freeze({
    subpathsEmu: Object.freeze([
      Object.freeze([
        Object.freeze({ x: left, y: top }),
        Object.freeze({ x: right, y: top }),
        Object.freeze({ x: right, y: bottom }),
        Object.freeze({ x: left, y: bottom }),
      ]),
    ]),
    subpathsClosed: Object.freeze([true]),
    fillHex,
    fillAlpha: 1,
    strokeHex: null,
    strokeAlpha: 1,
    strokeWidthEmu: 0,
  });
}

function ruleShape(projection: DrawingProjection, cx: number): VectorShapeProjection | null {
  const rule = projection.horizontalRule;
  const cy = projection.extentEmu.cy;
  if (!rule || cx <= 0) return null;
  // The bar takes its share of the line at its alignment; the drawing keeps the whole line.
  const width =
    rule.widthPt !== undefined
      ? Math.min(cx, Math.round(rule.widthPt * EMU_PER_POINT))
      : Math.round(cx * rule.widthFraction);
  const left = Math.round((cx - width) * { left: 0, center: 0.5, right: 1 }[rule.align]);
  const right = left + width;
  // A shaded rule is a groove: the fill colour above, a light band below.
  const middle = Math.round(cy / 2);
  const components = rule.shaded
    ? [band(left, right, 0, middle, rule.fillHex), band(left, right, middle, cy, RULE_SHADE_HEX)]
    : [band(left, right, 0, cy, rule.fillHex)];
  const subpathsEmu = components.map((component) => component.subpathsEmu[0]!);
  return Object.freeze({
    extentEmu: Object.freeze({ cx, cy }),
    subpathsEmu: Object.freeze(subpathsEmu),
    fillHex: null,
    fillAlpha: 1,
    strokeHex: null,
    strokeAlpha: 1,
    strokeWidthEmu: 0,
    components: Object.freeze(components),
  });
}

/** The drawing input of a rule at `widthPt`; any other drawing is returned as it is. */
export function widenedRule(
  input: InlineDrawingLayoutInput,
  widthPt: number
): InlineDrawingLayoutInput {
  const projection = input.projection;
  if (!projection.horizontalRule) return input;
  const cx = Math.max(0, Math.round(widthPt * EMU_PER_POINT));
  let byWidth = widened.get(input);
  if (!byWidth) widened.set(input, (byWidth = new Map()));
  const hit = byWidth.get(cx);
  if (hit) return hit;
  const result = Object.freeze({
    ...input,
    projection: Object.freeze({
      ...projection,
      extentEmu: Object.freeze({ cx, cy: projection.extentEmu.cy }),
      vectorShape: ruleShape(projection, cx),
    }),
  });
  // A paragraph lays out at a handful of widths; keep the latest few.
  if (byWidth.size >= 8) byWidth.delete(byWidth.keys().next().value!);
  byWidth.set(cx, result);
  return result;
}

/** `pieces` with every rule widened to `widthPt`; the same array when none holds a rule. */
export function withRuleWidths<P extends { readonly inlineDrawing?: InlineDrawingLayoutInput }>(
  pieces: P[],
  widthPt: number
): P[] {
  if (!pieces.some((piece) => piece.inlineDrawing?.projection.horizontalRule)) return pieces;
  return pieces.map((piece) =>
    piece.inlineDrawing?.projection.horizontalRule
      ? { ...piece, inlineDrawing: widenedRule(piece.inlineDrawing, widthPt) }
      : piece
  );
}
