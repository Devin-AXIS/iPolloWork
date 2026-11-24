import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('paint rotates btLr table-cell content as one layout-owned plane', () => {
  const body =
    '<w:tbl><w:tblGrid><w:gridCol w:w="510"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
    '<w:tc><w:tcPr><w:textDirection w:val="btLr"/></w:tcPr>' +
    '<w:p><w:r><w:t>vertical label</w:t></w:r></w:p>' +
    '</w:tc></w:tr></w:tbl>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });

  const content = container.querySelector<HTMLElement>('.docx-table-cell-content-btlr')!;
  expect(content.style.width).toBe('100px');
  expect(content.style.height).toBe('25.5px');
  expect(content.style.transform).toBe('translateY(100px) rotate(-90deg)');
  expect(content.textContent).toBe('vertical label');
});
