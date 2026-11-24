import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';

/** Paint Word's fixed-size checkbox after run text, so text mounting cannot erase its hit area. */
export function paintLegacyCheckbox(
  element: HTMLElement,
  span: StyleSpanRecord,
  scale: number
): void {
  const field = span.fieldAtom?.formControl;
  if (field?.kind !== 'checkbox') return;
  element.dataset.docxFormCheckbox = '';
  element.dataset.checked = String(field.checked);
  element.setAttribute('role', 'checkbox');
  element.tabIndex = 0;
  element.setAttribute('aria-checked', String(field.checked));
  if (field.accessibleName) element.setAttribute('aria-label', field.accessibleName);
  element.style.width = `${span.box.width * scale}px`;
  const hit = element.ownerDocument.createElement('span');
  hit.className = 'docx-form-checkbox-hit';
  hit.dataset.docxMarker = '';
  hit.setAttribute('aria-hidden', 'true');
  element.append(hit);
}
