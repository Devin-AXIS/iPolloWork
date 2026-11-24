// The two shapes a planned read answers with, for the planners split out of `plan.ts`.
//
// INTERNAL. Refusals are frozen, like the main planner's, so a caller cannot edit an error another
// operation in the same response shares.

import type { AutomationErrorCode, AutomationValue } from './protocol.ts';
import type { PlannedOperation } from './plan-types.ts';

/** A refused operation, with a frozen error. */
export function refused(
  code: AutomationErrorCode,
  message: string,
  detail?: string
): PlannedOperation {
  return {
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  };
}

/** A read that answered. */
export function answered(value: AutomationValue): PlannedOperation {
  return { ok: true, kind: 'query', value };
}
