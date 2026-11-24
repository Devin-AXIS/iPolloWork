// The `replaceDocument` editor command: `exec` and `can` answers, and the typed outcome that
// every refusal carries, including the ones the facade returns before the command runs.

import type { CanResult, EditorCommand } from '../contracts/editor.ts';
import type {
  ReplaceDocumentErrorCode,
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
} from '../contracts/replace-document.ts';
import type { ExecErrorCode, ExecResult } from '../contracts/types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { DocumentHandle } from '../contracts/editor.ts';
import { documentHandleOf } from './document-handle.ts';
import {
  replaceDocumentAsEdit,
  replaceDocumentGate,
  staleDocument,
} from './replace-document-edit.ts';
import { PREVIEW_WRITE_REFUSAL, REFRESH_WRITE_REFUSAL } from './refresh-write-guard.ts';

type ReplaceDocumentCommand = Extract<EditorCommand, { type: 'replaceDocument' }>;

/** The general command code each refusal reports at the top level of `ExecResult`. */
const EXEC_CODES: Readonly<Record<ReplaceDocumentErrorCode, ExecErrorCode>> = {
  invalidRequest: 'invalidArgs',
  invalidDocument: 'invalidArgs',
  staleDocument: 'notFound',
  unavailable: 'notFound',
  // The facade's own write block reports `unsupported` for every command; agree with it.
  busy: 'unsupported',
  editNotPermitted: 'locked',
  editUnsupported: 'unsupported',
};

function refusalResult(refusal: ReplaceDocumentRefusal): Extract<ExecResult, { ok: false }> {
  return {
    ok: false,
    code: EXEC_CODES[refusal.code],
    reason: refusal.message,
    replaceDocument: refusal,
  };
}

/** By tag rather than `instanceof`: bytes from another window are still bytes. */
function bytesOf(docx: unknown): Uint8Array | null {
  const tag = Object.prototype.toString.call(docx);
  if (tag === '[object Uint8Array]') return docx as Uint8Array;
  if (tag === '[object ArrayBuffer]') return new Uint8Array(docx as ArrayBuffer);
  return null;
}

function invalidRequest(command: ReplaceDocumentCommand): ReplaceDocumentRefusal | null {
  const expected = command.expected as Partial<DocumentHandle> | undefined;
  if (
    expected !== undefined &&
    (expected === null ||
      typeof expected !== 'object' ||
      !Number.isSafeInteger(expected.revision) ||
      typeof expected.loadId !== 'string')
  )
    return {
      ok: false,
      code: 'invalidRequest',
      message: 'expected must be a handle from getDocumentHandle().',
    };
  return bytesOf(command.docx)
    ? null
    : {
        ok: false,
        code: 'invalidRequest',
        message: 'docx must be a Uint8Array or an ArrayBuffer.',
      };
}

/** Run `replaceDocument` on the mounted surface. */
export function execReplaceDocument(
  command: ReplaceDocumentCommand,
  surface: PaginatedSurface | null,
  container: HTMLElement | null
): ExecResult {
  const invalid = invalidRequest(command);
  if (invalid) return refusalResult(invalid);
  const outcome: ReplaceDocumentOutcome = replaceDocumentAsEdit(
    surface,
    container,
    bytesOf(command.docx)!,
    command.expected
  );
  return outcome.ok
    ? { ok: true, changed: outcome.changed, replaceDocument: outcome }
    : refusalResult(outcome);
}

/** Whether `replaceDocument` can run now. It does not open the file, so a bad file still fails. */
export function canReplaceDocument(
  command: ReplaceDocumentCommand,
  surface: PaginatedSurface | null,
  container: HTMLElement | null
): CanResult {
  const refused = invalidRequest(command) ?? replaceDocumentGate(surface, container);
  if (refused) return { ok: false, code: EXEC_CODES[refused.code], reason: refused.message };
  const stale = command.expected ? staleDocument(command.expected, surface!) : null;
  return stale ? { ok: false, code: 'notFound', reason: stale.message } : { ok: true };
}

/**
 * Give a refusal the facade returned before `replaceDocument` ran its typed outcome, so a host
 * can always read `result.replaceDocument`.
 */
export function withReplaceDocumentOutcome(command: EditorCommand, result: ExecResult): ExecResult {
  if (command.type !== 'replaceDocument' || result.ok || result.replaceDocument) return result;
  // The facade refuses before the command for two reasons: a write block (a document refresh
  // or a preview), and a history group the command cannot join.
  const blocked =
    result.reason === REFRESH_WRITE_REFUSAL || result.reason === PREVIEW_WRITE_REFUSAL;
  return {
    ...result,
    replaceDocument: {
      ok: false,
      code: blocked ? 'busy' : 'invalidRequest',
      message: result.reason,
    },
  };
}

/** The facade reads these through one namespace import, to stay inside its line cap. */
export {
  documentHandleOf,
  canReplaceDocument as can,
  execReplaceDocument as exec,
  withReplaceDocumentOutcome as withOutcome,
};
