// The ancestors of a few nodes, for walks that only act near them.

import { parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * The ids of every ancestor of `ids`, with `ids` themselves and the part root. A walk that only
 * acts on nodes holding one of `ids` can skip every other subtree and still visit in document
 * order: a long document is mostly paragraphs that such a walk never needs.
 */
export function ancestorIdsOf(part: OoxmlPart, ids: Iterable<string>): ReadonlySet<string> {
  const ancestors = new Set<string>();
  for (const id of ids) {
    let current: string | undefined = id;
    while (current !== undefined && !ancestors.has(current)) {
      ancestors.add(current);
      current = parentNodeOf(part, current)?.id;
    }
  }
  ancestors.add(part.root.id);
  return ancestors;
}
