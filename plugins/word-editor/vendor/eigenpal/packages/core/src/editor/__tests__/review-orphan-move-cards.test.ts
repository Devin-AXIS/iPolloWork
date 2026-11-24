// A moved-to paragraph with no move origin: its text and its paragraph mark are two cards, and a
// decision on either card resolves both, so the paragraph stays apart from the next one.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { collectReviewItems, serializeOoxmlPart } from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="2026-10-01T10:00:00Z"`;
// The range end follows the paragraph, and the mark has its own w:id.
const body =
  `<w:p><w:pPr><w:rPr><w:moveTo ${stamp(10)}/></w:rPr></w:pPr>` +
  `<w:moveToRangeStart ${stamp(11)} w:name="move1"/>` +
  `<w:moveTo ${stamp(12)}><w:r><w:t>Moved</w:t></w:r></w:moveTo></w:p>` +
  `<w:moveToRangeEnd w:id="11"/><w:p><w:r><w:t>Next</w:t></w:r></w:p>`;

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const document_ = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({
    container,
    author: 'Reviewer',
    document: document_,
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

for (const kind of ['moveTo', 'paragraphMark'] as const)
  for (const command of ['rejectReviewItem', 'acceptReviewItem'] as const)
    test(`${command} on the ${kind} card resolves the text and the mark together`, () => {
      const { editor, done } = mount();
      try {
        const card = editor
          .getReviewItems({ placement: false })
          .find((entry) => entry.item.kind === 'revision' && entry.item.revisionKind === kind)!;
        expect(editor[command](card.key)).toMatchObject({ ok: true });
        expect(editor.getReviewItems({ placement: false })).toEqual([]);
        const xml = serializeOoxmlPart(editor.surface!.session.part());
        expect(xml).toMatch(/>Moved<\/w:t><\/w:r><\/w:p>.*<w:p[ >].*>Next</s);
      } finally {
        done();
      }
    });
