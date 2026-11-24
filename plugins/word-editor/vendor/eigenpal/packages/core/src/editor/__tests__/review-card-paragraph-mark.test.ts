import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import { collectReviewItems, serializeOoxmlPart } from '../../store/index.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

// A card for deleted text and the paragraph mark it reaches decides both in one step, so the
// paragraph goes whole, as Accept All takes it.
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
const ann = (id: number) => `w:id="${id}" w:author="Ann" w:date="2026-10-01T10:00:00Z"`;

test('accepting a deleted paragraph before a block control removes the paragraph', () => {
  const body =
    `<w:p><w:pPr><w:rPr><w:del ${ann(1)}/></w:rPr></w:pPr>` +
    `<w:del ${ann(2)}><w:r><w:delText>lead</w:delText></w:r></w:del></w:p>` +
    '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
    '<w:p><w:r><w:t>After.</w:t></w:r></w:p>';
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
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
  editors.push(editor);
  const cards = editor.getReviewItems({ pairReplacements: false });
  expect(cards).toHaveLength(1);
  expect(editor.acceptReviewItem(cards[0]!.key).ok).toBe(true);
  const xml = serializeOoxmlPart(editor.surface!.session.part());
  expect(xml).toMatch(/<w:body><w:sdt>/);
  expect(xml).not.toContain('lead');
});
