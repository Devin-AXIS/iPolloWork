// The namespace walks that choose a part's controlled prefixes.
//
// Before a part serializes, two walks find every namespace it uses: the namespaces and authored
// aliases of its elements and attributes, and the namespaces that need a non-empty prefix
// because an attribute or a QName-valued attribute names them. Both read each paragraph and
// table row through a per-block memo, so a save after an edit walks only what the edit rebuilt.

import {
  MC_NAMESPACE_URI,
  MC_QNAME_LIST_ATTRIBUTES,
  XSI_NAMESPACE_URI,
  resolvedPrefixNamespaceSet,
  resolvedQNameToken,
} from './ooxml-shared.ts';
import {
  isMemoizedBlock,
  memoizedNamespaceSummary,
  memoizedNonEmptyPrefixUris,
} from './ooxml-serialize-cache.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

export function collectNamespacesAndAliases(
  node: OoxmlNode,
  namespaceUris: Set<string>,
  aliasUris: Map<string, Set<string>>
): void {
  if (node.kind === 'textValue') return;
  if (isMemoizedBlock(node)) {
    const summary = memoizedNamespaceSummary(node, () => {
      const ownUris = new Set<string>();
      const ownAliases = new Map<string, Set<string>>();
      collectOwnNamespacesAndAliases(node, ownUris, ownAliases);
      return {
        namespaceUris: [...ownUris],
        aliases: [...ownAliases].flatMap(([prefix, uris]) =>
          [...uris].map((uri) => [prefix, uri] as const)
        ),
      };
    });
    for (const namespaceUri of summary.namespaceUris) namespaceUris.add(namespaceUri);
    for (const [prefix, namespaceUri] of summary.aliases) addAlias(aliasUris, prefix, namespaceUri);
    return;
  }
  collectOwnNamespacesAndAliases(node, namespaceUris, aliasUris);
}

function addAlias(aliasUris: Map<string, Set<string>>, prefix: string, namespaceUri: string): void {
  const uris = aliasUris.get(prefix) ?? new Set<string>();
  uris.add(namespaceUri);
  aliasUris.set(prefix, uris);
}

function collectOwnNamespacesAndAliases(
  node: OoxmlElement,
  namespaceUris: Set<string>,
  aliasUris: Map<string, Set<string>>
): void {
  if (node.namespaceUri !== '') namespaceUris.add(node.namespaceUri);
  for (const attribute of node.attributes)
    if (attribute.namespaceUri !== '') namespaceUris.add(attribute.namespaceUri);
  for (const binding of node.namespaceBindings) {
    if (binding.namespaceUri !== '') namespaceUris.add(binding.namespaceUri);
    addAlias(aliasUris, binding.prefix, binding.namespaceUri);
  }
  for (const child of node.children) collectNamespacesAndAliases(child, namespaceUris, aliasUris);
}

export function isMcPrefixListAttribute(attribute: OoxmlAttribute, owner: OoxmlElement): boolean {
  return (
    (attribute.namespaceUri === MC_NAMESPACE_URI &&
      (attribute.localName === 'Ignorable' || attribute.localName === 'MustUnderstand')) ||
    (owner.namespaceUri === MC_NAMESPACE_URI &&
      owner.localName === 'Choice' &&
      attribute.namespaceUri === '' &&
      attribute.localName === 'Requires')
  );
}

export function isQNameValuedAttribute(attribute: OoxmlAttribute): boolean {
  return (
    (attribute.namespaceUri === MC_NAMESPACE_URI &&
      MC_QNAME_LIST_ATTRIBUTES.has(attribute.localName)) ||
    (attribute.namespaceUri === XSI_NAMESPACE_URI && attribute.localName === 'type')
  );
}

/** Namespaces that must have a non-empty controlled prefix (attrs + MC/XSI QName values). */
export function collectNonEmptyPrefixUris(
  node: OoxmlNode,
  inheritedBindings: ReadonlyMap<string, string>,
  uris: Set<string>
): void {
  if (node.kind === 'textValue') return;
  if (isMemoizedBlock(node)) {
    const own = memoizedNonEmptyPrefixUris(node, inheritedBindings, () => {
      const found = new Set<string>();
      collectOwnNonEmptyPrefixUris(node, inheritedBindings, found);
      return [...found];
    });
    for (const namespaceUri of own) uris.add(namespaceUri);
    return;
  }
  collectOwnNonEmptyPrefixUris(node, inheritedBindings, uris);
}

function collectOwnNonEmptyPrefixUris(
  node: OoxmlElement,
  inheritedBindings: ReadonlyMap<string, string>,
  uris: Set<string>
): void {
  // Copy-on-write: most nodes declare no namespaces, and copying the inherited map per node
  // dominated the cost of this whole-tree walk on long documents.
  let bindings = inheritedBindings;
  if (node.namespaceBindings.length > 0) {
    const own = new Map(inheritedBindings);
    for (const binding of node.namespaceBindings) own.set(binding.prefix, binding.namespaceUri);
    bindings = own;
  }
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== '') uris.add(attribute.namespaceUri);
    if (typeof attribute.value !== 'string') continue;
    try {
      if (isMcPrefixListAttribute(attribute, node)) {
        for (const namespaceUri of resolvedPrefixNamespaceSet(attribute.value, bindings))
          uris.add(namespaceUri);
      } else if (isQNameValuedAttribute(attribute)) {
        for (const token of attribute.value.trim().split(/\s+/).filter(Boolean)) {
          const [namespaceUri] = resolvedQNameToken(token, bindings);
          if (namespaceUri !== '') uris.add(namespaceUri);
        }
      }
    } catch {
      // Undeclared / invalid tokens fail closed later during validate/serialize.
    }
  }
  for (const child of node.children) collectNonEmptyPrefixUris(child, bindings, uris);
}
