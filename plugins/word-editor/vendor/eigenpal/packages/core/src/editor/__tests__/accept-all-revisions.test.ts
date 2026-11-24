// `acceptAllRevisions` and `rejectAllRevisions`: the document vocabulary's decision over every
// tracked change, run as `resolveAllReviewChanges` with `scope: 'document'`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import { PRO_REVIEW_REASON } from '../opening-editing-mode.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const STAMP = 'w:date="2026-01-01T10:00:00Z"';
const ins = (id: number, text: string, author = 'Ada') =>
  `<w:ins w:id="${id}" w:author="${author}" ${STAMP}><w:r><w:t>${text}</w:t></w:r></w:ins>`;
const del = (id: number, text: string, author = 'Ada') =>
  `<w:del w:id="${id}" w:author="${author}" ${STAMP}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
const plain = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;

/** A change in every story: body, table cell, text box, header, footer, and footnote. */
const STORIES_BODY =
  p(plain('Body '), ins(1, 'kept'), del(2, 'gone')) +
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
  p(plain('Cell '), ins(3, 'kept', 'Grace'), del(4, 'gone', 'Grace')) +
  '</w:tc></w:tr></w:tbl>' +
  p(
    '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      p(plain('Box '), ins(5, 'kept'), del(6, 'gone')) +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>'
  ) +
  p(plain('Note'), '<w:r><w:footnoteReference w:id="2"/></w:r>') +
  `<w:sectPr><w:headerReference w:type="default" r:id="hdr"/><w:footerReference w:type="default" r:id="ftr"/></w:sectPr>`;

function storiesDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${WML}.footer+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="hdr" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="ftr" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="notes" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${STORIES_BODY}</w:body></w:document>`
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">${p(plain('Header '), ins(7, 'kept'), del(8, 'gone'))}</w:hdr>`
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}">${p(plain('Footer '), ins(9, 'kept'), del(10, 'gone'))}</w:ftr>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="2">${p(plain('Footnote '), ins(11, 'kept'), del(12, 'gone'))}</w:footnote></w:footnotes>`
    ),
  });
}

function docxOf(body: string, settings?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        (settings
          ? `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>`
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    ...(settings
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="s" Type="${R}/settings" Target="settings.xml"/></Relationships>`
          ),
          'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
        }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

function mount(document_: Uint8Array, review = true): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: document_,
    author: 'Grace Hopper',
    modules: review ? [reviewModule()] : [],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Every story's XML without the paragraph ids a first edit adds to an unopened story. */
const storiesXml = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.storyParts()
    .map((part) =>
      serializeOoxmlPart(part)
        .replace(/ xmlns:w14="[^"]*"/g, '')
        .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
    )
    .join('\n');
const pending = (editor: DocxEditorInstance) => editor.surface!.session.reviewItems().length;

describe('acceptAllRevisions and rejectAllRevisions', () => {
  test('without the review module, both are refused with the Pro reason and write nothing', () => {
    const editor = mount(storiesDocx(), false);
    const before = storiesXml(editor);
    for (const type of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
      const expected = { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      expect(editor.can({ type })).toEqual(expected);
      expect(editor.exec({ type })).toEqual(expected);
    }
    expect(storiesXml(editor)).toBe(before);
    editor.destroy();
  });

  for (const [type, kept, gone] of [
    ['acceptAllRevisions', 'kept', 'gone'],
    ['rejectAllRevisions', 'gone', 'kept'],
  ] as const) {
    test(`${type} decides every story in one undo step, and redo repeats it`, () => {
      const editor = mount(storiesDocx());
      expect(pending(editor)).toBe(12);
      expect(editor.can({ type })).toEqual({ ok: true });
      const before = storiesXml(editor);
      const result = editor.exec({ type });
      expect(result).toMatchObject({ ok: true, changed: true });
      expect(result.ok && result.revisions?.resolved).toHaveLength(12);
      expect(result.ok && result.revisions?.skipped).toEqual([]);
      expect(result.ok && result.revisions?.remaining).toBe(0);
      expect(pending(editor)).toBe(0);
      const after = storiesXml(editor);
      expect(after).not.toContain('<w:ins');
      expect(after).not.toContain('<w:del');
      for (const story of ['Body', 'Cell', 'Box', 'Header', 'Footer', 'Footnote']) {
        expect(after).toContain(`${story} </w:t></w:r><w:r><w:t>${kept}`);
      }
      expect(after).not.toContain(`>${gone}<`);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(storiesXml(editor)).toBe(before);
      expect(pending(editor)).toBe(12);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(storiesXml(editor)).toBe(after);
      editor.destroy();
    });
  }

  test('reports the same result as resolveAllReviewChanges with document scope', () => {
    const left = mount(storiesDocx());
    const right = mount(storiesDocx());
    const alias = left.exec({ type: 'acceptAllRevisions' });
    const bulk = right.exec({
      type: 'resolveAllReviewChanges',
      action: 'accept',
      scope: 'document',
    });
    expect(alias).toEqual(bulk);
    expect(storiesXml(left)).toBe(storiesXml(right));
    left.destroy();
    right.destroy();
  });

  test('a reviewer filter does not narrow it', () => {
    const editor = mount(storiesDocx());
    editor.setTrackedChangesFilter((revision) => revision.author === 'Grace');
    const result = editor.exec({ type: 'acceptAllRevisions' });
    expect(result.ok && result.revisions?.resolved).toHaveLength(12);
    expect(pending(editor)).toBe(0);
    editor.destroy();
  });

  test('ignores fields an untyped caller adds to the empty payload', () => {
    const editor = mount(storiesDocx());
    const command = { type: 'acceptAllRevisions', keys: ['nothing'], scope: 'visible' };
    const result = editor.exec(command as unknown as { type: 'acceptAllRevisions' });
    expect(result.ok && result.revisions?.resolved).toHaveLength(12);
    editor.destroy();
  });

  test('is refused with notFound when the document has no tracked changes', () => {
    const editor = mount(docxOf(p(plain('Clean text.'))));
    for (const type of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
      expect(editor.can({ type })).toMatchObject({ ok: false, code: 'notFound' });
      expect(editor.exec({ type })).toMatchObject({ ok: false, code: 'notFound' });
    }
    editor.destroy();
  });

  test('is refused with locked while viewing, and runs again after editing resumes', () => {
    const editor = mount(storiesDocx());
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(editor.can({ type: 'acceptAllRevisions' })).toMatchObject({ ok: false, code: 'locked' });
    expect(editor.exec({ type: 'acceptAllRevisions' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(pending(editor)).toBe(12);
    expect(editor.exec({ type: 'setEditingMode', mode: 'editing' }).ok).toBe(true);
    expect(editor.exec({ type: 'acceptAllRevisions' }).ok).toBe(true);
    editor.destroy();
  });

  test('is refused with locked under read-only protection', () => {
    const editor = mount(
      docxOf(
        p(plain('Text '), ins(1, 'added')),
        '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'
      )
    );
    const before = storiesXml(editor);
    expect(editor.can({ type: 'acceptAllRevisions' })).toMatchObject({ ok: false, code: 'locked' });
    expect(editor.exec({ type: 'rejectAllRevisions' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(storiesXml(editor)).toBe(before);
    editor.destroy();
  });

  test('leaves a change that locked content keeps pending and reports it as skipped', () => {
    const locked =
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
      p(plain('Locked '), del(1, 'clause')) +
      '</w:sdtContent></w:sdt>';
    const editor = mount(docxOf(locked + p(plain('Open '), ins(2, 'added'))));
    const result = editor.exec({ type: 'acceptAllRevisions' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.revisions?.resolved).toHaveLength(1);
    expect(result.ok && result.revisions?.skipped).toEqual([
      expect.objectContaining({ detail: 'locked-content' }),
    ]);
    expect(pending(editor)).toBe(1);
    expect(storiesXml(editor)).toContain('<w:delText>clause</w:delText>');
    // Only locked changes left: the next decision resolves nothing and names the lock.
    expect(editor.exec({ type: 'acceptAllRevisions' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    editor.destroy();
  });

  test('joins a history group with other edits as one undo step', () => {
    const editor = mount(storiesDocx());
    const before = storiesXml(editor);
    const group = editor.beginHistoryGroup();
    expect(editor.can({ type: 'acceptAllRevisions' }, { historyGroup: group })).toEqual({
      ok: true,
    });
    expect(editor.exec({ type: 'acceptAllRevisions' }, { historyGroup: group }).ok).toBe(true);
    const paragraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 0 },
      head: { paragraphId: paragraph, offset: 4 },
    });
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }, { historyGroup: group }).ok).toBe(
      true
    );
    group.end();
    expect(storiesXml(editor)).toContain('<w:b/>');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(storiesXml(editor)).toBe(before);
    editor.destroy();
  });
});
