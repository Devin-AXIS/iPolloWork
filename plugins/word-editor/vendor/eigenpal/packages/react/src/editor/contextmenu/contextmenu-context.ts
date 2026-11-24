// Context-menu-scoped state: where the panel is, and how a row closes it.
//
// The rows themselves are the MENU BAR's rows — `MenuRow`, `MenuItem`, `MenuSubmenu`,
// `MenuSeparator` — reused verbatim, because a right-click row and a menu-bar row are the
// same object: icon column, label, shortcut column, `aria-disabled` with the engine's
// reason. Two implementations would be two places for the disabled treatment to drift.
//
// Those parts close their panel by calling `setOpenMenu(null)` from the MENU context, so
// the root publishes a `MenuContext` whose `setOpenMenu` closes THIS panel. That is the
// whole adapter between the two compounds, and it is why this context carries only what
// the menu context has no field for.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { HighlightHit, HighlightRange } from '@docx-editor.dev/core/contracts/editor';
import { editorHostWindow } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { readContextMenuHighlights } from './menu-highlights';

/**
 * Where the panel opened, in client coordinates, and how it was opened.
 *
 * @public
 */
export interface ContextMenuAnchor {
  /** Horizontal client coordinate the panel opened at, in CSS pixels. */
  readonly x: number;
  /** Vertical client coordinate the panel opened at, in CSS pixels. */
  readonly y: number;
  /**
   * `pointer` for a right-click, which opens at the pointer. `keyboard` for Shift+F10 or the
   * Menu key, which opens below the caret, or at the top-left of the document area when the
   * caret is not on a painted page.
   */
  readonly trigger: 'pointer' | 'keyboard';
}

export interface ContextMenuContextValue {
  /**
   * Close the panel. `restoreFocus` on the paths where the user is FINISHING with the menu
   * (selecting a row); not on the ones where they are already going elsewhere.
   */
  readonly close: (restoreFocus?: boolean) => void;
  /** Non-null exactly while the panel is open. */
  readonly anchor: ContextMenuAnchor | null;
  /**
   * The table of contents this open was over, captured AT OPEN TIME.
   *
   * Read imperatively from the editor in the same event that opens the panel, not
   * subscribed to. The engine records the right-click target and the panel opens from the
   * same event, so a subscription is a render behind: the first right-click on a TOC drew
   * the menu without its rows and only a second one had them. It is also the more honest
   * shape — an open menu describes the gesture that opened it, whatever happens next.
   */
  readonly tocId: string | null;
  /**
   * The element the opening right-click landed on, captured AT OPEN TIME like {@link tocId}.
   *
   * What lets a contextual row decide it applies — a custom-node chip, a painted marker —
   * without installing a second `contextmenu` listener that could disagree with the one
   * that opened the panel. Null while closed, and for keyboard-invoked opens, which have
   * no pointer target: those act on the caret, which `editor.getSelectionRange()` reads.
   */
  readonly target: HTMLElement | null;
  /**
   * The browser's reason for refusing a clipboard READ, once one has actually been refused.
   *
   * Lives on the ROOT rather than in the Paste row because selecting that row closes the
   * panel, which unmounts the row — state kept there was written and discarded in the same
   * batch, so the row it was meant to disable came back enabled on the next right-click and
   * the documented behaviour never once happened. Firefox and Safari refuse every read, so
   * "ask once, then stop offering it" has to outlive one open.
   */
  readonly clipboardRefusal: string | null;
  readonly reportClipboardRefusal: (reason: string) => void;
}

export const ContextMenuContext = createContext<ContextMenuContextValue>({
  close: () => {},
  anchor: null,
  tocId: null,
  target: null,
  clipboardRefusal: null,
  reportClipboardRefusal: () => {},
});

export function useContextMenuContext(): ContextMenuContextValue {
  return useContext(ContextMenuContext);
}

/**
 * The element the opening right-click landed on, or null while the menu is closed.
 *
 * Public so capability packages can render contextual sections — a row that only exists
 * when the press landed on their own painted chrome — without a second listener. A menu
 * opened from the keyboard has no target; read the caret with `editor.getSelectionRange()`.
 *
 * @public
 */
export function useContextMenuTarget(): HTMLElement | null {
  return useContext(ContextMenuContext).target;
}

/**
 * Where the open menu is anchored and how it was opened, or null while the menu is closed.
 *
 * Rows in `ContextMenu.Start` read `trigger` to tell a right-click from a keyboard open,
 * which acts on the caret rather than on a pointer target.
 *
 * @public
 */
export function useContextMenuAnchor(): ContextMenuAnchor | null {
  return useContext(ContextMenuContext).anchor;
}

/**
 * The text highlights the open context menu is about, topmost first. Pass a set name to read
 * one set. `R` is your range type, so fields you added to your ranges come back typed on
 * `range`.
 *
 * For a right-click (`trigger: 'pointer'`), these are the marks under the pointer. For a
 * keyboard open (`trigger: 'keyboard'`, Shift+F10 or the Menu key), these are the marks whose
 * current range holds the caret: same paragraph, and the caret offset from `start` to
 * `start + length`, both ends included. For a range selection, the caret is its `head`. A
 * keyboard hit's `rect` is the mark's rectangle on the caret's line.
 *
 * A document change while the menu is open, such as a collaborator's edit, reads the marks
 * again, so `start` and `length` never describe text that moved. Text that moved away from
 * the pointer or the caret is no longer reported. Empty while the menu is closed, and when
 * the caret is on a page that is not painted.
 *
 * @example
 * ```tsx
 * function SpellingRows() {
 *   const [hit] = useContextMenuHighlights<MisspellingRange>('spelling');
 *   if (!hit) return null;
 *   return hit.range.suggestions.map((word) => (
 *     <ContextMenu.Item key={word} label={word} onSelect={() => replaceHit(hit, word)} />
 *   ));
 * }
 * ```
 * @public
 */
export function useContextMenuHighlights<R extends HighlightRange = HighlightRange>(
  name?: string
): readonly HighlightHit<R>[] {
  const editor = useDocxEditor();
  const anchor = useContextMenuAnchor();
  // Bumped after each document change while open: at once, for a change painted before it
  // reports, and again a frame later, for a paint the surface deferred under input pressure.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!editor || !anchor) return undefined;
    const view = editorHostWindow(editor);
    let frame = 0;
    const bump = () => setRevision((value) => value + 1);
    const off = editor.on('change', () => {
      bump();
      if (frame === 0) {
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          bump();
        });
      }
    });
    return () => {
      off();
      if (frame !== 0) view.cancelAnimationFrame(frame);
    };
  }, [editor, anchor]);
  return useMemo(() => {
    void revision;
    return readContextMenuHighlights<R>(editor, anchor, name);
  }, [editor, anchor, name, revision]);
}
