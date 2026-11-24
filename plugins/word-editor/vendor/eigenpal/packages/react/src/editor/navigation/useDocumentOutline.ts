// The headings half of the navigation pane, UI-free.
//
// Headings come from `Editor.getOutline()` — the session's per-revision derivation over
// the canonical trees — re-read on the version-cached snapshot's identity, the same
// subscription pattern as `useFontFamily` and the ruler parts. So the list follows edits
// (retitling a heading, adding one, deleting one) without a bespoke channel.
//
// A jump both MOVES THE CARET and BRINGS THE HEADING INTO VIEW. The two are separate
// because moving the caret does not move the viewport: a heading twenty pages down was
// otherwise selected where nobody could see it. The reveal resolves through layout rather
// than the DOM, so it works for a page that has not been materialised yet — which is
// exactly the page an outline jump asks for.

import { useCallback, useMemo, useState } from 'react';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { goToHeading } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/**
 * One heading of the engine's outline: text, 0-based level, and the block id
 * `Editor.scrollToBlock` accepts.
 *
 * @public
 */
export type OutlineHeading = ReturnType<Editor['getOutline']>[number];

/** A heading plus how deep to indent it in a rendered list. @public */
export interface OutlineHeadingItem {
  readonly heading: OutlineHeading;
  /**
   * Indent depth RELATIVE to the shallowest heading present, not the absolute level. A
   * memo whose top sections are Heading 2 should left-align them at the base instead of
   * carrying a phantom first-level indent.
   */
  readonly depth: number;
}

/** What `useDocumentOutline` answers. @public */
export interface UseDocumentOutlineResult {
  /** The document's headings, in document order. Empty when it has none. */
  readonly headings: readonly OutlineHeading[];
  /** The same headings with their rendering depth resolved. */
  readonly items: readonly OutlineHeadingItem[];
  /**
   * The heading this pane last navigated to, so a list can show it as current. Tracks the
   * PANE's navigation, not the caret: following the caret would mean walking the document
   * on every selection change, and the engine has no derivation for it yet.
   */
  readonly selectedBlockId: string | null;
  /** Move the caret to a heading and bring it into view. Unknown ids are a safe no-op. */
  readonly goTo: (blockId: string) => void;
  readonly isEmpty: boolean;
}

const EMPTY_HEADINGS: readonly OutlineHeading[] = Object.freeze([]);
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/**
 * The document outline's behavior, with no UI attached: the headings, their nesting
 * depth, and the jump. `DocxEditor.Navigation.Headings` is this hook plus rows; a host
 * that wants a different list takes the hook and renders its own.
 *
 * @public
 */
export function useDocumentOutline(): UseDocumentOutlineResult {
  const editor = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const headings = useMemo(
    () => (editor && !snapshot.isLoading ? editor.getOutline() : EMPTY_HEADINGS),
    [editor, snapshot]
  );

  const items = useMemo(() => {
    if (headings.length === 0) return [] as readonly OutlineHeadingItem[];
    let min = headings[0]!.level;
    for (const heading of headings) if (heading.level < min) min = heading.level;
    return headings.map((heading) => ({ heading, depth: heading.level - min }));
  }, [headings]);

  const goTo = useCallback(
    (blockId: string) => {
      if (!editor || typeof blockId !== 'string' || blockId.length === 0) return;
      // The engine places the caret at the heading text, past a leading page break.
      goToHeading(editor, blockId);
      setSelectedBlockId(blockId);
    },
    [editor]
  );

  return {
    headings,
    items,
    selectedBlockId,
    goTo,
    isEmpty: headings.length === 0,
  };
}
