// The paragraph a cell must end with after a nested table takes no room when its runs hold
// no text, in every compatibility mode. Measured on reference renderings: spacing, a large
// mark, an exact line height, a paragraph border and shading on it change nothing, while a
// space, a tab, or a second paragraph between it and the table keep a line.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, documentOrder } from '../semantic-interaction.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer();
const LINE = 14 * (10 / 11);

const p = (text: string, pPr = '') => `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const emptyRun = (pPr = '', rPr = '') =>
  `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve"></w:t></w:r></w:p>`;

function cellWithNestedTable(after: string): string {
  return (
    '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
    p('AAA') +
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    p('BBB') +
    '</w:tc></w:tr></w:tbl>' +
    after +
    '</w:tc></w:tr></w:tbl>'
  );
}

function layoutOf(bodyXml: string, compatibilityMode?: number): SemanticLayout {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return layoutSemanticDocument(result.part, 0, { measurer, compatibilityMode });
}

function outerRow(layout: SemanticLayout) {
  const fragment = layout.pages[0]!.fragments.find(
    (record): record is TableFragmentRecord => record.kind === 'table'
  )!;
  return fragment.rows[0]!;
}

const growth = (after: string, mode?: number) =>
  outerRow(layoutOf(cellWithNestedTable(after), mode)).box.height -
  outerRow(layoutOf(cellWithNestedTable(''), mode)).box.height;

describe('a nested-table terminator whose runs hold no text', () => {
  test('costs the row nothing in legacy and modern modes', () => {
    for (const mode of [undefined, 12, 14, 15]) expect(growth(emptyRun(), mode)).toBeCloseTo(0, 6);
  });

  test('spacing, mark size, exact height, border and shading take no room either', () => {
    for (const terminator of [
      emptyRun('<w:pPr><w:spacing w:before="200" w:after="200"/></w:pPr>'),
      emptyRun('<w:pPr><w:spacing w:line="480" w:lineRule="exact"/></w:pPr>'),
      emptyRun(
        '<w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:pPr>',
        '<w:rPr><w:sz w:val="48"/></w:rPr>'
      ),
      emptyRun('<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12"/></w:pBdr></w:pPr>'),
      emptyRun('<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:pPr>'),
      '<w:p><w:r><w:t></w:t></w:r><w:bookmarkStart w:id="1" w:name="b"/><w:r/></w:p>',
    ])
      expect(growth(terminator)).toBeCloseTo(0, 6);
  });

  test('a space or a tab is text, and keeps the line', () => {
    expect(growth('<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>')).toBeCloseTo(LINE, 6);
    expect(growth('<w:p><w:r><w:tab/></w:r></w:p>')).toBeCloseTo(LINE, 6);
  });

  test('only the paragraph right after the table collapses', () => {
    // Two empty paragraphs after the table both keep their lines.
    expect(growth(emptyRun() + emptyRun())).toBeCloseTo(2 * LINE, 6);
  });

  test('an empty run elsewhere in a cell keeps its line', () => {
    const cell = (content: string) =>
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      content +
      '</w:tc></w:tr></w:tbl>';
    const withEmpty = outerRow(layoutOf(cell(p('AAA') + emptyRun()))).box.height;
    const without = outerRow(layoutOf(cell(p('AAA')))).box.height;
    expect(withEmpty - without).toBeCloseTo(LINE, 6);
  });

  test('the caret in it is visible and ends inside the row', () => {
    const layout = layoutOf(cellWithNestedTable(emptyRun()) + p('NEXT'));
    const row = outerRow(layout);
    const terminator = documentOrder(layout).find((id) => id.endsWith('.3'))!;
    const caret = caretAt(layout, { paragraphId: terminator, offset: 0 }, { measurer });
    expect(caret).not.toBeNull();
    expect(caret!.height).toBeGreaterThan(0);
    expect(caret!.y + caret!.height).toBeCloseTo(row.box.y + row.box.height, 6);
  });
});
