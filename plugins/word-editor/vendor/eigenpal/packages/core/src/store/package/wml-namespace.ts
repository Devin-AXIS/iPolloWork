// WML namespace prefix resolution for freshly minted tree nodes.
//
// Fresh row/cell/property elements must not hardcode `w`: valid DOCX may bind
// WordprocessingML as another alias or as the default namespace. Attributes always
// require a non-empty in-scope prefix; when none exists, declare a collision-free
// binding on the fresh row.

import { parentNodeOf } from './ooxml-edit.ts';
import { WML_NAMESPACE_URI, XMLNS_NAMESPACE_URI, XML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlPart } from './ooxml-tree.ts';

export interface WmlFreshNamespaceContext {
  /** Prefix for WML element nodes. Undefined means default namespace. */
  readonly elementPrefix: string | undefined;
  /** Non-empty prefix for WML attributes. */
  readonly attributePrefix: string;
  /** Binding to declare on the inserted row when a new alias was allocated. */
  readonly rowBinding: { readonly prefix: string; readonly namespaceUri: string } | null;
}

function ancestorChain(part: OoxmlPart, node: OoxmlElement): readonly OoxmlElement[] {
  const chain: OoxmlElement[] = [];
  let current: OoxmlElement | null = node;
  while (current) {
    chain.push(current);
    if (current.id === part.root.id) break;
    current = parentNodeOf(part, current.id);
  }
  return chain.reverse();
}

/** Effective namespace bindings inherited at `node`, matching invariant validation. */
export function namespaceBindingsAt(
  part: OoxmlPart,
  node: OoxmlElement
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>([
    ['xml', XML_NAMESPACE_URI],
    ['xmlns', XMLNS_NAMESPACE_URI],
  ]);
  for (const ancestor of ancestorChain(part, node)) {
    for (const binding of ancestor.namespaceBindings) {
      bindings.set(binding.prefix, binding.namespaceUri);
    }
  }
  return bindings;
}

function chooseFreshWmlPrefix(usedPrefixes: ReadonlySet<string>): string {
  if (!usedPrefixes.has('w')) return 'w';
  for (let suffix = 97; suffix <= 122; suffix += 1) {
    const candidate = `w${String.fromCharCode(suffix)}`;
    if (!usedPrefixes.has(candidate)) return candidate;
  }
  for (let counter = 2; ; counter += 1) {
    const candidate = `wx${counter}`;
    if (!usedPrefixes.has(candidate)) return candidate;
  }
}

/**
 * Namespace context for fresh WML nodes inserted under `anchor`.
 *
 * Reuses an in-scope non-empty alias bound to WML when available. When WML is only
 * the default element namespace, elements use the default prefix and attributes use
 * a safe generated alias declared on the fresh row. Hostile rebinding of a candidate
 * alias is ignored because the effective binding map reflects the actual ancestry.
 */
export function wmlFreshNamespaceContextAt(
  part: OoxmlPart,
  anchor: OoxmlElement
): WmlFreshNamespaceContext {
  const bindings = namespaceBindingsAt(part, anchor);
  const defaultIsWml = bindings.get('') === WML_NAMESPACE_URI;
  const wmlPrefixes: string[] = [];
  for (const [prefix, uri] of bindings) {
    if (prefix !== '' && uri === WML_NAMESPACE_URI) wmlPrefixes.push(prefix);
  }

  let attributePrefix: string;
  let rowBinding: WmlFreshNamespaceContext['rowBinding'] = null;
  if (wmlPrefixes.length > 0) {
    attributePrefix = wmlPrefixes.includes('w') ? 'w' : wmlPrefixes[0]!;
  } else {
    attributePrefix = chooseFreshWmlPrefix(new Set(bindings.keys()));
    rowBinding = Object.freeze({ prefix: attributePrefix, namespaceUri: WML_NAMESPACE_URI });
  }

  const elementPrefix: string | undefined = defaultIsWml ? undefined : attributePrefix;
  return Object.freeze({ elementPrefix, attributePrefix, rowBinding });
}
