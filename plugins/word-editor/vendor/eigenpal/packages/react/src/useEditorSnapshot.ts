// Keeping shell chrome in step with the engine (interactive-paginated-editing M4).
//
// Toolbar enabled state, ruler geometry, and the page indicator all READ engine
// state during render — `Editor.can`, `getPageGeometry`, `getCurrentPage`.
// Reading is correct; not subscribing is not. Without this the chrome renders
// once and then lies: the toolbar keeps its first `can()` answer as the
// selection moves, and the rulers keep the first document's page size after a
// load.

import { useEffect, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/**
 * Re-render the caller whenever the editor commits a change, moves the
 * selection, or republishes display. Returns a counter that changes on each
 * such event, so it can also be used as a dependency.
 */
export function useEditorSnapshot(editor: Editor | null): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!editor) return undefined;
    const bump = (): void => setRevision((n) => n + 1);
    const offChange = editor.on('change', bump);
    const offSelection = editor.on('selectionChange', bump);
    bump();
    return () => {
      offChange();
      offSelection();
    };
  }, [editor]);

  return revision;
}
