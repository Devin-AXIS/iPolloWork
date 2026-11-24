// Ink extents of equation geometry. Script and bar placement keep clearances between drawn
// glyphs, not between font boxes, because a font box reaches far above and below its glyphs.
import type { EquationGeometry } from './equation-layout.ts';
import { segmentGraphemes } from './grapheme.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

/** Distances, in points, from a geometry's baseline to its highest and lowest ink. */
export interface EquationInk {
  /** Distance above the baseline. Negative when all ink is below the baseline. */
  readonly ascent: number;
  /** Distance below the baseline. Negative when all ink is above the baseline. */
  readonly descent: number;
  /** Some text reported no glyph ink, so its font box stands in for it. */
  readonly fromFontBox?: true;
}

function children(node: EquationGeometry): readonly EquationGeometry[] {
  switch (node.kind) {
    case 'text':
    case 'fallback':
      return [];
    case 'row':
      return node.items;
    case 'fraction':
      return [node.numerator, node.denominator];
    case 'radical':
      return node.degree ? [node.sign, node.radicand, node.degree] : [node.sign, node.radicand];
    case 'bar':
    case 'borderBox':
      return [node.body];
    case 'delimiter':
      return [...node.fences, ...node.items];
    case 'script':
      return [node.base, node.subscript, node.superscript].filter(
        (child): child is EquationGeometry => child !== undefined
      );
    case 'nary':
      return [node.operator, node.body, node.lowerLimit, node.upperLimit].filter(
        (child): child is EquationGeometry => child !== undefined
      );
  }
}

function rules(node: EquationGeometry): readonly LayoutBox[] {
  if (node.kind === 'borderBox') return node.rules;
  return node.kind === 'fraction' || node.kind === 'radical' || node.kind === 'bar'
    ? [node.bar]
    : [];
}

// Ink of one grapheme in one face, per measurer. Equations repeat a small set of letters,
// digits, and operators, so most reads hit. The bound keeps hostile documents finite.
const MAX_GRAPHEME_INK_ENTRIES = 8192;
const graphemeInkByMeasurer = new WeakMap<TextMeasurer, Map<string, EquationInk | null>>();
// Ink is relative to a node's baseline, so a shifted copy shares its source's entry.
const nodeInk = new WeakMap<EquationGeometry, EquationInk>();

function faceKey(style: ResolvedRunStyle): string {
  return [
    style.fontFamily ?? '',
    style.fontFamilyEastAsia ?? '',
    style.fontSizePt,
    style.bold ? 1 : 0,
    style.italic ? 1 : 0,
    style.caps ? 1 : 0,
    style.smallCaps ? 1 : 0,
    style.verticalAlign,
    style.horizontalScalePercent,
    style.shaping?.direction ?? '',
  ].join('|');
}

function graphemeInk(
  grapheme: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): EquationInk | null {
  let cache = graphemeInkByMeasurer.get(measurer);
  if (!cache) {
    cache = new Map();
    graphemeInkByMeasurer.set(measurer, cache);
  }
  const key = `${faceKey(style)}|${grapheme}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ink = measurer.textOutline?.(grapheme, style)?.ink;
  const result = ink ? Object.freeze({ ascent: -ink.top, descent: ink.bottom }) : null;
  if (cache.size >= MAX_GRAPHEME_INK_ENTRIES) cache.clear();
  cache.set(key, result);
  return result;
}

// Spaces, invisible operators (U+2061 to U+2064), and format characters draw no ink.
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]+$/u;

/** The text draws no ink: it holds only spaces, invisible operators, and format characters. */
export function isInvisibleEquationText(text: string): boolean {
  return INVISIBLE.test(text);
}

/**
 * Vertical ink of a text run: the union of its graphemes. Invisible graphemes add nothing.
 * Null when no grapheme has ink, or when a visible grapheme has none (a missing glyph).
 */
function textInk(
  text: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): EquationInk | null {
  if (!measurer.textOutline) return null;
  let ascent = Number.NEGATIVE_INFINITY;
  let descent = Number.NEGATIVE_INFINITY;
  for (const segment of segmentGraphemes(text)) {
    const ink = graphemeInk(segment.text, style, measurer);
    if (!ink) {
      if (INVISIBLE.test(segment.text)) continue;
      return null;
    }
    ascent = Math.max(ascent, ink.ascent);
    descent = Math.max(descent, ink.descent);
  }
  return Number.isFinite(ascent) && Number.isFinite(descent) ? { ascent, descent } : null;
}

/** Give a shifted copy of `from` the ink already measured for `from`. */
export function inheritEquationInk(from: EquationGeometry, to: EquationGeometry): void {
  const ink = nodeInk.get(from);
  if (ink) nodeInk.set(to, ink);
}

/**
 * The ink extents of `node`, measured from its baseline.
 *
 * Text uses the glyph ink that the measurer reports through `textOutline`, read once per
 * grapheme and face. A measurer that cannot report ink gives the font box instead, so
 * clearances stay conservative. Child positions and rules (fraction, radical, and bar strokes)
 * are included. Each node is measured once; geometry belongs to the measurer that laid it out.
 */
export function equationInk(node: EquationGeometry, measurer: TextMeasurer): EquationInk {
  const cached = nodeInk.get(node);
  if (cached) return cached;
  const ink = Object.freeze(measureInk(node, measurer));
  nodeInk.set(node, ink);
  return ink;
}

function measureInk(node: EquationGeometry, measurer: TextMeasurer): EquationInk {
  if (node.kind === 'text' || node.kind === 'fallback') {
    const ink = (node.text && node.runStyle
      ? textInk(node.text, node.runStyle, measurer)
      : null) ?? {
      ascent: node.baseline,
      descent: node.box.height - node.baseline,
      fromFontBox: true as const,
    };
    const stretch = node.kind === 'text' ? node.stretch : undefined;
    if (!stretch) return ink;
    // A grown character scales about a fixed height above its baseline.
    const fixed = node.baseline - stretch.originY;
    return {
      ...ink,
      ascent: fixed + (ink.ascent - fixed) * stretch.scale,
      descent: (ink.descent + fixed) * stretch.scale - fixed,
    };
  }
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let fromFontBox = false;
  for (const child of children(node)) {
    const ink = equationInk(child, measurer);
    fromFontBox ||= ink.fromFontBox === true;
    const baseline = child.box.y + child.baseline;
    top = Math.min(top, baseline - ink.ascent);
    bottom = Math.max(bottom, baseline + ink.descent);
  }
  for (const stroke of rules(node)) {
    if (stroke.height <= 0) continue;
    top = Math.min(top, stroke.y);
    bottom = Math.max(bottom, stroke.y + stroke.height);
  }
  if (top > bottom) return { ascent: 0, descent: 0 };
  return {
    ascent: node.baseline - top,
    descent: bottom - node.baseline,
    ...(fromFontBox ? { fromFontBox: true as const } : {}),
  };
}

/** The top of lowercase letters, in ems of their size. */
const LOWERCASE_HEIGHT = 976 / 2048;

/**
 * The highest top of lowercase text in `node`, in points above its baseline.
 *
 * Text gives the lowercase height of its size, whatever its glyphs, so an ascender does not
 * raise it. A structure gives the highest top among the parts above its baseline: the base and
 * superscript of a script, the radicand of a radical, the operator, body, and upper limit of an
 * n-ary operator, and every part of other structures.
 */
export function equationLowercaseTop(node: EquationGeometry): number {
  if (node.kind === 'text' || node.kind === 'fallback') return LOWERCASE_HEIGHT * node.fontSizePt;
  const parts =
    node.kind === 'script'
      ? [node.base, node.superscript]
      : node.kind === 'radical'
        ? [node.radicand]
        : node.kind === 'nary'
          ? [node.operator, node.body, node.upperLimit]
          : children(node);
  return parts.reduce(
    (top: number, child) =>
      child
        ? Math.max(
            top,
            node.baseline - (child.box.y + child.baseline) + equationLowercaseTop(child)
          )
        : top,
    0
  );
}
