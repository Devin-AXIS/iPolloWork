import React from 'react';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  formFieldDocx,
  firstFormCatalogue,
  nextFormCatalogue,
} from '../../core/src/editor/__tests__/form-field-docx.fixture';

afterEach(cleanup);
for (const composed of [false, true]) {
  test(`${composed ? 'Root provider' : 'packaged editor'} keeps form labels live without replacing controls`, async () => {
    const bytes = formFieldDocx();
    let editor: DocxEditorInstance | undefined;
    const ready = (value: DocxEditorInstance) => {
      editor = value;
    };
    const tree = (i18n: typeof firstFormCatalogue) =>
      composed ? (
        <LocaleProvider i18n={i18n}>
          <DocxEditorRoot document={bytes} locale="pl-PL" onReady={ready}>
            <DocxEditorViewport>
              <DocxEditorContent />
            </DocxEditorViewport>
          </DocxEditorRoot>
        </LocaleProvider>
      ) : (
        <DocxEditor document={bytes} locale="pl-PL" i18n={i18n} onReady={ready} />
      );
    const view = render(tree(firstFormCatalogue));
    await act(async () => {});
    const instance = editor!;
    const paragraphId = instance.surface!.session.paragraphIds()[0]!;
    act(() => {
      instance.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 10 },
      });
      expect(instance.surface!.editTextFormField()).toBe(true);
    });
    await waitFor(() => expect(view.container.querySelector('dialog')).not.toBeNull());
    const panel = view.container.querySelector('dialog')!;
    expect(panel.getAttribute('aria-label')).toBe('Pole daty');
    expect(panel.textContent).toContain('Wartość');
    expect(panel.textContent).toContain('Maximum length'); // missing keys fall back to English
    const input = panel.querySelector('input')!;
    act(() => {
      fireEvent.change(input, { target: { value: 'unfinished' } });
    });
    input.focus();
    await act(async () => {
      view.rerender(tree(nextFormCatalogue));
    });
    expect(editor).toBe(instance);
    expect(view.container.querySelector('dialog')).toBe(panel);
    expect(panel.getAttribute('aria-label')).toBe('Date field');
    expect(input.value).toBe('unfinished');
    expect(document.activeElement).toBe(input);
    expect(view.container.querySelector('.docx-text-form-status')?.textContent).toBe(
      'Field selected'
    );
  });
}

test('Root translate updates open Field Options without replacing its draft', async () => {
  const bytes = formFieldDocx();
  let editor: DocxEditorInstance | undefined;
  const tree = (title: string) => (
    <DocxEditorRoot
      document={bytes}
      translate={(key) => (key === 'textFormField.title' ? title : key)}
      onReady={(value) => {
        editor = value;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const view = render(tree('Custom field'));
  await act(async () => {});
  const instance = editor!;
  const paragraphId = instance.surface!.session.paragraphIds()[0]!;
  act(() => {
    instance.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 10 },
    });
    instance.surface!.editTextFormField();
  });
  await waitFor(() =>
    expect(view.container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Custom field')
  );
  const panel = view.container.querySelector('dialog')!;
  const input = panel.querySelector('input')!;
  fireEvent.change(input, { target: { value: 'unfinished' } });
  input.focus();
  await act(async () => {
    view.rerender(tree('Updated field'));
  });
  expect(view.container.querySelector('dialog')).toBe(panel);
  expect(panel.getAttribute('aria-label')).toBe('Updated field');
  expect(panel.textContent).toContain('Maximum length');
  expect(input.value).toBe('unfinished');
  expect(document.activeElement).toBe(input);
});
