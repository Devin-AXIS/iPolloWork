import { en } from '@docx-editor.dev/i18n';
import { hostWindowOf } from './host-realm.ts';

export type DropRejectionReason = 'readOnly' | 'noTarget' | 'unsupported';

/** One stable, localized status node, positioned inside the visible viewport. */
export function createDropFeedback(
  layer: HTMLElement,
  scroller: () => HTMLElement | null,
  translate: ((key: string) => string | undefined) | undefined
) {
  let badge: HTMLElement | null = null;
  let message = '';
  let width = 0;
  let height = 0;
  return {
    hide() {
      badge?.remove();
    },
    show(reason: DropRejectionReason, clientX: number, clientY: number) {
      if (!badge) {
        badge = layer.ownerDocument.createElement('div');
        badge.dataset.docxDropRejection = '';
        badge.dataset.docxMarker = '';
        badge.className = 'docx-drop-rejection';
        badge.setAttribute('contenteditable', 'false');
        badge.setAttribute('role', 'status');
        badge.setAttribute('aria-live', 'polite');
        badge.style.position = 'absolute';
        badge.style.pointerEvents = 'none';
      }
      const key = `drop.errors.${reason}`;
      const translated = translate?.(key);
      const next = translated && translated !== key ? translated : en.drop.errors[reason];
      const changed = next !== message;
      if (changed) {
        badge.textContent = next;
        message = next;
      }
      if (!badge.isConnected) layer.append(badge);
      if (changed || width === 0) {
        const size = badge.getBoundingClientRect();
        width = size.width;
        height = size.height;
      }
      const win = hostWindowOf(layer);
      const viewport = scroller()?.getBoundingClientRect();
      const left = Math.max(0, viewport?.left ?? 0);
      const top = Math.max(0, viewport?.top ?? 0);
      const right = Math.min(win.innerWidth, viewport?.right ?? win.innerWidth);
      const bottom = Math.min(win.innerHeight, viewport?.bottom ?? win.innerHeight);
      const origin = layer.getBoundingClientRect();
      const x = Math.max(left + 8, Math.min(clientX + 12, right - width - 8));
      const y = Math.max(top + 8, Math.min(clientY + 16, bottom - height - 8));
      badge.style.left = `${x - origin.left}px`;
      badge.style.top = `${y - origin.top}px`;
    },
  };
}
