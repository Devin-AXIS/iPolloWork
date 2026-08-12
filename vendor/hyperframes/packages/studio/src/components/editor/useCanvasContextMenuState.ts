/**
 * Canvas right-click context-menu state for DomEditOverlay: where the menu is
 * open (viewport x/y) and which selection it targets, plus the right-click
 * handler that resolves/selects the element under the pointer before opening.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { DomEditSelection } from "./domEditing";
import type { ApplyDomSelectionOptions } from "../../hooks/useDomSelection";
import { domEditSelectionsTargetSame } from "../../utils/domEditHelpers";

export interface CanvasContextMenuState {
  x: number;
  y: number;
  sel: DomEditSelection;
}

interface UseCanvasContextMenuStateParams {
  selection: DomEditSelection | null;
  onCanvasPointerMoveRef: RefObject<
    (
      event: React.PointerEvent<HTMLDivElement>,
      options?: { preferClipAncestor?: boolean },
    ) => Promise<DomEditSelection | null>
  >;
  onSelectionChangeRef: RefObject<
    (selection: DomEditSelection, options?: ApplyDomSelectionOptions) => void
  >;
}

export function useCanvasContextMenuState({
  selection,
  onCanvasPointerMoveRef,
  onSelectionChangeRef,
}: UseCanvasContextMenuStateParams): {
  contextMenu: CanvasContextMenuState | null;
  closeContextMenu: () => void;
  handleContextMenu: (event: React.MouseEvent<HTMLDivElement>) => Promise<void>;
} {
  // Context menu state: position of the right-click that opened it.
  // contextMenu.sel is the element the menu targets — captured at right-click
  // time so the menu can open even before the React selection state settles.
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Close the context menu whenever the selection moves off the element the menu
  // targets (a click that reselects elsewhere, a deselect, or a preview reload
  // that rebuilds the selection). Without this the menu can linger — orphaned —
  // over a stale target after the underlying element is gone. A right-click that
  // OPENS the menu also selects its target, so the common open path keeps the
  // menu (same element) rather than immediately dismissing it.
  useEffect(() => {
    if (!contextMenu) return;
    if (selection && !domEditSelectionsTargetSame(selection, contextMenu.sel)) {
      setContextMenu(null);
    }
  }, [selection, contextMenu]);

  // Right-click: select element first (if not already selected), then open menu.
  const handleContextMenu = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();

      // Resolve every right-click at its actual pointer position. Reusing the
      // current selection can target the wrong element when hover is stale.
      const pointerEvent = event as unknown as React.PointerEvent<HTMLDivElement>;
      const resolved = await onCanvasPointerMoveRef.current(pointerEvent);
      const clickedSelectionChrome =
        event.target instanceof Element &&
        Boolean(event.target.closest('[data-dom-edit-selection-box="true"]'));
      const activeSelection = resolved ?? (clickedSelectionChrome ? selection : null);
      if (!activeSelection) return;
      onSelectionChangeRef.current(activeSelection, {
        revealPanel: false,
        previewInteraction: "context-menu",
      });
      setContextMenu({ x: event.clientX, y: event.clientY, sel: activeSelection });
    },
    [onCanvasPointerMoveRef, onSelectionChangeRef, selection],
  );

  return { contextMenu, closeContextMenu, handleContextMenu };
}
