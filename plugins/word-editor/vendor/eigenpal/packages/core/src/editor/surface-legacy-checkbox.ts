// Legacy FORMCHECKBOX interaction: a press on the painted box, or Space on the selected
// field, flips `w:checked` through the ordinary commit path.
//
// Word only ticks these boxes in a document protected for forms; in an unprotected document
// a click just puts the caret there. This surface ticks them in edit mode as well, because
// its content-control checkboxes already do and a form that toggles in one shape but not the
// other reads as broken. Everything else follows Word: a field with `w:enabled` off refuses,
// and a view-only or comments-only document refuses.

import {
  findNode,
  legacyCheckboxFieldsOf,
  type LegacyCheckboxFieldRange,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import { isElementNode, isHTMLElementNode } from './host-realm.ts';

interface Host {
  readonly pagesLayer: HTMLElement;
  part(paragraphId?: string): OoxmlPart;
  /** Edit mode; forms protection is enforced by the store, not here. */
  editable(): boolean;
  /** The paragraph sits in a section protected for forms. */
  protected(paragraphId: string): boolean;
  selection(): SemanticSelection;
  select(selection: SemanticSelection): void;
  apply(op: TreeDocOp): boolean;
}

/** The painted checkbox atom under a pointer target, resolved against the current tree. */
function checkboxAtTarget(
  host: Host,
  target: EventTarget | null
): { paragraphId: string; field: LegacyCheckboxFieldRange } | null {
  const element = isElementNode(target) ? target : null;
  const span = element?.closest<HTMLElement>('[data-docx-form-checkbox][data-start]');
  const paragraphId = span?.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
  if (!span || !paragraphId) return null;
  const paragraph = findNode(host.part(paragraphId), paragraphId);
  if (paragraph?.kind !== 'paragraph') return null;
  const offset = Number(span.dataset.start);
  const field = legacyCheckboxFieldsOf(paragraph).find((f) => f.start <= offset && offset < f.end);
  return field ? { paragraphId, field } : null;
}

function modified(event: MouseEvent | KeyboardEvent): boolean {
  return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

export function createLegacyCheckboxInteraction(host: Host): {
  keydown(event: KeyboardEvent): boolean;
  destroy(): void;
} {
  const toggle = (paragraphId: string, field: LegacyCheckboxFieldRange): boolean => {
    if (!host.editable() || !field.enabled) return false;
    const applied = host.apply({
      op: 'setLegacyCheckbox',
      paragraphId,
      fieldNodeId: field.fieldNodeId,
      checked: !field.checked,
    });
    if (applied) {
      // The pointer handler prevents native focus. Return keyboard input from toolbar
      // controls or a replaced surface before selecting the field for Space.
      host.pagesLayer.focus({ preventScroll: true });
      // Leave the field selected, as a FORMTEXT click does, so Space can flip it again.
      host.select({
        anchor: { paragraphId, offset: field.start },
        head: { paragraphId, offset: field.end },
      });
    }
    return applied;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || modified(event)) return;
    const hit = checkboxAtTarget(host, event.target);
    if (!hit || !host.editable() || !hit.field.enabled) return;
    // The press is the toggle: it must not also become a caret press on the pages layer.
    event.preventDefault();
    event.stopPropagation();
    toggle(hit.paragraphId, hit.field);
  };
  host.pagesLayer.addEventListener('pointerdown', onPointerDown, { capture: true });
  const onFocus = (event: FocusEvent): void => {
    const hit = checkboxAtTarget(host, event.target);
    if (hit && isHTMLElementNode(event.target)) {
      event.target.setAttribute('aria-disabled', String(!host.editable() || !hit.field.enabled));
    }
  };
  host.pagesLayer.addEventListener('focusin', onFocus);

  /** The checkbox the selection addresses: the whole field, or the caret on it under forms. */
  const selectedField = (): { paragraphId: string; field: LegacyCheckboxFieldRange } | null => {
    const selected = host.selection();
    if (selected.anchor.paragraphId !== selected.head.paragraphId) return null;
    const paragraphId = selected.head.paragraphId;
    const paragraph = findNode(host.part(paragraphId), paragraphId);
    if (paragraph?.kind !== 'paragraph') return null;
    const start = Math.min(selected.anchor.offset, selected.head.offset);
    const end = Math.max(selected.anchor.offset, selected.head.offset);
    const field = legacyCheckboxFieldsOf(paragraph).find(
      (candidate) =>
        (candidate.start === start && candidate.end === end) ||
        (start === end && start === candidate.start && host.protected(paragraphId))
    );
    return field ? { paragraphId, field } : null;
  };

  return {
    keydown(event) {
      const direct = checkboxAtTarget(host, event.target);
      // A focused checkbox uses native Tab navigation, never the paragraph Tab command.
      if (direct && event.key === 'Tab') return true;
      // Printable keys must not type into the document from a focused box; navigation keys
      // (arrows, Escape, Enter, function keys) keep their normal meaning.
      if (
        direct &&
        event.key.length === 1 &&
        event.key !== ' ' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        return true;
      }
      if (event.key !== ' ' || modified(event) || event.isComposing) return false;
      const hit = direct ?? selectedField();
      if (!hit) return false;
      if (!host.editable() || !hit.field.enabled) {
        if (!direct) return false;
        event.preventDefault();
        return true;
      }
      event.preventDefault();
      const applied = toggle(hit.paragraphId, hit.field);
      if (direct && applied) {
        [...host.pagesLayer.querySelectorAll<HTMLElement>('[data-docx-form-checkbox][data-start]')]
          .find(
            (span) =>
              span.dataset.paragraphId === hit.paragraphId &&
              Number(span.dataset.start) === hit.field.start
          )
          ?.focus({ preventScroll: true });
      }
      return true;
    },
    destroy() {
      host.pagesLayer.removeEventListener('pointerdown', onPointerDown, { capture: true });
      host.pagesLayer.removeEventListener('focusin', onFocus);
    },
  };
}
