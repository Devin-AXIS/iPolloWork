// Canonical OOXML serialization and the semantic equality oracle.
//
// This module owns normalized XML output from a canonical part — repository-controlled
// prefixes, validated and escaped names/values — plus the namespace-aware fingerprint that
// backs `ooxmlTreesEqual`. It is a projection of the tree in ooxml-tree.ts; the read path
// stays there, and importers keep reaching everything through that module's re-exports.

import {
  assertSerializableName,
  assertSerializableNamespace,
} from './ooxml-serialize-validation.ts';
import { isXmlNCName } from './qname.ts';
import { escapeXmlAttributeChecked, escapeXmlChecked } from './sinks.ts';
import {
  MC_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  XSI_NAMESPACE_URI,
  canonicalQNameAttributeValue,
  expandedKey,
  normalizedWmlTextAttributes,
  resolvedPrefixNamespaceSet,
  resolvedQNameToken,
  validateQNameAttributeValues,
  wmlTextValueOf,
} from './ooxml-shared.ts';
import {
  cacheMarkup,
  cachedMarkup,
  isMemoizedBlock,
  serializationContext,
} from './ooxml-serialize-cache.ts';
import {
  collectNamespacesAndAliases,
  collectNonEmptyPrefixUris,
  isMcPrefixListAttribute,
  isQNameValuedAttribute,
} from './ooxml-serialize-namespaces.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { serializedPropertyOrder } from './ooxml-property-order.ts';

export interface ControlledPrefixes {
  /** Element-name prefixes; may map a root-default URI to `''`. */
  readonly byUri: ReadonlyMap<string, string>;
  /**
   * Non-empty aliases for URIs whose element prefix is `''` but that also name
   * attributes or appear in MC/XSI QName / prefix-list attribute values.
   */
  readonly attributeAliases: ReadonlyMap<string, string>;
  /** Equal for two prefix maps that emit the same names. Part of every cached paragraph key. */
  readonly key: string;
}

/** Prefer a uniquely authored non-empty prefix for a URI (stable: sorted NCName). */
function preferredAuthoredPrefix(
  namespaceUri: string,
  aliasUris: ReadonlyMap<string, ReadonlySet<string>>,
  used: ReadonlySet<string>
): string | undefined {
  const candidates: string[] = [];
  for (const [prefix, uris] of aliasUris) {
    if (
      prefix !== '' &&
      isXmlNCName(prefix) &&
      !used.has(prefix) &&
      uris.size === 1 &&
      uris.has(namespaceUri)
    )
      candidates.push(prefix);
  }
  candidates.sort();
  return candidates[0];
}

/** @internal Shared with the sliced serializer. */
export function controlledPrefixMap(root: OoxmlElement): ControlledPrefixes {
  const namespaceUris = new Set<string>();
  const aliasUris = new Map<string, Set<string>>();
  collectNamespacesAndAliases(root, namespaceUris, aliasUris);
  namespaceUris.delete('');
  namespaceUris.delete(XML_NAMESPACE_URI);
  namespaceUris.delete(XMLNS_NAMESPACE_URI);
  const byUri = new Map<string, string>([[XML_NAMESPACE_URI, 'xml']]);
  const used = new Set(['xml', 'xmlns']);
  const allocate = (namespaceUri: string, preferred: string): void => {
    let prefix = preferred;
    let suffix = 0;
    while (
      used.has(prefix) ||
      [...(aliasUris.get(prefix) ?? [])].some((uri) => uri !== namespaceUri)
    ) {
      suffix += 1;
      // Empty preferred means "default xmlns"; collide into nsN rather than "0"/"1".
      prefix = preferred === '' ? `ns${suffix}` : `${preferred}${suffix}`;
    }
    byUri.set(namespaceUri, prefix);
    used.add(prefix);
    namespaceUris.delete(namespaceUri);
  };
  // OPC relationship parts (and other default-xmlns roots) must re-emit the unprefixed
  // default form. Descendant `xmlns=""` / other default rebinds must NOT bump the root
  // URI to `nsN` — that yields the Word Online–corrupt dual `xmlns` + `nsN:Relationships`.
  const rootDefault =
    root.namespaceUri !== '' &&
    root.namespaceBindings.some(
      (binding) => binding.prefix === '' && binding.namespaceUri === root.namespaceUri
    );
  if (rootDefault) {
    byUri.set(root.namespaceUri, '');
    used.add('');
    namespaceUris.delete(root.namespaceUri);
  }
  if (namespaceUris.has(WML_NAMESPACE_URI)) allocate(WML_NAMESPACE_URI, 'w');
  if (namespaceUris.has(MC_NAMESPACE_URI)) allocate(MC_NAMESPACE_URI, 'mc');
  if (namespaceUris.has(XSI_NAMESPACE_URI)) allocate(XSI_NAMESPACE_URI, 'xsi');
  let generated = 0;
  for (const namespaceUri of [...namespaceUris].sort()) {
    const authored = preferredAuthoredPrefix(namespaceUri, aliasUris, used);
    let preferred = authored;
    if (preferred === undefined) {
      do {
        generated += 1;
        preferred = `ns${generated}`;
      } while (used.has(preferred));
    }
    allocate(namespaceUri, preferred);
  }

  const needsNonEmpty = new Set<string>();
  collectNonEmptyPrefixUris(
    root,
    new Map([
      ['xml', XML_NAMESPACE_URI],
      ['xmlns', XMLNS_NAMESPACE_URI],
    ]),
    needsNonEmpty
  );
  const attributeAliases = new Map<string, string>();
  for (const namespaceUri of [...needsNonEmpty].sort()) {
    if (byUri.get(namespaceUri) !== '') continue;
    let preferred = preferredAuthoredPrefix(namespaceUri, aliasUris, used);
    if (preferred === undefined) {
      do {
        generated += 1;
        preferred = `ns${generated}`;
      } while (used.has(preferred));
    }
    attributeAliases.set(namespaceUri, preferred);
    used.add(preferred);
  }
  const key = [...byUri, ['', ''], ...attributeAliases]
    .map(([namespaceUri, prefix]) => `${namespaceUri}\u0001${prefix}`)
    .join('\u0002');
  return { byUri, attributeAliases, key };
}

function prefixForAttributeOrQName(namespaceUri: string, prefixes: ControlledPrefixes): string {
  const alias = prefixes.attributeAliases.get(namespaceUri);
  if (alias !== undefined) return alias;
  const prefix = prefixes.byUri.get(namespaceUri);
  if (prefix === undefined)
    throw new Error(`no controlled prefix for namespace ${JSON.stringify(namespaceUri)}`);
  if (prefix === '')
    throw new Error(
      `namespace ${JSON.stringify(namespaceUri)} requires a non-empty controlled prefix`
    );
  return prefix;
}

function controlledQualifiedName(
  namespaceUri: string,
  localName: string,
  prefixes: ControlledPrefixes,
  attribute: boolean
): string {
  assertSerializableName(localName, prefixes);
  assertSerializableNamespace(namespaceUri, prefixes);
  if (namespaceUri === '') return localName;
  if (attribute) {
    const prefix = prefixForAttributeOrQName(namespaceUri, prefixes);
    return `${prefix}:${localName}`;
  }
  const prefix = prefixes.byUri.get(namespaceUri);
  if (prefix === undefined)
    throw new Error(`no controlled prefix for namespace ${JSON.stringify(namespaceUri)}`);
  if (prefix === '') return localName;
  return `${prefix}:${localName}`;
}

function sortedAttributes(
  attributes: readonly OoxmlAttribute[],
  prefixes?: ControlledPrefixes
): readonly OoxmlAttribute[] {
  if (attributes.length === 0) return attributes;
  // A single attribute cannot collide or need ordering; skip the set and the sort copy.
  const seen = attributes.length > 1 ? new Set<string>() : null;
  for (const attribute of attributes) {
    assertSerializableName(attribute.localName, prefixes);
    assertSerializableNamespace(attribute.namespaceUri, prefixes);
    if (!seen) continue;
    const key = expandedKey(attribute.namespaceUri, attribute.localName);
    if (seen.has(key))
      throw new Error(
        `duplicate expanded attribute {${attribute.namespaceUri}}${attribute.localName}`
      );
    seen.add(key);
  }
  if (attributes.length === 1) return attributes;
  return [...attributes].sort((left, right) => {
    const leftKey = expandedKey(left.namespaceUri, left.localName);
    const rightKey = expandedKey(right.namespaceUri, right.localName);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function controlledQNameValue(
  attribute: OoxmlAttribute,
  owner: OoxmlElement,
  bindings: ReadonlyMap<string, string>,
  prefixes: ControlledPrefixes
): string {
  const rawValue: unknown = attribute.value;
  if (typeof rawValue !== 'string')
    throw new Error(
      `attribute {${attribute.namespaceUri}}${attribute.localName} value must be a string scalar`
    );
  if (isMcPrefixListAttribute(attribute, owner)) {
    return resolvedPrefixNamespaceSet(rawValue, bindings)
      .map((namespaceUri) => prefixForAttributeOrQName(namespaceUri, prefixes))
      .sort()
      .join(' ');
  }
  if (!isQNameValuedAttribute(attribute)) return rawValue;
  return rawValue
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const [namespaceUri, localName] = resolvedQNameToken(token, bindings);
      assertSerializableName(localName, prefixes);
      assertSerializableNamespace(namespaceUri, prefixes);
      if (namespaceUri === '') return localName;
      const prefix = prefixForAttributeOrQName(namespaceUri, prefixes);
      return `${prefix}:${localName}`;
    })
    .sort()
    .join(' ');
}

function controlledRootDeclares(
  binding: { readonly prefix: string; readonly namespaceUri: string },
  rootBindings: ReadonlyMap<string, string>,
  prefixes: ControlledPrefixes
): boolean {
  if (rootBindings.get(binding.prefix) === binding.namespaceUri) return true;
  // One stable binding per URI on the root: controlled element prefix (possibly
  // '') plus an optional non-empty attribute/QName alias are emitted in
  // rootDeclarations. Extra authored aliases for the same URI
  // (`xmlns:w14` + `xmlns:ns13`) are save-introduced bloat and must be dropped.
  if (
    prefixes.byUri.has(binding.namespaceUri) ||
    prefixes.attributeAliases.has(binding.namespaceUri)
  )
    return true;
  return false;
}

/**
 * Nodes {@link serializeOoxmlPart} has walked in this process.
 *
 * A full-package save walks every XML node. Collaboration paths that only need one image
 * assert against this counter so a large document cannot hide behind a fast machine.
 */
let serializeNodeVisits = 0;

/** Test-observable count of nodes {@link serializeOoxmlPart} has walked. */
export function canonicalSerializeNodeVisits(): number {
  return serializeNodeVisits;
}

/** Nonzero while a memoized block serializes: its descendants are part of its markup. */
let insideMemoizedBlock = 0;

/** Markup text, or the UTF-8 bytes of a memoized block. */
export type MarkupChunk = string | Uint8Array;

const utf8 = new TextEncoder();

/** @internal Shared with the sliced serializer. */
export function serializeNode(
  node: OoxmlNode,
  prefixes: ControlledPrefixes,
  inheritedBindings: ReadonlyMap<string, string>,
  inheritedPreserve: boolean,
  rootDeclarations: string,
  /** Output accumulator — one flat join at the end beats per-element string assembly. */
  out: MarkupChunk[]
): void {
  serializeNodeVisits += 1;
  if (node.kind === 'textValue') {
    out.push(escapeXmlChecked(node.value, 'OOXML text'));
    return;
  }
  if (rootDeclarations === '' && insideMemoizedBlock === 0 && isMemoizedBlock(node)) {
    const context = serializationContext(prefixes.key, inheritedBindings, inheritedPreserve);
    const cached = cachedMarkup(node, context);
    if (cached !== undefined) {
      out.push(cached);
      return;
    }
    // Nothing inside a memoized block is memoized, so its own output is all strings.
    const own: string[] = [];
    insideMemoizedBlock += 1;
    try {
      serializeElement(node, prefixes, inheritedBindings, inheritedPreserve, rootDeclarations, own);
    } finally {
      insideMemoizedBlock -= 1;
    }
    const markup = utf8.encode(own.join(''));
    cacheMarkup(node, context, markup);
    out.push(markup);
    return;
  }
  serializeElement(node, prefixes, inheritedBindings, inheritedPreserve, rootDeclarations, out);
}

function serializeElement(
  node: OoxmlElement,
  prefixes: ControlledPrefixes,
  inheritedBindings: ReadonlyMap<string, string>,
  inheritedPreserve: boolean,
  rootDeclarations: string,
  out: MarkupChunk[]
): void {
  // Copy-on-write: most nodes declare no namespaces, and copying the inherited map (plus the
  // sort/dedup scaffolding) per node dominated serialization cost on long documents.
  let bindings = inheritedBindings;
  let declarations = '';
  if (node.namespaceBindings.length > 0) {
    const own = new Map(inheritedBindings);
    const seenDeclarationPrefixes = new Set<string>();
    declarations = [...node.namespaceBindings]
      .sort((left, right) => {
        const prefixOrder = left.prefix.localeCompare(right.prefix);
        return prefixOrder !== 0
          ? prefixOrder
          : left.namespaceUri.localeCompare(right.namespaceUri);
      })
      .map((binding) => {
        if (
          (binding.prefix !== '' && !isXmlNCName(binding.prefix)) ||
          binding.prefix === 'xmlns' ||
          seenDeclarationPrefixes.has(binding.prefix)
        )
          throw new Error(
            `invalid or duplicate namespace prefix ${JSON.stringify(binding.prefix)}`
          );
        assertSerializableNamespace(binding.namespaceUri, prefixes);
        seenDeclarationPrefixes.add(binding.prefix);
        const declaredByControlledRoot =
          rootDeclarations !== '' && controlledRootDeclares(binding, own, prefixes);
        own.set(binding.prefix, binding.namespaceUri);
        if (declaredByControlledRoot) return '';
        const declarationName = binding.prefix === '' ? 'xmlns' : `xmlns:${binding.prefix}`;
        return ` ${declarationName}="${escapeXmlChecked(binding.namespaceUri, declarationName)}"`;
      })
      .join('');
    bindings = own;
  }
  const elementAttributes = normalizedFingerprintAttributes(node);
  validateQNameAttributeValues(elementAttributes, bindings, node.namespaceUri, node.localName);
  const preserve = inheritedPreserveOf(elementAttributes, inheritedPreserve);
  const name = controlledQualifiedName(node.namespaceUri, node.localName, prefixes, false);
  out.push(`<${name}${rootDeclarations}${declarations}`);
  for (const attribute of sortedAttributes(elementAttributes, prefixes)) {
    const attributeName = controlledQualifiedName(
      attribute.namespaceUri,
      attribute.localName,
      prefixes,
      true
    );
    const value = controlledQNameValue(attribute, node, bindings, prefixes);
    out.push(
      ` ${attributeName}="${escapeXmlAttributeChecked(value, `attribute ${attributeName}`)}"`
    );
  }
  const children = serializedPropertyOrder(node, significantChildren(node, preserve));
  if (children.length === 0) {
    out.push('/>');
    return;
  }
  out.push('>');
  for (const child of children) serializeNode(child, prefixes, bindings, preserve, '', out);
  out.push(`</${name}>`);
}

function formatNamespaceDeclaration(namespaceUri: string, prefix: string): string {
  if (prefix === '') return ` xmlns="${escapeXmlChecked(namespaceUri, 'xmlns')}"`;
  return ` xmlns:${prefix}="${escapeXmlChecked(namespaceUri, `namespace ${prefix}`)}"`;
}

/**
 * Serialize normalized XML from a canonical part using repository-controlled
 * prefixes and validated, escaped names and values. This does not yet replace
 * writeDocx; package integration belongs to the subsequent migration pass.
 */
export function serializeOoxmlPart(part: OoxmlPart): string {
  const decoder = new TextDecoder();
  return serializeOoxmlPartChunks(part)
    .map((chunk) => (typeof chunk === 'string' ? chunk : decoder.decode(chunk)))
    .join('');
}

/**
 * Serialized markup in document order: strings, and the UTF-8 bytes of memoized blocks.
 *
 * Blocks stay bytes so a package write can copy them into the part unchanged. Joining them
 * into one string first would build, and then encode, a string the size of the part.
 *
 * @internal
 */
export function serializeOoxmlPartChunks(part: OoxmlPart): MarkupChunk[] {
  const prefixes = controlledPrefixMap(part.root);
  const { rootBindings, declarations } = rootSerializationScope(prefixes);
  const out: MarkupChunk[] = [];
  serializeNode(part.root, prefixes, rootBindings, false, declarations, out);
  return out;
}

/** @internal The bindings and declarations the root element serializes with. */
export function rootSerializationScope(prefixes: ControlledPrefixes): {
  readonly rootBindings: ReadonlyMap<string, string>;
  readonly declarations: string;
} {
  const rootBindings = new Map<string, string>([
    ['xml', XML_NAMESPACE_URI],
    ['xmlns', XMLNS_NAMESPACE_URI],
  ]);
  const declarationEntries: { namespaceUri: string; prefix: string }[] = [];
  for (const [namespaceUri, prefix] of prefixes.byUri) {
    if (namespaceUri === XML_NAMESPACE_URI) continue;
    declarationEntries.push({ namespaceUri, prefix });
  }
  for (const [namespaceUri, prefix] of prefixes.attributeAliases)
    declarationEntries.push({ namespaceUri, prefix });
  const declarations = declarationEntries
    .sort((left, right) => left.prefix.localeCompare(right.prefix))
    .map(({ namespaceUri, prefix }) => {
      rootBindings.set(prefix, namespaceUri);
      return formatNamespaceDeclaration(namespaceUri, prefix);
    })
    .join('');
  return { rootBindings, declarations };
}

type FingerprintValue =
  | readonly ['text', string]
  | readonly [
      'element',
      string,
      string,
      readonly (readonly [string, string, string])[],
      readonly FingerprintValue[],
    ];

function xmlSpaceValue(attributes: readonly OoxmlAttribute[]): string | undefined {
  return attributes.find(
    (attribute) => attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space'
  )?.value;
}

function significantChildren(node: OoxmlElement, preserve: boolean): readonly OoxmlNode[] {
  // Whitespace stripping only ever drops TEXT children; a child list without any is
  // returned as-is, which skips the filter allocation for the structural bulk of a part.
  if (!node.children.some((child) => child.kind === 'textValue')) return node.children;
  const hasElementChild = node.children.some((child) => child.kind !== 'textValue');
  const hasNonWhitespaceText = node.children.some(
    (child) => child.kind === 'textValue' && !/^\s*$/.test(child.value)
  );
  return node.children.filter(
    (child) =>
      child.kind !== 'textValue' ||
      preserve ||
      node.kind === 'text' ||
      node.kind === 'instrText' ||
      !hasElementChild ||
      hasNonWhitespaceText ||
      !/^\s*$/.test(child.value)
  );
}

/**
 * Nodes the fingerprint oracle has walked in this process.
 *
 * The oracle materializes the whole subtree before it can answer, so its cost is the size of
 * the document, not the size of the difference. Hot paths that only need "did anything
 * change" assert against this counter to prove they never reach it.
 */
let fingerprintNodeVisits = 0;

/** Test-observable count of nodes {@link canonicalOoxmlFingerprint} has walked. */
export function canonicalFingerprintNodeVisits(): number {
  return fingerprintNodeVisits;
}

/**
 * Extend inherited bindings with a node's own declarations.
 *
 * A node that declares none reads the parent map unchanged, so the copy is skipped. The map
 * is only ever read below this point, which makes sharing the instance identical to copying
 * it — and the copy was one allocation per element of the document.
 */
export function extendedBindings(
  inherited: ReadonlyMap<string, string>,
  node: OoxmlElement
): ReadonlyMap<string, string> {
  if (node.namespaceBindings.length === 0) return inherited;
  const bindings = new Map(inherited);
  for (const binding of node.namespaceBindings) bindings.set(binding.prefix, binding.namespaceUri);
  return bindings;
}

export function normalizedFingerprintAttributes(node: OoxmlElement): readonly OoxmlAttribute[] {
  // `w:delText` is `CT_Text` exactly as `w:t` is (§17.3.3.7), so it needs the same
  // `xml:space` normalization. Without it, striking " b " wrote `<w:delText> b </w:delText>`
  // with no attribute, a conformant reader dropped the edge spaces, and REJECTING the
  // deletion later restored the words with the spacing already gone.
  return node.kind === 'text' || node.kind === 'deletedText' || node.kind === 'instrText'
    ? normalizedWmlTextAttributes(node.attributes, wmlTextValueOf(node))
    : node.attributes;
}

export function inheritedPreserveOf(
  attributes: readonly OoxmlAttribute[],
  inheritedPreserve: boolean
): boolean {
  const ownSpace = xmlSpaceValue(attributes);
  return ownSpace === 'preserve' ? true : ownSpace === 'default' ? false : inheritedPreserve;
}

function fingerprintNode(
  node: OoxmlNode,
  inheritedPreserve: boolean,
  inheritedBindings: ReadonlyMap<string, string>
): FingerprintValue {
  fingerprintNodeVisits += 1;
  if (node.kind === 'textValue') return ['text', node.value];
  const bindings = extendedBindings(inheritedBindings, node);
  const elementAttributes = normalizedFingerprintAttributes(node);
  const preserve = inheritedPreserveOf(elementAttributes, inheritedPreserve);
  const attributes = sortedAttributes(elementAttributes).map(
    (attribute) =>
      [
        attribute.namespaceUri,
        attribute.localName,
        canonicalQNameAttributeValue(attribute, bindings, node.namespaceUri, node.localName),
      ] as const
  );
  const children = significantChildren(node, preserve).map((child) =>
    fingerprintNode(child, preserve, bindings)
  );
  return ['element', node.namespaceUri, node.localName, attributes, children];
}

/** Default namespace bindings for fingerprinting a subtree in isolation. */
export const DEFAULT_FINGERPRINT_BINDINGS = new Map<string, string>([
  ['xml', XML_NAMESPACE_URI],
  ['xmlns', XMLNS_NAMESPACE_URI],
]);

/** Repository-owned namespace-aware semantic XML oracle. */
export function canonicalOoxmlFingerprintWithBindings(
  value: OoxmlPart | OoxmlNode,
  inheritedBindings: ReadonlyMap<string, string> = DEFAULT_FINGERPRINT_BINDINGS
): string {
  return JSON.stringify(
    fingerprintNode('root' in value ? value.root : value, false, inheritedBindings)
  );
}

/** Repository-owned namespace-aware semantic XML oracle. */
export function canonicalOoxmlFingerprint(value: OoxmlPart | OoxmlNode): string {
  return canonicalOoxmlFingerprintWithBindings(value);
}

/**
 * Structural equality of two canonical trees, ignoring node ids.
 *
 * Ids differ between two parses of the same bytes, so comparing them would report every reopen as
 * a change. This compares what the document SAYS.
 */
export function ooxmlTreesEqual(
  left: OoxmlPart | OoxmlNode,
  right: OoxmlPart | OoxmlNode
): boolean {
  return canonicalOoxmlFingerprint(left) === canonicalOoxmlFingerprint(right);
}

/** How far the difference between two canonical trees reaches. */
export type CanonicalDifferenceReach =
  | 'equal'
  /** Only `w:t` character data differs, and only inside paragraphs. */
  | 'paragraph-text'
  /** Element structure or attributes differ, but only inside paragraphs. */
  | 'paragraph-content'
  /** At least one difference sits above every paragraph. */
  | 'outside-paragraph';

/** What an incremental comparison of two canonical trees found. */
export interface CanonicalTreeDifference {
  /** True when the two trees say the same thing, by the same rules as the fingerprint. */
  readonly equal: boolean;
  /**
   * True when the walk stopped without an answer. `equal` and `reach` mean nothing then,
   * and the caller must ask the full oracle instead.
   */
  readonly undecided: boolean;
  readonly reach: CanonicalDifferenceReach;
  /** Paragraph ids from `next` that own a difference. Complete only when decided. */
  readonly paragraphIds: readonly string[];
  /** True when every node pair the walk compared carried the same canonical id. */
  readonly idsPreserved: boolean;
  /**
   * Paragraph ids from `next` whose content kept its shape but changed ids, and whether an
   * id changed anywhere else. A collaboration view renames inline ids it shares with another
   * paragraph, and the editor has to take those ids even when the content is equal.
   */
  readonly renamedParagraphIds: readonly string[];
  readonly renamedOutsideParagraphs: boolean;
  /** Node pairs the walk compared. An identity-equal subtree counts as one. */
  readonly visited: number;
}

const REACH_RANK: Record<CanonicalDifferenceReach, number> = {
  equal: 0,
  'paragraph-text': 1,
  'paragraph-content': 2,
  'outside-paragraph': 3,
};

/**
 * Node pairs one comparison may look at before it gives up.
 *
 * The ceiling is high because giving up is the expensive outcome, not the cheap one: the
 * caller's fallback is the fingerprint oracle, which allocates a nested array for every node
 * of both trees and then stringifies it. Finishing the walk is cheaper than that even when
 * the two trees share nothing. The budget is here so recursion over a hostile tree cannot
 * run unbounded, not to steer ordinary work toward the oracle.
 */
const DEFAULT_DIFFERENCE_BUDGET = 250_000;

interface DifferenceWalk {
  readonly budget: number;
  visited: number;
  undecided: boolean;
  reach: CanonicalDifferenceReach;
  idsPreserved: boolean;
  readonly paragraphIds: Set<string>;
  readonly renamedParagraphIds: Set<string>;
  renamedOutsideParagraphs: boolean;
}

function namespaceBindingsMatch(left: OoxmlElement, right: OoxmlElement): boolean {
  if (left.namespaceBindings === right.namespaceBindings) return true;
  if (left.namespaceBindings.length !== right.namespaceBindings.length) return false;
  return left.namespaceBindings.every((binding, index) => {
    const other = right.namespaceBindings[index]!;
    return binding.prefix === other.prefix && binding.namespaceUri === other.namespaceUri;
  });
}

function fingerprintAttributesMatch(
  left: readonly OoxmlAttribute[],
  right: readonly OoxmlAttribute[],
  bindings: ReadonlyMap<string, string>,
  owner: OoxmlElement
): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = sortedAttributes(left);
  const rightSorted = sortedAttributes(right);
  return leftSorted.every((attribute, index) => {
    const other = rightSorted[index]!;
    return (
      attribute.namespaceUri === other.namespaceUri &&
      attribute.localName === other.localName &&
      canonicalQNameAttributeValue(attribute, bindings, owner.namespaceUri, owner.localName) ===
        canonicalQNameAttributeValue(other, bindings, owner.namespaceUri, owner.localName)
    );
  });
}

/**
 * Elements whose content only ever re-breaks the paragraph that holds it.
 *
 * A local `insertText` publishes `text-local` however it lands — merged into a run, split
 * across two, or wrapped in a tracked insertion — so a received one has to be allowed to say
 * the same thing. Everything absent from this list re-flows more than one paragraph, or
 * might: a drawing changes height, a `w:br` moves a page boundary, a note reference reaches
 * another story. The list is an allowlist on purpose. An element nobody has classified yet
 * reads as flow-affecting and costs a wider invalidation, which is the safe direction.
 */
const TEXT_FLOW_ELEMENTS = new Set(['r', 't', 'delText', 'ins', 'del', 'rPr']);

function isTextFlowElement(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    TEXT_FLOW_ELEMENTS.has(node.localName)
  );
}

function isTextFlowSubtree(node: OoxmlNode, walk: DifferenceWalk): boolean {
  walk.visited += 1;
  if (walk.visited > walk.budget) {
    walk.undecided = true;
    return false;
  }
  if (node.kind === 'textValue') return true;
  if (!isTextFlowElement(node)) return false;
  // Run properties are formatting only: no flow content can hang under them.
  if (node.localName === 'rPr') return true;
  return node.children.every((child) => isTextFlowSubtree(child, walk));
}

/** True when every child either side does not share by identity only re-breaks its paragraph. */
function replacedChildrenAreTextFlow(
  left: readonly OoxmlNode[],
  right: readonly OoxmlNode[],
  walk: DifferenceWalk
): boolean {
  const inLeft = new Set(left);
  const inRight = new Set(right);
  return (
    left.every((child) => inRight.has(child) || isTextFlowSubtree(child, walk)) &&
    right.every((child) => inLeft.has(child) || isTextFlowSubtree(child, walk))
  );
}

function recordDifference(
  walk: DifferenceWalk,
  paragraphId: string | null,
  reach: 'paragraph-text' | 'paragraph-content'
): void {
  if (paragraphId === null) {
    walk.reach = 'outside-paragraph';
    return;
  }
  walk.paragraphIds.add(paragraphId);
  if (REACH_RANK[reach] > REACH_RANK[walk.reach]) walk.reach = reach;
}

/**
 * Compare two canonical subtrees in lockstep, skipping the parts that never moved.
 *
 * The engine hands identical node objects back for content it did not rebuild, so an
 * identity match proves a whole subtree is equal for free. Everything else mirrors
 * `fingerprintNode` exactly — same attribute normalization, same `xml:space` inheritance,
 * same QName canonicalization, same whitespace-significance rule — so the two agree on
 * every pair of trees.
 */
function diffNodes(
  left: OoxmlNode,
  right: OoxmlNode,
  inheritedPreserve: boolean,
  inheritedBindings: ReadonlyMap<string, string>,
  paragraphId: string | null,
  textIsCharacterData: boolean,
  walk: DifferenceWalk
): void {
  if (walk.undecided) return;
  walk.visited += 1;
  if (walk.visited > walk.budget) {
    walk.undecided = true;
    return;
  }
  // An identity match is only sound because every ancestor pair matched: the inherited
  // bindings and `xml:space` state both sides carry into this subtree are the same.
  if (left === right) return;
  if (left.id !== right.id) {
    walk.idsPreserved = false;
    if (paragraphId !== null && left.kind !== 'paragraph')
      walk.renamedParagraphIds.add(paragraphId);
    else walk.renamedOutsideParagraphs = true;
  }
  if (left.kind === 'textValue') {
    if (right.kind !== 'textValue') {
      recordDifference(walk, paragraphId, 'paragraph-content');
      return;
    }
    if (left.value !== right.value) {
      recordDifference(
        walk,
        paragraphId,
        textIsCharacterData ? 'paragraph-text' : 'paragraph-content'
      );
    }
    return;
  }
  if (right.kind === 'textValue') {
    recordDifference(walk, paragraphId, 'paragraph-content');
    return;
  }
  if (
    left.kind !== right.kind ||
    left.namespaceUri !== right.namespaceUri ||
    left.localName !== right.localName
  ) {
    const replaced =
      isTextFlowSubtree(left, walk) && isTextFlowSubtree(right, walk) && !walk.undecided;
    recordDifference(walk, paragraphId, replaced ? 'paragraph-text' : 'paragraph-content');
    return;
  }
  // Two prefix sets can resolve every QName the same way and still differ as declarations.
  // Proving that costs more than the walk saves, so an unmatched pair goes to the oracle.
  if (!namespaceBindingsMatch(left, right)) {
    walk.undecided = true;
    return;
  }
  const scope = left.kind === 'paragraph' ? right.id : paragraphId;
  const bindings = extendedBindings(inheritedBindings, left);
  const leftAttributes = normalizedFingerprintAttributes(left);
  const rightAttributes = normalizedFingerprintAttributes(right);
  if (!fingerprintAttributesMatch(leftAttributes, rightAttributes, bindings, left)) {
    // Only this element's own attributes moved, so its subtree does not need classifying.
    recordDifference(walk, scope, isTextFlowElement(left) ? 'paragraph-text' : 'paragraph-content');
    return;
  }
  const preserve = inheritedPreserveOf(leftAttributes, inheritedPreserve);
  const leftChildren = significantChildren(left, preserve);
  const rightChildren = significantChildren(right, preserve);
  if (leftChildren.length !== rightChildren.length) {
    const rearranged =
      (left.kind === 'paragraph' || isTextFlowElement(left)) &&
      replacedChildrenAreTextFlow(leftChildren, rightChildren, walk) &&
      !walk.undecided;
    recordDifference(walk, scope, rearranged ? 'paragraph-text' : 'paragraph-content');
    return;
  }
  const characterData = left.kind === 'text' || left.kind === 'deletedText';
  for (let index = 0; index < leftChildren.length; index += 1) {
    diffNodes(
      leftChildren[index]!,
      rightChildren[index]!,
      preserve,
      bindings,
      scope,
      characterData,
      walk
    );
    if (walk.undecided) return;
  }
}

/**
 * Where two canonical trees differ, answered in the size of the difference.
 *
 * This agrees with {@link ooxmlTreesEqual} on the verdict whenever it returns a decided
 * result, and it reports which paragraphs own the difference so a caller does not have to
 * declare that everything changed.
 */
export function canonicalTreeDifference(
  previous: OoxmlPart | OoxmlNode,
  next: OoxmlPart | OoxmlNode,
  budget: number = DEFAULT_DIFFERENCE_BUDGET
): CanonicalTreeDifference {
  const walk: DifferenceWalk = {
    budget,
    visited: 0,
    undecided: false,
    reach: 'equal',
    idsPreserved: true,
    paragraphIds: new Set<string>(),
    renamedParagraphIds: new Set<string>(),
    renamedOutsideParagraphs: false,
  };
  diffNodes(
    'root' in previous ? previous.root : previous,
    'root' in next ? next.root : next,
    false,
    DEFAULT_FINGERPRINT_BINDINGS,
    null,
    false,
    walk
  );
  return {
    equal: !walk.undecided && walk.reach === 'equal',
    undecided: walk.undecided,
    reach: walk.reach,
    paragraphIds: [...walk.paragraphIds],
    idsPreserved: walk.idsPreserved,
    renamedParagraphIds: [...walk.renamedParagraphIds],
    renamedOutsideParagraphs: walk.renamedOutsideParagraphs,
    visited: walk.visited,
  };
}
