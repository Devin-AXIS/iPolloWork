// Display equations: `m:oMathPara` (ECMA-376 Part 1, §22.1.2.78).
//
// A display paragraph holds one or more `m:oMath` equations. The paragraph offset space
// treats the whole `m:oMathPara` as one atom, so typing beside it creates sibling runs
// and deleting it removes the complete display. Each inner `m:oMath` keeps its own id
// for equation editing.

import { OFFICE_MATH_NAMESPACE_URI, projectOmmlEquation } from './omml-equation.ts';
import type { EquationExpression, OmmlEquationProjection } from './omml-equation.ts';
import type { OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

/** Separator between equations that share one display paragraph. */
const DISPLAY_EQUATION_GAP = ' ';

const displayProjectionCache = new WeakMap<OoxmlGenericElementNode, OmmlEquationProjection>();

function isMath(node: OoxmlNode, localName: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
    node.localName === localName
  );
}

/** True for an `m:oMathPara` display equation. */
export function isOmmlDisplay(node: OoxmlNode): node is OoxmlGenericElementNode {
  return isMath(node, 'oMathPara');
}

/** True for a paragraph-level equation atom: `m:oMath` or `m:oMathPara`. */
export function isOmmlEquationAtom(node: OoxmlNode): node is OoxmlGenericElementNode {
  return isMath(node, 'oMath') || isMath(node, 'oMathPara');
}

/** The `m:oMath` equations of a display, or the equation itself for an inline `m:oMath`. */
export function equationsOfAtom(node: OoxmlNode): readonly OoxmlGenericElementNode[] {
  if (node.kind !== 'generic' || node.namespaceUri !== OFFICE_MATH_NAMESPACE_URI) return [];
  if (node.localName === 'oMath') return [node];
  if (node.localName !== 'oMathPara') return [];
  return node.children.filter((child): child is OoxmlGenericElementNode => isMath(child, 'oMath'));
}

/**
 * Project a display equation as one layout atom. A display with one equation keeps that
 * equation's projection, so the painted atom names the editable `m:oMath`. Several equations
 * share one row, separated by an em space.
 */
export function projectOmmlDisplay(node: OoxmlNode): OmmlEquationProjection | null {
  if (!isOmmlDisplay(node)) return null;
  const cached = displayProjectionCache.get(node);
  if (cached) return cached;
  const projections: OmmlEquationProjection[] = [];
  for (const equation of equationsOfAtom(node)) {
    const projection = projectOmmlEquation(equation);
    if (projection) projections.push(projection);
  }
  if (projections.length === 0) return null;
  let result: OmmlEquationProjection;
  if (projections.length === 1) {
    result = projections[0]!;
  } else {
    const items: EquationExpression[] = [];
    projections.forEach((projection, index) => {
      if (index > 0) items.push(Object.freeze({ kind: 'text', value: DISPLAY_EQUATION_GAP }));
      items.push(projection.expression);
    });
    // One shared run size sizes the display; otherwise it takes the surrounding size.
    const fontSizePt = projections[0]!.fontSizePt;
    const shared = projections.every((projection) => projection.fontSizePt === fontSizePt);
    result = Object.freeze({
      ...(shared && fontSizePt !== undefined ? { fontSizePt } : {}),
      sourceNodeId: projections[0]!.sourceNodeId,
      expression: Object.freeze({ kind: 'row', items: Object.freeze(items) }),
      fallbackText: projections.map((projection) => projection.fallbackText).join(' '),
      truncated: projections.some((projection) => projection.truncated),
      visitedNodes: projections.reduce((sum, projection) => sum + projection.visitedNodes, 0),
    });
  }
  displayProjectionCache.set(node, result);
  return result;
}

function isEmptyRun(node: OoxmlNode): boolean {
  return node.kind === 'run' && node.children.every((child) => child.kind === 'runProperties');
}

/**
 * The one equation atom (`m:oMath` or `m:oMathPara`) that is the only visible content of
 * `paragraph`, or null when the paragraph holds text, other content, or more than one
 * equation. Properties, empty runs, and bookmarks are not visible content.
 */
function soleEquationAtom(paragraph: {
  readonly children: readonly OoxmlNode[];
}): OoxmlGenericElementNode | null {
  let atom: OoxmlGenericElementNode | null = null;
  for (const child of paragraph.children) {
    if (isOmmlEquationAtom(child)) {
      if (atom !== null) return null;
      atom = child;
      continue;
    }
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraphProperties' || isEmptyRun(child)) continue;
    if (child.kind === 'bookmarkStart' || child.kind === 'bookmarkEnd') continue;
    return null;
  }
  return atom;
}

/**
 * True when the only visible content of `paragraph` is one equation. Such an equation is a
 * display equation even as a bare `m:oMath` without `m:oMathPara`: its n-ary operators
 * enlarge and follow the display limit rule, and its fractions take the display placement.
 */
export function soleParagraphEquation(paragraph: {
  readonly children: readonly OoxmlNode[];
}): boolean {
  return soleEquationAtom(paragraph) !== null;
}

/**
 * The physical justification of a paragraph whose only visible content is display math.
 * `m:oMathParaPr/m:jc` sets it; the default `centerGroup` centers the display. Returns null
 * when the paragraph also holds text or other content, which keeps the paragraph `w:jc`.
 */
export function displayMathAlignment(paragraph: {
  readonly children: readonly OoxmlNode[];
}): 'left' | 'center' | 'right' | null {
  const display = soleEquationAtom(paragraph);
  if (display === null || !isOmmlDisplay(display)) return null;
  const properties = display.children.find((child) => isMath(child, 'oMathParaPr'));
  const jc =
    properties && isMath(properties, 'oMathParaPr')
      ? properties.children.find((child) => isMath(child, 'jc'))
      : undefined;
  const value =
    jc && isMath(jc, 'jc')
      ? jc.attributes.find((attribute) => attribute.localName === 'val')?.value
      : undefined;
  if (value === 'left') return 'left';
  if (value === 'right') return 'right';
  return 'center';
}

/** Project a paragraph-level equation atom: inline `m:oMath` or display `m:oMathPara`. */
export function projectOmmlAtom(node: OoxmlNode): OmmlEquationProjection | null {
  return projectOmmlEquation(node) ?? projectOmmlDisplay(node);
}
