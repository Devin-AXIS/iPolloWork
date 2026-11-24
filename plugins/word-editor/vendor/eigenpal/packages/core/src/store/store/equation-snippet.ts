// The one OOXML shape the editing API inserts: a Flat OPC package that holds one equation.
//
// `Range.insertOoxml` hands this module caller data, which is untrusted XML. It is read
// through the bounded reader (`xml-reader.ts`: no DTD, no entity declarations, size, element
// and depth caps) and accepted only in one narrow shape:
//
//   pkg:package
//     pkg:part /_rels/.rels         optional; exactly one officeDocument relationship
//     pkg:part /word/document.xml   w:document > w:body > exactly one w:p
//
// The paragraph holds exactly one inline `m:oMath` and, around it, plain runs (`w:r` with
// `w:rPr`, `w:t`, `w:tab`). Every element is checked against an allowlist: OMML structure
// and properties, and character formatting. Any other part, relationship, external target,
// binary data, image, field, paragraph property, display equation (`m:oMathPara`), or
// unknown element or attribute refuses. Revision-session identifiers (`w:rsid*`) and
// paragraph identities (`w14:paraId`, `w14:textId`) carry no content and are ignored.
//
// The accepted content is re-emitted from the checked pieces with fixed prefixes and escaped
// values, then read into canonical nodes. Nothing in the input is fetched or evaluated.

import { OFFICE_MATH_NAMESPACE_URI } from '../package/omml-equation.ts';
import { isOmmlEquationAtom } from '../package/omml-display.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { readOoxmlPart, type OoxmlNode, type OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { escapeXml, escapeXmlAttribute, isValidXmlText } from '../package/sinks.ts';
import { storyParagraphs } from '../package/story-blocks.ts';
import { readXml, type XmlNode } from '../package/xml-reader.ts';
import { paragraphLength } from './tree-op-segments.ts';

/** The longest `ooxml` string the editing API reads, in UTF-8 bytes. */
export const MAX_EQUATION_SNIPPET_BYTES = 256 * 1024;
/** The most elements one snippet may hold, package wrappers included. */
export const MAX_EQUATION_SNIPPET_ELEMENTS = 8_192;
/** Text values one `w:t` or `m:t` may hold in a hand-built op; the reader yields one. */
const MAX_TEXT_VALUES_PER_ELEMENT = 16;
/** The deepest element nesting one snippet may hold, package wrappers included. */
export const MAX_EQUATION_SNIPPET_DEPTH = 64;
/** The longest attribute value or text the snippet may carry. */
const MAX_VALUE_CHARS = 4_096;

const PKG = 'http://schemas.microsoft.com/office/2006/xmlPackage';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const RELATIONSHIPS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

/** Why a snippet refused. `resource-limit` is size, element count, or depth. */
export type EquationSnippetRefusal = 'ooxml-invalid' | 'ooxml-unsupported' | 'resource-limit';

/** The checked equation: its inline nodes in order, and their length in model units. */
export interface EquationSnippet {
  readonly nodes: readonly OoxmlNode[];
  readonly length: number;
}

export type EquationSnippetResult =
  | { readonly ok: true; readonly snippet: EquationSnippet }
  | { readonly ok: false; readonly reason: EquationSnippetRefusal };

/** Character formatting a plain run, or a math run, may carry. */
const RUN_PROPERTIES: ReadonlySet<string> = new Set([
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'color',
  'sz',
  'szCs',
  'highlight',
  'u',
  'vertAlign',
  'lang',
  'noProof',
]);

/** OMML structure and properties. Document-wide math settings and displays are excluded. */
const MATH_ELEMENTS: ReadonlySet<string> = new Set(
  (
    'acc accPr aln alnScr argPr argSz bar barPr baseJc begChr borderBox borderBoxPr box boxPr ' +
    'brk cGp cGpRule chr count cSp ctrlPr d deg degHide den diff dPr e endChr eqArr eqArrPr f ' +
    'fName fPr func funcPr groupChr groupChrPr grow hideBot hideLeft hideRight hideTop lim ' +
    'limLoc limLow limLowPr limUpp limUppPr lit m maxDist mc mcJc mcPr mcs mPr mr nary naryPr ' +
    'noBreak nor num objDist oMath opEmu phant phantPr plcHide pos r rad radPr rPr rSp rSpRule ' +
    'scr sepChr show shp sPre sPrePr sSub sSubPr sSubSup sSubSupPr sSup sSupPr strikeBLTR ' +
    'strikeH strikeTLBR strikeV sty sub subHide sup supHide t transp type vertJc zeroAsc ' +
    'zeroDesc zeroWid'
  ).split(' ')
);

class Refused extends Error {
  constructor(readonly reason: EquationSnippetRefusal) {
    super(reason);
  }
}

const refuse = (reason: EquationSnippetRefusal = 'ooxml-unsupported'): never => {
  throw new Refused(reason);
};

type Element = Extract<XmlNode, { type: 'element' }>;
type Scope = ReadonlyMap<string, string>;

interface Named {
  readonly element: Element;
  readonly namespace: string;
  readonly local: string;
  readonly scope: Scope;
}

/** The element's namespace and local name, with the bindings its own attributes declare. */
function named(element: Element, parent: Scope): Named {
  let scope = parent;
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    if (scope === parent) scope = new Map(parent);
    (scope as Map<string, string>).set(name === 'xmlns' ? '' : name.slice(6), value);
  }
  const colon = element.name.indexOf(':');
  const prefix = colon < 0 ? '' : element.name.slice(0, colon);
  const namespace = scope.get(prefix);
  if (namespace === undefined) return refuse('ooxml-invalid');
  return { element, namespace, local: element.name.slice(colon + 1), scope };
}

/** The element's attributes other than namespace declarations, resolved. */
function attributesOf({
  element,
  scope,
}: Named): { readonly namespace: string; readonly local: string; readonly value: string }[] {
  const out: { namespace: string; local: string; value: string }[] = [];
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const namespace =
      colon < 0 ? '' : prefix === 'xml' ? XML : (scope.get(prefix) ?? refuse('ooxml-invalid'));
    if (value.length > MAX_VALUE_CHARS) refuse('resource-limit');
    out.push({ namespace, local: name.slice(colon + 1), value });
  }
  return out;
}

/** Child elements; text between them must be whitespace. */
function childrenOf(node: Named): Named[] {
  const out: Named[] = [];
  for (const child of node.element.children) {
    if (child.type === 'text') {
      if (child.value.trim().length > 0) refuse();
      continue;
    }
    out.push(named(child, node.scope));
  }
  return out;
}

/** Text content of a `w:t` or `m:t`: text only, valid XML 1.0. */
function textOf(node: Named): string {
  let text = '';
  for (const child of node.element.children) {
    if (child.type !== 'text') refuse();
    else text += child.value;
  }
  if (text.length > MAX_VALUE_CHARS) refuse('resource-limit');
  if (!isValidXmlText(text)) refuse('ooxml-invalid');
  return text;
}

const is = (node: Named, namespace: string, local: string): boolean =>
  node.namespace === namespace && node.local === local;

function emitAttributes(prefix: string, node: Named, allowed: (local: string) => boolean): string {
  let out = '';
  for (const attribute of attributesOf(node)) {
    if (attribute.namespace === XML && attribute.local === 'space') {
      if (attribute.value !== 'preserve' && attribute.value !== 'default') refuse();
      out += ` xml:space="${attribute.value}"`;
      continue;
    }
    const own = prefix === 'w' ? WML_NAMESPACE_URI : OFFICE_MATH_NAMESPACE_URI;
    if (attribute.namespace !== own || !allowed(attribute.local)) refuse();
    out += ` ${prefix}:${attribute.local}="${escapeXmlAttribute(attribute.value)}"`;
  }
  return out;
}

/** `w:rPr` with allowlisted children, each carrying WML attributes only. */
function emitRunProperties(node: Named): string {
  if (attributesOf(node).length > 0) refuse();
  let out = '';
  for (const child of childrenOf(node)) {
    if (child.namespace !== WML_NAMESPACE_URI || !RUN_PROPERTIES.has(child.local)) refuse();
    if (childrenOf(child).length > 0) refuse();
    out += `<w:${child.local}${emitAttributes('w', child, () => true)}/>`;
  }
  return `<w:rPr>${out}</w:rPr>`;
}

const ignoredRunAttribute = (attribute: { namespace: string; local: string }): boolean =>
  attribute.namespace === WML_NAMESPACE_URI && attribute.local.startsWith('rsid');

/** A plain run: `w:rPr`, `w:t`, and `w:tab` only. */
function emitPlainRun(node: Named): string {
  if (attributesOf(node).some((attribute) => !ignoredRunAttribute(attribute))) refuse();
  let out = '';
  for (const child of childrenOf(node)) {
    if (is(child, WML_NAMESPACE_URI, 'rPr')) out += emitRunProperties(child);
    else if (is(child, WML_NAMESPACE_URI, 'tab') && childrenOf(child).length === 0) {
      if (attributesOf(child).length > 0) refuse();
      out += '<w:tab/>';
    } else if (is(child, WML_NAMESPACE_URI, 't')) {
      out += `<w:t${emitAttributes('w', child, () => false)}>${escapeXml(textOf(child))}</w:t>`;
    } else refuse();
  }
  return `<w:r>${out}</w:r>`;
}

/** One OMML element and its subtree, against the allowlist. */
function emitMath(node: Named, depth: number): string {
  if (depth > MAX_EQUATION_SNIPPET_DEPTH) refuse('resource-limit');
  if (node.namespace !== OFFICE_MATH_NAMESPACE_URI || !MATH_ELEMENTS.has(node.local)) refuse();
  const attributes = emitAttributes('m', node, (local) => local === 'val');
  if (node.local === 't') return `<m:t${attributes}>${escapeXml(textOf(node))}</m:t>`;
  let out = '';
  for (const child of childrenOf(node)) {
    // Formatting of a math run, or of a structure's control characters.
    if (is(child, WML_NAMESPACE_URI, 'rPr') && (node.local === 'r' || node.local === 'ctrlPr'))
      out += emitRunProperties(child);
    else out += emitMath(child, depth + 1);
  }
  return `<m:${node.local}${attributes}>${out}</m:${node.local}>`;
}

/** The paragraph's inline content, or a refusal. Exactly one inline `m:oMath`. */
function emitParagraph(paragraph: Named): string {
  for (const attribute of attributesOf(paragraph)) {
    const identity =
      attribute.namespace === W14 && (attribute.local === 'paraId' || attribute.local === 'textId');
    if (!identity && !ignoredRunAttribute(attribute)) refuse();
  }
  let equations = 0;
  let out = '';
  for (const child of childrenOf(paragraph)) {
    if (is(child, WML_NAMESPACE_URI, 'r')) out += emitPlainRun(child);
    else if (is(child, OFFICE_MATH_NAMESPACE_URI, 'oMath')) {
      equations += 1;
      out += emitMath(child, 0);
    } else refuse();
  }
  if (equations !== 1) refuse();
  return out;
}

function readRelationships(root: Named): void {
  if (!is(root, RELATIONSHIPS, 'Relationships') || attributesOf(root).length > 0) refuse();
  const relationships = childrenOf(root);
  if (relationships.length !== 1) refuse();
  const relationship = relationships[0]!;
  if (!is(relationship, RELATIONSHIPS, 'Relationship') || childrenOf(relationship).length > 0)
    refuse();
  const attributes = new Map<string, string>();
  for (const attribute of attributesOf(relationship)) {
    if (attribute.namespace !== '') refuse();
    attributes.set(attribute.local, attribute.value);
  }
  for (const name of attributes.keys()) {
    if (name !== 'Id' && name !== 'Type' && name !== 'Target' && name !== 'TargetMode') refuse();
  }
  const target = attributes.get('Target');
  const mode = attributes.get('TargetMode');
  if (
    attributes.get('Type') !== OFFICE_DOCUMENT ||
    (target !== 'word/document.xml' && target !== '/word/document.xml') ||
    (mode !== undefined && mode !== 'Internal')
  )
    refuse();
}

/** The single element inside a part's `pkg:xmlData`. Binary data refuses. */
function xmlDataOf(part: Named): Named {
  const children = childrenOf(part);
  const data = children[0];
  if (children.length !== 1 || !data || !is(data, PKG, 'xmlData')) refuse();
  if (attributesOf(data!).length > 0) refuse();
  const roots = childrenOf(data!);
  if (roots.length !== 1) refuse();
  return roots[0]!;
}

/** Package wrappers above the equation: package, part, xmlData, document, body, p. */
const WRAPPER_DEPTH = 6;

/**
 * Whether the markup nests deeper than a snippet may, counted before the parser runs: the
 * parser reports very deep input as a parse error, and it is a size limit, not malformed XML.
 * One pass over the characters, never a regex: the input is untrusted, and a tag pattern
 * that can rescan from every `<` is quadratic on input with no `>`.
 */
function nestsTooDeep(ooxml: string): boolean {
  const limit = WRAPPER_DEPTH + MAX_EQUATION_SNIPPET_DEPTH + 1;
  let depth = 0;
  let tagStart = -1;
  for (let index = 0; index < ooxml.length; index += 1) {
    const char = ooxml.charCodeAt(index);
    if (char === LESS_THAN) {
      tagStart = index;
    } else if (char === GREATER_THAN && tagStart !== -1) {
      const first = ooxml.charCodeAt(tagStart + 1);
      if (first === SLASH) depth -= 1;
      else if (opensElement(first) && ooxml.charCodeAt(index - 1) !== SLASH) {
        depth += 1;
        if (depth > limit) return true;
      }
      tagStart = -1;
    }
  }
  return false;
}

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;
const SLASH = 0x2f;

/** Whether `<` followed by this character opens an element (not `<!`, `<?`, or `< `). */
function opensElement(char: number): boolean {
  return (
    char !== GREATER_THAN &&
    char !== 0x21 &&
    char !== 0x3f &&
    char !== 0x20 &&
    char !== 0x09 &&
    char !== 0x0a &&
    char !== 0x0d
  );
}

/** The checked inline content of the package's one document paragraph. */
function documentContent(ooxml: string): string {
  if (ooxml.length > MAX_EQUATION_SNIPPET_BYTES) refuse('resource-limit');
  if (nestsTooDeep(ooxml)) refuse('resource-limit');
  const read = readXml(ooxml, {
    maxBytes: MAX_EQUATION_SNIPPET_BYTES,
    maxElements: MAX_EQUATION_SNIPPET_ELEMENTS,
  });
  if (!read.ok) {
    return refuse(
      read.reason === 'too-large' ||
        read.reason === 'too-many-elements' ||
        read.reason === 'too-deep'
        ? 'resource-limit'
        : 'ooxml-invalid'
    );
  }
  const roots = read.nodes.filter((node): node is Element => node.type === 'element');
  if (roots.length !== 1) refuse('ooxml-invalid');
  const root = named(roots[0]!, new Map([['xml', XML]]));
  if (!is(root, PKG, 'package') || attributesOf(root).length > 0) refuse();
  let content: string | null = null;
  let relationships = false;
  for (const part of childrenOf(root)) {
    if (!is(part, PKG, 'part')) refuse();
    const attributes = new Map<string, string>();
    for (const attribute of attributesOf(part)) {
      if (attribute.namespace !== PKG) refuse();
      attributes.set(attribute.local, attribute.value);
    }
    for (const name of attributes.keys()) {
      if (name !== 'name' && name !== 'contentType' && name !== 'padding') refuse();
    }
    const name = attributes.get('name');
    const type = attributes.get('contentType');
    if (name === '/_rels/.rels' && type === RELATIONSHIPS_CONTENT_TYPE && !relationships) {
      relationships = true;
      readRelationships(xmlDataOf(part));
    } else if (name === '/word/document.xml' && type === MAIN_CONTENT_TYPE && content === null) {
      content = documentParagraph(xmlDataOf(part));
    } else refuse();
  }
  return content ?? refuse();
}

function documentParagraph(document: Named): string {
  if (!is(document, WML_NAMESPACE_URI, 'document')) refuse();
  // Root attributes are markup-compatibility declarations; they carry no content.
  const bodies = childrenOf(document);
  const body = bodies[0];
  if (bodies.length !== 1 || !body || !is(body, WML_NAMESPACE_URI, 'body')) refuse();
  if (attributesOf(body!).length > 0) refuse();
  const blocks = childrenOf(body!);
  const paragraph = blocks[0];
  if (blocks.length !== 1 || !paragraph || !is(paragraph, WML_NAMESPACE_URI, 'p')) refuse();
  return emitParagraph(paragraph!);
}

/**
 * Read `ooxml` as the one equation shape the editing API inserts.
 *
 * Never throws: every refusal is a typed reason. The nodes come from the bounded part reader,
 * so they are the canonical tree any opened document holds.
 */
export function readEquationSnippet(ooxml: unknown): EquationSnippetResult {
  if (typeof ooxml !== 'string') return { ok: false, reason: 'ooxml-invalid' };
  let content: string;
  try {
    content = documentContent(ooxml);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    return { ok: false, reason: 'ooxml-invalid' };
  }
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: MAIN_CONTENT_TYPE },
    { maxBytes: MAX_EQUATION_SNIPPET_BYTES * 2, maxElements: MAX_EQUATION_SNIPPET_ELEMENTS }
  );
  if (!read.ok) return { ok: false, reason: 'ooxml-invalid' };
  const body = read.part.root.children.find((node) => node.kind === 'body');
  const paragraph = body && storyParagraphs(body)[0];
  if (!paragraph || paragraph.kind !== 'paragraph') return { ok: false, reason: 'ooxml-invalid' };
  const nodes = paragraph.children;
  if (nodes.filter(isOmmlEquationAtom).length !== 1) return { ok: false, reason: 'ooxml-invalid' };
  return {
    ok: true,
    snippet: { nodes, length: paragraphLength(paragraph as OoxmlParagraphNode) },
  };
}

/** Budget for one shape check: nodes left to visit. */
interface ShapeBudget {
  nodes: number;
}

function isElementNode(node: unknown): node is Exclude<OoxmlNode, { kind: 'textValue' }> {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as OoxmlNode).kind !== 'textValue' &&
    Array.isArray((node as { children?: unknown }).children) &&
    Array.isArray((node as { attributes?: unknown }).attributes)
  );
}

const hasName = (node: OoxmlNode, namespace: string, local: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === namespace && node.localName === local;

/**
 * Text values only, as `w:t` and `m:t` hold. They do not spend the element budget, because the
 * reader counts elements only: a snippet the reader admits must pass here too. Their number per
 * element is capped instead, so a hand-built op cannot grow without bound.
 */
function holdsOnlyText(
  node: Exclude<OoxmlNode, { kind: 'textValue' }>,
  _budget: ShapeBudget
): boolean {
  if (node.children.length > MAX_TEXT_VALUES_PER_ELEMENT) return false;
  return node.children.every((child) => {
    return (
      !!child &&
      child.kind === 'textValue' &&
      typeof child.value === 'string' &&
      child.value.length <= MAX_VALUE_CHARS
    );
  });
}

/** Attributes from `namespace` (or `xml:space`) that `allowed` admits. */
function attributesAllowed(
  node: Exclude<OoxmlNode, { kind: 'textValue' }>,
  namespace: string,
  allowed: (local: string) => boolean
): boolean {
  return node.attributes.every(
    (attribute) =>
      (attribute.namespaceUri === XML && attribute.localName === 'space') ||
      (attribute.namespaceUri === namespace &&
        allowed(attribute.localName) &&
        typeof attribute.value === 'string' &&
        attribute.value.length <= MAX_VALUE_CHARS)
  );
}

/** A `w:rPr` with allowlisted, childless formatting elements. */
function isRunPropertiesShape(node: OoxmlNode, budget: ShapeBudget): boolean {
  if (
    !isElementNode(node) ||
    !hasName(node, WML_NAMESPACE_URI, 'rPr') ||
    node.attributes.length > 0
  )
    return false;
  return node.children.every((child) => {
    budget.nodes -= 1;
    return (
      budget.nodes > 0 &&
      isElementNode(child) &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      RUN_PROPERTIES.has(child.localName) &&
      child.children.length === 0 &&
      attributesAllowed(child, WML_NAMESPACE_URI, () => true)
    );
  });
}

function isPlainRunShape(node: OoxmlNode, budget: ShapeBudget): boolean {
  if (!isElementNode(node) || node.kind !== 'run' || node.attributes.length > 0) return false;
  return node.children.every((child) => {
    budget.nodes -= 1;
    if (budget.nodes <= 0 || !isElementNode(child)) return false;
    if (hasName(child, WML_NAMESPACE_URI, 'rPr')) return isRunPropertiesShape(child, budget);
    if (hasName(child, WML_NAMESPACE_URI, 'tab'))
      return child.children.length === 0 && child.attributes.length === 0;
    return (
      hasName(child, WML_NAMESPACE_URI, 't') &&
      attributesAllowed(child, WML_NAMESPACE_URI, () => false) &&
      holdsOnlyText(child, budget)
    );
  });
}

/** One OMML subtree against the allowlist the reader applied. */
function isMathShape(node: OoxmlNode, depth: number, budget: ShapeBudget): boolean {
  budget.nodes -= 1;
  if (budget.nodes <= 0 || depth > MAX_EQUATION_SNIPPET_DEPTH || !isElementNode(node)) return false;
  if (node.namespaceUri !== OFFICE_MATH_NAMESPACE_URI || !MATH_ELEMENTS.has(node.localName))
    return false;
  if (!attributesAllowed(node, OFFICE_MATH_NAMESPACE_URI, (local) => local === 'val')) return false;
  if (node.localName === 't') return holdsOnlyText(node, budget);
  return node.children.every((child) =>
    hasName(child, WML_NAMESPACE_URI, 'rPr') &&
    (node.localName === 'r' || node.localName === 'ctrlPr')
      ? isRunPropertiesShape(child, budget)
      : isMathShape(child, depth + 1, budget)
  );
}

/**
 * Whether `nodes` is a shape {@link readEquationSnippet} answers: plain runs and exactly one
 * inline `m:oMath`, every element on the reader's allowlists. The tree op checks it again,
 * because an op is a trust boundary too. The budget is the reader's element budget, so any
 * snippet the reader admits passes here.
 */
export function isEquationSnippetShape(nodes: unknown): nodes is readonly OoxmlNode[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const budget: ShapeBudget = { nodes: MAX_EQUATION_SNIPPET_ELEMENTS + 1 };
  let equations = 0;
  for (const node of nodes as readonly unknown[]) {
    budget.nodes -= 1;
    if (budget.nodes <= 0 || !isElementNode(node)) return false;
    if (hasName(node, OFFICE_MATH_NAMESPACE_URI, 'oMath')) {
      equations += 1;
      if (!isMathShape(node, 0, budget)) return false;
    } else if (!isPlainRunShape(node, budget)) return false;
  }
  return equations === 1;
}
