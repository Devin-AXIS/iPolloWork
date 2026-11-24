import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, render, getByLabelText } from '@testing-library/react';
import { reviewModule } from '../../pro/src/index';
import type { DocxEditorInstance, ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorRevisionMarkup } from '../src/editor/DocxEditorRevisionMarkup';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

test('React markup props and declarations update the same instance and event', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  const compoundChanges: ResolvedRevisionMarkup[] = [];
  const ready = (value: unknown) => {
    editor = value as DocxEditorInstance;
  };
  const result = render(
    <DocxEditorRoot
      document="blank"
      onReady={ready}
      revisionMarkup={{ insertions: { mark: 'bold' } }}
      onRevisionMarkupChange={(value) => changes.push(value)}
    />
  );
  await act(async () => {});
  const instance = editor!;
  expect(instance.snapshot().revisionMarkup.insertions.mark).toBe('bold');
  act(() => instance.setRevisionMarkup({ deletions: { color: 'blue' } }));
  expect(changes.at(-1)?.deletions.color).toBe('blue');
  expect(instance.snapshot().revisionMarkup.deletions.color).toBe('byAuthor');
  expect(changes).toHaveLength(1);
  result.rerender(
    <DocxEditorRoot
      document="blank"
      onReady={ready}

    >
      <DocxEditorRevisionMarkup
        insertions={{ mark: 'italic' }}
        movedTo={{ mark: 'bold' }}
        onRevisionMarkupChange={(value) => compoundChanges.push(value)}
      />
    </DocxEditorRoot>
  );
  await act(async () => {});
  expect(editor).toBe(instance);
  expect(instance.snapshot().revisionMarkup.insertions.mark).toBe('italic');
  expect(instance.snapshot().revisionMarkup.movedTo.mark).toBe('bold');
  expect(compoundChanges.some((value) => value.movedTo.mark === 'bold')).toBe(true);
});


test('React controlled markup accepts host updates without duplicate callbacks', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  function Host() {
    const [settings, setSettings] = useState<ResolvedRevisionMarkup | undefined>();
    return <DocxEditorRoot document="blank" revisionMarkup={settings ?? {}}
      onReady={(value) => { editor = value as DocxEditorInstance; }}
      onRevisionMarkupChange={(value) => { changes.push(value); setSettings(value); }} />;
  }
  render(<Host />);
  await act(async () => {});
  act(() => editor!.setRevisionMarkup({ insertions: { mark: 'bold' } }));
  expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('bold');
  expect(changes).toHaveLength(1);
});


test('React external controlled changes refresh an open dialog without callback loops', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  const surface = document.createElement('div');
  document.body.append(surface);
  const modules = [reviewModule({})];
  const ready = (value: unknown) => {
    editor = value as DocxEditorInstance;
    editor.attach(surface);
  };
  const callback = (value: ResolvedRevisionMarkup) => changes.push(value);
  const result = render(<DocxEditorRoot document="blank" modules={modules}
    revisionMarkup={{ insertions: { mark: 'bold' } }}
    onReady={ready} onRevisionMarkupChange={callback} />);
  try {
    await act(async () => {});
    act(() => { editor!.exec({ type: 'openRevisionMarkupDialog' }); });
    expect((getByLabelText(surface, 'Insertions') as HTMLSelectElement).value).toBe('bold');
    result.rerender(<DocxEditorRoot document="blank" modules={modules}
      revisionMarkup={{ insertions: { mark: 'italic' } }}
      onReady={ready} onRevisionMarkupChange={callback} />);
    await act(async () => {});
    expect((getByLabelText(surface, 'Insertions') as HTMLSelectElement).value).toBe('italic');
    expect(changes).toHaveLength(0);
  } finally { result.unmount(); surface.remove(); }
});
