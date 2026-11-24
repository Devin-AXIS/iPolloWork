import { useEffect, useRef, type RefObject } from 'react';
import {
  isDomNode,
  isElementNode,
  listenForPopupEscape,
  listenForPopupFocusLeave,
} from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/** Bind keyboard dismissal and option navigation to this mounted picker. */
export function usePickerKeyboard(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void
): void {
  // Read through refs: callers pass a fresh `close` each render, and re-binding on every
  // render would reorder this listener behind ones registered later.
  const viewport = useNavigationViewportElement();
  const latest = useRef({ close, viewport });
  latest.current = { close, viewport };
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    return bindPickerKeyboard(
      root,
      () => latest.current.close(),
      () => latest.current.viewport
    );
  }, [rootRef, open]);
}

function bindPickerKeyboard(
  root: HTMLElement,
  close: () => void,
  viewport: () => HTMLElement | null
): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    // The editable size input owns its draft and step keys.
    if (target.matches('input[role="combobox"]')) return;
    const typing = target.matches('input, textarea, select');
    if (typing && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).filter(
      (option) => !option.matches(':disabled, [aria-disabled="true"]')
    );
    if (options.length === 0) return;
    const current = options.indexOf(target);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowDown') next = (current + 1) % options.length;
    else if (event.key === 'ArrowUp')
      next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    else return;
    event.preventDefault();
    event.stopPropagation();
    options[next]?.focus();
  };
  const focusout = (event: FocusEvent) => {
    if (isDomNode(event.relatedTarget) && !root.contains(event.relatedTarget)) close();
  };
  // Escape is not handled here: the capture listener below hears it before the surface,
  // also when a click opened the picker and focus stayed in the pages.
  const stopEscape = listenForPopupEscape({
    popup: root,
    contains: (node) => root.contains(node),
    chromeRoot: () => root.closest('.docx-editor'),
    editorElements: () => [viewport()],
    // The editable size input owns its draft and its Escape.
    skip: (event) =>
      isElementNode(event.target) &&
      root.contains(event.target) &&
      event.target.matches('input[role="combobox"]'),
    close: (fromInside) => {
      if (fromInside) root.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      close();
    },
  });
  // Focus that moves elsewhere while focus stayed in the pages, such as Ctrl+F into the
  // find field, closes the picker too. `focusout` alone never fires for a click-opened picker.
  const stopFocus = listenForPopupFocusLeave({
    popup: root,
    contains: (node) => root.contains(node),
    close,
  });
  root.addEventListener('keydown', keydown);
  root.addEventListener('focusout', focusout);
  return () => {
    root.removeEventListener('keydown', keydown);
    root.removeEventListener('focusout', focusout);
    stopEscape();
    stopFocus();
  };
}
