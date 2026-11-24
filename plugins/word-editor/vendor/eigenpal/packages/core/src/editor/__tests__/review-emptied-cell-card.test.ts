// Accepting the card for a deletion that empties a table cell removes the cell, as accepting
// every change does.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { collectReviewItems, serializeOoxmlPart } from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="2026-10-01T10:00:00Z"`;
const tc = (body: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${body}</w:tc>`;
const body =
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
  tc(
    `<w:p><w:pPr><w:rPr><w:del ${stamp(1)}/></w:rPr></w:pPr><w:del ${stamp(2)}><w:r><w:delText>x</w:delText></w:r></w:del></w:p>`
  ) +
  tc('<w:p><w:r><w:t>y</w:t></w:r></w:p>') +
  '</w:tr></w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>';

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Reviewer',
    document: zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    }),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: () => [],
        },
      },
    ],
  });
  return { editor, done: () => (editor.destroy(), container.remove()) };
}

test('accepting the deletion card of a whole cell removes the cell', () => {
  const { editor, done } = mount();
  try {
    const cards = editor.getReviewItems({ placement: false });
    expect(cards).toHaveLength(1);
    expect(editor.acceptReviewItem(cards[0]!.key)).toMatchObject({ ok: true });
    expect(editor.getReviewItems({ placement: false })).toEqual([]);
    const xml = serializeOoxmlPart(editor.surface!.session.part());
    expect(xml.match(/<w:tc[ >]/g)).toHaveLength(1);
    expect(xml).toContain('>y<');
  } finally {
    done();
  }
});
