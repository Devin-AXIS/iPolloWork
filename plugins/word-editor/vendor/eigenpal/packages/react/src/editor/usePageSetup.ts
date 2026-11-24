// Page setup as a hook: the read side off the snapshot, the write side through the
// engine's `setPageSetup` command. One derivation feeds the rulers, the Page Setup
// dialog and any consumer chrome, so they can never disagree about the section.

import { useCallback, useMemo } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/**
 * The fields `apply` accepts — twips throughout, like every read shape. Omitted fields
 * are left as authored. `scope` is Word's "Apply to": `'document'` (the default) writes
 * every section, `'section'` only the one the selection is in.
 *
 * @public
 */
export interface PageSetupUpdate {
  readonly pageWidthTwips?: number;
  readonly pageHeightTwips?: number;
  readonly orientation?: 'portrait' | 'landscape';
  readonly marginTopTwips?: number;
  readonly marginRightTwips?: number;
  readonly marginBottomTwips?: number;
  readonly marginLeftTwips?: number;
  readonly scope?: 'document' | 'section';
}

/** What `usePageSetup` returns. @public */
export interface UsePageSetupReturn {
  /** The CARET section's page setup, or null while nothing is loaded. Reference-stable. */
  readonly pageSetup: PageSetup | null;
  /** Whether the engine can write page setup right now (mounted, editable). */
  readonly isEnabled: boolean;
  /** Write the given fields as one undoable step. Returns whether the engine accepted. */
  readonly apply: (update: PageSetupUpdate) => boolean;
}

const selectPageSetup = (snapshot: EditorSnapshot): PageSetup | null => snapshot.pageSetup ?? null;
const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;

/**
 * The section's page setup — size, orientation, margins — plus the command to change it.
 *
 * Reads `snapshot().pageSetup`, which is reference-stable across ticks that did not move
 * the section, so a subscriber re-renders only when the page actually changes shape. In
 * a multi-section document it reflects the CARET's section, as Word's ruler does.
 *
 * @public
 */
export function usePageSetup(): UsePageSetupReturn {
  const editor = useDocxEditor();
  const pageSetup = useEditorState(selectPageSetup);
  const editable = useEditorState(selectEditable);

  // `can` needs a representative payload (an empty command is refused); a zero top margin
  // is always classifiable, so the answer reflects only the mount/mode gates.
  const isEnabled = useMemo(
    () => editable && editor !== null && editor.can({ type: 'setPageSetup', marginTop: 0 }).ok,
    [editor, editable]
  );

  const apply = useCallback(
    (update: PageSetupUpdate): boolean => {
      if (!editor) return false;
      // The literal `type` comes LAST so no runtime caller can override it through the
      // update object.
      const result = editor.exec({
        ...(update.pageWidthTwips !== undefined ? { pageWidth: update.pageWidthTwips } : {}),
        ...(update.pageHeightTwips !== undefined ? { pageHeight: update.pageHeightTwips } : {}),
        ...(update.orientation !== undefined ? { orientation: update.orientation } : {}),
        ...(update.marginTopTwips !== undefined ? { marginTop: update.marginTopTwips } : {}),
        ...(update.marginRightTwips !== undefined ? { marginRight: update.marginRightTwips } : {}),
        ...(update.marginBottomTwips !== undefined
          ? { marginBottom: update.marginBottomTwips }
          : {}),
        ...(update.marginLeftTwips !== undefined ? { marginLeft: update.marginLeftTwips } : {}),
        ...(update.scope !== undefined ? { scope: update.scope } : {}),
        type: 'setPageSetup',
      });
      return result.ok;
    },
    [editor]
  );

  return useMemo(() => ({ pageSetup, isEnabled, apply }), [pageSetup, isEnabled, apply]);
}
