// A two-row vertical merge (17.4.85 `w:vMerge`) whose page break falls right after its head
// row. From mode 15 on, when the merged text cannot place a line inside the head row's own
// height, the head row keeps its own cells on the first page and the whole merged text starts
// beside the continuation row on the next page. The text stays the head cell's text: every
// reader of the layout finds it under the head cell and the head row. See
// `table-vmerge-boundary.ts`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  cellAddressAt,
  cellSelectionBetween,
  cellSelectionText,
  paragraphsInCells,
  tableAnchorAt,
  tableContextAt,
} from '../semantic-cell-selection.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import {
  findTableInteractionAt,
  pageContentToSheet,
  tableInteractionIndex,
} from '../semantic-table-interaction.ts';
import { planTableCommand } from '../../editor/table-command-plan.ts';
import { collectPageChangeBars } from '../../output/semantic-paint-change-bars.ts';
import type {
  BlockFragmentRecord,
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A 210pt content box. Every line is exactly 12pt, and a cell paragraph adds 6pt before it.
const GEOMETRY: PageGeometry = {
  width: 350,
  height: 250,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
};
const LINE = 12;
const BEFORE = 6;
/** `w:trHeight` 560 twips, `atLeast`. */
const ROW_MIN = 28;

interface Shape {
  /** Body lines above the table: the head row starts at `fill * LINE`. */
  readonly fill: number;
  /** Lines of merged text, in one paragraph broken by `w:br`. */
  readonly merged: number;
  readonly mode?: number;
  /** A third row the merges also cover. */
  readonly threeRows?: boolean;
  readonly cantSplit?: boolean;
  /** One-line paragraphs of the continuation row's own text. */
  readonly nextParagraphs?: number;
  /** Extra `w:pPr` content for the merged paragraph. */
  readonly mergedPPr?: string;
  /** A repeated header row above the head row. */
  readonly header?: boolean;
  /** Extra `w:tcPr` content for the merged head cell, and for its continuation. */
  readonly headTcPr?: string;
  readonly continuationTcPr?: string;
  /** Extra `w:trPr` content for the head row. */
  readonly headTrPr?: string;
}

const spacing = (before: number) =>
  `<w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="exact"/>`;
const paragraph = (lines: readonly string[], before = 120, pPr = '') =>
  `<w:p><w:pPr>${spacing(before)}${pPr}</w:pPr>` +
  lines
    .map((text, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t>${text}</w:t></w:r>`)
    .join('') +
  '</w:p>';
const cell = (width: number, content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

function document(shape: Shape): string {
  const trPr = `<w:trPr>${shape.cantSplit ? '<w:cantSplit/>' : ''}<w:trHeight w:val="560"/></w:trPr>`;
  const merged = Array.from({ length: shape.merged }, (_, index) => `M${index + 1}`);
  const own = (label: string, count = 1) =>
    Array.from({ length: count }, (_, index) => paragraph([index ? `${label}x${index}` : label]));
  const continued = (label: string, count = 1) =>
    `<w:tr>${trPr}${cell(1300, paragraph([]), CONTINUE)}${cell(1500, own(label, count).join(''))}` +
    `${cell(3000, paragraph([]), CONTINUE + (shape.continuationTcPr ?? ''))}</w:tr>`;
  const header = shape.header
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(1300, paragraph(['HEADER']))}` +
      `${cell(4500, paragraph(['HEADERB']), '<w:gridSpan w:val="2"/>')}</w:tr>`
    : '';
  const rows =
    header +
    `<w:tr>${shape.headTrPr ? trPr.replace('<w:trPr>', `<w:trPr>${shape.headTrPr}`) : trPr}` +
    `${cell(1300, paragraph(['HEADA']), RESTART)}${cell(1500, paragraph(['ROWA']))}` +
    `${cell(3000, paragraph(merged, 120, shape.mergedPPr), RESTART + (shape.headTcPr ?? ''))}</w:tr>` +
    continued('ROWB', shape.nextParagraphs) +
    (shape.threeRows ? continued('ROWC') : '') +
    `<w:tr>${cell(1300, paragraph(['NEXT']))}${cell(4500, paragraph(['AFTER']), '<w:gridSpan w:val="2"/>')}</w:tr>`;
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1300"/><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows}</w:tbl>`;
  const fill = Array.from({ length: shape.fill }, (_, index) => paragraph([`F${index + 1}`], 0));
  return `${fill.join('')}${table}${paragraph(['TAIL'], 0)}`;
}

function load(body: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (shape: Shape): SemanticLayout =>
  layoutSemanticDocument(load(document(shape)), 1, {
    measurer,
    geometry: GEOMETRY,
    compatibilityMode: shape.mode ?? 15,
  });

const tablesOn = (layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] =>
  (layout.pages[pageIndex]?.fragments ?? []).filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
const linesOf = (blocks: readonly BlockFragmentRecord[]) =>
  blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
/** A line's text; a `w:br` line ends in a newline span. */
const lineText = (line: ReturnType<typeof linesOf>[number]): string =>
  line.spans
    .map((span) => span.text)
    .join('')
    .trim();
const cellText = (cell: TableCellFragmentRecord): string[] => linesOf(cell.blocks).map(lineText);
const words = (blocks: readonly BlockFragmentRecord[]): string[] =>
  blocks.flatMap((block) =>
    block.kind === 'paragraph'
      ? block.lines.map(lineText)
      : block.rows.flatMap((row) => row.cells.flatMap((placed) => words(placed.blocks)))
  );
const pageWords = (layout: SemanticLayout): string[][] =>
  layout.pages.map((page) => words(page.fragments).filter((word) => word !== ''));
/** Page index of every merged line, in order. */
const mergedPages = (layout: SemanticLayout): number[] =>
  pageWords(layout).flatMap((page, index) =>
    page.filter((word) => /^M\d+$/.test(word)).map(() => index)
  );

function expectEveryWordOnce(layout: SemanticLayout, shape: Shape): void {
  const painted = pageWords(layout).flat();
  const expected = [
    ...Array.from({ length: shape.fill }, (_, index) => `F${index + 1}`),
    'HEADA',
    'ROWA',
    ...Array.from({ length: shape.merged }, (_, index) => `M${index + 1}`),
    'ROWB',
    ...Array.from({ length: (shape.nextParagraphs ?? 1) - 1 }, (_, index) => `ROWBx${index + 1}`),
    ...(shape.threeRows ? ['ROWC'] : []),
    'NEXT',
    'AFTER',
    'TAIL',
  ];
  for (const word of expected) expect(painted.filter((seen) => seen === word)).toEqual([word]);
  const known = new Set([...expected, 'HEADER', 'HEADERB']);
  expect(painted.filter((word) => !known.has(word))).toEqual([]);
}

/** Element children of an OOXML node with this local name. */
const childrenNamed = (node: OoxmlElement, name: string): OoxmlElement[] =>
  node.children.filter(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === name
  );

describe('mode 15: the merged text moves whole past a break after its head row', () => {
  test('the head row keeps its own height and the text starts beside the continuation row', () => {
    const shape: Shape = { fill: 14, merged: 5 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);

    const [first] = tablesOn(layout, 0);
    expect(first!.rows).toHaveLength(1);
    const head = first!.rows[0]!;
    expect(head.box.y).toBeCloseTo(shape.fill * LINE, 3);
    expect(head.box.height).toBeCloseTo(ROW_MIN, 3);
    expect(head.cells.map(cellText)).toEqual([['HEADA'], ['ROWA'], []]);

    const [second] = tablesOn(layout, 1);
    // The head row continues at zero height, and its merged cell spans the continuation row.
    const [headRest, continuation, after] = second!.rows;
    expect(headRest!.id).toBe(head.id);
    expect(headRest!.isContinuation).toBe(true);
    expect(headRest!.box.height).toBeCloseTo(0, 3);
    expect(continuation!.box.y).toBeCloseTo(0, 3);
    // The merged text keeps its space before, and the continuation row grows to hold it.
    expect(continuation!.box.height).toBeCloseTo(BEFORE + 5 * LINE, 3);
    const merged = headRest!.cells[2]!;
    expect(cellText(merged)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(merged.rowSpan).toBe(2);
    expect(merged.box.height).toBeCloseTo(BEFORE + 5 * LINE, 3);
    expect(linesOf(merged.blocks)[0]!.box.y).toBeCloseTo(BEFORE, 3);
    expect(cellText(continuation!.cells[1]!)).toEqual(['ROWB']);
    expect(continuation!.cells[2]!.paintInert).toBe(true);
    expect(after!.box.y).toBeCloseTo(BEFORE + 5 * LINE, 3);
  });

  test('a merged text that would fit the page when the head row grows still moves', () => {
    // 30pt of merged text in a 28pt head row with 42pt of page left: the head row does not grow.
    const shape: Shape = { fill: 14, merged: 2 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([1, 1]);
    expect(tablesOn(layout, 0)[0]!.rows[0]!.box.height).toBeCloseTo(ROW_MIN, 3);
    expect(tablesOn(layout, 1)[0]!.rows[1]!.box.height).toBeCloseTo(BEFORE + 2 * LINE, 3);
  });

  test('the head row stays on the page when only its own height fits there', () => {
    const shape: Shape = { fill: 15, merged: 5 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(pageWords(layout)[0]).toContain('HEADA');
    expect(pageWords(layout)[0]).toContain('ROWA');
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);
  });

  test('a w:cantSplit head row stays on the page at its own height', () => {
    const shape: Shape = { fill: 14, merged: 5, cantSplit: true };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(pageWords(layout)[0]).toContain('ROWA');
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);
    expect(tablesOn(layout, 1)[0]!.rows[1]!.box.height).toBeCloseTo(BEFORE + 5 * LINE, 3);
  });

  test('the carried text stays in the head cell of the head row', () => {
    const shape: Shape = { fill: 14, merged: 5 };
    const part = load(document(shape));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: GEOMETRY,
      compatibilityMode: 15,
    });
    const body = childrenNamed(part.root, 'body')[0]!;
    const [headRow, nextRow] = childrenNamed(childrenNamed(body, 'tbl')[0]!, 'tr');
    const headCell = childrenNamed(headRow!, 'tc')[2]!;
    const continuationCell = childrenNamed(nextRow!, 'tc')[2]!;
    const headParagraph = childrenNamed(headCell, 'p')[0]!;

    const placedHead = tablesOn(layout, 0)[0]!.rows[0]!.cells[2]!;
    expect(placedHead.id).toBe(headCell.id);
    expect(placedHead.blocks).toHaveLength(0);

    const [headRest, continuation] = tablesOn(layout, 1)[0]!.rows;
    expect(headRest!.id).toBe(headRow!.id);
    const carried = headRest!.cells[2]!;
    expect(carried.id).toBe(headCell.id);
    expect(carried.vMergeContinue).toBe(false);
    expect(carried.paintInert).not.toBe(true);
    const paragraphIds = new Set(linesOf(carried.blocks).map((line) => line.range.paragraphId));
    expect([...paragraphIds]).toEqual([headParagraph.id]);

    expect(continuation!.id).toBe(nextRow!.id);
    const inert = continuation!.cells[2]!;
    expect(inert.id).toBe(continuationCell.id);
    expect(inert.vMergeContinue).toBe(true);
    expect(inert.blocks).toHaveLength(0);
  });

  test('an incremental relayout reaches the same pages as a cold layout', () => {
    const before: Shape = { fill: 7, merged: 5 };
    const after: Shape = { fill: 14, merged: 5 };
    const shapeOf = (layout: SemanticLayout) =>
      layout.pages.map((page) =>
        tablesOn(layout, page.index).map((table) =>
          table.rows.map((row) => [row.box.y, row.box.height, row.cells.map(cellText)])
        )
      );
    const options = {
      measurer,
      geometry: GEOMETRY,
      compatibilityMode: 15,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(document(before)), 1, options);
    const warm = layoutSemanticDocument(load(document(after)), 2, options);
    expect(shapeOf(warm)).toEqual(shapeOf(lay(after)));
    expect(mergedPages(warm)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('the carried merged text', () => {
  test('taller than a page splits across pages beside the continuation row', () => {
    // 6pt + 18 lines is 222pt, taller than the 210pt page; the widow rule leaves two lines.
    const shape: Shape = { fill: 14, merged: 18 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([...Array<number>(16).fill(1), 2, 2]);
    for (const pageIndex of [1, 2]) {
      const [headRest, continuation] = tablesOn(layout, pageIndex)[0]!.rows;
      expect(headRest!.isContinuation).toBe(true);
      expect(headRest!.cells[2]!.box.height).toBeCloseTo(continuation!.box.height, 3);
    }
  });

  test('below a repeated header row lays out on the next pages', () => {
    const shape: Shape = { fill: 13, merged: 16, header: true };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([...Array<number>(14).fill(1), 2, 2]);
    expect(pageWords(layout)[1]!.slice(0, 3)).toEqual(['HEADER', 'HEADERB', 'M1']);
  });

  test('an incremental relayout of the split text reaches the same pages as a cold layout', () => {
    const shapeOf = (layout: SemanticLayout) =>
      layout.pages.map((page) =>
        tablesOn(layout, page.index).map((table) =>
          table.rows.map((row) => [row.id, row.box.y, row.box.height, row.cells.map(cellText)])
        )
      );
    const options = {
      measurer,
      geometry: GEOMETRY,
      compatibilityMode: 15,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(document({ fill: 14, merged: 5 })), 1, options);
    const warm = layoutSemanticDocument(load(document({ fill: 14, merged: 18 })), 2, options);
    expect(shapeOf(warm)).toEqual(shapeOf(lay({ fill: 14, merged: 18 })));
  });

  test('keeps document order on the page it is painted on', () => {
    const layout = lay({ fill: 14, merged: 5, nextParagraphs: 2 });
    expect(pageWords(layout)[1]!.slice(0, 8)).toEqual([
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'ROWB',
      'ROWBx1',
      'NEXT',
    ]);
  });
});

describe('painting the carried merged text', () => {
  // Five one-line paragraphs make the continuation row 90pt; the carried text is 30pt.
  const [first, second] = ['<w:vAlign w:val="center"/>', '<w:vAlign w:val="bottom"/>'];

  test('aligns vertically by the cell it is painted beside', () => {
    const layout = lay({ fill: 14, merged: 2, nextParagraphs: 5, headTcPr: first });
    const [headRest, continuation] = tablesOn(layout, 1)[0]!.rows;
    expect(continuation!.box.height).toBeCloseTo(5 * (BEFORE + LINE), 3);
    expect(linesOf(headRest!.cells[2]!.blocks)[0]!.box.y).toBeCloseTo(BEFORE, 3);
  });

  test('takes the continuation cell alignment when it has one', () => {
    const layout = lay({
      fill: 14,
      merged: 2,
      nextParagraphs: 5,
      headTcPr: first,
      continuationTcPr: second,
    });
    const [headRest, continuation] = tablesOn(layout, 1)[0]!.rows;
    const lines = linesOf(headRest!.cells[2]!.blocks);
    expect(lines[lines.length - 1]!.box.y + LINE).toBeCloseTo(continuation!.box.height, 3);
  });

  test('a tracked head row marks the carried text with a change bar', () => {
    const insert = '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"/>';
    const layout = lay({ fill: 14, merged: 5, headTrPr: insert });
    const page = layout.pages[1]!;
    const bars = collectPageChangeBars(page, 1, 'all-markup');
    const [, continuation] = tablesOn(layout, 1)[0]!.rows;
    // Bars are in page coordinates; row boxes are in content coordinates.
    const top = page.contentBox.y - page.box.y;
    const bottom = top + continuation!.box.y + continuation!.box.height;
    expect(bars.runs.some((run) => run.top <= top + 0.001 && run.bottom >= bottom - 0.001)).toBe(
      true
    );
  });
});

describe('readers of the carried merged text find the head cell', () => {
  const shape: Shape = { fill: 14, merged: 5 };
  const part = load(document(shape));
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    compatibilityMode: 15,
  });
  const headRow: TableRowFragmentRecord = tablesOn(layout, 0)[0]!.rows[0]!;
  const headCell = headRow.cells[2]!;
  const mergedParagraph = linesOf(tablesOn(layout, 1)[0]!.rows[0]!.cells[2]!.blocks)[0]!.range
    .paragraphId;
  const table = tablesOn(layout, 0)[0]!;
  const address = (placed: TableCellFragmentRecord) => ({
    tableId: table.tableId,
    rowId: headRow.id,
    cellId: placed.id,
    rowIndex: 0,
    gridColumn: placed.gridColumn,
    gridSpan: placed.gridSpan,
  });

  test('table anchor, context and cell address name the head row and cell', () => {
    expect(tableAnchorAt(layout, mergedParagraph)).toMatchObject({
      rowId: headRow.id,
      cellId: headCell.id,
    });
    expect(tableContextAt(layout, mergedParagraph)?.rowIndex).toBe(0);
    expect(cellAddressAt(layout, mergedParagraph)).toMatchObject({
      rowId: headRow.id,
      cellId: headCell.id,
      rowIndex: 0,
    });
  });

  test('a row command with the caret in the merged text targets the head row', () => {
    const at = { paragraphId: mergedParagraph, offset: 0 };
    const plan = planTableCommand({
      command: { type: 'insertRow', where: 'above' },
      part,
      layout,
      storeRevision: layout.revision,
      selection: { anchor: at, head: at },
      cellSelection: null,
      themeColors: [],
      editable: true,
      viewing: false,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops[0]).toMatchObject({ op: 'insertTableRow', rowId: headRow.id });
  });

  test('a cell selection over the merged head takes the whole merge and its text', () => {
    const selection = cellSelectionBetween(layout, address(headRow.cells[1]!), address(headCell))!;
    expect(selection.rows).toEqual({ from: 0, to: 1 });
    expect(paragraphsInCells(layout, selection.cellIds)).toContain(mergedParagraph);
    const text = cellSelectionText(layout, selection);
    expect(text.startsWith('ROWA\tM1')).toBe(true);
    expect(text).toContain('M5');
  });

  test('a press on the merged text or on the empty head resolves into the merged text', () => {
    const [headRest] = tablesOn(layout, 1)[0]!.rows;
    const carried = headRest!.cells[2]!;
    const onText = hitTestPage(layout, 1, { x: carried.box.x + 4, y: carried.box.y + 20 });
    expect(onText?.position.paragraphId).toBe(mergedParagraph);
    expect(onText?.cell).toMatchObject({ rowId: headRow.id, cellId: headCell.id });
    const onHead = hitTestPage(layout, 0, { x: headCell.box.x + 4, y: headCell.box.y + 10 });
    expect(onHead?.position.paragraphId).toBe(mergedParagraph);
  });

  test('the zero-height head row continuation offers no row handles at the page top', () => {
    const [headRest] = tablesOn(layout, 1)[0]!.rows;
    const sheet = pageContentToSheet(1, headRest!.box.x + 30, headRest!.box.y + 1, layout);
    const hit = findTableInteractionAt(tableInteractionIndex(layout), sheet.x, sheet.y, layout);
    expect(hit).not.toBeNull();
    expect(hit && 'rowId' in hit ? hit.rowId : null).not.toBe(headRow.id);
  });
});

describe('shapes the rule leaves on the older path', () => {
  test('merged text that fits the head row stays there', () => {
    const shape: Shape = { fill: 14, merged: 1 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([0]);
    expect(pageWords(layout)[1]).toContain('ROWB');
  });

  test('mode 14 keeps the merged text starting in the head row', () => {
    const shape: Shape = { fill: 14, merged: 5, mode: 14 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });

  test('a merge over three rows keeps its first lines on the head page', () => {
    // 54pt of page: four merged lines fit, and the widow rule sends two over.
    const shape: Shape = { fill: 13, merged: 5, threeRows: true };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([0, 0, 0, 1, 1]);
  });

  test('a merged first line that may stay alone keeps its place in the head row', () => {
    const shape: Shape = { fill: 14, merged: 5, mergedPPr: '<w:widowControl w:val="0"/>' };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });

  test('a continuation row that can start on the page keeps the merged text above it', () => {
    // 26pt below the 28pt head row: the continuation row cannot fit its 54pt, but its first
    // 18pt paragraph can start there.
    const shape: Shape = { fill: 13, merged: 5, nextParagraphs: 3 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });
});
