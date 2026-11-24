// Document protection over the tracked-change operations of the editing API.
//
// Enforced tracked-changes protection lets a reviewer make tracked edits and comments only. The
// rule is the editor's own (`trackedChangesProtectionRefusal`), so a server agent and a reader
// at the live editor get the same answer for the same file.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  readDocumentProtection,
  trackedChangesProtectionRefusal,
} from '../store/package/document-protection.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import { refused } from './plan-results.ts';

const DECISIONS: ReadonlySet<string> = new Set([
  'acceptRevision',
  'rejectRevision',
  'resolveRevisionBatch',
  'acceptAllRevisions',
  'rejectAllRevisions',
]);

/** The refusal of a tracked-change decision or author change under protection, or null. */
export function revisionProtectionRefusal(
  operation: AutomationOperation,
  pkg: OoxmlPackage | null
): PlannedOperation | null {
  const kind = DECISIONS.has(operation.op)
    ? 'decide'
    : operation.op === 'setRevisionAuthorBatch'
      ? 'attribute'
      : null;
  if (kind === null || pkg === null) return null;
  const reason = trackedChangesProtectionRefusal(
    readDocumentProtection(settingsPartOf(pkg)?.root),
    kind
  );
  return reason ? refused('transaction-refused', reason, 'edit.protected-content') : null;
}
