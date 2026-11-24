// Pieces of one change that an edit makes neighbours become one wrapper.
//
// One change can sit in several wrappers, split where a link, a content control, or another
// change once stood between them. Shared text holds a change as attributes on characters, so a
// peer shows two adjacent pieces as one wrapper at once. When an edit removes what stood
// between two pieces, the store joins them as well, and the next edit reads one change, as
// every peer does: typing inside a deletion lands after all of it, and a decision on the
// change's site reaches all of it. Pieces that were already neighbours stay as they are.

import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import { sameRevision } from './same-revision.ts';
import { mergedRevisions } from './tree-op-tracked.ts';

/**
 * One wrapper for two pieces of one change, or null. An insertion or deletion also joins its
 * boundary runs, as typing and striking do. A move keeps its runs: shared text holds them apart.
 */
function joinedPieces(mint: () => string, left: OoxmlNode, right: OoxmlNode): OoxmlNode | null {
  if (left.kind === 'textValue' || right.kind === 'textValue') return null;
  if (left.kind !== right.kind || !isContentRevisionKind(left.kind)) return null;
  const attributes = sameRevision(left, right) ? joinedAttributes(left, right) : null;
  if (attributes === null) return null;
  if (left.kind === 'revisionInsert' || left.kind === 'revisionDelete') {
    const joined = mergedRevisions(mint, [left, right])[0];
    if (joined === undefined || joined.kind === 'textValue') return null;
    return { ...joined, attributes } as OoxmlNode;
  }
  return { ...left, attributes, children: [...left.children, ...right.children] } as OoxmlNode;
}

type Attribute = OoxmlElement['attributes'][number];

/**
 * The attributes one wrapper for both pieces carries: the left piece's and any only the right
 * one has. Null when the two disagree on one, such as another UTC date or session id, which a
 * join would lose.
 */
function joinedAttributes(left: OoxmlElement, right: OoxmlElement): readonly Attribute[] | null {
  const extra: Attribute[] = [];
  for (const attribute of right.attributes) {
    const match = left.attributes.find(
      (entry) =>
        entry.namespaceUri === attribute.namespaceUri && entry.localName === attribute.localName
    );
    if (match === undefined) extra.push(attribute);
    else if (match.value !== attribute.value) return null;
  }
  return extra.length === 0 ? left.attributes : [...left.attributes, ...extra];
}

/**
 * `nodes`, with the two nodes at each seam joined when they are pieces of one change. Seam `i`
 * lies between `nodes[i - 1]` and `nodes[i]`.
 */
export function joinedAtSeams(
  mint: () => string,
  nodes: readonly OoxmlNode[],
  seams: readonly number[]
): OoxmlNode[] {
  const at = new Set(seams.filter((seam) => seam > 0 && seam < nodes.length));
  if (at.size === 0) return nodes.slice();
  const out: OoxmlNode[] = [];
  for (const [index, node] of nodes.entries()) {
    const previous = out.at(-1);
    if (previous !== undefined && at.has(index)) {
      const joined = joinedPieces(mint, previous, node);
      if (joined !== null) {
        out[out.length - 1] = joined;
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

/** `children` with the child `id` replaced by `content`, joining pieces of one change at both edges. */
export function splicedJoined(
  mint: () => string,
  children: readonly OoxmlNode[],
  id: string,
  content: readonly OoxmlNode[]
): OoxmlNode[] {
  const index = children.findIndex((child) => child.id === id);
  if (index < 0) return children.slice();
  const nodes = [...children.slice(0, index), ...content, ...children.slice(index + 1)];
  return joinedAtSeams(mint, nodes, [index, index + content.length]);
}
