// The toolbar's Insert Table control: a button that opens the table-size grid.
//
// The slot's own command inserts a 1×1 table, which is a placeholder rather than a choice.
// The size is the user's to pick, so the press opens the same grid as Insert › Table in the
// menu bar, and the enabled state still comes from the engine through the slot.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  isDomNode,
  listenForOutsidePress,
  toolbarPopupLeft,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { TableSizeGrid } from './TableSizeGrid';
import { useToolbarOverflowClose } from './ToolbarOverflow';
import type { ToolbarPartComponent, ToolbarPartProps } from './parts';

const SLOT: ChromeSlotId = 'table.insert';

function ToolbarTableInsertImpl({ className, hidden, icon, asChild, children }: ToolbarPartProps) {
  const editor = useDocxEditor();
  const { isEnabled, disabledReason } = useEditorCommand(SLOT);
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const popupId = useId();
  // Inside the "⋯" panel, a pick also closes the panel. Outside it this does nothing.
  const closePanel = useToolbarOverflowClose();

  // A press outside closes the popup. Capture, because the painted surface prevents the
  // default on its own pointer handling. The editor's own document, which is not the global
  // one when the editor renders into an iframe or a popup window.
  useEffect(() => {
    if (!open || !rootRef.current) return undefined;
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => setOpen(false),
    });
  }, [open]);

  // Every open, by pointer or key, moves focus into the grid's tab stop, so the grid's own
  // key handler sees Escape and the arrows.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
  }, [open]);

  // In the bar the grid opens under its button, moved in only as far as it must to stay
  // inside the viewport. In the "⋯" panel it is panel content and needs no placement.
  const shown = open && isEnabled;
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const root = rootRef.current;
    const view = root?.ownerDocument.defaultView;
    if (!shown || !popup || !root || !view || root.closest('.docx-toolbar__more-panel')) return;
    const anchor = root.getBoundingClientRect();
    const left = toolbarPopupLeft({
      anchorLeft: anchor.left,
      popupWidth: popup.offsetWidth,
      viewportWidth: view.innerWidth,
    });
    popup.style.left = `${left - anchor.left}px`;
  }, [shown]);

  const close = useCallback(() => {
    setOpen(false);
    closePanel(false);
  }, [closePanel]);

  if (hidden) return null;
  const control = chromeControlForSlot(SLOT);
  const text = label(control?.labelKey ?? SLOT);
  const trigger = {
    ref: triggerRef,
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': SLOT,
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    ...(shown ? { 'data-active': '' } : {}),
    'aria-haspopup': 'grid' as const,
    'aria-expanded': shown,
    'aria-controls': shown ? popupId : undefined,
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      if (!open) {
        setOpen(true);
        return;
      }
      // Focus is in the grid, which unmounts: give it back to the document, or typing goes
      // nowhere.
      setOpen(false);
      editor?.focus();
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      setOpen(true);
    },
  };

  return (
    <span ref={rootRef} className="docx-toolbar__table-insert">
      {asChild ? (
        <Slot {...trigger}>{children}</Slot>
      ) : (
        <button {...trigger}>{icon ?? children ?? chromeIcon(control?.paths)}</button>
      )}
      {shown ? (
        <div
          ref={popupRef}
          id={popupId}
          className="docx-toolbar__menu docx-toolbar__table-insert-menu"
          // Focus that leaves the control (Tab, a click elsewhere) closes the grid, so it
          // never stays open behind the focus.
          onBlur={(event: ReactFocusEvent) => {
            const next = event.relatedTarget;
            if (isDomNode(next) && !rootRef.current?.contains(next)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Stopped so an enclosing "⋯" panel stays open: Escape closes one layer.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <TableSizeGrid slot={SLOT} label={label('toolbar.insertTable')} onInserted={close} />
        </div>
      ) : null}
    </span>
  );
}

/** Insert Table (`DocxEditorToolbar.TableInsert`): opens the table-size grid. */
export const ToolbarTableInsert: ToolbarPartComponent = Object.assign(ToolbarTableInsertImpl, {
  docxSlot: SLOT,
});
