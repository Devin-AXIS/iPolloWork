// `setListLevel` for the batch planner. Split out of `plan.ts`, which is at its line cap.

import { automationListLevelExists } from './list-authoring.ts';
import { membershipIn, MAX_LIST_LEVEL } from './lists.ts';
import type { PlannedOperation } from './plan-types.ts';
import { refused as refuse } from './plan-results.ts';
import type { AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

/**
 * Move a list item to `level`. `admit` pins the batch's write story and claims the paragraph's
 * properties container, or answers the refusal.
 */
export function planSetListLevel(
  packageReads: AutomationPackageReads,
  reads: AutomationStoryReads,
  paragraphId: string,
  level: number,
  admit: () => PlannedOperation | null
): PlannedOperation {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LIST_LEVEL) {
    return refuse(
      'invalid-offset',
      `a list level is 0 to ${String(MAX_LIST_LEVEL)}`,
      String(level)
    );
  }
  // REFUSED FOR PROSE, not silently numbered: `setListLevel` writes `w:ilvl` inside an existing
  // `w:numPr`, and a paragraph with none is not a list item. Numbering it here would need a
  // `w:numId` this operation was never given.
  const membership = membershipIn(reads, paragraphId);
  if (!membership)
    return refuse('unsupported-content', 'that paragraph is not in a list', paragraphId);
  if (
    !packageReads.package ||
    !automationListLevelExists(packageReads.package, membership.numId, level)
  ) {
    return refuse(
      'unsupported-content',
      'list level is not defined; configure that level first',
      paragraphId
    );
  }
  const refusal = admit();
  if (refusal) return refusal;
  return {
    ok: true,
    kind: 'command',
    ops: [{ op: 'setListLevel', paragraphId, level }],
    story: reads.story,
    answer: () => APPLIED,
  };
}
