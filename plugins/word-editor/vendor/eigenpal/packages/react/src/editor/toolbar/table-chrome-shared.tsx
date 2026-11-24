import type { ReactNode } from 'react';
// Shared a11y and keyboard helpers for contextual table toolbar compounds.

import { useEffect, useId, type RefObject } from 'react';
import {
  editorInstanceScope,
  hostDocumentOf,
  isHTMLElementNode,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { focusBy, focusEdge } from '../menu/menu-keyboard';
import { guardToolbarMousedown } from './ToolbarButton';

/** Return focus to the painted pages layer after a table colour dialog applies. */
export function restoreToolbarDocumentFocus(from: HTMLElement | null): void {
  // NOT a bare `closest('.docx-editor')`: the toolbar's own root self-emits that class.
  const root = editorInstanceScope(from) ?? from?.ownerDocument?.body;
  root?.querySelector<HTMLElement>('.docx-pages')?.focus();
}

/** Props for a focusable disabled toolbar trigger with an announced reason. */
export interface TableChromeTriggerA11y {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly ariaLabel: string;
}

/** aria-disabled trigger props; reasons ride aria-describedby like menu rows. */
export function useTableChromeTriggerA11y({
  enabled,
  disabledReason,
  ariaLabel,
}: TableChromeTriggerA11y): {
  readonly reasonId: string;
  readonly shared: Record<string, unknown>;
  readonly reasonNode: ReactNode;
} {
  const { t } = useTranslation();
  const localizedReason = localizeDisabledReason(disabledReason, t);
  const reasonId = useId();
  const describe = !enabled && localizedReason ? reasonId : undefined;
  return {
    reasonId,
    shared: {
      type: 'button' as const,
      onMouseDown: guardToolbarMousedown,
      'aria-label': ariaLabel,
      ...(describe ? { 'aria-describedby': describe } : {}),
      ...(localizedReason ? { title: localizedReason } : {}),
      ...(!enabled ? { 'data-disabled': '', 'aria-disabled': true } : {}),
    },
    reasonNode:
      describe && localizedReason ? (
        <span id={reasonId} className="docx-editor-sr-only">
          {localizedReason}
        </span>
      ) : null,
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Keyboard contract for role=menu popups: arrows, Home/End, Enter/Space, Escape. */
export function useTableMenuKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  panelRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel) return undefined;

    const items = () =>
      [...panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
        (item) => item.closest('[role="menu"]') === panel
      );

    const focusInitial = () => {
      const list = items();
      const selected =
        list.find(
          (item) => item.hasAttribute('data-selected') || item.hasAttribute('data-active')
        ) ?? list[0];
      selected?.focus();
    };
    queueMicrotask(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const list = items();
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger?.focus();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusBy(list, hostDocumentOf(panel).activeElement, 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusBy(list, hostDocumentOf(panel).activeElement, -1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusEdge(list, 'first');
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusEdge(list, 'last');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const focused = hostDocumentOf(event.target as Node | null).activeElement;
        if (isHTMLElementNode(focused) && list.includes(focused)) {
          event.preventDefault();
          focused.click();
        }
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen, panelRef, triggerRef]);
}

/** Escape closes a role=dialog popup and restores trigger focus; Enter/Space activate focused swatches. */
export function useTableDialogKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  dialogRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    if (!dialog) return undefined;

    const activators = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')].filter(
        (item) => item.closest('[role="dialog"]') === dialog
      );

    queueMicrotask(() => {
      activators()[0]?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger?.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const focused = hostDocumentOf(event.target as Node | null).activeElement;
        const list = activators();
        if (isHTMLElementNode(focused) && list.includes(focused)) {
          event.preventDefault();
          focused.click();
        }
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen, dialogRef, triggerRef]);
}
