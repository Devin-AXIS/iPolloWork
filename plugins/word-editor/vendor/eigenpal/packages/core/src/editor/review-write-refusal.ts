// The answer for a review write that did not land.
//
// `commitReviewOps` says why a write did not go through: the external refresh that skipped the
// commit, a gate that refused it before it ran (viewing, a collaboration refusal), or the reason
// the write itself reported. The facade's comment and revision commands used to answer every one
// of those with the same generic sentence, so a host could not tell "wait for the refresh" from
// "the document is open for viewing" from a real failure.

import type { ExecErrorCode, ExecResult } from '../contracts/types.ts';
import { diagnosticCodeOfRefusal } from './diagnostic-codes.ts';
import { UNEXPLAINED_WRITE_REFUSAL } from './refresh-write-guard.ts';

/**
 * The failed `ExecResult` for a review write, from the reason `commitReviewOps` returned.
 *
 * `fallback` is the sentence for a write that refused without saying why, under `code`. A
 * viewing or protection refusal answers `locked`, as review commands' other such refusals do.
 */
export function reviewWriteRefusal(
  refused: string | null,
  fallback: string,
  code: ExecErrorCode = 'unsupported'
): Extract<ExecResult, { ok: false }> {
  if (refused === null || refused === UNEXPLAINED_WRITE_REFUSAL)
    return { ok: false, code, reason: fallback };
  // A decision a lock or a binding keeps, such as the locked half of a move, keeps the exec
  // code an edit there gets.
  if (refused.startsWith('locked-content:')) return { ok: false, code: 'locked', reason: refused };
  if (refused.startsWith('bound-content:')) return { ok: false, code: 'bound', reason: refused };
  const diagnostic = diagnosticCodeOfRefusal(refused);
  const locked = diagnostic === 'edit.read-only' || diagnostic === 'edit.protected-content';
  return { ok: false, code: locked ? 'locked' : 'unsupported', reason: refused };
}
