// MathML (presentation markup) converted to canonical OMML for clipboard paste.
//
// Word writes MathML in its `msEquation` comment on some setups, and browsers and other
// editors put MathML on the clipboard. Every element passes a fixed switch: unknown
// elements contribute their children, and annotations never reach the document. All text
// is escaped by the shared run emitter, and the shared budget and depth limits bound the work.
import {
  MAX_EQUATION_DEPTH,
  charge,
  mathRunXml,
  type EquationState,
  type MathRunFormat,
} from './clipboard-html-math-xml.ts';
import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';

const MAX_TOKEN_LENGTH = 512;

const NARY_OPERATORS = new Set([
  '∑', // ∑
  '∏', // ∏
  '∐', // ∐
  '∫', // ∫
  '∬', // ∬
  '∭', // ∭
  '∮', // ∮
  '∯', // ∯
  '∰', // ∰
  '⋀', // ⋀
  '⋁', // ⋁
  '⋂', // ⋂
  '⋃', // ⋃
  '⨀', // ⨀
  '⨁', // ⨁
  '⨂', // ⨂
  '⨄', // ⨄
  '⨆', // ⨆
]);

/** Spacing accent characters mapped to the combining marks OMML `m:acc` stores. */
const ACCENTS: ReadonlyMap<string, string> = new Map([
  ['^', '̂'],
  ['ˆ', '̂'],
  ['̂', '̂'],
  ['~', '̃'],
  ['˜', '̃'],
  ['̃', '̃'],
  ['˙', '̇'],
  ['̇', '̇'],
  ['¨', '̈'],
  ['̈', '̈'],
  ['→', '⃗'],
  ['⃗', '⃗'],
  ['´', '́'],
  ['`', '̀'],
  ['ˇ', '̌'],
  ['˘', '̆'],
]);

const BARS = new Set(['¯', '‾', '_', '―', '—', '̅', '-']);

const FENCES: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['|', '|'],
  ['‖', '‖'],
  ['⟨', '⟩'],
  ['〈', '〉'],
  ['⌊', '⌋'],
  ['⌈', '⌉'],
]);

const SKIPPED = new Set([
  'annotation',
  'annotation-xml',
  'none',
  'mprescripts',
  'mspace',
  'maligngroup',
  'malignmark',
  'mphantom',
]);

const SCRIPTED = new Set(['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover']);

function nameOf(element: Element): string {
  return element.localName.toLowerCase();
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.children);
}

function tokenText(element: Element): string {
  return (element.textContent ?? '')
    .replace(/[ \t\r\n\f\v]+/g, ' ')
    .trim()
    .slice(0, MAX_TOKEN_LENGTH);
}

function value(text: string): string {
  return escapeXmlAttribute(xmlSafeText(text));
}

function arg(name: string, inner: string): string {
  return inner.length > 0 ? `<m:${name}>${inner}</m:${name}>` : `<m:${name}/>`;
}

function formatOf(element: Element, base: MathRunFormat): MathRunFormat {
  let next = base;
  const color = element.getAttribute('mathcolor')?.trim() ?? '';
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex;
    next = { ...next, color: full.toUpperCase() };
  }
  const variant = element.getAttribute('mathvariant')?.trim().toLowerCase();
  if (variant === 'bold' || variant === 'bold-italic') next = { ...next, bold: true };
  return next;
}

/** The single operator character of an `mo`, or null. */
function operatorOf(element: Element | undefined): string | null {
  if (element === undefined || nameOf(element) !== 'mo') return null;
  const text = tokenText(element);
  return [...text].length === 1 ? text : null;
}

class MathmlConverter {
  constructor(private readonly state: EquationState) {}

  node(element: Element, depth: number, format: MathRunFormat): string {
    if (depth > MAX_EQUATION_DEPTH) {
      this.state.truncated = true;
      return '';
    }
    if (!charge(this.state)) return '';
    const name = nameOf(element);
    const own = formatOf(element, format);
    const children = elementChildren(element);
    const child = (index: number): string =>
      children[index] ? this.node(children[index]!, depth + 1, own) : '';
    if (SKIPPED.has(name)) return '';
    switch (name) {
      case 'semantics':
        return child(0);
      case 'mi':
        return this.identifier(element, own);
      case 'mn':
      case 'mo':
        return mathRunXml(tokenText(element), '', own);
      case 'mtext':
        return mathRunXml(tokenText(element), '<m:nor/>', own);
      case 'ms':
        return mathRunXml(`"${tokenText(element)}"`, '<m:nor/>', own);
      case 'msub':
        return `<m:sSub>${arg('e', child(0))}${arg('sub', child(1))}</m:sSub>`;
      case 'msup':
        return `<m:sSup>${arg('e', child(0))}${arg('sup', child(1))}</m:sSup>`;
      case 'msubsup':
        return (
          `<m:sSubSup>${arg('e', child(0))}${arg('sub', child(1))}` +
          `${arg('sup', child(2))}</m:sSubSup>`
        );
      case 'mfrac':
        return this.fraction(element, child(0), child(1));
      case 'msqrt':
        return (
          '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>' +
          `${arg('e', this.row(children, depth + 1, own))}</m:rad>`
        );
      case 'mroot':
        return `<m:rad>${arg('deg', child(1))}${arg('e', child(0))}</m:rad>`;
      case 'munder':
        return this.under(children[1], child(0), child(1));
      case 'mover':
        return this.over(element, children[1], child(0), child(1));
      case 'munderover':
        return (
          `<m:limUpp>${arg('e', `<m:limLow>${arg('e', child(0))}${arg('lim', child(1))}</m:limLow>`)}` +
          `${arg('lim', child(2))}</m:limUpp>`
        );
      case 'mfenced':
        return this.fenced(element, children, depth, own);
      case 'menclose':
        return `<m:borderBox>${arg('e', this.row(children, depth + 1, own))}</m:borderBox>`;
      case 'mtable':
        return this.table(children, depth, own);
      case 'mmultiscripts':
        return this.multiscripts(children, depth, own);
      default:
        // math, mrow, mstyle, mpadded, merror, and unknown elements group their children.
        return this.row(children, depth + 1, own);
    }
  }

  private identifier(element: Element, format: MathRunFormat): string {
    const text = tokenText(element);
    const variant = element.getAttribute('mathvariant')?.trim().toLowerCase();
    // A multi-letter identifier is upright in MathML and italic in OMML unless styled.
    let style = '';
    if (variant === 'normal' || (variant === undefined && [...text].length > 1)) {
      style = '<m:sty m:val="p"/>';
    } else if (variant === 'bold') {
      style = '<m:sty m:val="b"/>';
    } else if (variant === 'bold-italic') {
      style = '<m:sty m:val="bi"/>';
    }
    return mathRunXml(text, style, format);
  }

  private fraction(element: Element, numerator: string, denominator: string): string {
    const thickness = element.getAttribute('linethickness')?.trim().toLowerCase();
    const bevelled = element.getAttribute('bevelled')?.trim().toLowerCase() === 'true';
    const type =
      thickness !== undefined && /^0(?:\.0*)?(?:px|pt|em|ex|%)?$/.test(thickness)
        ? 'noBar'
        : bevelled
          ? 'skw'
          : null;
    const properties = type === null ? '' : `<m:fPr><m:type m:val="${type}"/></m:fPr>`;
    return `<m:f>${properties}${arg('num', numerator)}${arg('den', denominator)}</m:f>`;
  }

  private under(script: Element | undefined, base: string, under: string): string {
    const operator = operatorOf(script);
    if (operator !== null && BARS.has(operator)) {
      return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${arg('e', base)}</m:bar>`;
    }
    return `<m:limLow>${arg('e', base)}${arg('lim', under)}</m:limLow>`;
  }

  private over(element: Element, script: Element | undefined, base: string, over: string): string {
    const operator = operatorOf(script);
    if (operator !== null && BARS.has(operator)) {
      return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${arg('e', base)}</m:bar>`;
    }
    const accent = operator === null ? undefined : ACCENTS.get(operator);
    if (
      accent !== undefined ||
      (operator !== null && element.getAttribute('accent')?.trim() === 'true')
    ) {
      return (
        `<m:acc><m:accPr><m:chr m:val="${value(accent ?? operator!)}"/></m:accPr>` +
        `${arg('e', base)}</m:acc>`
      );
    }
    return `<m:limUpp>${arg('e', base)}${arg('lim', over)}</m:limUpp>`;
  }

  private fenced(
    element: Element,
    children: Element[],
    depth: number,
    format: MathRunFormat
  ): string {
    const open = [...(element.getAttribute('open') ?? '(')].slice(0, 1).join('');
    const close = [...(element.getAttribute('close') ?? ')')].slice(0, 1).join('');
    const separator = [...(element.getAttribute('separators') ?? ',').trim()][0] ?? '';
    const items = children.map((child) => arg('e', this.node(child, depth + 1, format)));
    return (
      `<m:d><m:dPr><m:begChr m:val="${value(open)}"/>` +
      `${separator.length > 0 ? `<m:sepChr m:val="${value(separator)}"/>` : ''}` +
      `<m:endChr m:val="${value(close)}"/></m:dPr>${items.join('') || '<m:e/>'}</m:d>`
    );
  }

  private table(rows: Element[], depth: number, format: MathRunFormat): string {
    let out = '';
    for (const row of rows) {
      if (!charge(this.state)) break;
      const kind = nameOf(row);
      if (kind !== 'mtr' && kind !== 'mlabeledtr') continue;
      // The first cell of a labeled row is its equation number, not matrix content.
      const cells = elementChildren(row).slice(kind === 'mlabeledtr' ? 1 : 0);
      out +=
        '<m:mr>' +
        cells
          .map((cell) =>
            arg(
              'e',
              nameOf(cell) === 'mtd'
                ? this.row(elementChildren(cell), depth + 2, format)
                : this.node(cell, depth + 2, format)
            )
          )
          .join('') +
        '</m:mr>';
    }
    return out.length > 0 ? `<m:m>${out}</m:m>` : '';
  }

  private multiscripts(children: Element[], depth: number, format: MathRunFormat): string {
    const at = (element: Element | undefined): string =>
      element === undefined || nameOf(element) === 'none'
        ? ''
        : this.node(element, depth + 1, format);
    const split = children.findIndex((child) => nameOf(child) === 'mprescripts');
    const post = split < 0 ? children.slice(1) : children.slice(1, split);
    const pre = split < 0 ? [] : children.slice(split + 1);
    let base = at(children[0]);
    if (post.length > 0) {
      base =
        `<m:sSubSup>${arg('e', base)}${arg('sub', at(post[0]))}` +
        `${arg('sup', at(post[1]))}</m:sSubSup>`;
    }
    if (pre.length > 0) {
      return `<m:sPre>${arg('sub', at(pre[0]))}${arg('sup', at(pre[1]))}${arg('e', base)}</m:sPre>`;
    }
    return base;
  }

  /** A large operator with its limits, taking the next sibling as its body. */
  private nary(
    scripted: Element,
    body: Element | undefined,
    depth: number,
    format: MathRunFormat
  ): string {
    const kind = nameOf(scripted);
    const parts = elementChildren(scripted);
    const operator = kind === 'mo' ? tokenText(scripted) : tokenText(parts[0]!);
    const script = (index: number): string =>
      parts[index] ? this.node(parts[index]!, depth + 1, format) : '';
    let lower = '';
    let upper = '';
    if (kind === 'msub' || kind === 'munder') lower = script(1);
    else if (kind === 'msup' || kind === 'mover') upper = script(1);
    else if (kind === 'msubsup' || kind === 'munderover') {
      lower = script(1);
      upper = script(2);
    }
    const location =
      kind === 'munder' || kind === 'mover' || kind === 'munderover' ? 'undOvr' : 'subSup';
    const properties =
      `<m:chr m:val="${value(operator)}"/><m:limLoc m:val="${location}"/>` +
      `${lower.length === 0 ? '<m:subHide m:val="1"/>' : ''}` +
      `${upper.length === 0 ? '<m:supHide m:val="1"/>' : ''}`;
    const inner = body ? this.node(body, depth + 1, format) : '';
    return (
      `<m:nary><m:naryPr>${properties}</m:naryPr>${arg('sub', lower)}${arg('sup', upper)}` +
      `${arg('e', inner)}</m:nary>`
    );
  }

  private isNary(element: Element): boolean {
    const kind = nameOf(element);
    if (kind === 'mo') return NARY_OPERATORS.has(tokenText(element));
    if (!SCRIPTED.has(kind)) return false;
    const base = element.children[0];
    return base !== undefined && NARY_OPERATORS.has(operatorOf(base) ?? '');
  }

  row(children: Element[], depth: number, format: MathRunFormat): string {
    if (depth > MAX_EQUATION_DEPTH) {
      this.state.truncated = true;
      return '';
    }
    // A row wrapped in matching fence operators is one delimiter object.
    const open = operatorOf(children[0]);
    const close = operatorOf(children[children.length - 1]);
    if (children.length >= 2 && open !== null && close !== null && FENCES.has(open)) {
      const closing = [...FENCES.values()].includes(close);
      if (closing) {
        const inner = this.row(children.slice(1, -1), depth + 1, format);
        return (
          `<m:d><m:dPr><m:begChr m:val="${value(open)}"/><m:endChr m:val="${value(close)}"/>` +
          `</m:dPr>${arg('e', inner)}</m:d>`
        );
      }
    }
    let out = '';
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (this.isNary(child)) {
        const body = children[index + 1];
        out += this.nary(child, body, depth, format);
        if (body !== undefined) index += 1;
        continue;
      }
      out += this.node(child, depth, format);
    }
    return out;
  }
}

/** True for a MathML root element. */
export function isMathmlRoot(element: Element): boolean {
  return nameOf(element) === 'math';
}

/** True when a MathML root is a display (block) equation. */
export function isMathmlDisplay(element: Element): boolean {
  return (
    element.getAttribute('display')?.trim().toLowerCase() === 'block' ||
    element.getAttribute('mode')?.trim().toLowerCase() === 'display'
  );
}

/** The OMML content of one equation converted from a MathML root. */
export function mathmlToOmml(
  element: Element,
  state: EquationState,
  format: MathRunFormat
): string {
  return new MathmlConverter(state).row(elementChildren(element), 1, formatOf(element, format));
}
