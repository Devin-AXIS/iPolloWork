// Edits above a leading page break whose text cites a footnote: the retained layout matches a
// reopened copy after every step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

// A 290pt content box of 20pt lines.
const SECTION =
  '<w:pgSz w:w="4000" w:h="6200"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="0" w:footer="0" w:gutter="0"/>';
const EXACT =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr>';
const line = (text: string, run = '') => `<w:p>${EXACT}<w:r><w:t>${text}</w:t>${run}</w:r></w:p>`;
const cite = (id: number) => `<w:footnoteReference w:id="${id}"/>`;
const BODY =
  Array.from({ length: 10 }, (_, index) => line(`line${index}`)).join('') +
  line('cite', cite(1)) +
  `<w:p>${EXACT}<w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t>${cite(2)}</w:r></w:p>` +
  line('tail0') +
  line('tail1');

function docx(body: string): Uint8Array {
  const note = (id: number) =>
    `<w:footnote w:id="${id}"><w:p><w:r><w:t>Note ${id}</w:t></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>${SECTION}</w:sectPr></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        note(1) +
        note(2) +
        '</w:footnotes>'
    ),
  });
}

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: bytes, mode: 'edit' });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

/** Fragments with their flow flag and position, and the notes of every page. */
const shape = (layout: SemanticLayout) =>
  layout.pages.map((page) => ({
    fragments: page.fragments.map((fragment) => ({
      box: fragment.box,
      outOfFlow: 'outOfFlow' in fragment ? fragment.outOfFlow : undefined,
      text:
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((entry) => entry.spans.map((span) => span.text)).join('')
          : fragment.kind,
    })),
    notes: (page.footnotes?.notes ?? []).map(
      (note) => `${note.noteId}${note.continuation ? '+' : ''}`
    ),
  }));

const reopened = (bytes: Uint8Array) => {
  const { editor, container } = mount(bytes);
  try {
    return shape(editor.surface!.layout());
  } finally {
    editor.destroy();
    container.remove();
  }
};

test('line breaks above the leading break keep the retained layout equal to a reopened copy', () => {
  const { editor, container } = mount(docx(BODY));
  try {
    const ids = editor.surface!.session.paragraphIds();
    for (const at of [0, 1]) {
      const paragraphId = ids[at]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 2 },
        head: { paragraphId, offset: 2 },
      });
      expect(editor.exec({ type: 'insertBreak', kind: 'line' })).toMatchObject({ ok: true });
      const retained = shape(editor.surface!.layout());
      expect(retained).toEqual(reopened(editor.surface!.save()));
      // The citing line and its note stay together on the first page, and the text after
      // the break starts the second.
      expect(retained).toHaveLength(2);
      expect(retained[0]!.notes).toEqual(['1']);
      expect(retained[1]!.notes).toEqual(['2']);
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});
