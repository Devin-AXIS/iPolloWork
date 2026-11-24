// Review snapshot reads must stay flush-free.
//
// `useReview` uses `getReviewRevision` as a `useSyncExternalStore` getSnapshot, and
// `getSelectionPlacement` runs during that same render. A flush there committed queued
// typing and layout mid-render: consecutive snapshot reads returned different ticks,
// and Chrome updated while the rail was still rendering.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx('<w:p><w:r><w:t>hello</w:t></w:r></w:p>'),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe('review snapshot reads', () => {
  test('getReviewRevision does not flush queued typing, and consecutive calls match', () => {
    const { editor } = mount();
    editor.surface!.enqueueType('x');
    const before = editor.surface!.session.bodyText();
    const first = editor.getReviewRevision();
    const second = editor.getReviewRevision();
    expect(second).toBe(first);
    expect(editor.getReviewAuthors()).toBe(editor.getReviewAuthors());
    expect(editor.getSelectionPlacement()).toEqual(editor.getSelectionPlacement());
    expect(editor.surface!.session.bodyText()).toBe(before);
    editor.destroy();
  });
});
