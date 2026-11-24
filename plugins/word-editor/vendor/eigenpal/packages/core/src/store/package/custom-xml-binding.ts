// The value a `w:dataBinding` points at, read from a part inside the package.
//
// A bound content control mirrors one node of a data store: a custom XML part named by its
// `ds:itemID`, or one of the two document-property parts, which have fixed store IDs. The
// control's `w:xpath` selects the node. The cached text in `w:sdtContent` is only the last
// rendering of that node, so a document whose store changed after save shows stale text until
// the binding is read again.
//
// SECURITY: the store ID, the XPath and the prefix mappings are file-supplied. Only parts the
// package already carries are read; nothing outside the package is ever resolved. The XPath
// reader accepts one bounded shape, an absolute path of child steps with optional positions,
// ending in an element, an attribute or `text()`, and refuses everything else. Lengths, step
// counts and positions are capped, and the walk visits each node at most once.

import { customXmlDataParts } from './custom-xml-part.ts';
import { documentPropertiesPart } from './document-property-writes.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveInternalTarget } from './opc-names.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { isValidNCName } from './qname.ts';

/** Store ID of the core document properties (`docProps/core.xml`). */
export const CORE_PROPERTIES_STORE_ID = '{6C3C8BC8-F283-45AE-878A-BAB7291924A1}';
/** Store ID of the extended document properties (`docProps/app.xml`). */
export const EXTENDED_PROPERTIES_STORE_ID = '{6668398D-A668-4E3E-A5EB-62B293D839F1}';

const EXTENDED_PROPERTIES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';

const MAX_XPATH_LENGTH = 1024;
const MAX_STEPS = 32;
const MAX_POSITION = 100_000;
const MAX_MAPPINGS_LENGTH = 8192;
/** A bound value longer than this is not a field value; the cached text stays. */
export const MAX_BOUND_VALUE_LENGTH = 32_768;
const MAX_TEXT_NODES = 10_000;

interface ElementStep {
  readonly kind: 'element';
  readonly namespaceUri: string;
  readonly localName: string;
  /** 1-based position among same-named siblings; absent means the first. */
  readonly position: number;
}

interface AttributeStep {
  readonly kind: 'attribute';
  readonly namespaceUri: string;
  readonly localName: string;
}

type Step = ElementStep | AttributeStep | { readonly kind: 'text' };

/** `xmlns:p='uri'` pairs, as `w:prefixMappings` writes them. Null when malformed. */
export function parsePrefixMappings(value: string | undefined): ReadonlyMap<string, string> | null {
  const mappings = new Map<string, string>();
  if (value === undefined || value.trim() === '') return mappings;
  if (value.length > MAX_MAPPINGS_LENGTH) return null;
  // One declaration per match; the classes cannot overlap, so the scan is linear.
  const declaration = /xmlns:([^\s=]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
  let consumed = '';
  for (const match of value.matchAll(declaration)) {
    const prefix = match[1]!;
    if (!isValidNCName(prefix)) return null;
    mappings.set(prefix, match[2] ?? match[3] ?? '');
    consumed += match[0];
  }
  // Anything besides declarations and whitespace is a shape this reader does not know.
  if (value.replace(declaration, '').trim() !== '' || consumed === '') return null;
  return mappings;
}

function qualifiedName(
  name: string,
  mappings: ReadonlyMap<string, string>
): { readonly namespaceUri: string; readonly localName: string } | null {
  const colon = name.indexOf(':');
  if (colon === -1) return isValidNCName(name) ? { namespaceUri: '', localName: name } : null;
  const prefix = name.slice(0, colon);
  const localName = name.slice(colon + 1);
  const namespaceUri = mappings.get(prefix);
  if (namespaceUri === undefined || !isValidNCName(localName)) return null;
  return { namespaceUri, localName };
}

/** Parse the supported XPath shape, or null for any other expression. */
export function parseBindingXPath(
  xpath: string | undefined,
  mappings: ReadonlyMap<string, string>
): readonly Step[] | null {
  if (!xpath || xpath.length > MAX_XPATH_LENGTH || !xpath.startsWith('/')) return null;
  const parts = xpath.slice(1).split('/');
  if (parts.length === 0 || parts.length > MAX_STEPS) return null;
  const steps: Step[] = [];
  for (const [index, raw] of parts.entries()) {
    const last = index === parts.length - 1;
    const part = raw.trim();
    if (part === 'text()') {
      if (!last || steps.length === 0) return null;
      steps.push({ kind: 'text' });
      continue;
    }
    if (part.startsWith('@')) {
      const name = last && steps.length > 0 ? qualifiedName(part.slice(1), mappings) : null;
      if (!name) return null;
      steps.push({ kind: 'attribute', ...name });
      continue;
    }
    const match = /^([^[\]]+)(?:\[(\d{1,6})\])?$/.exec(part);
    if (!match) return null;
    const name = qualifiedName(match[1]!, mappings);
    const position = match[2] === undefined ? 1 : Number(match[2]);
    if (!name || position < 1 || position > MAX_POSITION) return null;
    steps.push({ kind: 'element', ...name, position });
  }
  return steps;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** Concatenated text of an element's descendants, or null when it is too large. */
function stringValue(element: OoxmlElement): string | null {
  let text = '';
  let visited = 0;
  const stack: OoxmlNode[] = [element];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (++visited > MAX_TEXT_NODES) return null;
    if (node.kind === 'textValue') {
      text += node.value;
      if (text.length > MAX_BOUND_VALUE_LENGTH) return null;
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return text;
}

/** Evaluate parsed steps against a store's root element. Null when nothing matches. */
export function evaluateBindingXPath(root: OoxmlElement, steps: readonly Step[]): string | null {
  const first = steps[0];
  if (first?.kind !== 'element') return null;
  if (
    first.position !== 1 ||
    root.namespaceUri !== first.namespaceUri ||
    root.localName !== first.localName
  )
    return null;
  let current = root;
  for (const step of steps.slice(1)) {
    if (step.kind === 'attribute') {
      const attribute = current.attributes.find(
        (entry) => entry.localName === step.localName && entry.namespaceUri === step.namespaceUri
      );
      if (!attribute || attribute.value.length > MAX_BOUND_VALUE_LENGTH) return null;
      return attribute.value;
    }
    if (step.kind === 'text') {
      let text = '';
      for (const child of current.children) if (child.kind === 'textValue') text += child.value;
      return text.length > MAX_BOUND_VALUE_LENGTH ? null : text;
    }
    let seen = 0;
    let next: OoxmlElement | null = null;
    for (const child of current.children) {
      if (!isElement(child)) continue;
      if (child.localName !== step.localName || child.namespaceUri !== step.namespaceUri) continue;
      seen += 1;
      if (seen === step.position) {
        next = child;
        break;
      }
    }
    if (!next) return null;
    current = next;
  }
  return stringValue(current);
}

/**
 * The store roots a package carries, by upper-cased store ID: every custom XML data part the
 * main document relates to, and the two document-property parts.
 */
export function bindingStores(pkg: OoxmlPackage): ReadonlyMap<string, OoxmlElement> {
  const stores = new Map<string, OoxmlElement>();
  for (const data of customXmlDataParts(pkg, pkg.mainDocumentPart)) {
    const part = pkg.parts.get(data.partName);
    const id = data.itemId.toUpperCase();
    if (part && !stores.has(id)) stores.set(id, part.root);
  }
  const core = documentPropertiesPart(pkg);
  if (core) stores.set(CORE_PROPERTIES_STORE_ID, core.root);
  const app = (pkg.relationships.get('/') ?? []).find(
    (rel) => rel.type === EXTENDED_PROPERTIES_REL && rel.targetMode !== 'External'
  );
  const target = app ? resolveInternalTarget('/', app.rawTarget) : null;
  const appPart = target?.ok ? pkg.parts.get(target.partName) : undefined;
  if (appPart) stores.set(EXTENDED_PROPERTIES_STORE_ID, appPart.root);
  return stores;
}

/** The binding as `w:dataBinding` declares it. */
export interface DataBindingSource {
  readonly xpath?: string;
  readonly storeItemID?: string;
  readonly prefixMappings?: string;
}

/**
 * The current value of the node a binding points at, or null when the store is absent, the
 * expression is outside the supported shape, or nothing matches.
 */
export function boundValueOf(
  stores: ReadonlyMap<string, OoxmlElement>,
  binding: DataBindingSource
): string | null {
  const id = binding.storeItemID?.trim().toUpperCase();
  const root = id ? stores.get(id) : undefined;
  if (!root) return null;
  const mappings = parsePrefixMappings(binding.prefixMappings);
  if (!mappings) return null;
  const steps = parseBindingXPath(binding.xpath, mappings);
  return steps ? evaluateBindingXPath(root, steps) : null;
}
