/**
 * Internal refusal reasons → public {@link DiagnosticCode}s, the browser half.
 *
 * The store and host reasons map in `automation/diagnostics.ts`, which the headless runtime
 * shares. This file adds what only the browser editor raises: binding refusals, where the
 * browser moved the DOM in a way no op explains, and the surface's own refusal sentences.
 * Only the RESULT of a lookup leaves the engine; the raw reason never does.
 */
import type {
  EditDiagnosticCode,
  FontDiagnosticCode,
  ReviewDiagnosticCode,
} from '../contracts/diagnostics.ts';
import type { EditorFontErrorCode } from '../contracts/editor.ts';
import type { ExecErrorCode } from '../contracts/types.ts';
import type { TreeBindingRejection } from '@docx-editor.dev/core/binding';
import { reviewDiagnosticCode, storeEditDiagnosticCode } from '@docx-editor.dev/core/automation';
import { BINDING_CAUSES } from '../automation/diagnostic-context.ts';
import {
  FORMS_WRITE_REASON,
  TRACKED_CHANGES_AUTHOR_REASON,
  TRACKED_CHANGES_DECISION_REASON,
} from './command-protection.ts';
import {
  COMMENTS_PROTECTION_REASON,
  FORMS_PROTECTION_SUGGESTING_REASON,
  PRO_COLLABORATION_REASON,
  PRO_REVIEW_REASON,
  READ_ONLY_PROTECTION_REASON,
  READ_ONLY_REVISION_REASON,
  SUGGESTING_AUTHOR_REASON,
  SUGGESTING_IMAGE_REPLACE_REASON,
  TRACKED_ONLY_EDITING_REASON,
} from './opening-editing-mode.ts';
import { COLLABORATION_FIELD_RESULTS_REFUSAL } from './field-results-scope.ts';
import { FIELD_CODE_INPUT_REFUSAL } from './surface-field-code-input.ts';
import { PICTURE_SELECTED_INSERT_REASON } from './docx-editor-images.ts';
import { PREVIEW_WRITE_REFUSAL, REFRESH_WRITE_REFUSAL } from './refresh-write-guard.ts';
import { BOUND_CHANGES_REFUSAL, LOCKED_CHANGES_REFUSAL } from './review-guard-refusals.ts';
import { LOCKED_PARAGRAPH_FORMAT_REASON } from './paragraph-format-lock-refusal.ts';
import {
  LOCKED_CONTENT_BREAK_REFUSAL,
  LOCKED_SECTION_BREAK_REFUSAL,
  SUGGESTED_BREAK_REFUSAL,
  TABLE_CELL_BREAK_REFUSAL,
} from './surface-section-breaks.ts';
import {
  SUGGESTING_TABLE_DELETE_REFUSAL,
  SUGGESTING_FORM_FIELD_VALUE_REFUSAL,
  SUGGESTING_TABLE_MOVE_REFUSAL,
} from './surface-suggesting-structure.ts';

export {
  openDiagnosticCode,
  reviewCodeOfSkip,
  reviewDiagnosticCode,
} from '@docx-editor.dev/core/automation';

/** The binding's reasons and the diagnostic causes list the same tokens, in both directions. */
type BindingCause = (typeof BINDING_CAUSES)[number];
const BINDING_CAUSES_MATCH: [
  Exclude<TreeBindingRejection, BindingCause>,
  Exclude<BindingCause, TreeBindingRejection>,
] extends [never, never]
  ? true
  : never = true;
void BINDING_CAUSES_MATCH;

/** Exhaustive over the binding reasons: a new one fails the type check until it has a code. */
const BINDING_CODES: Readonly<Record<TreeBindingRejection, EditDiagnosticCode>> = {
  'paragraph-count-unexplained': 'edit.unmapped-change',
  'paragraph-reordered': 'edit.unmapped-change',
  'unknown-paragraph-id': 'edit.unmapped-change',
  'unknown-content-moved': 'edit.unmapped-change',
  'unsupported-node': 'edit.unsupported-content',
  'split-not-clean': 'edit.unmapped-change',
  'join-not-clean': 'edit.unmapped-change',
};

/** The surface's own refusal sentences. Matched by identity of the constant, never by parsing. */
const EDIT_SENTENCES: ReadonlyMap<string, EditDiagnosticCode> = new Map([
  ['the document is open for viewing', 'edit.read-only'],
  ['the document is read-only', 'edit.read-only'],
  ['this content is locked', 'edit.protected-content'],
  [LOCKED_PARAGRAPH_FORMAT_REASON, 'edit.protected-content'],
  [READ_ONLY_PROTECTION_REASON, 'edit.read-only'],
  [COMMENTS_PROTECTION_REASON, 'edit.protected-content'],
  [FORMS_WRITE_REASON, 'edit.protected-content'],
  [FORMS_PROTECTION_SUGGESTING_REASON, 'edit.protected-content'],
  [SUGGESTING_AUTHOR_REASON, 'edit.suggesting-needs-author'],
  [TRACKED_CHANGES_AUTHOR_REASON, 'edit.suggesting-needs-author'],
  [TRACKED_CHANGES_DECISION_REASON, 'edit.protected-content'],
  [PRO_REVIEW_REASON, 'edit.review-module-required'],
  [PRO_COLLABORATION_REASON, 'edit.unsupported-content'],
  [COLLABORATION_FIELD_RESULTS_REFUSAL, 'edit.unsupported-story'],
  [FIELD_CODE_INPUT_REFUSAL, 'edit.field-structure'],
  [SUGGESTED_BREAK_REFUSAL, 'edit.tracked-structure-unsupported'],
  [SUGGESTING_TABLE_DELETE_REFUSAL, 'edit.tracked-structure-unsupported'],
  [SUGGESTING_TABLE_MOVE_REFUSAL, 'edit.tracked-structure-unsupported'],
  [SUGGESTING_FORM_FIELD_VALUE_REFUSAL, 'edit.tracked-structure-unsupported'],
  [TABLE_CELL_BREAK_REFUSAL, 'edit.section-mark'],
  [LOCKED_SECTION_BREAK_REFUSAL, 'edit.protected-content'],
  [LOCKED_CONTENT_BREAK_REFUSAL, 'edit.protected-content'],
  [REFRESH_WRITE_REFUSAL, 'edit.refresh-in-progress'],
  [PREVIEW_WRITE_REFUSAL, 'edit.preview-active'],
  ['invalid note scope id', 'edit.stale-target'],
  [TRACKED_ONLY_EDITING_REASON, 'edit.tracking-required'],
  [SUGGESTING_IMAGE_REPLACE_REASON, 'edit.tracked-image-replace-unsupported'],
  [PICTURE_SELECTED_INSERT_REASON, 'edit.picture-selected'],
  [READ_ONLY_REVISION_REASON, 'edit.revision-unsupported'],
  ['note not found', 'edit.stale-target'],
]);

/**
 * A surface refusal as the automation lane reads it: a sentence the tables know becomes its
 * public code, which `storeEditDiagnosticCode` accepts, and a store token passes unchanged.
 */
export function publicRefusal(reason: unknown): string {
  const text = String(reason ?? 'refused');
  return EDIT_SENTENCES.get(text) ?? text;
}

/**
 * The public code for a refused edit. A raw reason the tables do not know, such as a sentence
 * written at one call site, falls back to the `exec` result code and then to `edit.refused`.
 * The raw text never leaves this function.
 *
 * @example
 * ```ts
 * const reason = editor.snapshot().lastRejection;
 * if (reason) console.warn(explainDiagnostic(diagnosticCodeOfRefusal(reason)).hint);
 * ```
 *
 * @public
 */
export function diagnosticCodeOfRefusal(
  reason: string,
  execCode?: ExecErrorCode
): EditDiagnosticCode {
  const binding = Object.hasOwn(BINDING_CODES, reason)
    ? BINDING_CODES[reason as TreeBindingRejection]
    : undefined;
  return (
    binding ??
    storeEditDiagnosticCode(reason) ??
    EDIT_SENTENCES.get(reason) ??
    (execCode !== undefined && Object.hasOwn(EXEC_CODES, execCode)
      ? EXEC_CODES[execCode]
      : undefined) ??
    'edit.refused'
  );
}

/**
 * The review code a tracked-change refusal leads with, such as `retained-structure: ...` for a
 * row that stays to keep a nested table, or null when the refusal names no review reason. A
 * card or an Accept All or Reject All that a content control lock or a data binding keeps gives
 * `review.locked-content` or `review.bound-content`.
 *
 * @example
 * ```ts
 * const result = editor.exec({ type: 'resolveAllReviewChanges', action: 'reject' });
 * if (!result.ok) console.warn(reviewCodeOfRefusal(result.reason));
 * ```
 *
 * @public
 */
export function reviewCodeOfRefusal(reason: string): ReviewDiagnosticCode | null {
  if (reason === LOCKED_CHANGES_REFUSAL) return 'review.locked-content';
  if (reason === BOUND_CHANGES_REFUSAL) return 'review.bound-content';
  return reviewDiagnosticCode(reason.split(':', 1)[0]!);
}

const EXEC_CODES: Readonly<Record<ExecErrorCode, EditDiagnosticCode>> = {
  notFound: 'edit.stale-target',
  ambiguous: 'edit.invalid-argument',
  locked: 'edit.protected-content',
  bound: 'edit.protected-content',
  typeMismatch: 'edit.invalid-argument',
  kindMismatch: 'edit.invalid-argument',
  outOfBounds: 'edit.invalid-argument',
  unsupported: 'edit.unsupported-content',
  invalidArgs: 'edit.invalid-argument',
};

const FONT_CODES: Readonly<Record<EditorFontErrorCode, FontDiagnosticCode>> = {
  wasmUnavailable: 'font.shaper-unavailable',
  initializationFailed: 'font.shaper-unavailable',
  missing: 'font.missing',
  forbidden: 'font.load-failed',
  overLimit: 'font.size-limit',
  malformed: 'font.malformed',
  fontFaceLoadFailed: 'font.load-failed',
  loadFailed: 'font.load-failed',
  missingFont: 'font.missing',
  hashMismatch: 'font.integrity-mismatch',
  hashInvalid: 'font.integrity-mismatch',
  metadataMismatch: 'font.integrity-mismatch',
  fontMismatch: 'font.integrity-mismatch',
  unsupportedFaceIndex: 'font.unsupported-face',
  unsupportedFace: 'font.unsupported-face',
};

/** The public code for a font failure. Unknown codes count as a failed load. */
export function fontDiagnosticCode(code: string | undefined): FontDiagnosticCode {
  return code !== undefined && Object.hasOwn(FONT_CODES, code)
    ? FONT_CODES[code as EditorFontErrorCode]
    : 'font.load-failed';
}
