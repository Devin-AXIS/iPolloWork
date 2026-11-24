// Layouts whose wrap reflow ran out of passes and published the layout of its last pass.
//
// Such a layout opens, but some text may wrap around where an object sat one pass earlier.
// The result mark lets a column-balance search skip trials that would each run to the ceiling.
// The session mark makes the next edit settle from scratch: a seed from an unsettled layout
// is not a fixed point, so a seeded settle would run to the ceiling and then fall back to a
// fresh settle anyway, and an early seeded match would depend on the edit history.

import type { BlockLayoutResult } from './column-balance-layout.ts';
import type { LayoutSession } from './layout-session.ts';

const unsettledResults = new WeakSet<BlockLayoutResult>();
const unsettledSessions = new WeakSet<LayoutSession>();
let warned = false;

/** Says once per process that a wrap reflow stopped before it settled. */
export function noteUnsettledExclusionReflow(passes: number): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[docx-editor] Text wrap around anchored objects did not settle in ${passes} layout passes. ` +
      'Some text may wrap around an earlier position of an object.'
  );
}

/** Records that `result` was published before its wrap reflow settled. */
export function markResultUnsettled(result: BlockLayoutResult, passes: number): void {
  unsettledResults.add(result);
  noteUnsettledExclusionReflow(passes);
}

/** Whether `result` was published before its wrap reflow settled. @internal */
export function resultUnsettled(result: BlockLayoutResult): boolean {
  return unsettledResults.has(result);
}

/** Records that `session` now holds a layout published before its wrap reflow settled. */
export function markSessionUnsettled(session: LayoutSession): void {
  unsettledSessions.add(session);
}

/** Whether `session` holds an unsettled layout; clears the mark. @internal */
export function takeSessionUnsettled(session: LayoutSession): boolean {
  return unsettledSessions.delete(session);
}
