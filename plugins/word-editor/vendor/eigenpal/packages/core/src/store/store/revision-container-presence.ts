// Which subtrees hold a revision container, memoized per immutable node.

import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { keepsSubtreeMemo } from '../package/subtree-memo-policy.ts';

/** Revision containers whose resolution rewrites the content they wrap. */
export const REVISION_LOCAL_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'sectPrChange',
  'tblGridChange',
  'cellIns',
  'cellDel',
  'cellMerge',
]);

/** Entries only for nodes `keepsSubtreeMemo` admits; leaf-only nodes answer from children. */
const presence = new WeakMap<OoxmlNode, boolean>();

/**
 * Whether a revision container sits at or below `node`. A walk for revision decisions skips
 * every subtree without one, so after an edit it pays for the edited path, not the part.
 */
export function holdsRevisionContainer(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const cached = presence.get(node);
  if (cached !== undefined) return cached;
  const result =
    (node.namespaceUri === WML_NAMESPACE_URI && REVISION_LOCAL_NAMES.has(node.localName)) ||
    node.children.some(holdsRevisionContainer);
  if (keepsSubtreeMemo(node)) presence.set(node, result);
  return result;
}

const MOVE_KINDS: ReadonlySet<string> = new Set([
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

const movePresence = new WeakMap<OoxmlNode, boolean>();

/** Whether a move range marker or a move wrapper sits strictly below `node`. */
export function holdsMoveNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const cached = movePresence.get(node);
  if (cached !== undefined) return cached;
  const result = node.children.some(
    (child) => child.kind !== 'textValue' && (MOVE_KINDS.has(child.kind) || holdsMoveNode(child))
  );
  if (keepsSubtreeMemo(node)) movePresence.set(node, result);
  return result;
}

/** Whether `node` is a move range marker or a move wrapper, or holds one. */
export function isOrHoldsMoveNode(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && (MOVE_KINDS.has(node.kind) || holdsMoveNode(node));
}
