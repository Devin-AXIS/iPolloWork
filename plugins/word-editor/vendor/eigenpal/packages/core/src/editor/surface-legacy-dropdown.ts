import { documentProtectionRefusal } from '../store/store/forms-protection.ts';
// Native legacy dropdowns own their keyboard input; each committed choice is one undo step.
import {
  findNode,
  validateTreeOp,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { legacyDropdownFieldsOf } from '../store/store/legacy-dropdown-fields.ts';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import { hostWindowOf, isElementNode } from './host-realm.ts';

interface Host {
  readonly pagesLayer: HTMLElement;
  part(paragraphId?: string): OoxmlPart;
  settings(): OoxmlPart | null | undefined;
  editable(): boolean;
  select(selection: SemanticSelection): void;
  apply(op: TreeDocOp): boolean;
  canApply(op: TreeDocOp): boolean;
  history(action: 'undo' | 'redo'): void;
}

export function createLegacyDropdownInteraction(host: Host): {
  keydown(event: KeyboardEvent): boolean;
  sync(): void;
  destroy(): void;
} {
  const selector = 'select[data-docx-form-dropdown]';
  const controlOf = (target: EventTarget | null) =>
    isElementNode(target) ? target.closest<HTMLSelectElement>(selector) : null;
  const locate = (control: HTMLSelectElement) => {
    const span = control.closest<HTMLElement>('[data-start][data-paragraph-id]');
    const paragraphId = span?.dataset.paragraphId;
    if (!span || !paragraphId) return null;
    const part = host.part(paragraphId);
    const paragraph = findNode(part, paragraphId);
    if (paragraph?.kind !== 'paragraph') return null;
    const offset = Number(span.dataset.start);
    const field = legacyDropdownFieldsOf(paragraph).find(
      (f) => f.start <= offset && offset < f.end
    );
    if (!field) return null;
    const op = {
      op: 'setLegacyDropdown',
      paragraphId,
      fieldNodeId: field.fieldNodeId,
      selectedIndex: control.selectedIndex,
    } as const;
    return {
      field,
      paragraphId,
      op,
      enabled:
        host.editable() &&
        host.canApply(op) &&
        documentProtectionRefusal(host.settings(), op) === null &&
        validateTreeOp(part, op) === null,
    };
  };
  const sync = () => {
    for (const control of host.pagesLayer.querySelectorAll<HTMLSelectElement>(selector)) {
      control.disabled = !locate(control)?.enabled;
    }
  };
  const pointer = (event: PointerEvent) => {
    const control = controlOf(event.target);
    if (!control) return;
    // Do not let the page turn a native select press into a document selection/repaint.
    event.stopPropagation();
    if (!locate(control)?.enabled) event.preventDefault();
  };
  const focus = (event: FocusEvent) => {
    const control = controlOf(event.target);
    if (control) control.disabled = !locate(control)?.enabled;
  };
  const change = (event: Event) => {
    const control = controlOf(event.target);
    if (!control) return;
    event.stopPropagation();
    const hit = locate(control);
    if (!hit) return;
    if (!hit.enabled || !host.apply(hit.op)) {
      control.selectedIndex = hit.field.selectedIndex;
      return;
    }
    host.select({
      anchor: { paragraphId: hit.paragraphId, offset: hit.field.start },
      head: { paragraphId: hit.paragraphId, offset: hit.field.end },
    });
    const replacement = [...host.pagesLayer.querySelectorAll<HTMLSelectElement>(selector)].find(
      (node) => {
        const span = node.closest<HTMLElement>('[data-start][data-paragraph-id]');
        return (
          span?.dataset.paragraphId === hit.paragraphId &&
          Number(span.dataset.start) === hit.field.start
        );
      }
    );
    replacement?.focus({ preventScroll: true });
  };
  const observer = new (hostWindowOf(host.pagesLayer).MutationObserver)((records) => {
    // Only newly painted subtrees need wiring. Typing elsewhere must not scan every page.
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!isElementNode(node)) continue;
        const controls = node.matches(selector)
          ? [node as HTMLSelectElement]
          : node.querySelectorAll<HTMLSelectElement>(selector);
        for (const control of controls) control.disabled = !locate(control)?.enabled;
      }
    }
  });
  observer.observe(host.pagesLayer, { childList: true, subtree: true });
  host.pagesLayer.addEventListener('pointerdown', pointer, true);
  host.pagesLayer.addEventListener('focusin', focus);
  host.pagesLayer.addEventListener('change', change);
  sync();
  return {
    sync,
    keydown(event) {
      const control = controlOf(event.target);
      if (!control) return false;
      event.stopPropagation();
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault();
        host.pagesLayer.focus({ preventScroll: true });
        host.history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        return true;
      }
      if (!locate(control)?.enabled && event.key !== 'Tab') event.preventDefault();
      return true;
    },
    destroy() {
      observer.disconnect();
      host.pagesLayer.removeEventListener('pointerdown', pointer, true);
      host.pagesLayer.removeEventListener('focusin', focus);
      host.pagesLayer.removeEventListener('change', change);
    },
  };
}
