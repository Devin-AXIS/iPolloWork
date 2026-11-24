import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const formatted =
  '<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' +
  '<w:sz w:val="36"/><w:b/><w:i/><w:highlight w:val="yellow"/></w:rPr></w:pPr></w:p>';

for (const cell of [false, true]) {
  test(`empty ${cell ? 'cell' : 'body'} paragraphs provide a scaled font for native composition`, () => {
    const body = cell
      ? '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
        formatted +
        '</w:tc></w:tr></w:tbl>'
      : formatted;
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${body}` +
        '<w:p><w:r><w:t>Populated line</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 14) });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 2 });
    const empty = container.querySelector('br')!.parentElement!;
    expect(empty.style.fontSize).toBe('36px');
    expect(empty.style.fontFamily).toContain('Arial');
    expect(empty.style.fontWeight).toBe('bold');
    expect(empty.style.fontStyle).toBe('italic');
    // The temporary typing font must not paint a line-wide character highlight.
    expect(empty.style.backgroundColor).toBe('');
    const populated = container.querySelector('.layout-run')!.closest<HTMLElement>('.layout-line')!;
    expect(populated.style.fontSize).toBe('0px');
    // One composition anchor, on the empty line. The populated paragraph's own `<br>` is its
    // paragraph-end break for the browser's text services, held apart in its own furniture.
    expect(container.querySelectorAll('.layout-line > br')).toHaveLength(1);
    expect(populated.querySelectorAll('.docx-paragraph-boundary > br')).toHaveLength(1);
    expect(empty.textContent).toBe('');
  });
}
