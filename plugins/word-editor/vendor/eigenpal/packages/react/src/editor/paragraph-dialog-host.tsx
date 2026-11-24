import { useDialogHost } from './dialog-host';
// Who owns the Paragraph dialog's mount.
//
// Not the control that opens it. The line-spacing part moves between the formatting bar and
// the overflow panel whenever the toolbar re-measures — a window resize, a browser zoom,
// opening devtools — and a dialog mounted inside it is unmounted with it, mid-edit, with no
// warning and nothing written. The toolbar root does not move, so the dialog lives here and
// the row only asks for it.
//
// The provider also owns handing focus back, because it is the only thing that still exists
// when the dialog closes: the row that opened it may itself have moved into the overflow
// panel by then.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import { hostDocumentOf, isHTMLElementNode } from '@docx-editor.dev/core/editor';

interface ParagraphDialogHandle {
  /**
   * Open the dialog, naming where focus should go when it closes.
   *
   * Explicit rather than "whatever was focused": the control that opens the dialog is
   * usually a menu item, and the menu closes in the same gesture — so by the time the
   * dialog closes, the element that was focused no longer exists. Pass something that
   * outlives the menu, like the trigger the menu hangs off.
   */
  readonly open: (returnFocusTo?: HTMLElement | null) => void;
}

const ParagraphDialogContext = createContext<ParagraphDialogHandle | null>(null);

/**
 * The dialog's stable home.
 *
 * Rendered once by the toolbar. A host composing its own chrome can render it anywhere that
 * outlives its trigger; `useParagraphDialog` returns null outside it, and a control that
 * cannot find a host simply renders nothing rather than mounting a dialog that will vanish.
 */
export function ParagraphDialogHost({ children }: { children: ReactNode }): ReactElement {
  const dialogs = useDialogHost();
  const [open, setOpen] = useState(false);
  const openerRef = useRef<Element | null>(null);
  // The editor's own document, which a pop-out window or an iframe does not share.
  const viewport = useNavigationViewportElement();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const handle = useMemo<ParagraphDialogHandle>(
    () => ({
      open: (returnFocusTo?: HTMLElement | null) => {
        if (dialogs) {
          dialogs.open('paragraph', returnFocusTo);
          return;
        }
        openerRef.current = returnFocusTo ?? hostDocumentOf(viewportRef.current).activeElement;
        setOpen(true);
      },
    }),
    [dialogs]
  );

  const close = useCallback(() => {
    setOpen(false);
    // Back to the control that asked for the dialog — the standard contract, and the one
    // mechanism that touches neither the document selection nor the scroll position. If it
    // has moved into the overflow panel meanwhile there is nothing to focus, and focus
    // staying put beats focusing something the user cannot see.
    const opener = openerRef.current;
    openerRef.current = null;
    if (isHTMLElementNode(opener) && opener.isConnected) {
      opener.focus({ preventScroll: true });
    }
  }, []);

  return (
    <ParagraphDialogContext.Provider value={handle}>
      {children}
      <DocxEditorParagraphDialog open={open} onClose={close} />
    </ParagraphDialogContext.Provider>
  );
}

/** The host's handle, or null when no host is above this control. */
export function useParagraphDialog(): ParagraphDialogHandle | null {
  return useContext(ParagraphDialogContext);
}
