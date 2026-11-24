// `w:doNotBreakWrappedTables` (ECMA-376 Part 4, 14.8.3.10) keeps a positioned table
// (`w:tblpPr`, Part 1, 17.4.57) in one piece in the legacy compatibility modes. A table taller
// than the page stays whole too. A table that then passes the bottom edge of the sheet moves up
// until its bottom edge meets it, but never above the top edge of the sheet. Compatibility mode
// 15 ignores the option. The page is 200 pt square without margins, and rows are exact.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const lead = (height: number) =>
  p('Lead', `<w:spacing w:line="${height * 20}" w:lineRule="exact"/>`);
/** A 100 pt wide text-relative table of `rows` exact rows, `height` points each. */
const table = (rows: number, height: number, offset = 0, vertAnchor = 'text') =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="${vertAnchor}" w:horzAnchor="margin" w:tblpY="${offset * 20 + 1}"/>` +
  '<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="2000"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/>' +
  '<w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  Array.from(
    { length: rows },
    (_, index) =>
      `<w:tr><w:trPr><w:trHeight w:val="${height * 20}" w:hRule="exact"/></w:trPr><w:tc>${p(`Row ${index}`)}</w:tc></w:tr>`
  ).join('') +
  '</w:tbl>';
const part = (xml: string, name: string) => {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const cascade = (mode: string | undefined) =>
  buildStyleCascadeTable(
    null,
    undefined,
    part(
      `<w:settings xmlns:w="${W}"><w:compat><w:doNotBreakWrappedTables/>` +
        (mode
          ? `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/>`
          : '') +
        '</w:compat></w:settings>',
      '/word/settings.xml'
    ).root
  );
const render = (body: string, mode: string | undefined) =>
  layoutSemanticDocument(
    part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml'),
    0,
    {
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      styleCascade: cascade(mode),
    }
  );
const tablesOn = (layout: ReturnType<typeof render>, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');

for (const mode of [undefined, '11', '14']) {
  test(`a table taller than the page stays whole at the sheet top (mode ${mode ?? 'absent'})`, () => {
    const layout = render(lead(20) + table(4, 60) + p('Anchor'), mode);
    // The table does not fit below the lead, so it moves to the next page with its anchor.
    expect(tablesOn(layout, 0)).toHaveLength(0);
    const [whole] = tablesOn(layout, 1);
    expect(isOutOfFlowTableFragment(whole!)).toBe(true);
    expect(whole!.rows).toHaveLength(4);
    expect(whole!.box.y + 0).toBe(0);
  });

  test(`a whole table moves up until it ends at the sheet bottom (mode ${mode ?? 'absent'})`, () => {
    for (const vertAnchor of ['text', 'page']) {
      const layout = render(table(3, 50, 90, vertAnchor) + p('Anchor'), mode);
      const [whole] = tablesOn(layout, 0);
      expect(whole!.rows).toHaveLength(3);
      expect(whole!.box.y).toBe(50);
    }
  });
}

test('compatibility mode 15 ignores the option and breaks the table', () => {
  const wide = table(4, 40).replaceAll('w:w="2000"', 'w:w="4000"');
  const layout = render(lead(100) + wide + p('Anchor'), '15');
  expect(tablesOn(layout, 0)[0]!.rows).toHaveLength(2);
  expect(tablesOn(layout, 1)[0]!.rows).toHaveLength(2);
});
