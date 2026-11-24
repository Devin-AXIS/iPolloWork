import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor';
import { VerticalRuler } from '../src/components/ui/VerticalRuler';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

test('packaged controls and document navigation expose native keyboard semantics', async () => {
  let editor: DocxEditorInstance | undefined;
  const view = render(
    <DocxEditor
      document="blank"
      onReady={(value) => {
        editor = value as DocxEditorInstance;
      }}
    />
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const viewport = view.getByRole('region', { name: 'Document pages' });
  act(() => {
    viewport.focus();
  });
  expect(document.activeElement).toBe(viewport);
  expect(viewport.tabIndex).toBe(0);
  expect(view.getByRole('textbox', { name: 'Document content' })).toBeTruthy();
  const controls = view.getByRole('group', { name: 'Formatting controls' });
  expect(controls.tagName).toBe('FIELDSET');
  expect(controls.getAttribute('role')).toBeNull();
  const top = view.getByRole('slider', { name: 'Top margin' });
  expect(top.closest('[aria-hidden="true"]')).toBeNull();
  act(() => {
    top.focus();
  });
  expect(document.activeElement).toBe(top);
  const before = Number(top.getAttribute('aria-valuenow'));
  fireEvent.keyDown(top, { key: 'ArrowUp' });
  expect(Number(top.getAttribute('aria-valuenow'))).toBe(before + 180);
  await act(async () => {
    editor!.exec({ type: 'undo' });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(Number(top.getAttribute('aria-valuenow'))).toBe(before);
  view.rerender(
    <DocxEditor
      document="blank"
      i18n={{
        editor: { documentContent: 'Treść dokumentu', documentViewport: 'Strony dokumentu' },
        formattingBar: { label: 'Formatowanie' },
        ruler: { topMargin: 'Górny margines' },
      }}
    />
  );
  expect(view.getByRole('textbox', { name: 'Treść dokumentu' })).toBeTruthy();
  expect(view.getByRole('region', { name: 'Strony dokumentu' })).toBe(viewport);
  expect(view.getByRole('group', { name: 'Formatowanie' })).toBe(controls);
  expect(view.getByRole('slider', { name: 'Górny margines' })).toBe(top);
});

test('vertical margin keys commit bounded values and respect disabled controls', () => {
  const changes: number[] = [];
  let commits = 0;
  const view = render(
    <VerticalRuler
      editable
      onTopMarginChange={(value) => changes.push(value)}
      onMarginDragEnd={() => {
        commits++;
      }}
    />
  );
  const top = view.getByRole('slider', { name: 'Top margin' });
  fireEvent.keyDown(top, { key: 'Home' });
  fireEvent.keyDown(top, { key: 'End' });
  fireEvent.keyDown(top, { key: 'ArrowDown', shiftKey: true });
  expect(changes).toEqual([0, 13680, 1439]);
  expect(commits).toBe(3);
  expect(top.getAttribute('aria-valuemin')).toBe('0');
  expect(top.getAttribute('aria-valuemax')).toBe('13680');
  view.rerender(<VerticalRuler onTopMarginChange={(value) => changes.push(value)} />);
  fireEvent.keyDown(top, { key: 'ArrowUp' });
  expect(changes).toHaveLength(3);
  expect(top.tabIndex).toBe(-1);
  expect(top.getAttribute('aria-disabled')).toBe('true');
});
