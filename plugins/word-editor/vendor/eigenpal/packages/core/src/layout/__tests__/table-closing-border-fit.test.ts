import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

/** Three one-line rows with 0.5pt rules on every edge and no cell margins. */
function table(lastRowLines = 1) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblBorders>${edges.map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`).join('')}</w:tblBorders>
    <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>
    ${['One', 'Two', 'Three'].map((text, index) => `<w:tr><w:tc>${index === 2 ? Array.from({ length: lastRowLines }, (_, line) => paragraph(`${text}${line}`)).join('') : paragraph(text)}</w:tc></w:tr>`).join('')}
    </w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function firstPageRows(height: number, lastRowLines = 1): string[] {
  const result = layoutSemanticDocument(table(lastRowLines), 0, {
    measurer: createFixedMeasurer(5, 12),
    session: createLayoutSession(),
    geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  return result.pages[0]!.fragments.flatMap((fragment) =>
    fragment.kind === 'table'
      ? fragment.rows.flatMap((row) =>
          row.cells.flatMap((cell) =>
            cell.blocks.flatMap((block) =>
              block.kind === 'paragraph'
                ? block.lines.map((line) => line.spans.map((span) => span.text).join(''))
                : []
            )
          )
        )
      : []
  );
}

// Each row is a 0.5pt rule above a 12pt line; the page's last row also needs its own
// 0.5pt rule below it.
test('a row that ends the page needs room for its closing border', () => {
  expect(firstPageRows(25.2)).toEqual(['One']);
  expect(firstPageRows(25.5)).toEqual(['One', 'Two']);
});

test('a row followed on the page by another row keeps its place', () => {
  expect(firstPageRows(38)).toEqual(['One', 'Two', 'Three0']);
  // A two-line row that may split opens on the page, so the row above does not end it.
  expect(firstPageRows(38, 2)).toEqual(['One', 'Two', 'Three0']);
});

test('a row stays when the next row opens below it, though a thick bottom rule would not fit', () => {
  // The page-ending rule is the table's thick bottom edge; rows on one page share a thin
  // inside rule. A splittable next row whose first line fits keeps the row above.
  const borders =
    '<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>' +
    '<w:right w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>' +
    '<w:insideH w:val="single" w:sz="4"/><w:bottom w:val="double" w:sz="96"/>';
  const row = (content: string) => `<w:tr><w:tc>${content}</w:tc></w:tr>`;
  const margins = ['top', 'bottom', 'left', 'right']
    .map((side) => `<w:${side} w:w="0" w:type="dxa"/>`)
    .join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders>` +
      `<w:tblCellMar>${margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
      row(paragraph('One')) +
      row(paragraph('Two')) +
      row(paragraph('Three') + paragraph('More')) +
      row(paragraph('Four')) +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const rowsOnFirstPage = (height: number) =>
    layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(5, 12),
      session: createLayoutSession(),
      geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    }).pages[0]!.fragments.flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
      .length;
  // 12pt below `Two`: the next row cannot open, so `Two` ends the page and its thick rule
  // does not fit.
  expect(rowsOnFirstPage(37)).toBe(1);
  // 13pt: `Three` opens with its first line, so `Two` stays.
  expect(rowsOnFirstPage(38)).toBe(3);
});

test('a row splits only where its minimum and the rule at the cut fit', () => {
  // Two 30pt-minimum rows with 0.5pt rules. The second holds three lines, so it must split. Its
  // first part needs the minimum plus the rule above it and the inside rule closing the cut.
  const row = (lines: readonly string[]) =>
    `<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc>${lines.map(paragraph).join('')}</w:tc></w:tr>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
      `<w:tblBorders>${edges.map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`).join('')}</w:tblBorders>` +
      `<w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
      row(['One']) +
      row(['Two', 'More', 'Last']) +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const rowsOnFirstPage = (height: number) =>
    layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(5, 12),
      geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    }).pages[0]!.fragments.flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
      .length;
  // The first row ends at 30.5pt. 30.9pt below it cannot hold 30 + 0.5 + 0.5: the row moves.
  expect(rowsOnFirstPage(61.4)).toBe(1);
  // 31.1pt holds them: the row starts and splits.
  expect(rowsOnFirstPage(61.6)).toBe(2);
});

/** Lines per page of a ruled table: one row of `count` one-line paragraphs, then a short row. */
function linesPerPage(count: number, height: number): number[] {
  const lines = Array.from({ length: count }, (_, index) => paragraph(`Line${index}`)).join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
      `<w:tblBorders>${edges.map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`).join('')}</w:tblBorders>` +
      `<w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
      `<w:tr><w:tc>${lines}</w:tc></w:tr><w:tr><w:tc>${paragraph('After')}</w:tc></w:tr>` +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, {
    measurer: createFixedMeasurer(5, 12),
    geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  return layout.pages.map(
    (page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'table'
          ? fragment.rows.flatMap((row) =>
              row.cells.flatMap((cell) =>
                cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
              )
            )
          : []
      ).length
  );
}

test('every part of a row that spans pages keeps room for the rule at its cut', () => {
  // A 60.75pt page holds the 0.5pt top rule and five 12pt lines, but not with the 0.5pt rule
  // that closes a cut below them. So the first and the middle parts each hold four lines.
  expect(linesPerPage(14, 60.75).slice(0, 3)).toEqual([4, 4, 4]);
  // A final part of five lines would also end the page, since the short row cannot open below
  // it, and its closing rule would not fit: its last line moves on with the short row.
  expect(linesPerPage(17, 60.75)).toEqual([4, 4, 4, 4, 2]);
});

test('a minimum-height row that ends the page needs room for its closing rule', () => {
  const row = (text: string) =>
    `<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc>${paragraph(text)}</w:tc></w:tr>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
      `<w:tblBorders>${edges.map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`).join('')}</w:tblBorders>` +
      `<w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
      row('One') +
      row('Two') +
      row('Three') +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const rowsOnFirstPage = (height: number) =>
    layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(5, 12),
      geometry: { width: 150, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    }).pages[0]!.fragments.flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
      .length;
  // `Two` fills 30.5pt from 30.5pt; `Three` cannot open below it, so `Two` ends the page and its
  // 30pt minimum needs both rules: 31pt. With 30.7pt left it moves, with 31.1pt it stays.
  expect(rowsOnFirstPage(61.2)).toBe(1);
  expect(rowsOnFirstPage(61.6)).toBe(2);
});
