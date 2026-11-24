// Replace many nodes of a part in one pass, for an export snapshot.
//
// An export repair (a shape's VML fallback, a text box's fallback story) writes a copy of the
// part and leaves the live part as it is. The edit primitives patch and move the live part's
// node index onto their result, and each one validates the whole part, so a repair with many
// replacements cost the part once per replacement and left the next edit a full index rebuild.
// This walks the part once, shares every untouched subtree by reference, never touches the live
// index, and validates the result once. A replacement that uses a prefix its new scope binds to
// another URI gets a local binding, as `replaceNode` gives it.

import { bindConflictingPrefixes } from './edit-namespace-scope.ts';
import {
  validateOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';

/** Nesting this deep is written as it is: the copy keeps the live part. */
const MAX_DEPTH = 512;

/**
 * `part` with each node whose id `replacements` names swapped for its replacement, or null
 * when a named node is missing, the tree is too deep, or the result fails validation.
 */
export function replaceNodesForExport(
  part: OoxmlPart,
  replacements: ReadonlyMap<string, OoxmlNode>
): OoxmlPart | null {
  if (replacements.size === 0) return part;
  let found = 0;
  let tooDeep = false;
  const visit = (node: OoxmlNode, depth: number, scope: ReadonlyMap<string, string>): OoxmlNode => {
    const replacement = replacements.get(node.id);
    if (replacement) {
      found += 1;
      return bindConflictingPrefixes(replacement, scope);
    }
    if (node.kind === 'textValue' || node.children.length === 0) return node;
    if (depth >= MAX_DEPTH) {
      tooDeep = true;
      return node;
    }
    let inner = scope;
    if (node.namespaceBindings.length > 0) {
      const own = new Map(scope);
      for (const binding of node.namespaceBindings) own.set(binding.prefix, binding.namespaceUri);
      inner = own;
    }
    let children: OoxmlNode[] | null = null;
    node.children.forEach((child, index) => {
      const next = visit(child, depth + 1, inner);
      if (next !== child && !children) children = node.children.slice(0, index);
      if (children) children.push(next);
    });
    return children ? ({ ...node, children } as OoxmlElement) : node;
  };
  const root = visit(part.root, 0, new Map());
  if (tooDeep || found !== replacements.size || root.kind === 'textValue') return null;
  const next: OoxmlPart = Object.freeze({ ...part, root: root as OoxmlElement });
  return validateOoxmlPart(next).ok ? next : null;
}
