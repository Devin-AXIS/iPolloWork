// Replace the open document with a DOCX file as ONE undoable edit: the `replaceDocument`
// command, which `applyUpdate({ mode: 'edit' })` uses too.
//
// The bytes open the way a load opens them, so the result is normalized exactly as a reload
// would show it. The session then installs that package as one package undo unit whose node
// ids follow the open document (`tree-package-update.ts`): the caret's paragraph keeps its id,
// and a collaboration session publishes the difference as an ordinary journal.

import { openTreeSession } from '../binding/tree-session.ts';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type {
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
} from '../contracts/replace-document.ts';
import type { PackageUpdateRefusal } from '../store/store/tree-package-update.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { isParagraph } from '../store/store/tree-op-segments.ts';
import { packageUpdateLanded } from '../store/store/tree-package-update.ts';
import type { DocumentHandle } from '../contracts/editor.ts';
import { handleMismatch } from './document-handle.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { refreshEditActive } from './refresh-edit-source.ts';
import { refreshWriteBlocked, writeBlockReason } from './refresh-write-guard.ts';

/** Only a different main part is a cause a host can act on; the rest are one cause. */
const UPDATE_REFUSALS: Readonly<
  Record<PackageUpdateRefusal, 'differentMainPart' | 'unsupportedDifference'>
> = {
  'missing-main-part': 'unsupportedDifference',
  'different-main-part': 'differentMainPart',
  unaligned: 'unsupportedDifference',
  failed: 'unsupportedDifference',
};

/** Whether enforced protection limits edits to comments, form fields, tracked changes, or none. */
function protectionForbidsEdit(surface: PaginatedSurface): boolean {
  const tracking = surface.session.trackingSettings();
  return (
    tracking.restrictedToComments ||
    tracking.restrictedToForms ||
    tracking.restrictedToTrackedChanges ||
    tracking.restrictedToReadOnly
  );
}

/** The bytes, opened as a load opens them, or null when they are not a document. */
export function openReplacementPackage(bytes: Uint8Array): OoxmlPackage | null {
  const opened = openTreeSession(bytes);
  return opened.ok ? opened.session.currentPackage() : null;
}

/** The caret's text position after an edit that turned `before` into `after`. */
function mapOffset(offset: number, before: string, after: string): number {
  if (before === after) return offset;
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  if (offset <= prefix) return offset;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  )
    suffix += 1;
  // Inside the rewritten span the caret has no counterpart: it goes to the span's end.
  if (offset < before.length - suffix) return after.length - suffix;
  return after.length - (before.length - offset);
}

/** Elements whose paragraphs float in a drawing, where a fallback caret must not land. */
const DRAWING_CONTAINERS = new Set(['drawing', 'pict', 'object', 'txbxContent']);

/** Every story paragraph id in the part, in document order, skipping drawing content. */
function paragraphIdsOf(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (isParagraph(node)) ids.push(node.id);
    if ('localName' in node && DRAWING_CONTAINERS.has(node.localName)) return;
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(part.root);
  return ids;
}

/**
 * Where a caret goes when the update removed its paragraph: the end of the nearest earlier
 * paragraph that survived, else the start of the first paragraph. A selection never points
 * into a paragraph that is gone, because typing there would be dropped.
 */
function survivingPosition(
  paragraphId: string,
  beforePart: OoxmlPart,
  afterPart: OoxmlPart
): SemanticPosition | null {
  const kept = new Set(paragraphIdsOf(afterPart));
  const order = paragraphIdsOf(beforePart);
  for (let index = order.indexOf(paragraphId) - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    if (!kept.has(id)) continue;
    const text = paragraphTextOf(afterPart, id);
    if (text !== null) return { paragraphId: id, offset: text.length };
  }
  const first = paragraphIdsOf(afterPart)[0];
  return first === undefined ? null : { paragraphId: first, offset: 0 };
}

function mapPosition(
  position: SemanticPosition,
  before: OoxmlPackage,
  after: OoxmlPackage
): SemanticPosition | null {
  const beforePart = before.parts.get(before.mainDocumentPart);
  const afterPart = after.parts.get(after.mainDocumentPart);
  if (!beforePart || !afterPart) return null;
  const old = paragraphTextOf(beforePart, position.paragraphId);
  const next = paragraphTextOf(afterPart, position.paragraphId);
  if (old === null || next === null)
    return survivingPosition(position.paragraphId, beforePart, afterPart);
  return { paragraphId: position.paragraphId, offset: mapOffset(position.offset, old, next) };
}

/**
 * Why the surface cannot take a replacement now, or null when it can. Cheap: it opens nothing,
 * so `can` asks it as well as `exec`.
 */
export function replaceDocumentGate(
  surface: PaginatedSurface | null,
  container: HTMLElement | null
): ReplaceDocumentRefusal | null {
  if (!surface)
    return {
      ok: false,
      code: 'unavailable',
      message: 'No document is mounted, or the editor was destroyed.',
    };
  if (container && refreshWriteBlocked(container))
    return { ok: false, code: 'busy', message: writeBlockReason(container) };
  // A replacement is an edit, and viewing takes none. In a collaboration session it would also
  // write to every participant.
  if (surface.editingMode() === 'view')
    return {
      ok: false,
      code: 'editNotPermitted',
      reason: 'viewing',
      message: 'The editor is in viewing mode.',
    };
  // Suggesting records every edit as a revision, and a replacement records none: refuse it
  // rather than bypass tracking. A document refresh in edit mode is the documented exception.
  if (surface.editingMode() === 'suggest' && !refreshEditActive(surface.session))
    return {
      ok: false,
      code: 'editNotPermitted',
      reason: 'suggesting',
      message: 'The editor is in suggesting mode, and a replacement is an untracked edit.',
    };
  // Protection that permits only comments, form fields, or tracked changes refuses every other
  // write, and a replacement is an untracked edit of the whole document.
  if (protectionForbidsEdit(surface))
    return {
      ok: false,
      code: 'editNotPermitted',
      reason: 'protected',
      message: 'Document protection does not permit an untracked edit.',
    };
  const gate = surface.collaborationSession()?.gateOperations([], { kind: 'body' });
  if (gate)
    return {
      ok: false,
      code: 'unavailable',
      reason: 'collaborationUnavailable',
      message: `The collaboration session cannot accept edits now (${gate}).`,
    };
  return null;
}

/** Why `expected` no longer describes the open document, as a refusal, or null. */
export function staleDocument(
  expected: DocumentHandle,
  surface: PaginatedSurface
): ReplaceDocumentRefusal | null {
  const mismatch = handleMismatch(expected, surface);
  if (mismatch === null) return null;
  return {
    ok: false,
    code: 'staleDocument',
    reason: mismatch,
    message:
      mismatch === 'otherDocument'
        ? 'Another document was loaded since the expected handle.'
        : 'The document was edited since the expected handle.',
  };
}

/**
 * Replace the document on `surface` with `bytes` as one undoable edit. Refuses with nothing
 * changed when a gate refuses, the open document is not the one `expected` describes, the
 * bytes are not a document, or the difference cannot apply as an edit.
 */
export function replaceDocumentAsEdit(
  surface: PaginatedSurface | null,
  container: HTMLElement | null,
  bytes: Uint8Array,
  expected?: DocumentHandle
): ReplaceDocumentOutcome {
  const refused = replaceDocumentGate(surface, container);
  if (refused || !surface) return refused!;
  // This code reads the session below the typing buffer: land queued keystrokes first, so they
  // count against `expected` and are part of what the undo step restores.
  surface.flushPendingInput();
  const stale = expected ? staleDocument(expected, surface) : null;
  if (stale) return stale;
  const incoming = openReplacementPackage(bytes);
  if (!incoming)
    return {
      ok: false,
      code: 'invalidDocument',
      message: 'The bytes are not a valid DOCX file.',
    };
  const collaboration = surface.collaborationSession();
  const before = surface.session.currentPackage();
  const selection: SemanticSelection | null =
    surface.activeScope().kind === 'body' ? surface.state().selection : null;
  const result = surface.session.applyPackageUpdate(incoming);
  if (!result.ok)
    return {
      ok: false,
      code: 'editUnsupported',
      reason: UPDATE_REFUSALS[result.reason],
      message: `The file cannot apply as an edit (${result.detail ? `${result.reason}: ${result.detail}` : result.reason}).`,
    };
  if (!result.change) return { ok: true, changed: false };
  const after = surface.session.currentPackage();
  // Shared state is the authority in a collaboration session. When it refuses the edit, the
  // session realigns this replica to what the room holds, so the update never landed.
  // Publish any journal still queued, so a refusal has realigned the replica before the check.
  collaboration?.flushPendingJournals();
  if (collaboration && !packageUpdateLanded(surface.session.currentPackage(), incoming))
    return {
      ok: false,
      code: 'editUnsupported',
      reason: 'collaborationRefused',
      message: 'The collaboration session refused the edit. The document keeps the shared content.',
    };
  if (selection) {
    const anchor = mapPosition(selection.anchor, before, after);
    const head = mapPosition(selection.head, before, after);
    if (anchor && head) surface.setSelection({ anchor, head });
  }
  return { ok: true, changed: true };
}
