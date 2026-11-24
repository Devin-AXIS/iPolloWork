import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';

/** Keep Word's painted result while a native select supplies the platform picker. */
export function paintLegacyDropdown(element: HTMLElement, span: StyleSpanRecord): void {
  const field = span.fieldAtom?.formControl;
  if (field?.kind !== 'dropdown' || field.entries.length === 0) return;
  const select = element.ownerDocument.createElement('select');
  select.dataset.docxFormDropdown = '';
  select.dataset.docxMarker = '';
  select.setAttribute('aria-label', field.accessibleName ?? span.text);
  for (const [index, label] of field.entries.entries()) {
    const option = element.ownerDocument.createElement('option');
    option.value = String(index);
    option.textContent = label;
    select.append(option);
  }
  select.selectedIndex = field.selectedIndex;
  // The native control covers the text without changing its metrics or printed appearance.
  // Keep its default appearance: trusted mouse and keyboard input open the OS picker.
  Object.assign(select.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    opacity: '0',
    cursor: 'pointer',
    font: 'inherit',
    padding: '0',
    border: '0',
  });
  element.style.position = 'relative';
  element.append(select);
}
