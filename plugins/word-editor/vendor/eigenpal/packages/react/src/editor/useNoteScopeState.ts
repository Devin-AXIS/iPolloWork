// Note editing scope — reference-stable slice for notes chrome.

import { useCallback } from 'react';
import type { Editor, EditorSnapshot, ViewScope } from '@docx-editor.dev/core/contracts/editor';

import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

function noteScopeEqual(a: ViewScope | null, b: ViewScope | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'note' && b.kind === 'note') return a.id === b.id;
  if (a.kind === 'headerFooter' && b.kind === 'headerFooter') return a.rId === b.rId;
  return true;
}

/**
 * Subscribe to the active note view scope with reference-stable results when unchanged.
 *
 * @public
 */
export function useNoteScopeState(): Extract<ViewScope, { kind: 'note' }> | null {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): Extract<ViewScope, { kind: 'note' }> | null => {
      const scope = editor?.getActiveScope();
      return scope?.kind === 'note' ? scope : null;
    },
    [editor]
  );
  const scope = useEditorState(select, noteScopeEqual);
  return scope?.kind === 'note' ? scope : null;
}

export type NotePropertiesState = Exclude<ReturnType<Editor['getNotePropertiesState']>, null>;

type AuthoredNoteNumbering = NonNullable<NotePropertiesState['footnote']['documentAuthored']>;

function authoredNoteNumberingEqual(
  a: AuthoredNoteNumbering | undefined,
  b: AuthoredNoteNumbering | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pos === b.pos &&
    a.numFmt === b.numFmt &&
    a.numStart === b.numStart &&
    a.numRestart === b.numRestart
  );
}

function notePropertiesSideEqual(
  a: NotePropertiesState['footnote'],
  b: NotePropertiesState['footnote']
): boolean {
  return (
    a.resolved.pos === b.resolved.pos &&
    a.resolved.numFmt === b.resolved.numFmt &&
    a.resolved.numStart === b.resolved.numStart &&
    a.resolved.numRestart === b.resolved.numRestart &&
    authoredNoteNumberingEqual(a.documentAuthored, b.documentAuthored) &&
    authoredNoteNumberingEqual(a.sectionAuthored, b.sectionAuthored)
  );
}

function notePropertiesEqual(
  a: NotePropertiesState | null,
  b: NotePropertiesState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sectionIndex === b.sectionIndex &&
    notePropertiesSideEqual(a.footnote, b.footnote) &&
    notePropertiesSideEqual(a.endnote, b.endnote)
  );
}

/**
 * Subscribe to `getNotePropertiesState()` with reference-stable results when unchanged.
 *
 * @public
 */
export function useNotePropertiesState(): NotePropertiesState | null {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): NotePropertiesState | null =>
      editor?.getNotePropertiesState() ?? null,
    [editor]
  );
  return useEditorState(select, notePropertiesEqual);
}
