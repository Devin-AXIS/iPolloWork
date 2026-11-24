// Clipboard equations (Word OMML and MathML) projected into canonical OMML.
//
// Word writes each equation twice: OMML markup and a downlevel fallback picture in an
// `<![if !msEquation]>` block. Word writes the OMML as live elements or inside an
// `<!--[if gte msEquation 12]>` comment; some setups write MathML there instead, and
// browsers paste MathML directly. Run text appears in `m:t`, as bare text, or inside
// HTML formatting such as `<i>`; that formatting carries color, highlight, size, and
// bold onto the math runs. Every OMML name passes an allowlist, every value is escaped,
// and node, depth, and count limits bound the work. A recovered equation drops its
// fallback picture; an unrecovered one keeps it.
import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';
import { applyElementRunProps, applyInlineTag, tagOf } from './clipboard-html-styles.ts';
import {
  MAX_EQUATION_DEPTH,
  NO_MATH_FORMAT,
  charge,
  mathFormatOf,
  mathRunXml,
  type EquationState,
  type MathRunFormat,
} from './clipboard-html-math-xml.ts';
import { isMathmlDisplay, isMathmlRoot, mathmlToOmml } from './clipboard-html-mathml.ts';

/** Office Math Markup Language namespace (ECMA-376 Part 1, §22.1). */
export const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

// Every element in the ECMA-376 `shared-math.xsd` schema.
const OMML_LOCAL_NAMES = (
  'acc accPr aln alnScr argPr argSz bar barPr baseJc begChr borderBox borderBoxPr box ' +
  'boxPr brk brkBin brkBinSub cGp cGpRule chr count cSp ctrlPr d defJc deg degHide den ' +
  'diff dispDef dPr e endChr eqArr eqArrPr f fName fPr func funcPr groupChr groupChrPr ' +
  'grow hideBot hideLeft hideRight hideTop interSp intLim intraSp jc lim limLoc limLow ' +
  'limLowPr limUpp limUppPr lit lMargin m mathFont mathPr maxDist mc mcJc mcPr mcs mPr ' +
  'mr nary naryLim naryPr noBreak nor num objDist oMath oMathPara oMathParaPr opEmu ' +
  'phant phantPr plcHide pos postSp preSp r rad radPr rMargin rPr rSp rSpRule scr ' +
  'sepChr show shp smallFrac sPre sPrePr sSub sSubPr sSubSup sSubSupPr sSup sSupPr ' +
  'strikeBLTR strikeH strikeTLBR strikeV sty sub subHide sup supHide t transp type ' +
  'vertJc wrapIndent wrapRight zeroAsc zeroDesc zeroWid'
).split(' ');

/** The HTML parser lowercases tag names; OOXML local names are case-sensitive. */
const OMML_NAME_BY_TAG: ReadonlyMap<string, string> = new Map(
  OMML_LOCAL_NAMES.map((name) => [`m:${name.toLowerCase()}`, name])
);

/** Argument containers (`CT_OMathArg`) hold runs, so stray text there becomes a run. */
const ARGUMENT_NAMES: ReadonlySet<string> = new Set([
  'oMath',
  'e',
  'num',
  'den',
  'sub',
  'sup',
  'deg',
  'lim',
  'fName',
]);

const MAX_EQUATIONS = 512;
const MAX_EQUATION_COMMENTS = 512;
const MAX_VALUE_LENGTH = 64;
const MAX_FALLBACK_NODES = 64;
const MAX_WRAPPER_CLIMB = 2;
const MAX_ANCESTOR_CLIMB = 256;

const EQUATION_COMMENT = /^\[if\s+gte\s+msEquation\b[^\]]*\]>([\s\S]*)<!\[endif\]$/i;
const FALLBACK_OPEN = /^\[if\s+!msEquation\s*\]$/i;
const DOWNLEVEL_OPEN = /^\[if\b[^\]]*\]$/i;
const DOWNLEVEL_CLOSE = /^\[endif\]$/i;

export interface WordEquations {
  /** Canonical equation XML (`m:oMath` or `m:oMathPara`) for each recovered element. */
  readonly byElement: ReadonlyMap<Element, readonly string[]>;
  /** Nodes visited, charged by the caller against the projection walk budget. */
  readonly visited: number;
  /** True when a limit stopped equation recovery with work remaining. */
  readonly truncated: boolean;
}

const NO_EQUATIONS: WordEquations = Object.freeze({
  byElement: new Map<Element, readonly string[]>(),
  visited: 0,
  truncated: false,
});

/** True when the payload can carry equations, so the parsed document needs a pass. */
export function hasWordEquationMarkup(html: string): boolean {
  return /<m:omath|msEquation|<math[\s>]/i.test(html);
}

function ommlName(node: Node): string | undefined {
  return node.nodeType === 1 ? OMML_NAME_BY_TAG.get(tagOf(node as Element)) : undefined;
}

/** Visible text below `node`, skipping `o:p` paragraph-mark placeholders. */
function collectText(node: Node, state: EquationState, depth: number, out: string[]): void {
  if (depth > MAX_EQUATION_DEPTH || !charge(state)) return;
  if (node.nodeType === 3) {
    out.push(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== 1 || tagOf(node as Element) === 'o:p') return;
  for (const child of Array.from(node.childNodes)) collectText(child, state, depth + 1, out);
}

/** HTML formatting on an element, folded into the math run format. */
function wrapperFormat(element: Element, format: MathRunFormat): MathRunFormat {
  return mathFormatOf(applyElementRunProps(applyInlineTag({}, tagOf(element)), element), format);
}

/** One `m:r`: properties first, then all run text as one `m:t`, whatever its clipboard shape. */
function ommlRunXml(
  element: Element,
  state: EquationState,
  depth: number,
  format: MathRunFormat
): string {
  let properties = '';
  const text: string[] = [];
  let runFormat = format;
  for (const child of Array.from(element.childNodes)) {
    const name = ommlName(child);
    if (name === 'rPr') {
      properties += childrenXml(child as Element, 'rPr', state, depth + 1, format);
    } else if (child.nodeType === 1 && tagOf(child as Element) === 'w:rpr') {
      // Word run properties never appear as markup on the clipboard; HTML wrappers carry them.
      continue;
    } else {
      // Formatting INSIDE the run (`<m:r><b>x</b></m:r>`) applies to the run.
      if (child.nodeType === 1 && name === undefined) {
        runFormat = wrapperFormat(child as Element, runFormat);
      }
      collectText(child, state, depth + 1, text);
    }
  }
  return mathRunXml(text.join(''), properties, runFormat);
}

function childrenXml(
  element: Element,
  container: string,
  state: EquationState,
  depth: number,
  format: MathRunFormat
): string {
  let out = '';
  let stray = '';
  const acceptsText = ARGUMENT_NAMES.has(container);
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      if (!charge(state)) break;
      if (acceptsText) stray += child.nodeValue ?? '';
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (stray.trim().length > 0) out += mathRunXml(stray, '', format);
    stray = '';
    out += mathElementXml(child as Element, container, state, depth + 1, format);
  }
  if (stray.trim().length > 0) out += mathRunXml(stray, '', format);
  return out;
}

function mathElementXml(
  element: Element,
  container: string,
  state: EquationState,
  depth: number,
  format: MathRunFormat
): string {
  if (depth > MAX_EQUATION_DEPTH) {
    state.truncated = true;
    return '';
  }
  if (!charge(state)) return '';
  const name = OMML_NAME_BY_TAG.get(tagOf(element));
  // HTML formatting between math elements is transparent: its children belong to the
  // enclosing math container, and its formatting applies to the runs inside it.
  if (name === undefined) {
    if (tagOf(element) === 'o:p') return '';
    return childrenXml(element, container, state, depth, wrapperFormat(element, format));
  }
  // `m:ctrlPr` holds Word run formatting as HTML on the clipboard; it does not travel.
  if (name === 'ctrlPr' || name === 'oMathPara' || name === 'oMath') return '';
  if (name === 'r' || name === 't') return ommlRunXml(element, state, depth, format);
  const value = element.getAttribute('m:val');
  const attribute =
    value !== null && value.length <= MAX_VALUE_LENGTH
      ? ` m:val="${escapeXmlAttribute(xmlSafeText(value))}"`
      : '';
  const inner = childrenXml(element, name, state, depth, format);
  return inner.length > 0
    ? `<m:${name}${attribute}>${inner}</m:${name}>`
    : `<m:${name}${attribute}/>`;
}

function equationXml(element: Element, state: EquationState, format: MathRunFormat): string | null {
  if (!charge(state)) return null;
  const inner = childrenXml(element, 'oMath', state, 1, format);
  return inner.length > 0 ? `<m:oMath>${inner}</m:oMath>` : null;
}

/** The display properties and `m:oMath` children of a display, through HTML wrappers. */
function displayPartsOf(
  element: Element,
  state: EquationState,
  depth: number,
  format: MathRunFormat,
  out: { properties: string; equations: string[] }
): void {
  if (depth > MAX_EQUATION_DEPTH || !charge(state)) return;
  for (const child of Array.from(element.children)) {
    const name = ommlName(child);
    if (name === 'oMath') {
      const xml = equationXml(child, state, format);
      if (xml !== null) out.equations.push(xml);
    } else if (name === 'oMathParaPr' && out.properties.length === 0) {
      out.properties = mathElementXml(child, 'oMathPara', state, depth + 1, format);
    } else if (name === undefined) {
      displayPartsOf(child, state, depth + 1, wrapperFormat(child, format), out);
    }
  }
}

function isEquationRoot(element: Element): boolean {
  const name = ommlName(element);
  return name === 'oMath' || name === 'oMathPara' || isMathmlRoot(element);
}

/** True inside another equation, or below the climb cap, where a root never sits. */
function hasMathAncestor(element: Element): boolean {
  let steps = 0;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if ((steps += 1) > MAX_ANCESTOR_CLIMB) return true;
    if (isEquationRoot(parent)) return true;
  }
  return false;
}

/** Replace each `msEquation` conditional comment that holds OMML or MathML with live markup. */
function unwrapEquationComments(document: Document, state: EquationState): void {
  if (typeof document.createTreeWalker !== 'function') return;
  const walker = document.createTreeWalker(document.body, 128 /* SHOW_COMMENT */);
  const comments: Comment[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!charge(state)) return;
    const data = (node as Comment).data;
    if (/<m:omath|<math[\s>]/i.test(data) && EQUATION_COMMENT.test(data)) {
      if (comments.length >= MAX_EQUATION_COMMENTS) {
        state.truncated = true;
        break;
      }
      comments.push(node as Comment);
    }
  }
  for (const comment of comments) {
    const inner = EQUATION_COMMENT.exec(comment.data)?.[1] ?? '';
    let parsed: Document;
    try {
      // The comment text is part of the size-capped payload. The result stays inert
      // and detached until the allowlist walk reads it; nothing executes or loads.
      // codeql[js/xss]
      parsed = new DOMParser().parseFromString(inner, 'text/html');
    } catch {
      continue;
    }
    const parent = comment.parentNode;
    if (parent === null || parsed.body === null) continue;
    for (const child of Array.from(parsed.body.childNodes)) {
      parent.insertBefore(document.importNode(child, true), comment);
    }
    parent.removeChild(comment);
  }
}

function isSignificant(node: Node): boolean {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/[\s ]/g, '').length > 0;
  return node.nodeType === 1 || node.nodeType === 8;
}

/**
 * Remove the downlevel `<![if !msEquation]>` picture that Word places after a recovered
 * equation. The equation can sit in up to two inline wrappers that end with it.
 */
function removeFallbackAfter(equation: Element): void {
  let anchor: Node = equation;
  for (let climb = 0; climb <= MAX_WRAPPER_CLIMB; climb += 1) {
    let next = anchor.nextSibling;
    while (next !== null && !isSignificant(next)) next = next.nextSibling;
    if (next !== null) {
      if (next.nodeType !== 8 || !FALLBACK_OPEN.test((next as Comment).data.trim())) return;
      const removed: Node[] = [next];
      let depth = 1;
      for (
        let node = next.nextSibling;
        node !== null && removed.length <= MAX_FALLBACK_NODES;
        node = node.nextSibling
      ) {
        removed.push(node);
        if (node.nodeType === 8) {
          const data = (node as Comment).data.trim();
          if (DOWNLEVEL_CLOSE.test(data)) depth -= 1;
          else if (DOWNLEVEL_OPEN.test(data)) depth += 1;
          if (depth === 0) {
            for (const target of removed) target.parentNode?.removeChild(target);
            return;
          }
        }
      }
      return;
    }
    const parent = anchor.parentElement;
    if (parent === null || ommlName(parent) !== undefined) return;
    const tag = tagOf(parent);
    if (tag !== 'span' && tag !== 'i' && tag !== 'b' && tag !== 'font') return;
    anchor = parent;
  }
}

/** Canonical XML for one equation root, or null when nothing recoverable remains. */
function rootXml(root: Element, state: EquationState): string | null {
  const format: MathRunFormat =
    root.getElementsByTagName('i').length > 0 ? { uprightUnlessItalic: true } : NO_MATH_FORMAT;
  if (isMathmlRoot(root)) {
    if (!charge(state)) return null;
    const inner = mathmlToOmml(root, state, format);
    if (inner.length === 0) return null;
    return isMathmlDisplay(root)
      ? `<m:oMathPara><m:oMath>${inner}</m:oMath></m:oMathPara>`
      : `<m:oMath>${inner}</m:oMath>`;
  }
  if (ommlName(root) === 'oMathPara') {
    const parts = { properties: '', equations: [] as string[] };
    displayPartsOf(root, state, 1, format, parts);
    if (parts.equations.length === 0) return null;
    return `<m:oMathPara>${parts.properties}${parts.equations.join('')}</m:oMathPara>`;
  }
  return equationXml(root, state, format);
}

/**
 * Recover the equations in a parsed clipboard document. The pass mutates the detached
 * document: it unwraps `msEquation` comments and removes the fallback pictures of
 * recovered equations.
 */
export function prepareWordEquations(document: Document, budget: number): WordEquations {
  if (document.body === null || budget <= 0) return NO_EQUATIONS;
  const state: EquationState = { left: budget, visited: 0, truncated: false };
  unwrapEquationComments(document, state);
  const byElement = new Map<Element, readonly string[]>();
  const roots: Element[] = [];
  for (const tag of ['m:omathpara', 'm:omath', 'math']) {
    const found = document.body.getElementsByTagName(tag);
    for (let index = 0; index < found.length; index += 1) {
      if (roots.length >= MAX_EQUATIONS) {
        state.truncated = true;
        break;
      }
      if (!charge(state)) break;
      const element = found[index]!;
      if (!hasMathAncestor(element)) roots.push(element);
    }
  }
  for (const root of roots) {
    if (state.left <= 0) {
      state.truncated = true;
      break;
    }
    const xml = rootXml(root, state);
    // A partial equation would change the math; the walk keeps its text and picture.
    if (xml === null || state.truncated) continue;
    byElement.set(root, [xml]);
    removeFallbackAfter(root);
  }
  return { byElement, visited: state.visited, truncated: state.truncated };
}

/** True for a projected paragraph child that is visible content, not furniture. */
export function isEquationPiece(piece: string): boolean {
  return piece.startsWith('<m:oMath>') || piece.startsWith('<m:oMathPara>');
}
