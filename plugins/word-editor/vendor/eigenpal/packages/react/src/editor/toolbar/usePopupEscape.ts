import { useEffect, useRef, type RefObject } from 'react';
import { listenForPopupEscape, listenForPopupFocusLeave } from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/**
 * Close an open chrome popup on Escape through core's `listenForPopupEscape`, and when focus
 * moves outside it through `listenForPopupFocusLeave`.
 *
 * An Escape from this editor closes the popup and stops there. An Escape from a host input,
 * a host dialog, or another editor closes the popup and keeps its default behavior.
 * `close` receives `fromInside`: true when the key came from inside the popup, so focus can
 * go back to its trigger. `skip` leaves an Escape to a handler inside the popup.
 */
export function usePopupEscape(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  close: (fromInside: boolean) => void,
  skip?: (event: KeyboardEvent) => boolean
): void {
  const viewport = useNavigationViewportElement();
  // Read through a ref, so a fresh callback each render never re-binds the listener.
  const latest = useRef({ close, skip, viewport });
  latest.current = { close, skip, viewport };
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return undefined;
    const contains = (node: Node) => root.contains(node);
    const stopEscape = listenForPopupEscape({
      popup: root,
      contains,
      chromeRoot: () => root.closest('.docx-editor'),
      editorElements: () => [latest.current.viewport],
      skip: (event) => latest.current.skip?.(event) === true,
      close: (fromInside) => latest.current.close(fromInside),
    });
    const stopFocus = listenForPopupFocusLeave({
      popup: root,
      contains,
      close: () => latest.current.close(false),
    });
    return () => {
      stopEscape();
      stopFocus();
    };
  }, [open, rootRef]);
}
