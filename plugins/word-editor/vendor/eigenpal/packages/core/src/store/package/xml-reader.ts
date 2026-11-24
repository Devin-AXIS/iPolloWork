// Bounded, fidelity-preserving XML reader (document-engine task 2.4 / design D14).
// Uses fast-xml-parser but at the trust boundary: it PRE-REJECTS DTDs, entity
// declarations, and external-entity references before parsing (fast-xml-parser
// can otherwise process DOCTYPE/entities), disables entity expansion and value
// coercion, and preserves significant child order, attributes, whitespace, and
// raw lexical values. Output is ordered and every attribute record has a null prototype.

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decodeXmlEntities, ownString, validateXmlText } from './xml-text.ts';
import { fastReadXml } from './xml-fast-read.ts';
import { DEFAULT_LIMITS, HARD_CEILINGS } from '../runtime/limits.ts';

/**
 * One parsed XML node, preserving significant order, whitespace and raw lexical values.
 *
 * Attribute records have a NULL prototype: attribute names come from a file and become object
 * keys, so `__proto__` must be inert by construction rather than by filtering.
 */
export type XmlNode =
  | {
      readonly type: 'element';
      readonly name: string;
      readonly attributes: Readonly<Record<string, string>>;
      readonly children: readonly XmlNode[];
    }
  | { readonly type: 'text'; readonly value: string };

/**
 * Why XML was refused at the trust boundary.
 *
 * DTDs, entity declarations and external-entity references are PRE-rejected before parsing —
 * blocking XXE and billion-laughs by never handing the parser the construct, rather than by
 * trusting it to be configured safely.
 */
export type XmlRejection =
  | 'too-large'
  | 'dtd-forbidden'
  | 'entity-forbidden'
  | 'too-deep'
  | 'too-many-elements'
  | 'invalid-limits'
  | 'parse-error';

/**
 * Recursion-depth ceiling at the trust boundary, enforced twice: `preflightDepth` refuses
 * the bytes before the parser allocates anything, and `convert` throws if a tree somehow
 * exceeds it anyway. Exported because it is what BOUNDS every later walk over a part —
 * nothing downstream needs a cap of its own smaller than this one, and a smaller cap only
 * makes that walk stop early on a document this one already admitted.
 */
export const MAX_XML_DEPTH = 256;
const MAX_DEPTH = MAX_XML_DEPTH;
export const XML_HARD_MAX_BYTES = 64 * 1024 * 1024;
// Share the engine's resource policy instead of imposing a second, smaller ceiling.
// These are defensive budgets, not a guarantee that every document fits the host's memory.
export const XML_DEFAULT_MAX_ELEMENTS = DEFAULT_LIMITS.maxElementCount;
export const XML_HARD_MAX_ELEMENTS = HARD_CEILINGS.maxElementCount;

class DepthError extends Error {}
class ElementCountError extends Error {}

/** A parsed document, or a typed refusal. Never throws — the input is untrusted. */
export type XmlResult =
  | { readonly ok: true; readonly nodes: readonly XmlNode[] }
  | { readonly ok: false; readonly reason: XmlRejection };

// Sticky (`y`) so the scan can anchor at an ampersand without slicing the tail of a
// multi-megabyte part. `lastIndex` is shared mutable state: every caller MUST assign it
// immediately before `test`, as `preflightForbiddenXml` does.
const CUSTOM_ENTITY_REF_STICKY_RE = /&(?!(amp|lt|gt|quot|apos);)[A-Za-z_][\w.-]*;/y;

function validLimit(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Reject active declarations/references while treating CDATA, comments, and PIs as literal. */
function preflightForbiddenXml(xml: string): XmlRejection | undefined {
  for (let i = 0; i < xml.length; i += 1) {
    // Everything this preflight can object to starts at '<' or '&'; skipping every other
    // character keeps the scan linear without per-character slicing on multi-megabyte parts.
    const ch = xml.charCodeAt(i);
    if (ch !== 0x3c /* '<' */ && ch !== 0x26 /* '&' */) continue;
    if (ch === 0x26) {
      CUSTOM_ENTITY_REF_STICKY_RE.lastIndex = i;
      if (CUSTOM_ENTITY_REF_STICKY_RE.test(xml)) return 'entity-forbidden';
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) return 'parse-error';
      i = end + 1;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      const declaration = xml.slice(i, i + 10).toUpperCase();
      if (declaration.startsWith('<!DOCTYPE')) return 'dtd-forbidden';
      if (declaration.startsWith('<!ENTITY')) return 'entity-forbidden';
    }
  }
  return undefined;
}

/** Return once the UTF-8 encoding exceeds the limit, without allocating encoded bytes. */
function exceedsUtf8Bytes(value: string, limit: number): boolean {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
}

/** Count lexical start tags before XMLParser allocates its object tree. Comments,
 * CDATA, processing instructions, and closing tags are skipped quote-aware. */
function preflightElementCount(xml: string, maxElements: number): XmlRejection | undefined {
  let count = 0;
  for (let i = 0; i < xml.length; i += 1) {
    if (xml[i] !== '<') continue;
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) return 'parse-error';
      i = end + 1;
      continue;
    }
    const next = xml[i + 1];
    if (next === '/' || next === '!') continue;
    count += 1;
    if (count > maxElements) return 'too-many-elements';
    let quote: '"' | "'" | undefined;
    let closed = false;
    for (i += 1; i < xml.length; i += 1) {
      const c = xml[i];
      if (quote) {
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') {
        closed = true;
        break;
      }
    }
    if (!closed) return 'parse-error';
  }
  return undefined;
}

/** Reject excessive lexical nesting before XMLParser allocates its object tree. */
function preflightDepth(xml: string): XmlRejection | undefined {
  let depth = 0;
  for (let i = 0; i < xml.length; i += 1) {
    if (xml[i] !== '<') continue;
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) return 'parse-error';
      i = end + 1;
      continue;
    }
    if (xml.startsWith('</', i)) {
      depth = Math.max(0, depth - 1);
      const end = xml.indexOf('>', i + 2);
      if (end < 0) return 'parse-error';
      i = end;
      continue;
    }
    if (xml.startsWith('<!', i)) continue;
    let quote: '"' | "'" | undefined;
    let end = -1;
    for (let j = i + 1; j < xml.length; j += 1) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') {
        end = j;
        break;
      }
    }
    if (end < 0) return 'parse-error';
    const selfClosing = xml
      .slice(i + 1, end)
      .trimEnd()
      .endsWith('/');
    if (!selfClosing) {
      depth += 1;
      if (depth > MAX_DEPTH + 1) return 'too-deep';
    }
    i = end;
  }
  return undefined;
}

/** Per-part caps on size, element count and depth. Clamped into the hard ceilings. */
export interface XmlLimits {
  readonly maxBytes: number;
  /** Element budget; may raise or lower the engine default, up to its hard ceiling. */
  readonly maxElements?: number;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false, // preserve significant whitespace
  parseTagValue: false, // never coerce text to number/boolean
  parseAttributeValue: false, // never coerce attributes
  processEntities: false, // no entity expansion (billion laughs)
  htmlEntities: false,
  cdataPropName: '#cdata', // distinguish literal CDATA from entity-bearing text
  ignoreDeclaration: true,
  ignorePiTags: true,
  // No callback reads a tag path. The default built one string per element and attribute
  // list, a noticeable share of reading a long part.
  jPath: false,
});

/** What the whole-part checks leave a read: the element budget, or a rejection. */
export type XmlChecked =
  | { readonly ok: true; readonly maxElements: number }
  | { readonly ok: false; readonly reason: XmlRejection };

/**
 * The bounded checks `readXml` runs over a whole part before parsing: limits, size, forbidden
 * constructs, element count, and depth. Well-formedness is {@link validateWholeXml}.
 *
 * @internal Split out so a long part can run them in tasks of their own.
 */
export function preflightXml(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): XmlChecked {
  const steps = preflightXmlSteps(xml, limits);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * The first of the bounded checks: valid limits, and a part within the byte budget. Gives the
 * element budget. Every read runs it before anything else looks at the part.
 *
 * @internal
 */
export function checkXmlSize(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): XmlChecked {
  if (
    !validLimit(limits.maxBytes) ||
    (limits.maxElements !== undefined && !validLimit(limits.maxElements))
  )
    return { ok: false, reason: 'invalid-limits' };
  const maxBytes = Math.min(limits.maxBytes, XML_HARD_MAX_BYTES);
  const maxElements = Math.min(
    limits.maxElements ?? XML_DEFAULT_MAX_ELEMENTS,
    XML_HARD_MAX_ELEMENTS
  );
  if (exceedsUtf8Bytes(xml, maxBytes)) return { ok: false, reason: 'too-large' };
  return { ok: true, maxElements };
}

/** @internal {@link preflightXml}, yielding between its whole-part scans. */
export function* preflightXmlSteps(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): Generator<void, XmlChecked> {
  const sized = checkXmlSize(xml, limits);
  if (!sized.ok) return sized;
  const { maxElements } = sized;
  const forbidden = preflightForbiddenXml(xml);
  if (forbidden) return { ok: false, reason: forbidden };
  yield;
  const preflight = preflightElementCount(xml, maxElements);
  if (preflight) return { ok: false, reason: preflight };
  yield;
  const depthPreflight = preflightDepth(xml);
  if (depthPreflight) return { ok: false, reason: depthPreflight };
  return { ok: true, maxElements };
}

/** @internal Whether the whole part is well-formed, as `readXml` decides it. */
export function validateWholeXml(xml: string): boolean {
  return XMLValidator.validate(xml) === true;
}

/** An element budget shared by every fragment of one part. */
export interface XmlElementBudget {
  count: number;
  readonly maxElements: number;
}

/** Read XML into an ordered tree, refusing DTDs/entities and bounding size. */
/**
 * Read XML at the trust boundary: bounded, entity-free, and fidelity-preserving.
 *
 * Pre-rejects DTDs and entity constructs, disables expansion and value coercion, and keeps child
 * order, attributes, whitespace and raw lexical form — everything a lossless re-emit needs.
 */
export function readXml(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): XmlResult {
  // A part in the plain subset reads in one pass (`xml-fast-read.ts`); anything else, and
  // every refusal, takes the full bounded read below.
  const sized = checkXmlSize(xml, limits);
  if (!sized.ok) return sized;
  const fast = fastReadXml(xml, sized.maxElements);
  if (fast !== null) return { ok: true, nodes: fast };
  return readXmlBounded(xml, limits);
}

/**
 * {@link readXml} without the one-pass reader: every bounded check, then the parse.
 *
 * @internal Exported so tests can hold the one-pass reader to this one.
 */
export function readXmlBounded(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): XmlResult {
  const checked = preflightXml(xml, limits);
  if (!checked.ok) return checked;
  if (!validateWholeXml(xml)) return { ok: false, reason: 'parse-error' };
  return parseChecked(xml, 0, { count: 0, maxElements: checked.maxElements }, false);
}

/**
 * Parse one run of sibling content from a part that already passed {@link preflightXml} and
 * {@link validateWholeXml} whole, at `depth`, against the part's shared `budget`. The run
 * must be a balanced content sequence; it is read inside a neutral wrapper element.
 *
 * @internal For reading a long part in tasks of its own.
 */
export function readXmlFragment(
  fragment: string,
  depth: number,
  budget: XmlElementBudget
): XmlResult {
  const wrapped = `<r>${fragment}</r>`;
  // The parser builds a tree from an unbalanced run without complaint, so a cut in the wrong
  // place must fail here rather than read as different content.
  if (XMLValidator.validate(wrapped) !== true) return { ok: false, reason: 'parse-error' };
  return parseChecked(wrapped, depth, budget, true);
}

/**
 * Parse a whole document that already passed {@link preflightXml} and {@link validateWholeXml}
 * (or a document assembled from such a part), against `budget`.
 *
 * @internal For reading a long part in tasks of its own.
 */
export function readCheckedXml(xml: string, budget: XmlElementBudget): XmlResult {
  return parseChecked(xml, 0, budget, false);
}

function parseChecked(
  xml: string,
  depth: number,
  budget: XmlElementBudget,
  wrapped: boolean
): XmlResult {
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  try {
    let items = raw as FxpNode[];
    if (wrapped) {
      const wrapper = items.length === 1 ? items[0]!['r'] : undefined;
      if (!Array.isArray(wrapper)) return { ok: false, reason: 'parse-error' };
      items = wrapper as FxpNode[];
    }
    return { ok: true, nodes: convert(items, depth, budget) };
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof DepthError
          ? 'too-deep'
          : e instanceof ElementCountError
            ? 'too-many-elements'
            : 'parse-error',
    };
  }
}

// fast-xml-parser preserveOrder node: { [tag]: children[], ':@'?: {"@_a": v} } |
// { '#text': v } | { '#cdata': [{ '#text': raw }] }.
type FxpNode = Record<string, unknown>;

/** Fail closed on non-string parser values — `String({})` is "[object Object]". */
export function requireXmlStringScalar(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`non-scalar ${what}`);
  return value;
}

function cdataText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw new Error('non-scalar cdata');
  return value
    .map((entry) => {
      if (entry !== null && typeof entry === 'object' && '#text' in entry)
        return requireXmlStringScalar((entry as Record<string, unknown>)['#text'], 'cdata');
      throw new Error('non-scalar cdata');
    })
    .join('');
}

function convert(items: FxpNode[], depth: number, budget: XmlElementBudget): XmlNode[] {
  if (depth > MAX_DEPTH) throw new DepthError();
  const out: XmlNode[] = [];
  for (const item of items) {
    if ('#text' in item) {
      out.push({
        type: 'text',
        value: decodeXmlEntities(requireXmlStringScalar(item['#text'], 'text')),
      });
      continue;
    }
    if ('#cdata' in item) {
      out.push({ type: 'text', value: ownString(validateXmlText(cdataText(item['#cdata']))) });
      continue;
    }
    const attrs = item[':@'] as Record<string, unknown> | undefined;
    // Plain loops: this runs once per element and attribute of every part, and the
    // array-building helpers cost a noticeable share of reading a long document.
    const keys = Object.keys(item);
    let tagKey: string | undefined;
    for (const key of keys) {
      if (key !== ':@') {
        tagKey = key;
        break;
      }
    }
    if (!tagKey) continue;
    budget.count += 1;
    if (budget.count > budget.maxElements) throw new ElementCountError();
    const attributes = Object.create(null) as Record<string, string>;
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        // Fail closed on non-scalars: `String({})` is "[object Object]", which would
        // silently corrupt authored attribute values (e.g. w:fldSimple/@w:instr) and
        // then round-trip as if that garbage were source text.
        attributes[k.startsWith('@_') ? k.slice(2) : k] = decodeXmlEntities(
          requireXmlStringScalar(attrs[k], 'attribute')
        );
      }
    }
    out.push({
      type: 'element',
      name: tagKey,
      attributes,
      children: convert((item[tagKey] as FxpNode[]) ?? [], depth + 1, budget),
    });
  }
  return out;
}

/** Find the first descendant element with the given qualified name. */
export function findElement(
  nodes: readonly XmlNode[],
  name: string
): Extract<XmlNode, { type: 'element' }> | undefined {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.name === name) return node;
    const nested = findElement(node.children, name);
    if (nested) return nested;
  }
  return undefined;
}

/** All direct child elements with the given name. */
export function childElements(
  node: Extract<XmlNode, { type: 'element' }>,
  name: string
): Extract<XmlNode, { type: 'element' }>[] {
  return node.children.filter(
    (c): c is Extract<XmlNode, { type: 'element' }> => c.type === 'element' && c.name === name
  );
}

/** Concatenated text content of an element (all descendant text nodes). */
export function textContent(node: Extract<XmlNode, { type: 'element' }>): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else out += textContent(child);
  }
  return out;
}
