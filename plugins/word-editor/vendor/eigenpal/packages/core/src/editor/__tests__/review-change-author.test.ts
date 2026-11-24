// CHANGING WHO A TRACKED CHANGE BELONGS TO.
//
// `setReviewChangesAuthor` keeps every change pending and rewrites only its attribution, with
// the same selection rules as the bulk accept and reject command.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DATE = '2026-01-01T00:00:00Z';

const ins = (id: number, author: string) =>
  `<w:p><w:ins w:id="${id}" w:author="${author}" w:date="${DATE}"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;

function docxOf(body: string, settings = ''): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (settings) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
    );
    files['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`);
  }
  return zipSync(files);
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

function mountEditor(body: string, settings?: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docxOf(body, settings),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const documentXml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
// Hidden authors leave the pane, so read the session's complete queue.
const revisionAuthors = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.reviewItems()
    .flatMap((item) => (item.kind === 'revision' ? [item.author] : []));

describe('setReviewChangesAuthor', () => {
  test('selected keys change author, stay pending, and undo in one step', async () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'AI') + ins(3, 'Ada'));
    const before = await editor.save();
    const [first] = editor.getReviewItems();
    const result = editor.exec({
      type: 'setReviewChangesAuthor',
      author: 'Grace Hopper',
      keys: [first!.key],
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) throw new Error(result.reason);
    expect(result.revisionAuthors?.updated).toEqual([
      expect.objectContaining({
        previousKey: first!.key,
        previousAuthor: 'AI',
        author: 'Grace Hopper',
      }),
    ]);
    expect(revisionAuthors(editor)).toEqual(['Grace Hopper', 'AI', 'Ada']);
    expect(editor.getReviewItems()[0]!.key).toBe(result.revisionAuthors!.updated[0]!.key);
    expect(await documentXml(editor)).toContain(
      `<w:ins w:author="Grace Hopper" w:date="${DATE}" w:id="1">`
    );

    editor.exec({ type: 'undo' });
    expect(await editor.save()).toEqual(before);
    editor.exec({ type: 'redo' });
    expect(revisionAuthors(editor)).toEqual(['Grace Hopper', 'AI', 'Ada']);
    editor.destroy();
  });

  test('the default selection honors author visibility; document scope does not', () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'Ada'));
    editor.setReviewAuthorVisible('Ada', false);
    const date = '2026-10-08T09:30:00Z';
    expect(editor.exec({ type: 'setReviewChangesAuthor', author: 'Grace', date }).ok).toBe(true);
    expect(revisionAuthors(editor)).toEqual(['Grace', 'Ada']);
    const changed = editor.getReviewItems()[0]!;
    expect(changed.kind === 'revision' && changed.date).toBe(date);
    expect(
      editor.exec({ type: 'setReviewChangesAuthor', author: 'Lin', scope: 'document' }).ok
    ).toBe(true);
    expect(revisionAuthors(editor)).toEqual(['Lin', 'Lin']);
    editor.destroy();
  });

  test('authors narrows the selection to those authors, and refuses beside keys', () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'Ada') + ins(3, 'AI'));
    const result = editor.exec({ type: 'setReviewChangesAuthor', author: 'Lin', authors: ['AI'] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.revisionAuthors!.updated).toHaveLength(2);
    expect(revisionAuthors(editor)).toEqual(['Lin', 'Ada', 'Lin']);
    expect(
      // The type refuses this combination too; untyped callers meet the runtime check.
      editor.can({
        type: 'setReviewChangesAuthor',
        author: 'Lin',
        authors: ['Ada'],
        keys: [editor.getReviewItems()[1]!.key],
      } as never)
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(
      editor.can({
        type: 'setReviewChangesAuthor',
        author: 'Lin',
        scope: 'document',
        keys: [editor.getReviewItems()[1]!.key],
      } as never)
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(
      editor.can({ type: 'setReviewChangesAuthor', author: 'Lin', authors: ['Nobody'] })
    ).toMatchObject({ ok: false, code: 'notFound' });
    editor.destroy();
  });

  test('an active card stays active under its new key', () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'AI'));
    const [, second] = editor.getReviewItems();
    editor.setActiveReviewItem(second!.key);
    const result = editor.exec({ type: 'setReviewChangesAuthor', author: 'Ada' });
    if (!result.ok) throw new Error(result.reason);
    const active = editor.getReviewItems().find((item) => item.isActive);
    expect(active?.key).toBe(result.revisionAuthors!.updated[1]!.key);
    editor.destroy();
  });

  test('a change that already has the author reports success without an undo step', async () => {
    const editor = mountEditor(ins(1, 'Ada'));
    const before = await editor.save();
    expect(editor.exec({ type: 'setReviewChangesAuthor', author: 'Ada' })).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(await editor.save()).toEqual(before);
    editor.destroy();
  });

  test('invalid input, stale keys, viewing, and protection refuse without writing', async () => {
    const editor = mountEditor(ins(1, 'AI'));
    const before = await editor.save();
    for (const command of [
      { type: 'setReviewChangesAuthor', author: '  ' },
      { type: 'setReviewChangesAuthor', author: 'Ada', date: 'tomorrow' },
      { type: 'setReviewChangesAuthor', author: 'Ada', scope: 'everything' },
    ] as const)
      expect(editor.exec(command as never)).toMatchObject({ ok: false, code: 'invalidArgs' });

    const stale = editor.exec({ type: 'setReviewChangesAuthor', author: 'Ada', keys: ['gone'] });
    expect(stale).toMatchObject({
      ok: false,
      code: 'notFound',
      revisionAuthors: { updated: [], skipped: [{ key: 'gone', reason: 'unknown-revision' }] },
    });
    const strict = editor.can({
      type: 'setReviewChangesAuthor',
      author: 'Ada',
      keys: [editor.getReviewItems()[0]!.key, 'gone'],
      unsupported: 'fail',
    });
    expect(strict).toMatchObject({ ok: false, code: 'unsupported' });

    editor.setEditingMode('viewing');
    expect(editor.can({ type: 'setReviewChangesAuthor', author: 'Ada' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(await editor.save()).toEqual(before);
    editor.destroy();

    const protectedEditor = mountEditor(
      ins(1, 'AI'),
      '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>'
    );
    expect(protectedEditor.exec({ type: 'setReviewChangesAuthor', author: 'Ada' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(revisionAuthors(protectedEditor)).toEqual(['AI']);
    protectedEditor.destroy();
  });

  test('an omitted author is the editor author, and follows setAuthor', () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'AI'));
    const [first, second] = editor.getReviewItems();
    expect(editor.exec({ type: 'setReviewChangesAuthor', keys: [first!.key] }).ok).toBe(true);
    expect(revisionAuthors(editor)).toEqual(['Grace Hopper', 'AI']);
    editor.setAuthor('Ada');
    expect(editor.exec({ type: 'setReviewChangesAuthor', keys: [second!.key] }).ok).toBe(true);
    expect(revisionAuthors(editor)).toEqual(['Grace Hopper', 'Ada']);
    editor.setAuthor(undefined);
    expect(editor.can({ type: 'setReviewChangesAuthor' })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    editor.destroy();
  });

  test('stored w:id values select changes through their review keys, as documented', () => {
    const editor = mountEditor(ins(1, 'AI') + ins(2, 'AI') + ins(3, 'AI'));
    const ids = ['1', '3'];
    const keys = editor
      .getReviewItems({ placement: false })
      .filter(
        (entry) =>
          entry.kind === 'revision' &&
          entry.item.addresses.some((address) => ids.includes(address.id))
      )
      .map((entry) => entry.key);
    expect(editor.exec({ type: 'setReviewChangesAuthor', keys }).ok).toBe(true);
    expect(revisionAuthors(editor)).toEqual(['Grace Hopper', 'AI', 'Grace Hopper']);
    editor.destroy();
  });

  test('without the review module the command refuses', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docxOf(ins(1, 'AI')) });
    expect(editor.can({ type: 'setReviewChangesAuthor', author: 'Ada' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    editor.destroy();
  });
});
