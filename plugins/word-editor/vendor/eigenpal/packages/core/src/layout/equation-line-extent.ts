// The vertical extent that an equation claims on its line.
import type { EquationGeometry } from './equation-layout.ts';
import { equationInk, isInvisibleEquationText } from './equation-ink.ts';
import { box, shifted } from './equation-scripts.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

/** The space kept above the ink of the math, in ems of the first atom size (`MathLeading`). */
const MATH_LEADING = 300 / 2048;

/** A font box on the equation baseline: its height and the baseline from its top. */
export interface EquationTextBand {
  readonly height: number;
  readonly baseline: number;
}

/** One part that claims height, with its baseline offset below the equation baseline. */
interface Claimant {
  readonly node: EquationGeometry;
  readonly offset: number;
  /** How many script levels the part sits below the equation: scripts and limits add one. */
  readonly depth: number;
  /** The part claims its whole box, as the operator of an n-ary structure does. */
  readonly boxOnly?: true;
}

/**
 * The script levels that a script argument adds: one for plain text, and two for an argument
 * that holds a structure, whose parts then claim like a script of a script.
 */
function scriptLevels(part: EquationGeometry | undefined): number {
  const plain = (node: EquationGeometry): boolean =>
    node.kind === 'text' || (node.kind === 'row' && node.items.every(plain));
  return part && !plain(part) ? 2 : 1;
}

/** Integral signs: an inline integral keeps its whole box on the line. */
const INTEGRALS = /^[\u222b-\u2233\u2a0b-\u2a1c]$/u;

/**
 * Collect the parts that claim height. Rows, scripts, and fractions open into their parts, so
 * every script and fraction part claims for itself. An inline n-ary operator other than an
 * integral opens too: its operator claims its box, and its limits and body claim for
 * themselves. Other structures claim as one part.
 */
function collectClaimants(
  node: EquationGeometry,
  top: number,
  baseline: number,
  display: boolean,
  claimants: Claimant[],
  depth = 0
): void {
  const offsetOf = (part: EquationGeometry) => top + part.box.y + part.baseline - baseline;
  const open = (part: EquationGeometry | undefined, level: number) => {
    if (part) collectClaimants(part, top + part.box.y, baseline, display, claimants, level);
  };
  switch (node.kind) {
    case 'row':
      for (const item of node.items) open(item, depth);
      return;
    case 'script':
      open(node.base, depth);
      open(node.subscript, depth + scriptLevels(node.subscript));
      open(node.superscript, depth + scriptLevels(node.superscript));
      return;
    case 'delimiter':
      // The arguments claim like any other part, and each character claims as text.
      for (const item of node.items) open(item, depth);
      for (const fence of node.fences) open(fence, depth);
      return;
    case 'borderBox':
      // The body claims like any other part; the box adds a claim for its own rules.
      open(node.body, depth);
      if (node.rules.length > 0)
        claimants.push({ node, offset: top + node.baseline - baseline, depth });
      return;
    case 'fraction':
      if (display) break;
      open(node.numerator, depth);
      open(node.denominator, depth);
      return;
    case 'nary':
      if (display || INTEGRALS.test(node.operator.text)) break;
      claimants.push({
        node: node.operator,
        offset: offsetOf(node.operator),
        depth,
        boxOnly: true,
      });
      open(node.lowerLimit, depth + 1);
      open(node.upperLimit, depth + 1);
      open(node.body, depth);
      return;
    default:
      break;
  }
  claimants.push({ node, offset: top + node.baseline - baseline, depth });
}

/** `node` with a new `baseline` and `height`: its parts move down by the change in baseline. */
function withExtent(node: EquationGeometry, baseline: number, height: number): EquationGeometry {
  const dy = baseline - node.baseline;
  const move = <T extends EquationGeometry>(part: T): T =>
    shifted(part, part.box.x, part.box.y + dy);
  const extent = { box: box(node.box.x, node.box.y, node.box.width, height), baseline };
  const rule = (stroke: LayoutBox) => box(stroke.x, stroke.y + dy, stroke.width, stroke.height);
  switch (node.kind) {
    case 'row':
      return Object.freeze({ ...node, ...extent, items: Object.freeze(node.items.map(move)) });
    case 'script':
      return Object.freeze({
        ...node,
        ...extent,
        base: move(node.base),
        ...(node.subscript ? { subscript: move(node.subscript) } : {}),
        ...(node.superscript ? { superscript: move(node.superscript) } : {}),
      });
    case 'fraction':
      return Object.freeze({
        ...node,
        ...extent,
        numerator: move(node.numerator),
        denominator: move(node.denominator),
        bar: rule(node.bar),
      });
    case 'nary':
      return Object.freeze({
        ...node,
        ...extent,
        operator: move(node.operator),
        body: move(node.body),
        ...(node.lowerLimit ? { lowerLimit: move(node.lowerLimit) } : {}),
        ...(node.upperLimit ? { upperLimit: move(node.upperLimit) } : {}),
      });
    case 'bar':
      return Object.freeze({ ...node, ...extent, body: move(node.body), bar: rule(node.bar) });
    case 'delimiter':
      return Object.freeze({
        ...node,
        ...extent,
        fences: Object.freeze(node.fences.map(move)),
        items: Object.freeze(node.items.map(move)),
      });
    case 'borderBox':
      return Object.freeze({
        ...node,
        ...extent,
        body: move(node.body),
        rules: Object.freeze(node.rules.map(rule)),
        diagonals: Object.freeze(
          node.diagonals.map((line) =>
            Object.freeze({ ...line, y1: line.y1 + dy, y2: line.y2 + dy })
          )
        ),
      });
    case 'radical':
      return Object.freeze({
        ...node,
        ...extent,
        sign: move(node.sign),
        radicand: move(node.radicand),
        ...(node.degree ? { degree: move(node.degree) } : {}),
        bar: rule(node.bar),
      });
    default:
      // A text or fallback part moves inside a row of its own.
      return Object.freeze({ kind: 'row', items: Object.freeze([move(node)]), ...extent });
  }
}

/** The font box of each equation whose extent this module fitted; see {@link equationTextBand}. */
const textBands = new WeakMap<EquationGeometry, EquationTextBand>();

/**
 * The text height that an equation gives its line for multiple line spacing: the font box of
 * its first atom, or of the structure size when a structure opens the equation. Undefined for
 * geometry that {@link fitEquationLineExtent} did not return.
 */
export function equationTextBand(geometry: EquationGeometry): EquationTextBand | undefined {
  return textBands.get(geometry);
}

/**
 * Fit the outer node of an equation to the extent that it claims on its line.
 *
 * The equation claims the font box `band` on its baseline: the box of its first text atom, or
 * of the structure size when a structure opens it. Every other part claims only its glyph
 * ink, plus the math leading above the ink, and never more than its own font box. The leading
 * takes the smaller of `leadingSizePt` and the part's own size, and `leadingSizePt` for a
 * script of a script. Script and fraction parts claim for themselves at their own positions,
 * so a large script raises the line by its ink, not by its font box. The limits and body of an
 * inline n-ary structure other than an integral claim the same way, and its operator claims
 * its box. A fraction of a `display` equation keeps its padded box. Text that draws nothing,
 * such as a space, claims no height. Other structures claim their boxes. A text part without
 * measured ink keeps its font box.
 *
 * The result is `root` itself when the extent does not change.
 */
export function fitEquationLineExtent(
  root: EquationGeometry,
  band: EquationTextBand,
  leadingSizePt: number,
  measurer: TextMeasurer,
  display = false
): EquationGeometry {
  const claimants: Claimant[] = [];
  collectClaimants(root, 0, root.baseline, display, claimants);
  const first = claimants[0];
  if (!first) return root;
  // A first text atom is the band itself, on the baseline.
  const opensWithText = first.node.kind === 'text' && first.offset === 0 && !first.node.stretch;
  let ascent = band.baseline;
  let descent = band.height - band.baseline;
  for (const [index, { node, offset, depth, boxOnly }] of claimants.entries()) {
    if (index === 0 && opensWithText) continue;
    // Later text that draws nothing, such as a larger space, claims no height.
    if (node.kind === 'text' && isInvisibleEquationText(node.text)) continue;
    let nodeAscent = node.baseline;
    let nodeDescent = node.box.height - node.baseline;
    // A fraction part stands in a box of the face's typographic ascent; its claim may still
    // reach the ascent of its font box.
    if (node.kind === 'text' && !boxOnly && node.runStyle)
      nodeAscent = Math.max(nodeAscent, measurer.lineMetrics(node.runStyle).baseline);
    // Ink can only lower a claim, so read it only for a box that reaches past the extent.
    if (
      node.kind === 'text' &&
      !boxOnly &&
      (nodeAscent - offset > ascent || nodeDescent + offset > descent)
    ) {
      const ink = equationInk(node, measurer);
      if (!ink.fromFontBox) {
        // The leading takes the smaller of the first atom size and the part's own size. A
        // script of a script takes the leading of the first atom size.
        const sizePt = depth >= 2 ? leadingSizePt : Math.min(leadingSizePt, node.fontSizePt);
        const leading = MATH_LEADING * sizePt;
        nodeAscent = Math.min(nodeAscent, ink.ascent + leading);
        nodeDescent = Math.min(nodeDescent, ink.descent);
      }
    }
    // A grown delimiter character claims its scaled ink, with the math leading above it.
    if (node.kind === 'text' && node.stretch) {
      const ink = equationInk(node, measurer);
      nodeAscent = ink.ascent + MATH_LEADING * Math.min(leadingSizePt, node.fontSizePt);
      nodeDescent = ink.descent;
    }
    // A border box claims the extent of its rules, with the math leading above them.
    if (node.kind === 'borderBox') {
      let ruleTop = Number.POSITIVE_INFINITY;
      let ruleBottom = Number.NEGATIVE_INFINITY;
      for (const rule of node.rules) {
        ruleTop = Math.min(ruleTop, rule.y);
        ruleBottom = Math.max(ruleBottom, rule.y + rule.height);
      }
      nodeAscent = node.baseline - ruleTop + MATH_LEADING * leadingSizePt;
      nodeDescent = ruleBottom - node.baseline;
    }
    ascent = Math.max(ascent, nodeAscent - offset);
    descent = Math.max(descent, nodeDescent + offset);
  }
  const rootDescent = root.box.height - root.baseline;
  const fitted =
    ascent === root.baseline && descent === rootDescent
      ? root
      : withExtent(root, ascent, ascent + descent);
  textBands.set(fitted, band);
  return fitted;
}
