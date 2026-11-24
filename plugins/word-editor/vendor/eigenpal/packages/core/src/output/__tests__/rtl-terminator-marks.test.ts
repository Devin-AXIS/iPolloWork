import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test.each([false, true])(
  'RTL terminator marks stay outside the physical left text edge (mixed=%s)',
  (mixed) => {
    const source = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>مرحبا${mixed ? ' ABC' : ''}</w:t><w:br/><w:t>عالم${mixed ? ' XYZ' : ''}</w:t></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!source.ok) throw Error(source.reason);
    const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer(6, 14) });
    const host = document.createElement('div');
    paintSemanticLayout(host, layout, { scale: 2, showParagraphMarks: true });
    const fragment = layout.pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw Error('missing paragraph');
    const mark = host.querySelector<HTMLElement>('.docx-paragraph-mark')!;
    const last = fragment.lines.at(-1)!;
    const edge = Math.min(...last.spans.map((s) => s.box.x));
    // The seat stands at the edge, relative to its line, and reads from its right.
    expect(parseFloat(mark.parentElement!.style.left)).toBeCloseTo((edge - last.contentX) * 2, 5);
    expect(mark.parentElement!.style.direction).toBe('rtl');
    const manual = host.querySelector<HTMLElement>('.docx-line-break-mark')!;
    const first = fragment.lines[0]!;
    expect(parseFloat(manual.parentElement!.style.left)).toBeCloseTo(
      (Math.min(...first.spans.map((s) => s.box.x)) - first.contentX) * 2,
      5
    );
    expect(manual.parentElement!.style.direction).toBe('rtl');
  }
);

test('empty and tab-containing RTL paragraphs keep marks on the leading-direction terminator edge', () => {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr></w:p><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:tab/><w:br/></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const host = document.createElement('div');
  paintSemanticLayout(host, layout, { scale: 1, showParagraphMarks: true });
  for (const mark of host.querySelectorAll<HTMLElement>(
    '.docx-paragraph-mark,.docx-line-break-mark'
  )) {
    expect(mark.parentElement!.style.direction).toBe('rtl');
  }
});
