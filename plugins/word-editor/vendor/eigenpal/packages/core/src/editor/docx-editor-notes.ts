// Footnote/endnote command dispatch for `createDocxEditor`.
//
// Lifecycle ops commit through TreePackageStore.applyLifecycleOp via the session's
// applyTreeOps path. Note bodies are editable stories under EditorScope { kind: 'note' }.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';

export function execInsertNote(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'insertNote' }>
): ExecResult {
  const scope = mounted.activeScope();
  if (scope.kind === 'headerFooter') {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'cannot insert a note reference inside a header or footer',
    };
  }
  if (scope.kind === 'note') {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'cannot insert a note reference inside another note',
    };
  }
  if (typeof mounted.insertNote !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'insertNote is not available' };
  }
  const ok = mounted.insertNote(command.noteKind);
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'insertNote was refused',
    };
  }
  return null as unknown as ExecResult; // signal normal completion to caller
}

export function execDeleteNote(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'deleteNote' }>
): ExecResult {
  if (typeof mounted.deleteNote !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'deleteNote is not available' };
  }
  const ok = mounted.deleteNote(command.noteKind, command.noteId);
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'deleteNote was refused',
    };
  }
  return null as unknown as ExecResult;
}

export function execConvertNote(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'convertNote' }>
): ExecResult {
  if (typeof mounted.convertNote !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'convertNote is not available' };
  }
  const ok = mounted.convertNote(command.fromKind, command.noteId);
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'convertNote was refused',
    };
  }
  return null as unknown as ExecResult;
}

export function execConvertAllNotes(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'convertAllNotes' }>
): ExecResult {
  if (typeof mounted.convertAllNotes !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'convertAllNotes is not available' };
  }
  const ok = mounted.convertAllNotes(command.fromKind);
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'convertAllNotes was refused',
    };
  }
  return null as unknown as ExecResult;
}

export function execSetNoteProperties(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'setNoteProperties' }>
): ExecResult {
  if (typeof mounted.setNoteProperties !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'setNoteProperties is not available' };
  }
  const scope = command.scope ?? 'document';
  const ok = mounted.setNoteProperties({
    scope,
    sectionIndex: command.sectionIndex,
    footnote: command.footnote,
    endnote: command.endnote,
  });
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'setNoteProperties was refused',
    };
  }
  return null as unknown as ExecResult;
}

/** True when the active view scope is a note body. */
export function isNoteViewScope(
  scope: { readonly kind: string; readonly id?: string } | null | undefined
): boolean {
  return (
    scope?.kind === 'note' && typeof scope.id === 'string' && parseNoteScopeId(scope.id) !== null
  );
}
