// A tracked insertion that lands inside another author's pending insertion.
//
// Nested, the new `w:ins` would belong to their proposal: rejecting theirs removes the new
// words, and accepting the new words leaves them inside a pending insertion. So the other
// author's wrapper splits at the landing point instead. Both halves keep the same revision
// triple, and the new insertion sits between them as a decision of its own.
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { insertionAuthor } from './tree-op-retraction.ts';

/**
 * `nodes` with every wrapper in `wrapperIds` lifted out of each enclosing insertion by
 * another author that is its direct parent, or null when a wrapper stays inside one.
 *
 * Only a direct parent splits. A link, a content control, or another container inside their
 * insertion cannot split without duplicating its identity, so new words inside one would
 * stay part of their proposal. The caller refuses that edit instead.
 */
export function liftedOutOfForeignInsertions(
  nodes: readonly OoxmlNode[],
  wrapperIds: ReadonlySet<string>,
  author: string,
  mint: () => string
): OoxmlNode[] | null {
  const lifted = lift(nodes, wrapperIds, author, mint);
  return holdsNested(lifted, wrapperIds, author, false) ? null : lifted;
}

function lift(
  nodes: readonly OoxmlNode[],
  wrapperIds: ReadonlySet<string>,
  author: string,
  mint: () => string
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'textValue' || wrapperIds.has(node.id) || !holdsAny(node, wrapperIds)) {
      out.push(node);
      continue;
    }
    const children = lift(node.children, wrapperIds, author, mint);
    if (!isForeignInsertion(node, author) || !children.some((child) => wrapperIds.has(child.id))) {
      out.push({ ...node, children } as OoxmlNode);
      continue;
    }
    let part: OoxmlNode[] = [];
    let first = true;
    const flush = () => {
      if (!part.length) return;
      out.push({ ...node, id: first ? node.id : mint(), children: part } as OoxmlNode);
      first = false;
      part = [];
    };
    for (const child of children) {
      if (child.kind !== 'textValue' && wrapperIds.has(child.id)) {
        flush();
        out.push(child);
      } else part.push(child);
    }
    flush();
  }
  return out;
}

function isForeignInsertion(node: OoxmlNode, author: string): boolean {
  return node.kind === 'revisionInsert' && (insertionAuthor([node]) ?? author) !== author;
}

/** Whether a new wrapper still sits anywhere inside another author's insertion. */
function holdsNested(
  nodes: readonly OoxmlNode[],
  ids: ReadonlySet<string>,
  author: string,
  inside: boolean
): boolean {
  return nodes.some((node) => {
    if (node.kind === 'textValue') return false;
    if (ids.has(node.id)) return inside;
    return holdsNested(node.children, ids, author, inside || isForeignInsertion(node, author));
  });
}

function holdsAny(node: OoxmlNode, ids: ReadonlySet<string>): boolean {
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => ids.has(child.id) || holdsAny(child, ids));
}
