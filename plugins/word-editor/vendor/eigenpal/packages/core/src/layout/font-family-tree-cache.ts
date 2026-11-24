import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { keepsSubtreeMemo } from '../store/package/subtree-memo-policy.ts';

interface Scope {
  readonly key: string;
}
interface Entry {
  readonly key: string;
  readonly families: readonly string[];
}
// Avoid retaining large unions at every ancestor of a font-diverse document.
const MAX_CACHED_FAMILIES = 256;
/** Most subtrees name no family; their entries share this answer. */
const NO_FAMILIES: readonly string[] = Object.freeze([]);

/** Reuse font discoveries on immutable subtrees; edits only revisit their ancestors. */
export function createFontFamilyTreeCache<C extends Scope>(
  inspect: (
    node: OoxmlElement,
    context: C
  ) => {
    readonly families?: readonly string[];
    readonly children: readonly { node: OoxmlElement; context: C }[];
  }
): (roots: readonly OoxmlElement[], context: C) => readonly string[] {
  const cache = new WeakMap<OoxmlElement, Entry>();
  return (roots, context) => {
    type Frame = {
      node: OoxmlElement;
      context: C;
      children?: ReturnType<typeof inspect>['children'];
      next: number;
      found?: Set<string>;
    };
    const families = new Set<string>();
    for (const root of roots) {
      const stack: Frame[] = [{ node: root, context, next: 0 }];
      const finish = (found: readonly string[]): void => {
        stack.pop();
        const target = stack.at(-1)?.found ?? families;
        for (const family of found) target.add(family);
      };
      while (stack.length) {
        const frame = stack[stack.length - 1]!;
        const cached = cache.get(frame.node);
        if (cached?.key === frame.context.key) {
          finish(cached.families);
          continue;
        }
        if (!frame.children) {
          const result = inspect(frame.node, frame.context);
          frame.children = result.children;
          frame.found = new Set(result.families);
        }
        const child = frame.children[frame.next++];
        if (child) {
          stack.push({ ...child, next: 0 });
          continue;
        }
        const found = frame.found!.size === 0 ? NO_FAMILIES : [...frame.found!];
        // A node of leaves answers again from them in a few steps. Keeping an entry for every
        // property element held hundreds of megabytes on a long document.
        if (found.length <= MAX_CACHED_FAMILIES && keepsSubtreeMemo(frame.node))
          cache.set(frame.node, { key: frame.context.key, families: found });
        else cache.delete(frame.node);
        finish(found);
      }
    }
    return [...families];
  };
}

export function fontScanChildren<C>(node: OoxmlElement, context: C) {
  return node.children.flatMap((child) =>
    child.kind === 'textValue' ? [] : [{ node: child as OoxmlElement, context }]
  );
}
