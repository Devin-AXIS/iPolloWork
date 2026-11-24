// Equations in the interop `text/html` flavour.
//
// Each `m:oMath` or `m:oMathPara` atom copies twice. Word reads OMML from an
// `<!--[if gte msEquation 12]>` comment when the document root declares the `m` prefix;
// italic and bold variables travel as `<i>` and `<b>` wrappers, and run color as a span.
// Browsers and other editors read the MathML in the downlevel `<![if !msEquation]>` block.
// All text and values are escaped, so no comment can close early, and node and depth
// limits bound the walk.
import { escapeXml, escapeXmlAttribute } from '../store/package/sinks.ts';
import {
  OFFICE_MATH_NAMESPACE_URI,
  projectOmmlEquation,
  type EquationExpression,
} from '../store/package/omml-equation.ts';
import {
  isOmmlDisplay,
  isOmmlEquationAtom,
  projectOmmlDisplay,
} from '../store/package/omml-display.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';

/** The namespace Word's HTML uses for the `m` prefix. */
export const WORD_HTML_MATH_NAMESPACE = 'http://schemas.microsoft.com/office/2004/12/omml';
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

const MAX_NODES = 4096;
const MAX_DEPTH = 32;

interface Walk {
  left: number;
  failed: boolean;
}

function enter(walk: Walk, depth: number): boolean {
  if (walk.failed || depth > MAX_DEPTH || walk.left <= 0) {
    walk.failed = true;
    return false;
  }
  walk.left -= 1;
  return true;
}

function isMath(node: OoxmlNode, localName?: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
    (localName === undefined || node.localName === localName)
  );
}

function valueOf(node: OoxmlNode, namespaceUri: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === 'val' && attribute.namespaceUri === namespaceUri
  )?.value;
}

function textOf(node: OoxmlNode, walk: Walk, depth: number): string {
  if (!enter(walk, depth)) return '';
  if (node.kind === 'textValue') return node.value;
  let out = '';
  for (const child of node.children) out += textOf(child, walk, depth + 1);
  return out;
}

/** One math run with Word's clipboard formatting wrappers. */
function runHtml(run: OoxmlNode, walk: Walk, depth: number): string {
  if (run.kind === 'textValue') return '';
  let text = '';
  let style: string | undefined;
  let normal = false;
  let color: string | undefined;
  for (const child of run.children) {
    if (isMath(child, 't')) text += textOf(child, walk, depth + 1);
    else if (isMath(child, 'rPr') && child.kind !== 'textValue') {
      for (const property of child.children) {
        if (isMath(property, 'sty')) style = valueOf(property, OFFICE_MATH_NAMESPACE_URI);
        if (isMath(property, 'nor')) normal = true;
      }
    } else if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'rPr'
    ) {
      const colorNode = child.children.find(
        (property) => property.kind !== 'textValue' && property.localName === 'color'
      );
      const value = colorNode ? valueOf(colorNode, WML_NAMESPACE_URI) : undefined;
      if (value && /^[0-9A-Fa-f]{6}$/.test(value)) color = value.toUpperCase();
    }
  }
  if (text.length === 0) return '';
  let html = `<m:r>${escapeXml(text)}</m:r>`;
  if (color !== undefined) html = `<span style="color:#${color}">${html}</span>`;
  // Word reads an unwrapped run as upright text; the math default is italic.
  const italic = !normal && (style === undefined || style === 'i' || style === 'bi');
  const bold = style === 'b' || style === 'bi';
  if (italic) html = `<i>${html}</i>`;
  if (bold) html = `<b>${html}</b>`;
  return html;
}

function ommlHtml(node: OoxmlNode, walk: Walk, depth: number): string {
  if (node.kind === 'textValue' || !isMath(node) || !enter(walk, depth)) return '';
  if (node.localName === 'r') return runHtml(node, walk, depth);
  // Word's clipboard carries run properties as HTML wrappers, never as `m:ctrlPr` markup.
  if (node.localName === 'ctrlPr') return '';
  const value = valueOf(node, OFFICE_MATH_NAMESPACE_URI);
  const attribute = value === undefined ? '' : ` m:val="${escapeXmlAttribute(value)}"`;
  let inner = '';
  for (const child of node.children) inner += ommlHtml(child, walk, depth + 1);
  return inner.length > 0
    ? `<m:${node.localName}${attribute}>${inner}</m:${node.localName}>`
    : `<m:${node.localName}${attribute}/>`;
}

function textTokens(text: string): string {
  let out = '';
  for (const token of text.match(/\d+(?:\.\d+)?|\p{L}|\s+|./gu) ?? []) {
    if (/^\s+$/.test(token)) continue;
    const escaped = escapeXml(token);
    if (/^\d/.test(token)) out += `<mn>${escaped}</mn>`;
    else if (/^\p{L}$/u.test(token)) out += `<mi>${escaped}</mi>`;
    else out += `<mo>${escaped}</mo>`;
  }
  return out;
}

function mathml(expression: EquationExpression, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  const row = (inner: EquationExpression): string => `<mrow>${mathml(inner, depth + 1)}</mrow>`;
  switch (expression.kind) {
    case 'text':
      return expression.format?.normalText
        ? `<mtext>${escapeXml(expression.value)}</mtext>`
        : textTokens(expression.value);
    case 'fallback':
      return `<mtext>${escapeXml(expression.text)}</mtext>`;
    case 'row':
      return expression.items.map((item) => mathml(item, depth + 1)).join('');
    case 'bar':
      return expression.position === 'top'
        ? `<mover accent="true">${row(expression.body)}<mo>¯</mo></mover>`
        : `<munder accentunder="true">${row(expression.body)}<mo>¯</mo></munder>`;
    case 'borderBox': {
      const notation = [
        expression.hidden.top ? '' : 'top',
        expression.hidden.bottom ? '' : 'bottom',
        expression.hidden.left ? '' : 'left',
        expression.hidden.right ? '' : 'right',
        expression.strikes.horizontal ? 'horizontalstrike' : '',
        expression.strikes.vertical ? 'verticalstrike' : '',
        expression.strikes.bottomLeftToTopRight ? 'updiagonalstrike' : '',
        expression.strikes.topLeftToBottomRight ? 'downdiagonalstrike' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<menclose notation="${notation}">${row(expression.body)}</menclose>`;
    }
    case 'delimiter': {
      const stretchy = expression.grow ? '' : ' stretchy="false"';
      const fence = (character: string) =>
        character ? `<mo fence="true"${stretchy}>${escapeXml(character)}</mo>` : '';
      const separator = expression.separator
        ? `<mo separator="true"${stretchy}>${escapeXml(expression.separator)}</mo>`
        : '';
      return (
        `<mrow>${fence(expression.opening)}` +
        expression.items.map(row).join(separator) +
        `${fence(expression.closing)}</mrow>`
      );
    }
    case 'fraction':
      return `<mfrac>${row(expression.numerator)}${row(expression.denominator)}</mfrac>`;
    case 'radical':
      return expression.degree === undefined
        ? `<msqrt>${row(expression.radicand)}</msqrt>`
        : `<mroot>${row(expression.radicand)}${row(expression.degree)}</mroot>`;
    case 'script': {
      const base = row(expression.base);
      if (expression.subscript && expression.superscript) {
        return `<msubsup>${base}${row(expression.subscript)}${row(expression.superscript)}</msubsup>`;
      }
      if (expression.subscript) return `<msub>${base}${row(expression.subscript)}</msub>`;
      if (expression.superscript) return `<msup>${base}${row(expression.superscript)}</msup>`;
      return base;
    }
    case 'nary': {
      const operator = `<mo>${escapeXml(expression.operator)}</mo>`;
      const lower = expression.lowerLimit ? row(expression.lowerLimit) : '';
      const upper = expression.upperLimit ? row(expression.upperLimit) : '';
      const [both, under, over] =
        expression.limitLocation === 'subSup'
          ? ['msubsup', 'msub', 'msup']
          : ['munderover', 'munder', 'mover'];
      const scripted =
        lower && upper
          ? `<${both}>${operator}${lower}${upper}</${both}>`
          : lower
            ? `<${under}>${operator}${lower}</${under}>`
            : upper
              ? `<${over}>${operator}${upper}</${over}>`
              : operator;
      return `<mrow>${scripted}${row(expression.body)}</mrow>`;
    }
  }
}

/**
 * Interop HTML for one equation atom, or '' for any other node. The OMML half is dropped
 * when its walk exceeds the limits; the MathML half always travels.
 */
export function equationHtml(node: OoxmlNode): string {
  if (!isOmmlEquationAtom(node)) return '';
  const display = isOmmlDisplay(node);
  const projection = display ? projectOmmlDisplay(node) : projectOmmlEquation(node);
  const walk: Walk = { left: MAX_NODES, failed: false };
  const omml = ommlHtml(node, walk, 0);
  const fallback =
    projection === null
      ? ''
      : `<math xmlns="${MATHML_NAMESPACE}"${display ? ' display="block"' : ''}>` +
        `${mathml(projection.expression, 0)}</math>`;
  if (walk.failed || omml.length === 0) return fallback;
  return `<!--[if gte msEquation 12]>${omml}<![endif]--><![if !msEquation]>${fallback}<![endif]>`;
}

/** True when interop HTML carries Word equations, so its root must declare `m`. */
export function hasEquationHtml(html: string): boolean {
  return html.includes('<!--[if gte msEquation 12]>');
}
