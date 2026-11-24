// `w:pageBreakBefore` on the first paragraph of a body table row's first cell starts that row
// on a new page. The property elsewhere in the row, and a manual page break in a cell, do not.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayoutOptions,
} from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const load = (body: string) =>
  read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml');

// `Break` inherits the page break through `basedOn`.
const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:pageBreakBefore/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Break"><w:basedOn w:val="Base"/></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);

const options = (extra: Partial<SemanticLayoutOptions> = {}): SemanticLayoutOptions => ({
  measurer: createFixedMeasurer(6, 14),
  styleCascade,
  ...extra,
});
const lay = (body: string) => layoutSemanticDocument(load(body), 1, options());

// 200pt wide, 300pt tall sheets with 10pt margins: a 280pt content box.
const sect = (extra = '') =>
  '<w:sectPr><w:pgSz w:w="4000" w:h="6000"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  `w:header="0" w:footer="0" w:gutter="0"/>${extra}</w:sectPr>`;
const paragraph = (text: string, pPr = '', content = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${content}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const breakBefore = '<w:pageBreakBefore/>';
const manualBreak = '<w:br w:type="page"/>';
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const row = (cells: string, trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells}</w:tr>`;
const table = (rows: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="3200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="1600"/></w:tblGrid>${rows}</w:tbl>`;
/** Two rows of two cells; `pPr[n]` formats the paragraph of cell `n` in reading order. */
const grid = (pPr: readonly string[] = [], content: readonly string[] = []) =>
  table(
    row(cell(paragraph('a1', pPr[0], content[0])) + cell(paragraph('b1', pPr[1]))) +
      row(cell(paragraph('a2', pPr[2])) + cell(paragraph('b2', pPr[3])))
  );

const blockText = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? [
        block.lines
          .flatMap((line) => line.spans.map((span) => span.text))
          .join('')
          .replace(/[^\w ]/g, ''),
      ]
    : block.rows.flatMap((placed) => placed.cells.flatMap((c) => c.blocks.flatMap(blockText)));
const pageTexts = (layout: SemanticLayout): string[] =>
  layout.pages.map((page) =>
    page.fragments
      .flatMap(blockText)
      .filter((text) => text !== '')
      .join(' ')
  );

describe('a table row whose first cell starts with a page break before', () => {
  test('moves the first row, and the table with it, to a new page', () => {
    expect(
      pageTexts(lay(paragraph('lead') + grid([breakBefore]) + paragraph('tail') + sect()))
    ).toEqual(['lead', 'a1 b1 a2 b2 tail']);
  });

  test('moves the row once when every cell of the row asks for it', () => {
    const layout = lay(paragraph('lead') + grid([breakBefore, breakBefore]) + sect());
    expect(pageTexts(layout)).toEqual(['lead', 'a1 b1 a2 b2']);
  });

  test('moves a later row and leaves the rows above it', () => {
    const layout = lay(
      paragraph('lead') + grid(['', '', breakBefore]) + paragraph('tail') + sect()
    );
    expect(pageTexts(layout)).toEqual(['lead a1 b1', 'a2 b2 tail']);
    const [first, second] = layout.pages.map((page) =>
      page.fragments.find((f) => f.kind === 'table')!
    );
    expect(first!.id.endsWith('#f0')).toBe(true);
    expect(second!.id.endsWith('#f1')).toBe(true);
    expect(second!.box.y).toBe(0);
  });

  test('follows the property, not a manual break beside it', () => {
    const layout = lay(paragraph('lead') + grid([breakBefore], [manualBreak]) + sect());
    expect(pageTexts(layout)).toEqual(['lead', 'a1 b1 a2 b2']);
  });

  test('resolves the property through the paragraph style chain', () => {
    const styled = '<w:pStyle w:val="Break"/>';
    expect(pageTexts(lay(paragraph('lead') + grid([styled]) + sect()))).toEqual([
      'lead',
      'a1 b1 a2 b2',
    ]);
    // An explicit off value on the paragraph wins over the style.
    const off = `${styled}<w:pageBreakBefore w:val="0"/>`;
    expect(pageTexts(lay(paragraph('lead') + grid([off]) + sect()))).toEqual(['lead a1 b1 a2 b2']);
  });

  test('adds no blank page when the table already starts the page', () => {
    expect(pageTexts(lay(grid([breakBefore]) + paragraph('tail') + sect()))).toEqual([
      'a1 b1 a2 b2 tail',
    ]);
  });

  test('adds no blank page when the row already starts the page after a break', () => {
    const layout = lay(
      paragraph('lead') +
        table(row(cell(paragraph('a1', breakBefore)) + cell(paragraph('b1')))) +
        sect()
    );
    expect(pageTexts(layout)).toEqual(['lead', 'a1 b1']);
    // Consecutive rows that both ask for a new page each take one.
    const both = lay(paragraph('lead') + grid([breakBefore, '', breakBefore]) + sect());
    expect(pageTexts(both)).toEqual(['lead', 'a1 b1', 'a2 b2']);
  });

  test('skips the remaining columns of a multi-column page', () => {
    const layout = lay(
      paragraph('lead') + grid([breakBefore]) + sect('<w:cols w:num="2" w:space="0"/>')
    );
    expect(pageTexts(layout)).toEqual(['lead', 'a1 b1 a2 b2']);
    const later = lay(
      paragraph('lead') + grid(['', '', breakBefore]) + sect('<w:cols w:num="2" w:space="0"/>')
    );
    expect(pageTexts(later)).toEqual(['lead a1 b1', 'a2 b2']);
  });

  test('repeats the header rows above a moved row', () => {
    const layout = lay(
      paragraph('lead') +
        table(
          row(cell(paragraph('h1')) + cell(paragraph('h2')), '<w:tblHeader/>') +
            row(cell(paragraph('a2', breakBefore)) + cell(paragraph('b2')))
        ) +
        sect()
    );
    expect(pageTexts(layout)).toEqual(['lead h1 h2', 'h1 h2 a2 b2']);
    const repeated = layout.pages[1]!.fragments.find((f) => f.kind === 'table');
    expect(repeated?.kind === 'table' && repeated.rows[0]!.isHeaderRepeat).toBe(true);
  });
});

describe('the page break before property elsewhere in a table', () => {
  test('does nothing in the second cell of a row', () => {
    expect(pageTexts(lay(paragraph('lead') + grid(['', breakBefore]) + sect()))).toEqual([
      'lead a1 b1 a2 b2',
    ]);
  });

  test('does nothing on a later paragraph of the first cell', () => {
    const layout = lay(
      paragraph('lead') +
        table(
          row(cell(paragraph('a0') + paragraph('a1', breakBefore)) + cell(paragraph('b1'))) +
            row(cell(paragraph('a2')) + cell(paragraph('b2')))
        ) +
        sect()
    );
    expect(pageTexts(layout)).toEqual(['lead a0 a1 b1 a2 b2']);
  });

  test('does nothing in a nested table', () => {
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="3400" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3400"/></w:tblGrid>' +
      `<w:tr><w:tc>${paragraph('inner lead')}${grid([breakBefore])}<w:p/></w:tc></w:tr></w:tbl>`;
    expect(pageTexts(lay(paragraph('lead') + outer + sect()))).toEqual([
      'lead inner lead a1 b1 a2 b2',
    ]);
  });

  test('keeps a manual page break in a cell inert', () => {
    expect(pageTexts(lay(paragraph('lead') + grid([], [manualBreak]) + sect()))).toEqual([
      'lead a1 b1 a2 b2',
    ]);
  });
});

describe('retained layout of a row page break before', () => {
  const warmThenCold = (before: string, after: string) => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(before), 1, options({ session }));
    const next = load(after);
    return {
      warm: layoutSemanticDocument(next, 2, options({ session })),
      cold: layoutSemanticDocument(next, 2, options()),
    };
  };

  test('matches a cold layout when the property is added and removed', () => {
    const plain = paragraph('lead') + grid() + paragraph('tail') + sect();
    const breaking = paragraph('lead') + grid(['', '', breakBefore]) + paragraph('tail') + sect();
    const added = warmThenCold(plain, breaking);
    expect(added.warm.pages).toEqual(added.cold.pages);
    expect(pageTexts(added.warm)).toEqual(['lead a1 b1', 'a2 b2 tail']);
    const removed = warmThenCold(breaking, plain);
    expect(removed.warm.pages).toEqual(removed.cold.pages);
    expect(pageTexts(removed.warm)).toEqual(['lead a1 b1 a2 b2 tail']);
  });
});

test('table style paragraph properties can start each row on a new page', () => {
  const tableStyle = buildStyleCascadeTable(
    read(
      `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="RowBreak">` +
        '<w:pPr><w:pageBreakBefore/></w:pPr></w:style></w:styles>',
      '/word/styles.xml'
    ).root
  );
  const body =
    paragraph('lead') +
    grid().replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="RowBreak"/>') +
    sect();
  const layout = layoutSemanticDocument(load(body), 1, options({ styleCascade: tableStyle }));
  expect(pageTexts(layout)).toEqual(['lead', 'a1 b1', 'a2 b2']);
});
