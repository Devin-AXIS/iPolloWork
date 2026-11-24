import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/**
 * Bind introduced QNames locally when the destination uses their prefix for another URI.
 *
 * Returns `node` itself when nothing in its subtree needs a binding. The walk copies the
 * scope only on an element that declares or adds a binding, and copies the child list only
 * when a child changes: a structural edit hands this whole story-sized child lists, and
 * a per-node scope copy made every Enter cost the size of the body.
 */
export function bindConflictingPrefixes(
  node: OoxmlNode,
  inherited: ReadonlyMap<string, string>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  let scope: ReadonlyMap<string, string> = inherited;
  let authored: Set<string> | null = null;
  if (node.namespaceBindings.length > 0) {
    const own = new Map(inherited);
    authored = new Set();
    for (const binding of node.namespaceBindings) {
      own.set(binding.prefix, binding.namespaceUri);
      authored.add(binding.prefix);
    }
    scope = own;
  }
  let additions: Map<string, string> | null = null;
  const bind = (prefix: string | undefined, uri: string): void => {
    if (!prefix || prefix === 'xml' || prefix === 'xmlns' || !uri || authored?.has(prefix)) return;
    // Missing declarations still go through the existing validation path. Never repair
    // an explicitly contradictory declaration or two conflicting QNames on one element.
    if (additions?.has(prefix)) return;
    const current = scope.get(prefix);
    if (current !== undefined && current !== uri) {
      additions ??= new Map();
      additions.set(prefix, uri);
      const own = scope === inherited ? new Map(inherited) : (scope as Map<string, string>);
      own.set(prefix, uri);
      scope = own;
    }
  };
  bind(node.prefix, node.namespaceUri);
  for (const attribute of node.attributes) bind(attribute.prefix, attribute.namespaceUri);
  let children: OoxmlNode[] | null = null;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const bound = bindConflictingPrefixes(child, scope);
    if (bound !== child && !children) children = node.children.slice(0, index);
    children?.push(bound);
  }
  // Assigned inside `bind`, which flow analysis does not follow.
  const added = additions as Map<string, string> | null;
  if (!added && !children) return node;
  return {
    ...node,
    namespaceBindings: [
      ...node.namespaceBindings,
      ...[...(added ?? [])].map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
    ],
    children: children ?? node.children,
  } as OoxmlElement;
}

/**
 * Declare on `node` every prefix its subtree uses that neither it nor `inherited` binds.
 *
 * For content moved between parts: a note copied out of a part whose root declared a prefix
 * keeps using that prefix, and a destination root that never declared it leaves the copy
 * unserializable. Each element and attribute carries its own namespace URI, so the binding
 * comes from the moved content itself. A prefix the subtree uses for two URIs gets no
 * binding and still fails validation. A prefix the destination binds to another URI is
 * rebound locally, as {@link bindConflictingPrefixes} does. Returns `node` itself when
 * nothing needs a binding.
 */
export function bindMissingPrefixes(
  node: OoxmlNode,
  inherited: ReadonlyMap<string, string>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const missing = new Map<string, string | null>();
  const visit = (current: OoxmlNode, scope: ReadonlyMap<string, string>): void => {
    if (current.kind === 'textValue') return;
    let own = scope;
    if (current.namespaceBindings.length > 0) {
      const local = new Map(scope);
      for (const binding of current.namespaceBindings) {
        local.set(binding.prefix, binding.namespaceUri);
      }
      own = local;
    }
    const need = (prefix: string | undefined, uri: string): void => {
      if (!prefix || prefix === 'xml' || prefix === 'xmlns' || !uri || own.has(prefix)) return;
      const seen = missing.get(prefix);
      if (seen === undefined) missing.set(prefix, uri);
      else if (seen !== uri) missing.set(prefix, null);
    };
    need(current.prefix, current.namespaceUri);
    for (const attribute of current.attributes) need(attribute.prefix, attribute.namespaceUri);
    for (const child of current.children) visit(child, own);
  };
  visit(node, inherited);
  const additions = [...missing].filter((entry): entry is [string, string] => entry[1] !== null);
  const declared =
    additions.length === 0
      ? node
      : ({
          ...node,
          namespaceBindings: [
            ...node.namespaceBindings,
            ...additions.map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
          ],
        } as OoxmlElement);
  return bindConflictingPrefixes(declared, inherited);
}
