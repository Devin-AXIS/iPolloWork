import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createT, deepMerge, en, type LocaleStrings } from '@docx-editor.dev/i18n';
import { formFieldDocx, firstFormCatalogue, nextFormCatalogue } from './form-field-docx.fixture';
import { textFormTranslate } from '../text-form-field-translations';

test('open validation alerts follow live form translations even when drawing labels stay unchanged', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const translate = (catalogue: typeof firstFormCatalogue) => {
    const t = createT(deepMerge(en, catalogue) as LocaleStrings);
    return (key: string) => t(key as Parameters<typeof t>[0]);
  };
  const editor = createDocxEditor({
    container,
    document: formFieldDocx(true),
    locale: 'pl-PL',
    translate: translate(firstFormCatalogue),
  });
  try {
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 10 },
    });
    editor.surface!.pasteRich('invalid', null);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 11 },
      head: { paragraphId, offset: 11 },
    });
    const panel = container.querySelector('dialog')!;
    expect(panel.getAttribute('aria-label')).toBe('Błąd daty');
    expect(panel.getAttribute('aria-description')).toBe('Podaj poprawną datę.');
    const button = panel.querySelector('button')!;
    editor.setTranslate(translate(nextFormCatalogue));
    expect(container.querySelector('dialog')).toBe(panel);
    expect(panel.getAttribute('aria-label')).toBe('Date error');
    expect(panel.getAttribute('aria-description')).toBe('Enter a valid date.');
    expect(panel.textContent).toContain('Enter a valid date.');
    expect(document.activeElement).toBe(button);
    editor.setTranslate(undefined);
    expect(panel.textContent).toContain('A valid date is required.');
    button.click();
    expect(container.querySelector('dialog')).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('partial and missing custom form translations fall back to English', () => {
  for (const translate of [
    undefined,
    (key: string) => key,
    () => '',
    () => {
      throw new Error('missing');
    },
  ]) {
    expect(textFormTranslate(translate)('textFormField.title')).toBe('Text Form Field Options');
  }
});
