import { expect, test } from 'bun:test';
import { createDocxEditor, DEFAULT_REVISION_MARKUP, type RevisionMarkupOptions } from '../index.ts';

test('markup preferences resolve, stay immutable, and emit only effective changes', () => {
  const editor = createDocxEditor({ revisionMarkup: { insertions: { color: 'red' } } });
  try {
    const original = editor.snapshot();
    expect(original.revisionMarkup.insertions).toEqual({
      mark: 'underline',
      color: 'red',
      background: 'none',
    });
    expect(Object.isFrozen(original.revisionMarkup.insertions)).toBe(true);
    const values: unknown[] = [];
    editor.on('revisionMarkupChange', (value) => {
      expect(editor.snapshot().revisionMarkup).toBe(value);
      values.push(value);
    });
    editor.setRevisionMarkup({ insertions: { color: 'red' } });
    expect(editor.snapshot()).toBe(original);
    expect(values).toHaveLength(0);
    editor.setRevisionMarkup({ insertions: { mark: 'doubleUnderline' } });
    expect(editor.snapshot().revisionMarkup.insertions).toEqual({
      mark: 'doubleUnderline',
      color: 'red',
      background: 'none',
    });
    expect(values).toHaveLength(1);
    const beforeInvalid = editor.snapshot();
    expect(() =>
      editor.setRevisionMarkup({
        insertions: { color: 'url(https://invalid.example)' },
      } as unknown as RevisionMarkupOptions)
    ).toThrow(TypeError);
    expect(editor.snapshot()).toBe(beforeInvalid);
    expect(values).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('local preferences survive attach, detach, reload and leave package revisions unchanged', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank' });
  try {
    const revision = editor.getDocumentHandle().revision;
    const before = new Uint8Array(await editor.save());
    editor.setRevisionMarkup({
      deletions: { mark: 'hidden' },
      insertions: { background: 'lightGreen' },
      trackFormatting: false,
    });
    expect(editor.getDocumentHandle().revision).toBe(revision);
    expect(new Uint8Array(await editor.save())).toEqual(before);
    const settings = editor.snapshot().revisionMarkup;
    editor.detach();
    editor.attach(container);
    expect(editor.snapshot().revisionMarkup).toBe(settings);
    editor.load('blank');
    expect(editor.snapshot().revisionMarkup).toBe(settings);
    editor.setRevisionMarkup(DEFAULT_REVISION_MARKUP);
    expect(editor.snapshot().revisionMarkup).toEqual(DEFAULT_REVISION_MARKUP);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('unsupported initial review mode and unavailable dialog fail explicitly', () => {
  expect(() => createDocxEditor({ reviewDisplayMode: 'all-markup' })).toThrow('review module');
  expect(() => createDocxEditor({ reviewDisplayMode: 'bogus' as 'original' })).toThrow('Invalid');
  const editor = createDocxEditor({ reviewDisplayMode: 'proposed' });
  expect(editor.can({ type: 'openRevisionMarkupDialog' }).ok).toBe(false);
  expect(editor.exec({ type: 'openRevisionMarkupDialog' }).ok).toBe(false);
  editor.destroy();
});
