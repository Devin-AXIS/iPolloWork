// A nested table's autofit need, measured once per pass.
//
// Each level asks its nested table for two needs (plain and widened), and measuring either one
// measures every deeper level. Without a memo the work doubled with each level of nesting.
// A context belongs to one pass of one flow, during which nothing a need reads can change, so
// keying on it is exact, and the memo dies with the pass.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { AutofitView } from './table-autofit-widths.ts';

/** What a nested table needs from its column, plainly and once the column has to widen. */
export interface NestedTableNeed {
  readonly plain: number;
  readonly widened: number;
}

interface Memo {
  readonly depth: number;
  readonly view: AutofitView;
  readonly need: NestedTableNeed;
}

const passNeeds = new WeakMap<object, WeakMap<OoxmlElement, Memo[]>>();

/** The view fields a need reads; `markupStructure` belongs to the outer table only. */
const sameView = (a: AutofitView, b: AutofitView): boolean =>
  a.readNested === b.readNested &&
  a.styleCascade === b.styleCascade &&
  a.displayMode === b.displayMode &&
  a.authorFilter === b.authorFilter;

/** `measure()`'s need for `table` at `depth` in this pass's `context`, measured once. */
export function memoizedNestedNeed(
  context: object,
  table: OoxmlElement,
  view: AutofitView,
  depth: number,
  measure: () => NestedTableNeed
): NestedTableNeed {
  let byTable = passNeeds.get(context);
  if (!byTable) passNeeds.set(context, (byTable = new WeakMap()));
  let memos = byTable.get(table);
  if (!memos) byTable.set(table, (memos = []));
  for (const memo of memos) if (memo.depth === depth && sameView(memo.view, view)) return memo.need;
  const need = measure();
  memos.push({ depth, view, need });
  return need;
}
