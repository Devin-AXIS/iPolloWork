import { afterEach, beforeEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { movedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import { movedRowComparisonTestRecorder, sameRowHeights } from '../table-width-update.ts';
import type {
  LineRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// A width change moves most rows without placing them again (table-row-geometry-reuse.ts).
// The width lane then compares such a row with the old one through the move's own blocks
// instead of walking every block and line. These tests run the full walk beside it.

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string, pPr = '') =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  `<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>${pPr}</w:pPr>` +
  (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p>';
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
const borders = (edges: Record<string, string>) =>
  '<w:tblBorders>' +
  Object.entries(edges)
    .map(([edge, value]) => `<w:${edge} ${value}/>`)
    .join('') +
  '</w:tblBorders>';
const THIN = borders(
  Object.fromEntries(
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((edge) => [
      edge,
      'w:val="single" w:sz="4"',
    ])
  )
);
// Compound outer rules, a thick inside rule and a dashed inside rule: every stroke kind.
const MIXED = borders({
  top: 'w:val="double" w:sz="12"',
  left: 'w:val="single" w:sz="4"',
  bottom: 'w:val="thinThickSmallGap" w:sz="48"',
  right: 'w:val="triple" w:sz="6"',
  insideH: 'w:val="single" w:sz="24"',
  insideV: 'w:val="dashed" w:sz="8"',
});
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[], tblBorders = THIN) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${tblBorders}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const tableRows = (layout: SemanticLayout): TableRowFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((fragment) => fragment.rows);

let comparisons = movedRowComparisonTestRecorder();
let moves = movedRowsTestRecorder();
beforeEach(() => {
  comparisons = movedRowComparisonTestRecorder();
  moves = movedRowsTestRecorder();
});
afterEach(() => {
  comparisons.dispose();
  moves.dispose();
});

/**
 * Type `text` into `paragraphId` through a retained session. Every layout must equal a cold
 * layout of the reparsed part, and every moved-row comparison must decide like the full walk.
 */
function typeBurst(start: OoxmlPart, paragraphId: string, text: string, offset = 0): void {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let part = start;
  lay(part, 15, { session, cache });
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: offset + index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    expect(lay(part, 15, { session, cache }).pages).toEqual(lay(reparsed(part)).pages);
  }
  expect(comparisons.disagreements).toBe(0);
}

test('thin rules: moved rows compare through the move and decide like the full walk', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => body(i))));
  typeBurst(part, paragraphAt(part, 13, 1), 'wider ');
  expect(moves.moved).toBeGreaterThan(0);
  expect(comparisons.accepted).toBeGreaterThan(0);
  expect(comparisons.movedCells).toBeGreaterThan(comparisons.accepted);
});

test('compound, thick and dashed rules with each page keeping its own bottom edge', () => {
  const part = load(
    autofit(
      Array.from({ length: 30 }, (_, i) => body(i)),
      MIXED
    )
  );
  // A page's last row publishes its own bottom rule. A row whose rule does not fit moves to
  // the next page, so every moved row compares like the full walk (`typeBurst` checks it).
  typeBurst(part, paragraphAt(part, 16, 0), 'bottom ');
  expect(comparisons.accepted).toBeGreaterThan(0);
  expect(comparisons.refused).toBe(0);
});

test('mixed cell rules override the table rules on some rows', () => {
  const cellRules =
    '<w:tcBorders><w:top w:val="double" w:sz="4"/><w:bottom w:val="thickThinMediumGap" w:sz="36"/>' +
    '</w:tcBorders>';
  const rows = Array.from({ length: 30 }, (_, i) =>
    i % 4 === 1 ? tr([tc(p(`m${i}a`), cellRules), tc(p(`m${i}b`)), tc(p(`m${i}c`))]) : body(i)
  );
  const part = load(autofit(rows, MIXED));
  typeBurst(part, paragraphAt(part, 12, 2), 'mixed ');
  expect(comparisons.accepted).toBeGreaterThan(0);
});

test('repeated header rows', () => {
  const header = tr([tc(p('Head A')), tc(p('Head B')), tc(p('Head C'))], '<w:tblHeader/>');
  const part = load(autofit([header, ...Array.from({ length: 40 }, (_, i) => body(i))], MIXED));
  typeBurst(part, paragraphAt(part, 20, 2), 'header ');
  expect(comparisons.accepted).toBeGreaterThan(0);
});

test('centered, right, justified and empty hidden-mark cells', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([
      tc(p(`c${i} mid`, '<w:jc w:val="center"/>')),
      tc(p(`r${i} end`, '<w:jc w:val="right"/>')),
      i % 3 === 0 ? tc(p(''), '<w:hideMark/>') : tc(p(`j${i} both sides`, '<w:jc w:val="both"/>')),
    ])
  );
  const part = load(autofit(rows));
  typeBurst(part, paragraphAt(part, 10, 1), 'aligned ');
  expect(comparisons.accepted).toBeGreaterThan(0);
});

test('a rewrapping width change refuses exactly as before', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 4
      ? tr([tc(p('alpha beta gamma delta')), tc(p('x')), tc(p('y'))])
      : tr([tc(p(`r${i}`)), tc(p(`s${i}`)), tc(p(`t${i}`))])
  );
  const part = load(autofit(rows));
  typeBurst(part, paragraphAt(part, 10, 2), 'Supercalifragilistic', 2);
});

// The construction `moveRowToWidths` gives a moved record: every field copied, one block of
// one line per cell, with only x and width new.
function moveRecord(row: TableRowFragmentRecord, dx: number): TableRowFragmentRecord {
  const cells = row.cells.map((cell): TableCellFragmentRecord => {
    const block = cell.blocks[0] as ParagraphFragmentRecord;
    const line: LineRecord = {
      ...block.lines[0]!,
      box: { ...block.lines[0]!.box, x: block.lines[0]!.box.x + dx },
    };
    const moved: ParagraphFragmentRecord = {
      ...block,
      lines: [line],
      box: { ...block.box, x: block.box.x + dx },
    };
    return { ...cell, blocks: [moved], box: { ...cell.box, x: cell.box.x + dx } };
  });
  return { ...row, cells, box: { ...row.box, x: row.box.x + dx } };
}

/** A finalized row as the width lane sees it: new cell objects, the move's blocks kept. */
const finalized = (
  moved: TableRowFragmentRecord,
  cell: (cell: TableCellFragmentRecord, index: number) => TableCellFragmentRecord = (c) => ({
    ...c,
  })
): TableRowFragmentRecord => ({ ...moved, cells: moved.cells.map(cell) });

const withBlock = (
  row: TableRowFragmentRecord,
  change: (block: ParagraphFragmentRecord) => ParagraphFragmentRecord
): TableRowFragmentRecord => ({
  ...row,
  cells: row.cells.map((cell, index) =>
    index === 1 ? { ...cell, blocks: [change(cell.blocks[0] as ParagraphFragmentRecord)] } : cell
  ),
});
const withLine = (
  row: TableRowFragmentRecord,
  change: (line: LineRecord) => LineRecord
): TableRowFragmentRecord =>
  withBlock(row, (block) => ({ ...block, lines: [change(block.lines[0]!)] }));

test('the shorter comparison decides like the full walk on every construction case', () => {
  comparisons.dispose();
  const part = load(
    autofit(
      Array.from({ length: 6 }, (_, i) => body(i)),
      MIXED
    )
  );
  const rows = tableRows(lay(part));
  expect(rows.length).toBe(6);
  const strokes = rows[2]!.cells[1]!.borders?.strokes ?? [];
  expect(strokes.some((stroke) => stroke.side === 'bottom')).toBe(true);
  const nan = Number.NaN;
  const cases: [string, TableRowFragmentRecord, boolean][] = [
    ['unchanged', rows[2]!, true],
    ['terminal row', rows[5]!, true],
    ['first row', rows[0]!, true],
    ['NaN block top', withBlock(rows[2]!, (b) => ({ ...b, box: { ...b.box, y: nan } })), false],
    [
      'NaN spacing',
      withBlock(rows[2]!, (b) => ({ ...b, spacing: { ...b.spacing, after: nan } })),
      false,
    ],
    ['NaN fragment index', withBlock(rows[2]!, (b) => ({ ...b, fragmentIndex: nan })), false],
    ['NaN line top', withLine(rows[2]!, (l) => ({ ...l, box: { ...l.box, y: nan } })), false],
    ['NaN baseline', withLine(rows[2]!, (l) => ({ ...l, baseline: nan })), false],
    ['NaN leading', withLine(rows[2]!, (l) => ({ ...l, leading: nan })), false],
    ['NaN trailing spacing', withLine(rows[2]!, (l) => ({ ...l, trailingSpacing: nan })), false],
    ['drawing', withLine(rows[2]!, (l) => ({ ...l, drawings: [{} as never] })), false],
    ['empty drawings', withLine(rows[2]!, (l) => ({ ...l, drawings: [] })), true],
    [
      'second line',
      withBlock(rows[2]!, (b) => ({ ...b, lines: [b.lines[0]!, b.lines[0]!] })),
      false,
    ],
  ];
  for (const [name, old, expected] of cases) {
    const moved = moveRecord(old, 3);
    const candidate = finalized(moved);
    expect([name, sameRowHeights(old, candidate)]).toEqual([name, expected]);
    expect([name, sameRowHeights(old, candidate, moved)]).toEqual([name, expected]);
  }

  // Finalize facts outside the blocks still refuse through the shorter comparison.
  const old = rows[2]!;
  const moved = moveRecord(old, 3);
  const refusals: [string, TableRowFragmentRecord][] = [
    [
      'bottom rule moved',
      finalized(moved, (cell) => ({
        ...cell,
        borders: {
          ...cell.borders,
          strokes: cell.borders?.strokes?.map((stroke) =>
            stroke.side === 'bottom' ? { ...stroke, y: stroke.y + 1 } : stroke
          ),
        },
      })),
    ],
    [
      'bottom rule dropped',
      finalized(moved, (cell) => ({
        ...cell,
        borders: {
          ...cell.borders,
          strokes: cell.borders?.strokes?.filter((stroke) => stroke.side !== 'bottom'),
        },
      })),
    ],
    ['cell taller', finalized(moved, (cell) => ({ ...cell, box: { ...cell.box, height: 99 } }))],
    ['merged', finalized(moved, (cell, index) => (index === 0 ? { ...cell, rowSpan: 2 } : cell))],
    ['inert', finalized(moved, (cell) => ({ ...cell, paintInert: true }))],
    ['continuation', { ...finalized(moved), hasContinuation: true }],
    ['row index', { ...finalized(moved), rowIndex: old.rowIndex + 1 }],
    // A vAlign shift gives the cell new blocks: the full walk sees the new top.
    [
      'content shifted',
      finalized(moved, (cell) => {
        const block = cell.blocks[0] as ParagraphFragmentRecord;
        return { ...cell, blocks: [{ ...block, box: { ...block.box, y: block.box.y + 2 } }] };
      }),
    ],
  ];
  for (const [name, candidate] of refusals) {
    expect([name, sameRowHeights(old, candidate)]).toEqual([name, false]);
    expect([name, sameRowHeights(old, candidate, moved)]).toEqual([name, false]);
  }

  // Side rules never decide: dropping one is accepted by both comparisons.
  const sideless = finalized(moved, (cell) => ({
    ...cell,
    borders: {
      ...cell.borders,
      strokes: cell.borders?.strokes?.filter((stroke) => stroke.side !== 'left'),
    },
  }));
  expect(sameRowHeights(old, sideless)).toBe(true);
  expect(sameRowHeights(old, sideless, moved)).toBe(true);
});
