// A snapshot read while typed text waits in the input buffer. Reading layout during the
// derive lands the buffered keystrokes; the snapshot must describe the state they moved to,
// not cache a mix of values read before and after the flush.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('a snapshot read that lands buffered typing reports the typed state', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    document: docx(p('Hello world')),
    container,
  }) as DocxEditorInstance;
  try {
    const [first] = editor.surface!.session.paragraphIds();
    editor.exec({
      type: 'setSelection',
      range: { anchor: { blockId: first!, offset: 5 }, head: { blockId: first!, offset: 5 } },
    });
    expect(editor.snapshot().canUndo).toBe(false);
    editor.surface!.enqueueType('XYZ');
    // Something else ticks the snapshot before the input buffer's timer fires.
    editor.setZoom(1.5);
    const snapshot = editor.snapshot();
    const live = editor.surface!.state();
    expect(snapshot.canUndo).toBe(live.canUndo);
    expect(snapshot.canUndo).toBe(true);
    expect(snapshot.selectionRange?.head.offset).toBe(live.selection.head.offset);
    expect(editor.snapshot()).toBe(snapshot);
  } finally {
    editor.destroy();
    container.remove();
  }
});
