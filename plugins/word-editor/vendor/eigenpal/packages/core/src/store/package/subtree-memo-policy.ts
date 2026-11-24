// Which nodes a whole-subtree memo keeps an entry for.
//
// Subtree memos (`WeakMap<node, answer>`) let an edit reuse every untouched subtree, because
// an edit shares those nodes by reference. Most nodes of a story are leaves or hold only
// leaves: run and paragraph property elements, `w:t`. One entry per such node is most of a
// memo's size, and a major GC visits every entry of every live weak collection.
//
// A node whose children are all leaves is answered again from those children, at most
// `WIDE_SUBTREE_CHILDREN - 1` of them, with no deeper walk. Its parent has a grandchild
// element, so the parent keeps its entry and an untouched subtree still answers in one read.

import type { OoxmlNode } from './ooxml-tree.ts';

/** A node with this many children keeps its entry even when they are all leaves. */
export const WIDE_SUBTREE_CHILDREN = 16;

/** True for an element grandchild or a wide child. Bounds the policy scan as well. */
function hasElementGrandchild(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.children.length >= WIDE_SUBTREE_CHILDREN) return true;
    for (const grandchild of child.children) if (grandchild.kind !== 'textValue') return true;
  }
  return false;
}

/**
 * Whether a whole-subtree memo keeps an entry for `node`: a node that is wide, or that
 * has an element below its children, or has a wide child. Every other node is answered from its
 * children, which are leaves.
 */
export function keepsSubtreeMemo(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  return node.children.length >= WIDE_SUBTREE_CHILDREN || hasElementGrandchild(node);
}

/** An answer with this many items is kept only for the latest revision of its node. */
export const LARGE_SUBTREE_ANSWER = 256;

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here, as `recent-root-cache.ts` does.
 */
interface NodeWeakRef {
  deref(): OoxmlNode | undefined;
}
declare const WeakRef: new (target: OoxmlNode) => NodeWeakRef;

/**
 * A memo for answers that grow with the subtree, such as every id under a node.
 *
 * An edit rebuilds the nodes above it: the root, the body, and the table that holds the edit.
 * The undo history keeps every rebuilt node alive, so a plain `WeakMap` entry on each kept an
 * O(subtree) answer per revision. A large answer is kept only for the latest revision of its
 * node id instead: node ids survive edits, so the current tree still answers every untouched
 * table in one read, and the history keeps nothing. Small answers keep a plain weak entry.
 * `set` takes the answer's size in items.
 *
 * Every answer stays in a `WeakMap`, so an answer that holds its own node, such as a prepared
 * table, does not keep that node alive. The id map holds only weak references to the latest
 * node: a strong answer there kept the last document's tables after it closed.
 */
export function createSubtreeAggregateMemo<V>(): {
  get(node: OoxmlNode): V | undefined;
  set(node: OoxmlNode, value: V, size: number): void;
} {
  const answers = new WeakMap<OoxmlNode, V>();
  const latest = new Map<string, NodeWeakRef>();
  let pruneAt = 64;
  return {
    get: (node) => answers.get(node),
    set(node, value, size) {
      answers.set(node, value);
      if (size < LARGE_SUBTREE_ANSWER) return;
      const previous = latest.get(node.id)?.deref();
      if (previous && previous !== node) answers.delete(previous);
      latest.set(node.id, new WeakRef(node));
      // Drop ids whose node is gone, such as a deleted table's.
      if (latest.size < pruneAt) return;
      for (const [id, ref] of latest) if (!ref.deref()) latest.delete(id);
      pruneAt = Math.max(64, latest.size * 2);
    },
  };
}
