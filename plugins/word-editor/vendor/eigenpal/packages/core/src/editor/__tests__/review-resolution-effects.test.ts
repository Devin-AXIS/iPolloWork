// WHAT RESOLVING A REVISION LEAVES BEHIND.
//
// Accept and Reject are one click that rewrites the document under the reader's caret, and
// two things have to survive it: the caret has to still mean the characters it meant, and the
// markup left behind has to be markup the rest of the engine accepts.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  paragraphTextOf,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

function docxOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
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

function mountEditor(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docxOf(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('#351 resolving a revision under the caret', () => {
  test('the caret follows the text, so the next character lands where it looks', () => {
    const editor = mountEditor(
      '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>' +
        '<w:ins w:id="1" w:author="Ada" w:date="2026-01-02T03:04:05Z">' +
        '<w:r><w:t>added</w:t></w:r></w:ins>' +
        '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>'
    );
    try {
      const surface = editor.surface!;
      const pid = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: pid, offset: 8 },
        head: { paragraphId: pid, offset: 8 },
      });
      const [card] = editor.getReviewItems();
      expect(editor.rejectReviewItem(card!.key)).toEqual({ ok: true, changed: true });
      expect(paragraphTextOf(surface.session.part(), pid)).toBe('Kept  tail');
      expect(surface.state().selection.head.offset).toBe(5);
      surface.type('Z');
      expect(paragraphTextOf(surface.session.part(), pid)).toBe('Kept Z tail');
    } finally {
      editor.destroy();
    }
  });

  test('accepting the deletion of the only row takes the table with it', () => {
    const editor = mountEditor(
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:del w:id="7" w:author="Ada" w:date="2026-01-02T03:04:05Z"/></w:trPr>' +
        '<w:tc><w:tcPr><w:cellDel w:id="7" w:author="Ada" w:date="2026-01-02T03:04:05Z"/></w:tcPr>' +
        '<w:p><w:del w:id="8" w:author="Ada" w:date="2026-01-02T03:04:05Z">' +
        '<w:r><w:delText>only row</w:delText></w:r></w:del></w:p>' +
        '</w:tc></w:tr></w:tbl>' +
        p('after')
    );
    try {
      for (const item of editor.getReviewItems()) editor.acceptReviewItem(item.key);
      const xml = serializeOoxmlPart(editor.surface!.session.part());
      expect(xml).not.toMatch(/<w:tbl>(?:(?!<w:tr).)*<\/w:tbl>/s);
    } finally {
      editor.destroy();
    }
  });
});
