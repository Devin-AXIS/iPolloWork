// Instruction scope for the complex-field machine.
//
// A nested field inside another field's instruction is part of that instruction. Its result
// is input to the enclosing field, never displayed text on its own. This holds at every open
// level, so an `IF` nested inside a saved result still hides the fields in its own
// instruction. The store's saved-result text applies the same rule through
// `store/package/field-marker-scope.ts`; inside an atomic field the two always agree, because
// its begins and ends are balanced.

import { MAX_FIELD_NESTING, type ComplexFieldParseState } from './field-instruction.ts';

/**
 * Whether the machine's current position belongs to any open field's instruction.
 *
 * True while any open level has not reached its `separate`. Levels past
 * {@link MAX_FIELD_NESTING} are not captured and answer through the levels below them; such a
 * field overflows and demotes, so no atomic projection reads this answer for it.
 */
export function isInsideOpenFieldInstruction(state: ComplexFieldParseState): boolean {
  if (state.nesting < 1) return false;
  if (state.phase === 'instruction') return true;
  const capturedInnerLevels = Math.min(state.nesting, MAX_FIELD_NESTING) - 1;
  for (let index = 0; index < capturedInnerLevels; index += 1) {
    if (state.inner[index]?.separated !== true) return true;
  }
  return false;
}
