import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('paragraph marks appear once per paragraph across pages, including table cells', () => {
  const long = `<w:p><w:r><w:t>${'word '.repeat(180)}</w:t></w:r></w:p>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${long}<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${long}<w:p/></w:tc></w:tr></w:tbl><w:p/><w:sectPr><w:pgSz w:w="5000" w:h="4000"/><w:pgMar w:top="300" w:bottom="300" w:left="300" w:right="300"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 14) });
  expect(layout.pages.length).toBeGreaterThan(1);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(0);
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true });
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(4);
  expect(container.classList.contains('docx-show-paragraph-marks')).toBe(true);
  const paragraphIds = [...container.querySelectorAll('.docx-paragraph-mark')].map(
    (mark) => mark.closest<HTMLElement>('[data-paragraph-id]')!.dataset.paragraphId
  );
  expect(new Set(paragraphIds).size).toBe(4);
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: false });
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(0);
});
