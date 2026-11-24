import { createCommentScanBudget, type CommentScanBudget } from './comment-lifecycle-scan.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

const nodeCounts = new WeakMap<OoxmlNode, number>();

/** Count an already admitted tree without recursion or a width-sized work queue. */
function nodeCount(root: OoxmlNode): number {
  const cached = nodeCounts.get(root);
  if (cached !== undefined) return cached;
  let count = 1;
  const stack = [{ node: root, next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.node.kind === 'textValue' || frame.next === frame.node.children.length) {
      stack.pop();
      continue;
    }
    const child = frame.node.children[frame.next++]!;
    count += 1;
    stack.push({ node: child, next: 0 });
  }
  nodeCounts.set(root, count);
  return count;
}

/**
 * Explicit deletion scans admitted canonical trees, including edits since import.
 * Four package passes cover the owner and remaining-marker scans, two record scans,
 * and two metadata scans. Reply deletion needs at most three metadata scans instead.
 * Each node belongs to one part, so four passes also cover that case.
 * Keep the shared depth and thread-graph guards. This budget does not admit input.
 */
export function commentDeletionBudget(pkg: OoxmlPackage): CommentScanBudget {
  let nodes = 0;
  for (const part of pkg.parts.values()) nodes += nodeCount(part.root);
  return createCommentScanBudget(4 * nodes, 4 * pkg.parts.size);
}
