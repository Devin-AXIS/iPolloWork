// Answers about a resolved table row, shared by the row's side-rule copies.
//
// Width-dependent side-rule geometry is written onto copies (`legacy-table-side-rules.ts`). A
// copy only adds or drops `centeredSideRules` and `centeredSidePaint` on some cells. It shares
// everything else with its source by reference: the row's own fields, and each cell's fields,
// `blocks` included. An answer that reads none of those flags holds for every copy, so the
// whole family keeps one record: an answer found for one copy is found for all of them.
//
// The record holds only primitive answers, never a row, so a copy does not keep its source
// alive. A copy that adds only `spacingShading` or `spacingFrame` (`table-spacing-shading.ts`,
// `table-spacing-frame.ts`), which no answer reads, joins the family too. Any other row copy, such as a text edit or a split override,
// starts its own record.

import type { SemanticTableRow } from './semantic-table.ts';

/** Each answer reads the row's cells, their `blocks`, merge and direction facts only. */
export interface TableRowFacts {
  /** The table width lane may place the row (`table-width-update.ts`). */
  eligible: boolean | undefined;
  /** Identity of a list-item set the row has no paragraph in, or 0 (`table-width-update.ts`). */
  listFree: number;
  /** The row probe may be reused (`table-row-probe-reuse.ts`). */
  ordinary: boolean | undefined;
  /** `w:keepNext` on the row's first paragraph (`table-row-keeps.ts`). */
  keepsWithNext: boolean | undefined;
  /** `w:pageBreakBefore` on the row's first paragraph (`table-row-page-break.ts`). */
  breaksPageBefore: boolean | undefined;
}

const families = new WeakMap<SemanticTableRow, TableRowFacts>();

/** The record of `row`'s family; empty until an answer is found. */
export function rowFacts(row: SemanticTableRow): TableRowFacts {
  let known = families.get(row);
  if (!known) {
    known = {
      eligible: undefined,
      listFree: 0,
      ordinary: undefined,
      keepsWithNext: undefined,
      breaksPageBefore: undefined,
    };
    families.set(row, known);
  }
  return known;
}

/**
 * Put `copy` in the family of `source`. Only for a copy that adds or drops the centred
 * side-rule flags, `spacingShading` or `spacingFrame`, and shares every other field with `source`.
 */
export function shareRowFacts(source: SemanticTableRow, copy: SemanticTableRow): SemanticTableRow {
  families.set(copy, rowFacts(source));
  return copy;
}

let observer: Record<keyof TableRowFacts, number> | null = null;

/** Count one answer found by reading the row, for {@link rowFactsTestRecorder}. */
export function noteRowFactRead(fact: keyof TableRowFacts): void {
  if (observer) observer[fact] += 1;
}

/** @internal Counts answers found by reading a row, for tests that must see the sharing. */
export function rowFactsTestRecorder(): Readonly<Record<keyof TableRowFacts, number>> & {
  dispose(): void;
} {
  const counts = {
    eligible: 0,
    listFree: 0,
    ordinary: 0,
    keepsWithNext: 0,
    breaksPageBefore: 0,
  };
  observer = counts;
  return {
    get eligible() {
      return counts.eligible;
    },
    get listFree() {
      return counts.listFree;
    },
    get ordinary() {
      return counts.ordinary;
    },
    get keepsWithNext() {
      return counts.keepsWithNext;
    },
    get breaksPageBefore() {
      return counts.breaksPageBefore;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}
