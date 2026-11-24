// A column break (`w:br w:type="column"`, 17.3.3.1) inside a table cell breaks nothing: the
// text after it stays on the same line, and the cell takes no extra line. Outside a table the
// break still ends the line.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { BlockFragmentRecord, LineRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const columnBreak = '<w:r><w:br w:type="column"/></w:r>';
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const sect = (columns: number) =>
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>' +
  `<w:cols w:num="${columns}" w:space="720"/></w:sectPr>`;
const table = (paragraphs: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
  `<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${paragraphs}</w:tc></w:tr></w:tbl>`;
const cellParagraphs =
  `<w:p>${text('Alpha')}${columnBreak}${text('Beta')}</w:p>` +
  `<w:p>${text('Gamma')}${columnBreak}</w:p>` +
  `<w:p>${columnBreak}${text('Delta')}</w:p>` +
  `<w:p>${text('Tail')}</w:p>`;

function lay(body: string): SemanticLayout {
  return layoutSemanticDocument(
    read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    1,
    { measurer: createFixedMeasurer(6, 12) }
  );
}

function cellLines(layout: SemanticLayout): readonly LineRecord[] {
  const lines: LineRecord[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[]) => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') lines.push(...block.lines);
      else if (block.kind === 'table')
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
    }
  };
  for (const page of layout.pages)
    visit(page.fragments.filter((fragment) => fragment.kind === 'table'));
  return lines;
}

const visibleText = (line: LineRecord) =>
  line.spans
    .map((span) => span.text)
    .join('')
    .replace(/[\f\n]/g, '');

describe('column breaks in table cells', () => {
  for (const columns of [1, 2]) {
    test(`keep the text on one line in a section of ${columns} column(s)`, () => {
      const layout = lay(`${table(cellParagraphs)}<w:p/>${sect(columns)}`);
      const lines = cellLines(layout);
      expect(lines.map(visibleText)).toEqual(['AlphaBeta', 'Gamma', 'Delta', 'Tail']);
      expect(lines.every((line) => line.breakAfter === undefined)).toBe(true);
      // The cell grows by one line per paragraph, not by one per break.
      const tops = lines.map((line) => line.box.y);
      expect(new Set(tops).size).toBe(4);
      expect(tops[3]! - tops[0]!).toBeCloseTo(3 * lines[0]!.box.height, 3);
      // The break keeps its model offset.
      const alpha = lines[0]!.spans;
      expect(alpha.at(-1)!.range.end).toBe(10);
      expect(layout.pages).toHaveLength(1);
    });
  }

  test('still end the line in a body paragraph', () => {
    const layout = lay(`<w:p>${text('Alpha')}${columnBreak}${text('Beta')}</w:p>${sect(2)}`);
    const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph');
    expect(paragraph?.kind === 'paragraph' && paragraph.lines[0]!.breakAfter).toBe('column');
  });
});
