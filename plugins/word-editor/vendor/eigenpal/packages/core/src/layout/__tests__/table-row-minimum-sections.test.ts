// The minimum height fit of a table row (`table-row-minimum-fit.ts`) in continuous sections and
// positioned tables, and after an incremental relayout.
//
// The page is 400pt square with 50pt margins: a 300pt body. The row has one cell of nine exact
// 14pt lines (126pt) in four paragraphs, and no cell margins.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { read, W } from './table-row-keep-fixtures.ts';

const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      '<w:name w:val="Normal"/></w:style></w:styles>',
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(6, 14);
const options = { measurer, styleCascade, compatibilityMode: 15 };

const para = (label: string, height = 14, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" ` +
  `w:line="${height * 20}" w:lineRule="exact"/></w:pPr><w:r><w:t>${label}-1</w:t></w:r></w:p>`;

const cellPara = (label: string, lines: number) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="280" ' +
  'w:lineRule="exact"/></w:pPr><w:r>' +
  Array.from({ length: lines }, (_, n) => `${n ? '<w:br/>' : ''}<w:t>${label}-${n + 1}</w:t>`).join(
    ''
  ) +
  '</w:r></w:p>';

const table = (label: string, minimum: number, tblpPr = '') =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="5000"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:trPr>' +
  `<w:trHeight w:val="${minimum * 20}" w:hRule="atLeast"/></w:trPr>` +
  '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5000"/></w:tcPr>' +
  [3, 2, 3, 1].map((lines, n) => cellPara(`${label}${n}`, lines)).join('') +
  '</w:tc></w:tr></w:tbl>';

const sectPr = (type = '') =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="8000" w:h="8000"/>` +
  '<w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000" w:header="0" ' +
  'w:footer="0" w:gutter="0"/></w:sectPr>';

const load = (body: string) =>
  read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml');

/** Every line as `text@page:y`, and every table fragment as `T@page:y`. */
function shape(layout: SemanticLayout): string[] {
  const out: string[] = [];
  const visit = (block: unknown, page: number): void => {
    const b = block as {
      kind: string;
      box: { y: number };
      lines?: { box: { y: number }; spans: { text: string }[] }[];
      rows?: { cells: { blocks: unknown[] }[] }[];
    };
    if (b.kind === 'paragraph') {
      for (const line of b.lines ?? [])
        out.push(`${line.spans.map((span) => span.text).join('')}@${page}:${line.box.y}`);
      return;
    }
    out.push(`T@${page}:${b.box.y}`);
    for (const row of b.rows ?? [])
      for (const cell of row.cells) for (const inner of cell.blocks) visit(inner, page);
  };
  layout.pages.forEach((page, index) => {
    for (const fragment of page.fragments) visit(fragment, index + 1);
  });
  return out;
}

const pageOf = (lines: readonly string[], marker: string) =>
  Number(
    lines
      .find((line) => line.startsWith(marker))
      ?.split('@')[1]
      ?.split(':')[0]
  );

describe('a continuous one-column section that starts below the page top', () => {
  // Section 1 is a 100pt line. Section 2 starts below it: 150pt fits page 1, the 100pt line
  // opens page 2, and a 20pt line leaves 180pt for the row.
  const document = (label: string, minimum: number, caption = '') =>
    para('S', 100, sectPr()) +
    para('F', 150) +
    para('G', 100) +
    para('P', 20, caption) +
    table(label, minimum) +
    para('TAIL') +
    sectPr('continuous');

  for (const minimum of [190, 230, 250]) {
    test(`an incremental relayout places a ${minimum}pt minimum as a new layout does`, () => {
      const session = createLayoutSession();
      const cache = createParagraphLayoutCache();
      const warmOptions = { ...options, session, cache };
      layoutSemanticDocument(load(document('C', minimum)), 1, warmOptions);
      const edited = load(document('D', minimum));
      const warm = shape(layoutSemanticDocument(edited, 2, warmOptions));
      const cold = shape(layoutSemanticDocument(edited, 2, options));
      expect(warm).toEqual(cold);
      expect(pageOf(cold, 'D0-1')).toBe(3);
    });
  }

  test('a row whose minimum does not fit on the first page moves with or without a caption', () => {
    // Section 2 starts at 100pt: a 30pt line leaves 170pt for a 250pt minimum. A new page
    // offers the full 300pt.
    const body = (caption: string) =>
      para('S', 100, sectPr()) +
      para('P', 30, caption) +
      table('C', 250) +
      para('TAIL') +
      sectPr('continuous');
    const plain = shape(layoutSemanticDocument(load(body('')), 1, options));
    const kept = shape(layoutSemanticDocument(load(body('<w:keepNext/>')), 1, options));
    expect([pageOf(plain, 'P-1'), pageOf(plain, 'C0-1')]).toEqual([1, 2]);
    expect([pageOf(kept, 'P-1'), pageOf(kept, 'C0-1')]).toEqual([2, 2]);
  });
});

describe('positioned tables', () => {
  test('a text-anchored positioned table keeps its placement', () => {
    const tblpPr =
      '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="400" w:tblpX="0"/>';
    const lines = shape(
      layoutSemanticDocument(load(table('C', 290, tblpPr) + para('TAIL') + sectPr()), 1, options)
    );
    expect(pageOf(lines, 'C0-1')).toBe(1);
  });
});
