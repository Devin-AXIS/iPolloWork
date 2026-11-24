// Bounded Office Math projection and compact linear-math conversion.
//
// OMML stays generic in the canonical tree. This module reads that preserved source into a
// small immutable expression tree and creates fresh generic OMML for supported user input.

import { XML_NAMESPACE_URI } from './ooxml-shared.ts';
import {
  equationControlFontSizePt,
  equationRunFormat,
  equationMathChild as namedChild,
  equationMathChildren as namedChildren,
} from './omml-run-format.ts';
import {
  DEFAULT_DELIMITER_CHARACTERS,
  DELIMITER_CHARACTERS,
  delimiterCharacter,
  equationStructureHasControlProperties,
  isSupportedExpressionNode,
  mathOnOff,
  mathVal,
} from './omml-structure-support.ts';
import {
  cloneEquationControl,
  equationDefaultFormatting,
  equationSharedRunSizePt,
} from './omml-control-defaults.ts';
import { isValidXmlText } from './sinks.ts';
import { renderReversibleLinearMath } from './linear-math-render.ts';
import type {
  OoxmlAttribute,
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlNodeId,
} from './ooxml-tree.ts';

/** Office Math Markup Language namespace. */
export const OFFICE_MATH_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/math';

export const DEFAULT_OMML_LIMITS = Object.freeze({
  maxDepth: 24,
  maxNodes: 256,
  maxTextLength: 512,
});

/** The operator of an `m:nary` that names no `m:chr`. */
const DEFAULT_NARY_OPERATOR = '\u222b';

/** Shared work limits for untrusted OMML and linear-math input. */
export interface OmmlLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxTextLength?: number;
}

export type {
  EquationBoxEdges,
  EquationBoxStrikes,
  EquationControlSource,
  EquationExpression,
} from './omml-equation-expression.ts';
import type { EquationControlSource, EquationExpression } from './omml-equation-expression.ts';

export interface OmmlEquationProjection {
  readonly sourceNodeId: OoxmlNodeId;
  readonly expression: EquationExpression;
  readonly fallbackText: string;
  readonly truncated: boolean;
  readonly visitedNodes: number;
  /**
   * The font size, in points, that every run of the equation shares through default run
   * properties (`w:sz`). Individual run sizes remain on their text expressions. Without a
   * shared size, structural spacing takes the size of the surrounding text.
   */
  readonly fontSizePt?: number;
}

/**
 * Canonical nodes are immutable and edits preserve untouched child identity.
 *
 * Cache the default projection by source identity. Typing beside an equation can relayout its
 * paragraph many times, but it must not walk the same bounded OMML tree twice per keystroke.
 * Weak keys release the projection with the document revision that owned the source node.
 */
const defaultProjectionCache = new WeakMap<OoxmlGenericElementNode, OmmlEquationProjection>();
const DEFAULT_LINEAR_CACHE_LIMIT = 64;
const defaultLinearMathCache = new Map<string, LinearMathParseResult>();
const reversibleLinearMathCache = new WeakMap<EquationExpression, string>();

export type LinearMathRejection =
  'empty' | 'invalid-syntax' | 'invalid-xml-text' | 'depth-limit' | 'node-limit' | 'text-limit';

export type LinearMathParseResult =
  | { readonly ok: true; readonly expression: EquationExpression }
  | { readonly ok: false; readonly reason: LinearMathRejection };

export type LinearMathOmmlResult =
  | {
      readonly ok: true;
      readonly expression: EquationExpression;
      readonly equation: OoxmlGenericElementNode;
    }
  | { readonly ok: false; readonly reason: LinearMathRejection };

interface ResolvedLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTextLength: number;
}

function resolveLimits(limits: OmmlLimits | undefined): ResolvedLimits {
  const positiveInteger = (value: number | undefined, fallback: number): number =>
    Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
  return {
    maxDepth: positiveInteger(limits?.maxDepth, DEFAULT_OMML_LIMITS.maxDepth),
    maxNodes: positiveInteger(limits?.maxNodes, DEFAULT_OMML_LIMITS.maxNodes),
    maxTextLength: positiveInteger(limits?.maxTextLength, DEFAULT_OMML_LIMITS.maxTextLength),
  };
}

function isMathElement(node: OoxmlNode, localName?: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
    (localName === undefined || node.localName === localName)
  );
}

function frozenRow(children: readonly EquationExpression[]): EquationExpression {
  if (children.length === 1) return children[0]!;
  return Object.freeze({ kind: 'row', items: Object.freeze([...children]) });
}

function childrenOf(node: OoxmlElement): readonly OoxmlNode[] {
  return node.children;
}

interface ProjectionState {
  readonly limits: ResolvedLimits;
  /** Every `m:ctrlPr` of the equation is default, so structures carry no control mark. */
  readonly defaultControls?: boolean;
  /** Every run of the equation carries default `w:rPr`, so runs carry no format. */
  readonly defaultRuns?: boolean;
  visitedNodes: number;
  text: string;
  truncated: boolean;
}

function appendProjectionText(state: ProjectionState, value: string): string {
  const room = state.limits.maxTextLength - state.text.length;
  if (room <= 0) {
    if (value.length > 0) state.truncated = true;
    return '';
  }
  const accepted = value.slice(0, room);
  state.text += accepted;
  if (accepted.length !== value.length) state.truncated = true;
  return accepted;
}

function enterProjectionNode(state: ProjectionState, depth: number): boolean {
  if (depth > state.limits.maxDepth || state.visitedNodes >= state.limits.maxNodes) {
    state.truncated = true;
    return false;
  }
  state.visitedNodes += 1;
  return true;
}

function fallbackOf(node: OoxmlNode, state: ProjectionState, depth: number): EquationExpression {
  const start = state.text.length;
  collectFallbackText(node, state, depth);
  const text = state.text.slice(start);
  return Object.freeze({ kind: 'fallback', text: text || (state.truncated ? '…' : '') });
}

/** The `m:val` of one `m:naryPr` property of an `m:nary`, when present. */
function naryProperty(node: OoxmlGenericElementNode, name: string): string | undefined {
  const property = namedChild(node, 'naryPr');
  return (property ? namedChild(property, name) : null)?.attributes.find(
    (attribute) =>
      attribute.namespaceUri === OFFICE_MATH_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
}

/** The operator an `m:nary` draws. Without `m:chr` it stands for an integral. */
function naryOperator(node: OoxmlGenericElementNode): string {
  return naryProperty(node, 'chr') ?? DEFAULT_NARY_OPERATOR;
}

function collectFallbackText(node: OoxmlNode, state: ProjectionState, depth: number): void {
  if (!enterProjectionNode(state, depth)) return;
  if (node.kind === 'textValue') {
    appendProjectionText(state, node.value);
    return;
  }
  // The operator of an n-ary structure and the characters of a delimiter are properties, not
  // text, but they are drawn.
  if (isMathElement(node, 'nary')) appendProjectionText(state, naryOperator(node));
  const delimiter = isMathElement(node, 'd') ? node : null;
  if (delimiter) appendProjectionText(state, delimiterCharacter(delimiter, 'begChr'));
  let argument = 0;
  for (const child of childrenOf(node)) {
    if (delimiter && isMathElement(child, 'e') && argument++ > 0)
      appendProjectionText(state, delimiterCharacter(delimiter, 'sepChr'));
    collectFallbackText(child, state, depth + 1);
    if (state.truncated && state.text.length >= state.limits.maxTextLength) return;
  }
  if (delimiter) appendProjectionText(state, delimiterCharacter(delimiter, 'endChr'));
}

function projectContainer(
  node: OoxmlGenericElementNode,
  state: ProjectionState,
  depth: number,
  skipLocalName?: string
): EquationExpression {
  const expressions: EquationExpression[] = [];
  for (const child of childrenOf(node)) {
    if (skipLocalName && isMathElement(child, skipLocalName)) continue;
    expressions.push(projectNode(child, state, depth + 1));
  }
  return frozenRow(expressions);
}

function controlSource(
  node: OoxmlGenericElementNode,
  propertyName: string,
  state: ProjectionState
): EquationControlSource {
  const property = namedChild(node, propertyName);
  const control = property ? namedChild(property, 'ctrlPr') : null;
  const controlFontSizePt = control ? equationControlFontSizePt(control) : undefined;
  return {
    ...(!state.defaultControls && equationStructureHasControlProperties(node, propertyName)
      ? { controlProperties: true as const }
      : {}),
    ...(controlFontSizePt === undefined ? {} : { controlFontSizePt }),
  };
}

function projectStructured(
  node: OoxmlGenericElementNode,
  state: ProjectionState,
  depth: number
): EquationExpression | null {
  if (!isSupportedExpressionNode(node)) return null;
  if (node.localName === 'bar') {
    const property = namedChild(node, 'barPr');
    const position = property ? namedChild(property, 'pos') : null;
    return Object.freeze({
      kind: 'bar',
      body: projectContainer(namedChildren(node, 'e')[0]!, state, depth + 1),
      position: position && mathVal(position) === 'top' ? 'top' : 'bottom',
      ...controlSource(node, 'barPr', state),
    });
  }
  if (node.localName === 'borderBox') {
    const property = namedChild(node, 'borderBoxPr');
    const flag = (name: string) => (property ? mathOnOff(namedChild(property, name)) : false);
    return Object.freeze({
      kind: 'borderBox',
      body: projectContainer(namedChildren(node, 'e')[0]!, state, depth + 1),
      hidden: Object.freeze({
        top: flag('hideTop'),
        bottom: flag('hideBot'),
        left: flag('hideLeft'),
        right: flag('hideRight'),
      }),
      strikes: Object.freeze({
        horizontal: flag('strikeH'),
        vertical: flag('strikeV'),
        bottomLeftToTopRight: flag('strikeBLTR'),
        topLeftToBottomRight: flag('strikeTLBR'),
      }),
      ...controlSource(node, 'borderBoxPr', state),
    });
  }
  if (node.localName === 'd') {
    // The characters join the projected text in drawing order, as the fallback scan reads them.
    const opening = delimiterCharacter(node, 'begChr');
    const separator = delimiterCharacter(node, 'sepChr');
    const closing = delimiterCharacter(node, 'endChr');
    const property = namedChild(node, 'dPr');
    const grow = property ? namedChild(property, 'grow') : null;
    const shape = property ? namedChild(property, 'shp') : null;
    appendProjectionText(state, opening);
    const items = namedChildren(node, 'e').map((argument, index) => {
      if (index > 0) appendProjectionText(state, separator);
      return projectContainer(argument, state, depth + 1);
    });
    appendProjectionText(state, closing);
    return Object.freeze({
      kind: 'delimiter',
      opening,
      closing,
      separator,
      items: Object.freeze(items),
      grow: grow === null || mathOnOff(grow),
      shape: shape && mathVal(shape) === 'match' ? 'match' : 'centered',
      ...controlSource(node, 'dPr', state),
    });
  }
  if (node.localName === 'f') {
    const numerator = namedChild(node, 'num');
    const denominator = namedChild(node, 'den');
    if (!numerator || !denominator) return null;
    return Object.freeze({
      kind: 'fraction',
      numerator: projectContainer(numerator, state, depth + 1),
      denominator: projectContainer(denominator, state, depth + 1),
      ...controlSource(node, 'fPr', state),
    });
  }
  if (node.localName === 'rad') {
    const radicand = namedChild(node, 'e');
    if (!radicand) return null;
    const degree = namedChild(node, 'deg');
    const projectedDegree =
      degree && childrenOf(degree).length > 0
        ? projectContainer(degree, state, depth + 1)
        : undefined;
    return Object.freeze({
      kind: 'radical',
      radicand: projectContainer(radicand, state, depth + 1),
      ...(projectedDegree === undefined ? {} : { degree: projectedDegree }),
      ...controlSource(node, 'radPr', state),
    });
  }
  if (node.localName === 'sSup' || node.localName === 'sSub' || node.localName === 'sSubSup') {
    const base = namedChild(node, 'e');
    const subscript = node.localName === 'sSup' ? null : namedChild(node, 'sub');
    const superscript = node.localName === 'sSub' ? null : namedChild(node, 'sup');
    if (
      !base ||
      (node.localName !== 'sSup' && !subscript) ||
      (node.localName !== 'sSub' && !superscript)
    ) {
      return null;
    }
    return Object.freeze({
      kind: 'script',
      base: projectContainer(base, state, depth + 1),
      ...(subscript ? { subscript: projectContainer(subscript, state, depth + 1) } : {}),
      ...(superscript ? { superscript: projectContainer(superscript, state, depth + 1) } : {}),
      ...controlSource(node, `${node.localName}Pr`, state),
    });
  }
  if (node.localName === 'nary') {
    const body = namedChild(node, 'e');
    if (!body) return null;
    const lower = namedChild(node, 'sub');
    const upper = namedChild(node, 'sup');
    const limitLocation = naryProperty(node, 'limLoc');
    return Object.freeze({
      kind: 'nary',
      operator: appendProjectionText(state, naryOperator(node)),
      body: projectContainer(body, state, depth + 1),
      ...(lower && childrenOf(lower).length > 0
        ? { lowerLimit: projectContainer(lower, state, depth + 1) }
        : {}),
      ...(upper && childrenOf(upper).length > 0
        ? { upperLimit: projectContainer(upper, state, depth + 1) }
        : {}),
      ...(limitLocation === 'undOvr' || limitLocation === 'subSup' ? { limitLocation } : {}),
      ...controlSource(node, 'naryPr', state),
    });
  }
  return null;
}

function projectNode(node: OoxmlNode, state: ProjectionState, depth: number): EquationExpression {
  if (!enterProjectionNode(state, depth)) {
    return Object.freeze({ kind: 'fallback', text: '…' });
  }
  if (node.kind === 'textValue') {
    return Object.freeze({ kind: 'text', value: appendProjectionText(state, node.value) });
  }
  if (!isMathElement(node)) return fallbackOf(node, state, depth + 1);
  if (node.localName === 'oMath') {
    return projectContainer(node, state, depth);
  }
  if (node.localName === 'r') {
    if (!isSupportedExpressionNode(node)) return fallbackOf(node, state, depth + 1);
    // Default properties stay reversible because replacement writes them back. Their size
    // still belongs to each run, including inside a display with differently sized equations.
    const sourceFormat = equationRunFormat(node)!;
    const format = state.defaultRuns ? {} : sourceFormat;
    return frozenRow(
      namedChildren(node, 't').map((text) => {
        const projected = projectContainer(text, state, depth + 1);
        const formatted = (value: EquationExpression): EquationExpression =>
          value.kind === 'text'
            ? Object.freeze({
                ...value,
                ...(!state.defaultRuns || sourceFormat.fontSizePt === undefined
                  ? {}
                  : { fontSizePt: sourceFormat.fontSizePt }),
                ...(Object.keys(format).length ? { format } : {}),
              })
            : value;
        return projected.kind === 'row'
          ? frozenRow(projected.items.map(formatted))
          : formatted(projected);
      })
    );
  }
  if (node.localName === 't') {
    return isSupportedExpressionNode(node)
      ? projectContainer(node, state, depth)
      : fallbackOf(node, state, depth + 1);
  }
  const structured = projectStructured(node, state, depth);
  return structured ?? fallbackOf(node, state, depth + 1);
}

/**
 * Project one preserved `m:oMath` generic node without changing its canonical source.
 */
export function projectOmmlEquation(
  node: OoxmlNode,
  limits?: OmmlLimits
): OmmlEquationProjection | null {
  if (!isMathElement(node, 'oMath')) return null;
  const cached = limits === undefined ? defaultProjectionCache.get(node) : undefined;
  if (cached) return cached;
  const publish = (projection: OmmlEquationProjection): OmmlEquationProjection => {
    if (limits === undefined) defaultProjectionCache.set(node, projection);
    return projection;
  };
  const resolved = resolveLimits(limits);
  const scan: ProjectionState = {
    limits: resolved,
    visitedNodes: 0,
    text: '',
    truncated: false,
  };
  collectFallbackText(node, scan, 1);
  const fallbackText = scan.text + (scan.truncated ? '…' : '');
  if (scan.truncated) {
    return publish(
      Object.freeze({
        sourceNodeId: node.id,
        expression: Object.freeze({ kind: 'fallback', text: fallbackText || '…' }),
        fallbackText,
        truncated: true,
        visitedNodes: scan.visitedNodes,
      })
    );
  }
  // The preflight proves the complete source is within each work limit. The structured pass
  // can revisit wrappers while it maps their roles, but it cannot discover more source nodes.
  const defaults = equationDefaultFormatting(node, resolved.maxNodes, resolved.maxDepth);
  const state: ProjectionState = {
    limits: { ...resolved, maxNodes: Number.MAX_SAFE_INTEGER },
    defaultControls: defaults.controls.kind === 'default',
    defaultRuns: defaults.runs.kind === 'default',
    visitedNodes: 0,
    text: '',
    truncated: false,
  };
  const expression = projectNode(node, state, 1);
  const fontSizePt = equationSharedRunSizePt(node, resolved.maxNodes, resolved.maxDepth);
  if (state.truncated) {
    const structuredFallback = state.text + '…';
    return publish(
      Object.freeze({
        sourceNodeId: node.id,
        expression: Object.freeze({ kind: 'fallback', text: structuredFallback }),
        fallbackText: structuredFallback,
        truncated: true,
        visitedNodes: scan.visitedNodes,
      })
    );
  }
  return publish(
    Object.freeze({
      sourceNodeId: node.id,
      expression,
      fallbackText,
      truncated: false,
      visitedNodes: scan.visitedNodes,
      ...(fontSizePt === undefined ? {} : { fontSizePt }),
    })
  );
}

class LinearMathError extends Error {
  constructor(readonly reason: LinearMathRejection) {
    super(reason);
  }
}

class LinearMathParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly input: string,
    private readonly limits: ResolvedLimits
  ) {}

  parse(): EquationExpression {
    if (this.input.length === 0) throw new LinearMathError('empty');
    if (this.input.length > this.limits.maxTextLength) throw new LinearMathError('text-limit');
    if (!isValidXmlText(this.input)) throw new LinearMathError('invalid-xml-text');
    const expression = this.sequence(undefined, 1);
    if (this.index !== this.input.length) throw new LinearMathError('invalid-syntax');
    return expression;
  }

  private make<T extends EquationExpression>(expression: T, depth: number): T {
    if (depth > this.limits.maxDepth) throw new LinearMathError('depth-limit');
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) throw new LinearMathError('node-limit');
    return Object.freeze(expression);
  }

  private sequence(stop: '}' | ']' | undefined, depth: number): EquationExpression {
    if (depth > this.limits.maxDepth) throw new LinearMathError('depth-limit');
    const children: EquationExpression[] = [];
    while (this.index < this.input.length && this.input[this.index] !== stop) {
      if (this.input[this.index] === '}' || this.input[this.index] === ']') {
        throw new LinearMathError('invalid-syntax');
      }
      children.push(this.scripted(depth + 1));
    }
    if (stop !== undefined) {
      if (this.input[this.index] !== stop) throw new LinearMathError('invalid-syntax');
      this.index += 1;
    }
    if (children.length === 0) return this.make({ kind: 'row', items: Object.freeze([]) }, depth);
    return children.length === 1
      ? children[0]!
      : this.make({ kind: 'row', items: Object.freeze(children) }, depth);
  }

  private scripted(depth: number): EquationExpression {
    const groupedBase = this.input[this.index] === '{';
    let base = this.primary(depth + 1);
    let prefix: EquationExpression | undefined;
    let subscript: EquationExpression | undefined;
    let superscript: EquationExpression | undefined;
    while (this.input[this.index] === '^' || this.input[this.index] === '_') {
      const marker = this.input[this.index++]!;
      const operand = this.scriptOperand(depth + 1);
      if (marker === '^') {
        if (superscript) throw new LinearMathError('invalid-syntax');
        superscript = operand;
      } else {
        if (subscript) throw new LinearMathError('invalid-syntax');
        subscript = operand;
      }
    }
    if (subscript || superscript) {
      if (!groupedBase && base.kind === 'text') {
        const characters = Array.from(base.value);
        if (characters.length > 1) {
          prefix = this.make({ kind: 'text', value: characters.slice(0, -1).join('') }, depth + 1);
          base = this.make({ kind: 'text', value: characters.at(-1)! }, depth + 1);
        }
      }
      base = this.make(
        {
          kind: 'script',
          base,
          ...(subscript === undefined ? {} : { subscript }),
          ...(superscript === undefined ? {} : { superscript }),
        },
        depth
      );
    }
    return prefix ? this.make({ kind: 'row', items: [prefix, base] }, depth) : base;
  }

  private scriptOperand(depth: number): EquationExpression {
    if (this.input[this.index] === '{') return this.braced(depth + 1);
    const value = this.codePoint();
    if (value === null || '^_{}[]'.includes(value)) throw new LinearMathError('invalid-syntax');
    return this.make({ kind: 'text', value }, depth);
  }

  private braced(depth: number): EquationExpression {
    if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
    this.index += 1;
    const expression = this.sequence('}', depth + 1);
    if (expression.kind === 'row' && expression.items.length === 0) {
      throw new LinearMathError('invalid-syntax');
    }
    return expression;
  }

  private primary(depth: number): EquationExpression {
    if (this.input[this.index] === '{') {
      const numerator = this.braced(depth + 1);
      if (this.input[this.index] === '/' && this.input[this.index + 1] === '{') {
        this.index += 1;
        const denominator = this.braced(depth + 1);
        return this.make({ kind: 'fraction', numerator, denominator }, depth);
      }
      return numerator;
    }
    if (this.input[this.index] === '√') {
      this.index += 1;
      let degree: EquationExpression | undefined;
      if (this.input[this.index] === '[') {
        this.index += 1;
        degree = this.sequence(']', depth + 1);
        if (degree.kind === 'row' && degree.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
      return this.make(
        {
          kind: 'radical',
          radicand: this.braced(depth + 1),
          ...(degree === undefined ? {} : { degree }),
        },
        depth
      );
    }
    if (this.input[this.index] === '∑') {
      this.index += 1;
      let lowerLimit: EquationExpression | undefined;
      let upperLimit: EquationExpression | undefined;
      if (this.input[this.index] === '[') {
        this.index += 1;
        lowerLimit = this.sequence(']', depth + 1);
        if (lowerLimit.kind === 'row' && lowerLimit.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] === '^') {
        this.index += 1;
        if (this.input[this.index] !== '[') throw new LinearMathError('invalid-syntax');
        this.index += 1;
        upperLimit = this.sequence(']', depth + 1);
        if (upperLimit.kind === 'row' && upperLimit.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
      return this.make(
        {
          kind: 'nary',
          operator: '∑',
          body: this.braced(depth + 1),
          ...(lowerLimit === undefined ? {} : { lowerLimit }),
          ...(upperLimit === undefined ? {} : { upperLimit }),
        },
        depth
      );
    }
    const start = this.index;
    while (this.index < this.input.length) {
      const character = this.input[this.index]!;
      if ('{}[]^_√∑'.includes(character)) break;
      this.index += 1;
    }
    if (this.index === start) throw new LinearMathError('invalid-syntax');
    return this.make({ kind: 'text', value: this.input.slice(start, this.index) }, depth);
  }

  private codePoint(): string | null {
    if (this.index >= this.input.length) return null;
    const point = this.input.codePointAt(this.index);
    if (point === undefined) return null;
    const value = String.fromCodePoint(point);
    this.index += value.length;
    return value;
  }
}

/** Parse the supported compact linear-math subset with fixed work limits. */
export function parseLinearMath(input: string, limits?: OmmlLimits): LinearMathParseResult {
  const cacheable = limits === undefined && input.length <= DEFAULT_OMML_LIMITS.maxTextLength;
  const cached = cacheable ? defaultLinearMathCache.get(input) : undefined;
  if (cached) return cached;
  let result: LinearMathParseResult;
  try {
    result = Object.freeze({
      ok: true,
      expression: new LinearMathParser(input, resolveLimits(limits)).parse(),
    });
  } catch (error) {
    result = Object.freeze({
      ok: false,
      reason: error instanceof LinearMathError ? error.reason : 'invalid-syntax',
    });
  }
  if (cacheable) {
    if (defaultLinearMathCache.size >= DEFAULT_LINEAR_CACHE_LIMIT) {
      const oldest = defaultLinearMathCache.keys().next().value;
      if (oldest !== undefined) defaultLinearMathCache.delete(oldest);
    }
    defaultLinearMathCache.set(input, result);
  }
  return result;
}

/**
 * Convert a projected expression into reversible compact syntax.
 *
 * Returns an empty string when parsing the result would change the projected meaning.
 */
export function equationExpressionToLinearMath(expression: EquationExpression): string {
  const cached = reversibleLinearMathCache.get(expression);
  if (cached !== undefined) return cached;
  const linear = renderReversibleLinearMath(expression, parseLinearMath);
  reversibleLinearMathCache.set(expression, linear);
  return linear;
}

type NextNodeId = () => string;

/** What emitted nodes need: fresh ids, and the default properties to write back. */
interface EmitContext {
  readonly nextId: NextNodeId;
  /** The `m:ctrlPr` written on each emitted structure. */
  readonly control: OoxmlGenericElementNode | null;
  /** The `w:rPr` written on each emitted run. */
  readonly runProperties: OoxmlElement | null;
}

function mathAttribute(localName: string, value: string): OoxmlAttribute {
  return Object.freeze({
    kind: 'genericExtension',
    namespaceUri: OFFICE_MATH_NAMESPACE_URI,
    localName,
    prefix: 'm',
    value,
  });
}

function textValue(value: string, nextId: NextNodeId): OoxmlNode {
  return Object.freeze({ id: nextId(), kind: 'textValue', value });
}

function textAttributes(value: string): readonly OoxmlAttribute[] {
  return /^\s|\s$/.test(value)
    ? [
        Object.freeze({
          kind: 'xmlSpace',
          namespaceUri: XML_NAMESPACE_URI,
          localName: 'space',
          prefix: 'xml',
          value: 'preserve',
        }),
      ]
    : [];
}

function mathElement(
  localName: string,
  children: readonly OoxmlNode[],
  nextId: NextNodeId,
  attributes: readonly OoxmlAttribute[] = []
): OoxmlGenericElementNode {
  return Object.freeze({
    id: nextId(),
    kind: 'generic',
    namespaceUri: OFFICE_MATH_NAMESPACE_URI,
    localName,
    prefix: 'm',
    namespaceBindings: Object.freeze([]),
    attributes: Object.freeze([...attributes]),
    children: Object.freeze([...children]),
  });
}

/**
 * The property element of one emitted structure. `m:ctrlPr` is the last child in schema
 * order. Null when the structure needs no properties at all.
 */
function structureProperties(
  localName: string,
  properties: readonly OoxmlNode[],
  context: EmitContext
): OoxmlGenericElementNode | null {
  const control = context.control ? [cloneEquationControl(context.control, context.nextId)] : [];
  if (properties.length === 0 && control.length === 0) return null;
  return mathElement(localName, [...properties, ...control], context.nextId);
}

function structure(
  localName: string,
  properties: OoxmlGenericElementNode | null,
  children: readonly OoxmlNode[],
  context: EmitContext
): OoxmlGenericElementNode {
  return mathElement(localName, properties ? [properties, ...children] : children, context.nextId);
}

/** One emitted run. Schema order puts `w:rPr` (after any `m:rPr`) before `m:t`. */
function textRun(value: string, context: EmitContext): OoxmlNode {
  const { nextId, runProperties } = context;
  const properties = runProperties ? [cloneEquationControl(runProperties, nextId)] : [];
  return mathElement(
    'r',
    [...properties, mathElement('t', [textValue(value, nextId)], nextId, textAttributes(value))],
    nextId
  );
}

function expressionNodes(
  expression: EquationExpression,
  context: EmitContext
): readonly OoxmlNode[] {
  const { nextId } = context;
  const container = (localName: string, value: EquationExpression | undefined): OoxmlNode =>
    mathElement(localName, value ? expressionNodes(value, context) : [], nextId);
  switch (expression.kind) {
    case 'row':
      return expression.items.flatMap((child) => expressionNodes(child, context));
    case 'text':
      return [textRun(expression.value, context)];
    case 'fallback':
      return [textRun(expression.text, context)];
    case 'bar': {
      const position = mathElement('pos', [], nextId, [
        mathAttribute('val', expression.position === 'top' ? 'top' : 'bot'),
      ]);
      return [
        structure(
          'bar',
          structureProperties('barPr', [position], context),
          [container('e', expression.body)],
          context
        ),
      ];
    }
    case 'borderBox': {
      const on = (localName: string) =>
        mathElement(localName, [], nextId, [mathAttribute('val', '1')]);
      const flags: [boolean, string][] = [
        [expression.hidden.top, 'hideTop'],
        [expression.hidden.bottom, 'hideBot'],
        [expression.hidden.left, 'hideLeft'],
        [expression.hidden.right, 'hideRight'],
        [expression.strikes.horizontal, 'strikeH'],
        [expression.strikes.vertical, 'strikeV'],
        [expression.strikes.bottomLeftToTopRight, 'strikeBLTR'],
        [expression.strikes.topLeftToBottomRight, 'strikeTLBR'],
      ];
      const properties = flags.filter(([set]) => set).map(([, name]) => on(name));
      return [
        structure(
          'borderBox',
          structureProperties('borderBoxPr', properties, context),
          [container('e', expression.body)],
          context
        ),
      ];
    }
    case 'delimiter': {
      const value = (localName: string, val: string) =>
        mathElement(localName, [], nextId, [mathAttribute('val', val)]);
      const { opening: begChr, separator: sepChr, closing: endChr } = expression;
      const characters = { begChr, sepChr, endChr };
      const properties = [
        ...DELIMITER_CHARACTERS.filter(
          (name) => characters[name] !== DEFAULT_DELIMITER_CHARACTERS[name]
        ).map((name) => value(name, characters[name])),
        ...(expression.grow ? [] : [value('grow', '0')]),
        ...(expression.shape === 'match' ? [value('shp', 'match')] : []),
      ];
      return [
        structure(
          'd',
          structureProperties('dPr', properties, context),
          expression.items.map((item) => container('e', item)),
          context
        ),
      ];
    }
    case 'fraction':
      return [
        structure(
          'f',
          structureProperties('fPr', [], context),
          [container('num', expression.numerator), container('den', expression.denominator)],
          context
        ),
      ];
    case 'radical':
      return [
        structure(
          'rad',
          structureProperties('radPr', [], context),
          [container('deg', expression.degree), container('e', expression.radicand)],
          context
        ),
      ];
    case 'script': {
      const both = expression.subscript !== undefined && expression.superscript !== undefined;
      const superscript = expression.superscript !== undefined;
      const localName = both ? 'sSubSup' : superscript ? 'sSup' : 'sSub';
      const properties = structureProperties(`${localName}Pr`, [], context);
      const base = container('e', expression.base);
      const scripts = both
        ? [container('sub', expression.subscript), container('sup', expression.superscript)]
        : [
            container(
              superscript ? 'sup' : 'sub',
              superscript ? expression.superscript : expression.subscript
            ),
          ];
      return [structure(localName, properties, [base, ...scripts], context)];
    }
    case 'nary': {
      const properties = [
        mathElement('chr', [], nextId, [mathAttribute('val', expression.operator)]),
        mathElement('limLoc', [], nextId, [mathAttribute('val', 'undOvr')]),
      ];
      return [
        structure(
          'nary',
          structureProperties('naryPr', properties, context),
          [
            container('sub', expression.lowerLimit),
            container('sup', expression.upperLimit),
            container('e', expression.body),
          ],
          context
        ),
      ];
    }
  }
}

/**
 * Build a canonical `m:oMath` tree. The caller supplies the part-scoped fresh ID allocator.
 */
function ommlEquationFromExpression(
  expression: EquationExpression,
  context: EmitContext
): OoxmlGenericElementNode {
  const equation = mathElement('oMath', expressionNodes(expression, context), context.nextId);
  return Object.freeze({
    ...equation,
    namespaceBindings: Object.freeze([
      Object.freeze({ prefix: 'm', namespaceUri: OFFICE_MATH_NAMESPACE_URI }),
    ]),
  });
}

/** Parse compact linear math and generate fresh canonical OMML in one bounded operation. */
export function linearMathToOmml(
  input: string,
  nextId: NextNodeId,
  limits?: OmmlLimits
): LinearMathOmmlResult {
  return linearMathReplacementOmml(input, nextId, null, limits);
}

/**
 * Generate the OMML that replaces `replacing`, an existing `m:oMath`. When every `m:ctrlPr`
 * in it holds only default formatting, each emitted structure receives a copy of its first
 * `m:ctrlPr`. When every run in it carries default `w:rPr`, each emitted run receives a copy
 * of its first run's `w:rPr`. Otherwise the result matches {@link linearMathToOmml}.
 */
export function linearMathReplacementOmml(
  input: string,
  nextId: NextNodeId,
  replacing: OoxmlNode | null,
  limits?: OmmlLimits
): LinearMathOmmlResult {
  const parsed = parseLinearMath(input, limits);
  if (!parsed.ok) return parsed;
  const resolved = resolveLimits(limits);
  const defaults = replacing
    ? equationDefaultFormatting(replacing, resolved.maxNodes, resolved.maxDepth)
    : null;
  const context: EmitContext = {
    nextId,
    control: defaults?.controls.kind === 'default' ? defaults.controls.control : null,
    runProperties: defaults?.runs.kind === 'default' ? defaults.runs.properties : null,
  };
  return Object.freeze({
    ok: true,
    expression: parsed.expression,
    equation: ommlEquationFromExpression(parsed.expression, context),
  });
}
