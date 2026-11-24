import { expect, test } from 'bun:test';
import { textFormFieldInvalidDialog } from '../text-form-field-invalid-dialog.ts';

for (const type of ['number', 'date'] as const) {
  test(`invalid ${type} fill shows a modal alert and focuses acknowledgement`, () => {
    const container = document.createElement('div');
    document.body.append(container);
    let calls = 0;
    const panel = textFormFieldInvalidDialog(container, type, () => calls++);
    const button = panel.querySelector('button')!;
    expect(panel.getAttribute('role')).toBe('alertdialog');
    expect(panel.textContent).toContain(`A valid ${type} is required.`);
    expect(panel.open).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click();
    button.click();
    expect(calls).toBe(1);
    container.remove();
  });
}

for (const gesture of ['Enter', 'Escape'] as const) {
  test(`${gesture} acknowledges once and prevents the browser default`, () => {
    const container = document.createElement('div');
    document.body.append(container);
    let calls = 0;
    const panel = textFormFieldInvalidDialog(container, 'number', () => calls++);
    const event =
      gesture === 'Enter'
        ? new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        : new Event('cancel', { cancelable: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    panel.querySelector('button')!.click();
    expect(calls).toBe(1);
    container.remove();
  });
}
