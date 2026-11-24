import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
function load(body: string) {
  const value = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!value.ok) throw new Error(value.reason);
  return value.part;
}
const line = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
const p = (text = '') => `<w:p>${line}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
function input(pageBreak = false, floating = true, emptyContent = '') {
  const table =
    '<w:tbl><w:tblPr>' +
    (floating
      ? '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="86"/>'
      : '') +
    '<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
    `<w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${p('Cell')}</w:tc></w:tr></w:tbl>`;
  return load(
    p('Lead') +
      table +
      `<w:p>${line}${emptyContent}</w:p>` +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="700" w:lineRule="exact"/>' +
      (pageBreak ? '<w:pageBreakBefore/>' : '') +
      '</w:pPr></w:p>' +
      p('Next')
  );
}
function paragraphs(layout: ReturnType<typeof layoutSemanticDocument>) {
  return layout.pages.flatMap((page) =>
    page.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph')
  );
}
test('empty paragraphs clear full-width floating tables and retain authored exact height', () => {
  const layout = layoutSemanticDocument(input(), 1, { measurer });
  const [, first, exact] = paragraphs(layout);
  expect(layout.pages).toHaveLength(1);
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(first!.box.y).toBeCloseTo(table.box.y + table.box.height, 6);
  expect(exact!.box.y).toBeCloseTo(first!.box.y + first!.box.height, 6);
  expect(exact!.lines[0]!.box.height).toBeCloseTo(35, 6);
  expect(paragraphs(layout)).toHaveLength(4);
});
test('ordinary text still clears a full-width floating table', () => {
  const layout = layoutSemanticDocument(input(), 1, { measurer });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  const next = paragraphs(layout)[3]!;
  expect(next.lines[0]!.spans.map((s) => s.text).join('')).toBe('Next');
  expect(next.box.y).toBeGreaterThanOrEqual(table.box.y + table.box.height - 1e-6);
});
test('an authored page break on the empty paragraph still creates a new page', () => {
  const layout = layoutSemanticDocument(input(true), 1, { measurer });
  expect(layout.pages).toHaveLength(2);
  const exact = paragraphs(layout)[2]!;
  expect(exact.box.y).toBe(0);
  expect(exact.lines[0]!.box.height).toBeCloseTo(35, 6);
});
test('an in-flow table still consumes its full row height', () => {
  const layout = layoutSemanticDocument(input(false, false), 1, { measurer });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(paragraphs(layout)[1]!.box.y).toBeGreaterThanOrEqual(
    table.box.y + table.box.height - 1e-6
  );
});
test('warm and cold empty-paragraph table wrapping produce the same layout', () => {
  const part = input(),
    session = createLayoutSession();
  layoutSemanticDocument(part, 1, { measurer, session });
  expect(layoutSemanticDocument(part, 2, { measurer, session }).pages).toEqual(
    layoutSemanticDocument(part, 2, { measurer }).pages
  );
});

const emptyForms = [
  '',
  '<w:r/>',
  '<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:r>',
  '<w:r><w:t/></w:r>',
  '<w:bookmarkStart w:id="1" w:name="empty"/><w:r/><w:bookmarkEnd w:id="1"/>',
];
test.each(emptyForms)(
  'empty content clears the table without losing line height: %s',
  (content) => {
    const layout = layoutSemanticDocument(input(false, true, content), 1, { measurer });
    const [, empty, exact, next] = paragraphs(layout);
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    expect(empty!.box.y).toBeCloseTo(table.box.y + table.box.height, 6);
    expect(exact!.box.y).toBeCloseTo(empty!.box.y + empty!.box.height, 6);
    expect(next!.box.y).toBeCloseTo(exact!.box.y + exact!.box.height, 6);
    expect(empty!.box.height).toBe(14);
  }
);
