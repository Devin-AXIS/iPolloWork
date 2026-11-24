// Whether a table holds tracked content that a view can hide.
import type { OoxmlNode } from '@docx-editor.dev/core/store';

/** Elements whose content one of the revision views hides. */
const HIDABLE = new Set(['del', 'ins', 'moveFrom', 'moveTo', 'cellDel', 'cellIns']);

const known = new WeakMap<object, boolean>();

/**
 * Whether `table` contains inserted, deleted or moved content. Only such a table can size its
 * columns differently with every revision shown, so only it needs a second reading. Memoized
 * per node: an untouched table keeps its node identity across edits.
 */
export function tableHasHidableRevisions(table: OoxmlNode): boolean {
  if (table.kind === 'textValue') return false;
  const cached = known.get(table);
  if (cached !== undefined) return cached;
  const pending: OoxmlNode[] = [table];
  let found = false;
  while (pending.length > 0 && !found) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (node !== table && HIDABLE.has(node.localName)) found = true;
    else for (const child of node.children) pending.push(child);
  }
  known.set(table, found);
  return found;
}
