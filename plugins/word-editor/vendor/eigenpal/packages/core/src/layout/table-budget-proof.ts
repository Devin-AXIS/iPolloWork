// Which table fragments were finalized while the pass-wide budgets still had headroom.
//
// `finalizeTableRows` spends two budgets shared by every table of a layout pass: border
// ownership intervals and vMerge cell visits. Both fail soft: once one is spent, later rows
// lose their border ownership or merge spans. Spending only decreases, so a budget that is
// still positive after a fragment's finalize was positive for every row of that fragment and
// every nested table placed inside it. Such a fragment is exactly what the same rows give
// without the budgets.
//
// The table fast paths finalize again without the pass budgets. They accept a table only
// when every old fragment carries this proof. A copy made elsewhere has no proof and takes
// the full layout, which marks its own result again.

import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { TableFragmentRecord } from './semantic-records.ts';

const unspent = new WeakSet<TableFragmentRecord>();

/** True when neither pass budget has run out. Absent budgets are unlimited. */
export function budgetsHaveHeadroom(
  deps: Pick<TableFlowDeps, 'borderOwnershipBudget' | 'vMergeResolveBudget'>
): boolean {
  return (
    (deps.borderOwnershipBudget?.intervalsRemaining ?? 1) > 0 &&
    (deps.vMergeResolveBudget?.cellsRemaining ?? 1) > 0
  );
}

/** Record that `fragment` was finalized with headroom, when `proven`. Returns `fragment`. */
export function withBudgetProof<T extends TableFragmentRecord>(fragment: T, proven: boolean): T {
  if (proven) unspent.add(fragment);
  return fragment;
}

/** True when `fragment` was finalized with headroom in both pass budgets. */
export function finalizedWithHeadroom(fragment: TableFragmentRecord): boolean {
  return unspent.has(fragment);
}
