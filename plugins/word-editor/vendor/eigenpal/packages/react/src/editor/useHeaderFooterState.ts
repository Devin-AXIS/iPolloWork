// Header/footer editing state as a hook — reference-stable slices for overlay chrome.

import { useCallback } from 'react';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** Live furniture scope state from `Editor.getHeaderFooterState()`. */
export type HeaderFooterState = Exclude<ReturnType<Editor['getHeaderFooterState']>, null>;

function headerFooterEqual(a: HeaderFooterState | null, b: HeaderFooterState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.editing === b.editing &&
    a.sectionIndex === b.sectionIndex &&
    a.variant === b.variant &&
    a.rId === b.rId &&
    a.partName === b.partName &&
    a.inherited === b.inherited &&
    a.titlePage === b.titlePage &&
    a.evenAndOddHeaders === b.evenAndOddHeaders &&
    a.headerDistanceTwips === b.headerDistanceTwips &&
    a.footerDistanceTwips === b.footerDistanceTwips
  );
}

/**
 * Subscribe to `getHeaderFooterState()` with reference-stable results when unchanged.
 *
 * @public
 */
export function useHeaderFooterState(): HeaderFooterState | null {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): HeaderFooterState | null => editor?.getHeaderFooterState() ?? null,
    [editor]
  );
  return useEditorState(select, headerFooterEqual);
}
