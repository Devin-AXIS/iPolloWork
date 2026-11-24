// Node helpers for a drawing's text wrap edit (`setDrawingWrap`).

import { WP_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';

const WRAP_KINDS: ReadonlySet<string> = new Set([
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
]);

/** Whether `node` is a `wp:wrap*` element of a `wp:anchor`, typed or generic. */
export function isWrapElement(node: OoxmlNode): node is OoxmlElement {
  if (node.kind === 'textValue') return false;
  return (
    WRAP_KINDS.has(node.kind) ||
    (node.namespaceUri === WP_NAMESPACE_URI && node.localName.startsWith('wrap'))
  );
}

/** Every node under `node`, inclusive, by id. */
function nodesById(node: OoxmlNode, into: Map<string, OoxmlNode>): Map<string, OoxmlNode> {
  into.set(node.id, node);
  if (node.kind !== 'textValue') for (const child of node.children) nodesById(child, into);
  return into;
}

/**
 * `next` with every element the edit created made generic, where `previous` is the drawing it
 * replaces. A drawing inside `mc:Choice` (a text box or shape as Word writes it, with a VML copy
 * in `mc:Fallback`) keeps its drawing elements generic, and a typed one under a generic parent
 * breaks the tree invariants. Elements the edit kept, such as a text box's paragraphs, keep their
 * kind. The XML that is saved is the same.
 */
export function withCreatedNodesGeneric<T extends OoxmlNode>(previous: OoxmlNode, next: T): T {
  const before = nodesById(previous, new Map());
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const old = before.get(node.id);
    // Untouched: the same object. Kept but changed: its own kind, its children visited.
    if (old === node) return node;
    const children = node.children.map((child) => visit(child));
    return { ...node, kind: old ? node.kind : 'generic', children } as OoxmlNode;
  };
  return visit(next) as T;
}
