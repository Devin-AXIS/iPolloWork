import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { partOfNodeId } from './surface-scope.ts';
import { paragraphTextOf } from '../store/store/tree-op-apply.ts';
import { isTableEditorCommand } from './table-command-plan.ts';
import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import {
  readDocumentProtection,
  trackedChangesProtectionRefusal,
} from '../store/package/document-protection.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import {
  formsProtectionCommandRefusal,
  type FormsProtectionCommand,
} from '../store/store/forms-protection-command.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import { contentLockPolicyOf } from '../store/store/content-lock-policy.ts';
import { COMMENTS_PROTECTION_REASON, READ_ONLY_PROTECTION_REASON } from './opening-editing-mode.ts';
import { insertOwnerOf } from './content-control-prompt-landing.ts';
import { insertableText } from './clipboard-plain-text.ts';

const formFieldIdentities = new WeakMap<PaginatedSurface, () => string | null>();

/** Share active field affinity with admission without adding it to the public surface API. */
export function registerFormFieldIdentity(
  surface: PaginatedSurface,
  read: () => string | null
): void {
  formFieldIdentities.set(surface, read);
}

const contentLockPolicies = new WeakMap<PaginatedSurface, ContentLockPolicy>();

/** Share the host's lock policy with admission, so a preflight answers as the commit will. */
export function registerContentLockPolicy(
  surface: PaginatedSurface,
  policy: ContentLockPolicy | undefined
): void {
  const kept = contentLockPolicyOf(policy);
  if (kept) contentLockPolicies.set(surface, kept);
}

/** The host's lock policy for this surface, as admission sees it. */
export function contentLockPolicyFor(surface: PaginatedSurface): ContentLockPolicy | undefined {
  return contentLockPolicies.get(surface);
}

export {
  TRACKED_CHANGES_AUTHOR_REASON,
  TRACKED_CHANGES_DECISION_REASON,
} from '../store/package/document-protection.ts';

/** The commands that accept or reject tracked changes. */
const REVIEW_DECISION_COMMANDS: ReadonlySet<string> = new Set<EditorCommand['type']>([
  'resolveAllReviewChanges',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'acceptRevision',
  'rejectRevision',
]);

export const FORMS_WRITE_REASON = 'this document is protected; only form fields can be filled';

/** Called only for mutating commands. History restores complete, already admitted transactions. */
export function commandProtectionRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  if (
    command.type === 'undo' ||
    command.type === 'redo' ||
    command.type === 'toggleDocumentProtection'
  )
    return null;
  const settings = settingsPartOf(surface.session.currentPackage());
  const protection = readDocumentProtection(settings?.root);
  if (!protection.enforced) return null;
  if (protection.edit === 'readOnly' || protection.edit === 'comments') {
    return {
      ok: false,
      code: 'locked',
      reason:
        protection.edit === 'comments' ? COMMENTS_PROTECTION_REASON : READ_ONLY_PROTECTION_REASON,
    };
  }
  // Tracked-changes protection keeps every change pending and attributed to its author.
  const tracked =
    command.type === 'setReviewChangesAuthor'
      ? trackedChangesProtectionRefusal(protection, 'attribute')
      : REVIEW_DECISION_COMMANDS.has(command.type)
        ? trackedChangesProtectionRefusal(protection, 'decide')
        : null;
  if (tracked) return { ok: false, code: 'locked', reason: tracked };
  if (protection.edit !== 'forms') return null;
  // Table commands check their complete planned ops, including explicit off-caret targets.
  if (isTableEditorCommand(command)) return null;
  let intent: FormsProtectionCommand['intent'] = 'structure';
  let text: string | undefined;
  let paste = false;
  switch (command.type) {
    case 'insertText':
      intent = 'text';
      text = command.text;
      break;
    case 'paste':
    case 'pasteWithoutFormatting':
      intent = 'text';
      text = command.text;
      paste = true;
      break;
    case 'replaceText':
      intent = 'text';
      text = command.text;
      paste = true;
      break;
    case 'deleteText':
    case 'cut':
      intent = 'text';
      break;
    case 'toggleMark':
    case 'setMarkAttr':
    case 'applyFormatting':
    case 'pasteFormatting':
      intent = 'runFormat';
      break;
    case 'clearFormatting':
    case 'setAlignment':
    case 'setParagraphDirection':
    case 'setLineSpacing':
    case 'setParagraphSpacing':
    case 'setIndent':
    case 'adjustIndent':
    case 'toggleList':
    case 'setParagraphStyle':
    case 'setParagraphFormat':
    case 'removeTabMark':
      intent = 'paragraph';
      break;
    case 'setPageSetup':
    case 'setHeaderFooterOptions':
    case 'setWatermark':
    case 'convertAllNotes':
    case 'insertToc':
    case 'refreshToc':
    case 'removeToc':
    case 'replaceAllMatches':
    case 'resolveAllReviewChanges':
    case 'setReviewChangesAuthor':
    case 'acceptRevision':
    case 'rejectRevision':
    case 'acceptAllRevisions':
    case 'rejectAllRevisions':
      intent = 'document';
      break;
  }
  const selection = surface.state().selection;
  const part = partOfNodeId(surface.session, selection.head.paragraphId);
  if (!part) return { ok: false, code: 'locked', reason: FORMS_WRITE_REASON };
  const collapsed =
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset;
  // Typing and a one-line plain paste name the caret's control, so a text control's trailing
  // edge is inside it. Admission asks about the same insert, or `can` refuses what the keyboard
  // does. A multi-line paste lands beside the control, as the paste itself does.
  const inside =
    intent === 'text' && text !== undefined && !insertableText(text).includes('\n') && collapsed
      ? insertOwnerOf(surface.contentControls.atCaret())
      : undefined;
  const cells = surface.state().cellSelection;
  const selections =
    cells && (intent === 'runFormat' || intent === 'paragraph')
      ? [...paragraphsInCells(surface.layout(), cells.cellIds)].map((paragraphId) => ({
          anchor: { paragraphId, offset: 0 },
          head: { paragraphId, offset: (paragraphTextOf(part, paragraphId) ?? '').length },
        }))
      : [selection];
  const refused = selections.some((selected) =>
    formsProtectionCommandRefusal(part, settings, {
      selection: selected,
      intent,
      text,
      paste,
      fieldId: formFieldIdentities.get(surface)?.() ?? undefined,
      ...(inside === undefined ? {} : { inside }),
      contentLockPolicy: contentLockPolicies.get(surface),
    })
  );
  return refused ? { ok: false, code: 'locked', reason: FORMS_WRITE_REASON } : null;
}

/** Store codes are never suitable text for the status UI. */
export function writeRejectionReason(
  reason: string,
  root: Parameters<typeof readDocumentProtection>[0]
): string {
  if (reason !== 'locked') return reason;
  const protection = readDocumentProtection(root);
  if (!protection.enforced) return 'this content is locked';
  if (protection.edit === 'comments') return COMMENTS_PROTECTION_REASON;
  return protection.edit === 'forms' ? FORMS_WRITE_REASON : READ_ONLY_PROTECTION_REASON;
}

/** Revision cards and their commands use the same document-wide permission. */
export function reviewChangesLocked(surface: PaginatedSurface | null): boolean {
  return (
    surface !== null &&
    commandProtectionRefusal({ type: 'resolveAllReviewChanges', action: 'accept' }, surface) !==
      null
  );
}

/** Control widgets address a control, so their host gate must not judge the caret's TOC. */
export function createControlWriteRefusal(
  writeRefusal: () => string | null,
  editable: () => boolean
): () => string | null {
  return () => writeRefusal() ?? (editable() ? null : 'the document is read-only');
}
