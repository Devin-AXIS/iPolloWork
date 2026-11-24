// Paragraph indent as a hook: the read side off the snapshot, the write side through the
// engine's `setIndent` command.
//
// The indent twin of `usePageSetup`. One derivation feeds the ruler's four handles and any
// consumer chrome — an indent spinner, a paragraph dialog, a custom ruler — so they can
// never disagree about what the selection's indent is.

import { useCallback, useMemo } from 'react';
import type { EditorSnapshot, IndentFormatting } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { useEditorCommand } from './useEditorCommand';

/**
 * The fields `apply` accepts — twips throughout, like every other read shape here.
 *
 * Omitted fields are left as authored; `null` CLEARS one, so the paragraph falls back to
 * its style. That is a different thing from zero, which blocks the cascade — the same
 * distinction `setParagraphSpacing` draws.
 *
 * `firstLine` is ONE SIGNED offset from the left indent: negative IS the hanging indent.
 * OOXML spells it as two mutually exclusive attributes, and a caller should not have to
 * know which of them wins.
 *
 * @public
 */
export interface IndentUpdate {
  readonly left?: number | null;
  readonly right?: number | null;
  readonly firstLine?: number | null;
}

/** What `useParagraphIndent` returns. @public */
export interface UseParagraphIndentReturn {
  /**
   * The EFFECTIVE indent at the selection — style and numbering cascade included — or
   * null with no document, and inside a table.
   *
   * The values are the FIRST touched paragraph's, with `mixed` reporting per field
   * whether the rest agree. Unlike the other formatting reads it does not go null on
   * disagreement: a ruler has to draw its handles somewhere, and Word draws them at the
   * first selected paragraph rather than hiding them.
   *
   * Reference-stable across ticks that did not move it, so a subscriber re-renders only
   * when the indent actually changes.
   */
  readonly indent: IndentFormatting | null;
  /** Whether the engine can write indent right now (mounted, editable). */
  readonly isEnabled: boolean;
  /** Write the given fields as one undoable step. Returns whether the engine accepted. */
  readonly apply: (update: IndentUpdate) => boolean;
}

const selectIndent = (snapshot: EditorSnapshot): IndentFormatting | null =>
  snapshot.formatting?.indent ?? null;
const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;
const SET_INDENT_PROBE = { type: 'setIndent', left: 0 } as const;

/**
 * The selection's paragraph indent — left, right, and the signed first line — plus the
 * command to change it.
 *
 * This is what `DocxEditor.HorizontalRuler` drives its four handles from. A host that
 * wants its own indent chrome takes the hook and renders whatever it likes; the ruler's
 * drag geometry is separately available as pure functions
 * (`dragIndent` / `handlePosition` from the engine).
 *
 * @public
 */
export function useParagraphIndent(): UseParagraphIndentReturn {
  const editor = useDocxEditor();
  const indent = useEditorState(selectIndent);
  const editable = useEditorState(selectEditable);

  // `can` needs a representative payload (an empty command is refused); a zero left
  // indent is always in range. The answer depends on the selection too (a content lock
  // refuses indents), so it is re-read on every snapshot, not once per mount.
  const { isEnabled: canIndent } = useEditorCommand(SET_INDENT_PROBE);
  const isEnabled = editable && canIndent;

  const apply = useCallback(
    (update: IndentUpdate): boolean => {
      if (!editor) return false;
      // The literal `type` comes LAST so no runtime caller can override it through the
      // update object.
      const result = editor.exec({
        ...(update.left !== undefined ? { left: update.left } : {}),
        ...(update.right !== undefined ? { right: update.right } : {}),
        ...(update.firstLine !== undefined ? { firstLine: update.firstLine } : {}),
        type: 'setIndent',
      });
      return result.ok;
    },
    [editor]
  );

  return useMemo(() => ({ indent, isEnabled, apply }), [indent, isEnabled, apply]);
}
