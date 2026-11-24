import { RELATIONSHIPS_NAMESPACE_URI, type OoxmlNode } from './ooxml-tree.ts';

const OFFICE_NAMESPACE_URI = 'urn:schemas-microsoft-com:office:office';

/**
 * Count authored relationship references, including opaque VML and dead MC branches.
 * Rendering support cannot decide whether source relationships may be deleted.
 * Truncation is explicit so cleanup keeps resources it cannot prove unreferenced.
 */
export function canonicalMediaReferenceCount(
  root: OoxmlNode,
  relationshipIds: ReadonlySet<string>,
  limits: Readonly<{ maxVisited: number; maxDepth: number }> = {
    maxVisited: 50_000,
    maxDepth: 64,
  }
): Readonly<{ count: number; truncated: boolean }> {
  if (relationshipIds.size === 0) return { count: 0, truncated: false };
  const stack = [{ node: root, depth: 0 }];
  let visited = 0;
  let count = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (++visited > limits.maxVisited || depth > limits.maxDepth) {
      return { count, truncated: true };
    }
    if (node.kind === 'textValue') continue;
    if (node.attributes.length > 512) return { count, truncated: true };
    if (
      node.attributes.some(
        (attribute) =>
          (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI ||
            (attribute.namespaceUri === OFFICE_NAMESPACE_URI && attribute.localName === 'relid')) &&
          relationshipIds.has(attribute.value)
      )
    ) {
      count += 1;
    }
    if (visited + stack.length + node.children.length > limits.maxVisited) {
      return { count, truncated: true };
    }
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
  return { count, truncated: false };
}
