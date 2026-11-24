import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { readTableStructure, type SemanticTableStructure } from '../semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { bodyLineId } from '../body-line-id.ts';
import { moveRowToTop, shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// Fractional geometry on purpose: 5.4pt side margins (108 twips), 1.15pt and 1.85pt top and
// bottom margins, 3.3pt and 2.35pt paragraph spacing, exact 13.7pt lines, a 0.75pt band.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:spacing w:before="66" w:after="47" w:line="274" w:lineRule="exact"/>` +
  `</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, vAlign: string) =>
  `<w:tc><w:tcPr><w:vAlign w:val="${vAlign}"/></w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], height: string) =>
  `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;
const MARGINS =
  '<w:tblCellMar><w:top w:w="23" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
  '<w:bottom w:w="37" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="6"/>`)
    .join('') +
  '</w:tblBorders>';
const table = (rows: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}` +
  `${MARGINS}</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  `${rows.join('')}</w:tbl>`;
const ROW_SHAPES = {
  'center, atLeast below content': ['center', '<w:trHeight w:val="200" w:hRule="atLeast"/>'],
  'center, atLeast above content': ['center', '<w:trHeight w:val="497" w:hRule="atLeast"/>'],
  'bottom, atLeast above content': ['bottom', '<w:trHeight w:val="497" w:hRule="atLeast"/>'],
  'top, auto': ['top', ''],
} as const;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const structureOf = (rows: readonly string[]): SemanticTableStructure =>
  readTableStructure(tableNode(load(table(rows))), 310, 0, styleCascade)!;
const measurer = createFixedMeasurer(6, 13.37);
const flowDeps = (extra: Partial<TableFlowDeps> = {}): TableFlowDeps => ({
  measurer,
  styleCascade,
  producer: 'shifted-replay',
  nextLineId: bodyLineId,
  displayMode: 'all-markup',
  compatibilityMode: 15,
  cache: createParagraphLayoutCache(),
  ...extra,
});

/** Seeded tops: fractions that round, large values, values above the first placement. */
function tops(count: number): number[] {
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const values = [0, 0.1 + 0.2, 1e-9, 99.99999999, 123.456789, 700.0000001, 3.3 + 2.35];
  while (values.length < count) values.push(next() * 800, next() * 13.7, next() * 0.3);
  return values.slice(0, count);
}

/** Every number by `Object.is` (so -0 and NaN count), every key in the same order. */
function expectSame(actual: unknown, expected: unknown, path = 'record'): void {
  if (typeof expected === 'number') {
    if (!Object.is(actual, expected)) throw Error(`${path}: ${String(actual)} !== ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    expect(actual).toBe(expected);
    return;
  }
  expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
  for (const key of Object.keys(expected))
    expectSame(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${path}.${key}`
    );
}

for (const [name, [vAlign, height]] of Object.entries(ROW_SHAPES)) {
  test(`a row rebuilt at a new top equals a fresh placement there (${name})`, () => {
    const cells = [tc(p('Cell one'), vAlign), tc(p('two'), vAlign), tc(p('three x'), vAlign)];
    const structure = structureOf([tr(cells, height)]);
    const row = structure.rows[0]!;
    const cols = structure.columnWidthsPt;
    const left = 7.25;
    const deps = flowDeps();
    const base = layoutRowFragment(row, cols, left, 41.3, false, 0, deps);
    const wider = cols.map((column) => column * 1.1);
    for (const [label, at] of [
      ['same widths', cols],
      ['wider columns', wider],
    ] as const) {
      const recorder = shiftedRowsTestRecorder();
      // Rebuild first: a fresh placement at other widths transfers the cache entry.
      const sample = tops(400);
      const shifted = sample.map((top) => moveRowToTop(row, base.record, at, left, top, deps));
      recorder.dispose();
      expect([label, recorder.moved]).toEqual([label, sample.length]);
      sample.forEach((top, index) => {
        const fresh = layoutRowFragment(row, at, left, top, false, 0, deps);
        const rebuilt = shifted[index]!;
        expect(rebuilt).not.toBeNull();
        expectSame(rebuilt.bottom, fresh.bottom, `${label} @${top} bottom`);
        expectSame(rebuilt.record, fresh.record, `${label} @${top}`);
      });
    }
  });
}

test('rows outside the replayed shape are refused, each by its first reason', () => {
  const cases: [string, string[], string, Partial<TableFlowDeps>?][] = [
    ['height', [tc(p('a'), 'center')], '<w:trHeight w:val="300" w:hRule="exact"/>'],
    ['cell', [tc(p('one') + p('two'), 'center')], ''],
    ['cell', [tc(p('a', '<w:pBdr><w:top w:val="single" w:sz="8"/></w:pBdr>'), 'center')], ''],
    // A lone cell spans the whole 300pt table: the grid columns it leaves take no width.
    ['cell', [tc(p('wraps across more than one line here '.repeat(4)), 'center')], ''],
  ];
  for (const [reason, cells, height] of cases) {
    const structure = structureOf([tr(cells, height)]);
    const deps = flowDeps();
    const base = layoutRowFragment(
      structure.rows[0]!,
      structure.columnWidthsPt,
      0,
      10,
      false,
      0,
      deps
    );
    const recorder = shiftedRowsTestRecorder();
    expect(
      moveRowToTop(structure.rows[0]!, base.record, structure.columnWidthsPt, 0, 33.3, deps)
    ).toBeNull();
    recorder.dispose();
    expect(recorder.moved).toBe(0);
    expect(recorder.refused[reason as 'cell']).toBe(1);
  }
  // Without a break cache nothing was remembered, and nothing is rebuilt.
  const structure = structureOf([tr([tc(p('a'), 'center')], '')]);
  const unremembered = flowDeps({ cache: undefined });
  const base = layoutRowFragment(
    structure.rows[0]!,
    structure.columnWidthsPt,
    0,
    10,
    false,
    0,
    unremembered
  );
  const recorder = shiftedRowsTestRecorder();
  expect(
    moveRowToTop(structure.rows[0]!, base.record, structure.columnWidthsPt, 0, 33.3, unremembered)
  ).toBeNull();
  expect(
    moveRowToTop(structure.rows[0]!, base.record, structure.columnWidthsPt, 0, 33.3, flowDeps())
  ).toBeNull();
  recorder.dispose();
  expect([recorder.refused.row, recorder.refused.cell]).toEqual([1, 1]);
});

// A fixed table of centred `atLeast` rows on 310 x 170pt pages: a cell that wraps grows its
// row, and every later row of the table stands lower.
const growthTable = (rows: number) =>
  table(
    Array.from({ length: rows }, (_, i) =>
      tr(
        [0, 1, 2].map((c) => tc(p(`r${i}c${c}`), 'center')),
        '<w:trHeight w:val="300" w:hRule="atLeast"/>'
      )
    )
  );
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const rowTops = (layout: SemanticLayout) =>
  layout.pages.flatMap((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((fragment) => fragment.rows.map((row) => `${row.id}@${row.box.y}`))
  );

test('a row that grows rebuilds the shifted rows below it exactly', () => {
  let part = load(growthTable(40));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const before = lay(part, 15, { session, cache, measurer });
  const paragraphId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[4]!.cells[1]!
    .blocks[0]!.id;
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId,
    offset: 0,
    text: 'aaaa bbbb cccc dddd ',
  });
  if (!edit.ok) throw Error(edit.reason);
  part = edit.part;
  const recorder = shiftedRowsTestRecorder();
  const updated = lay(part, 15, { session, cache, measurer });
  recorder.dispose();
  expect(updated.pages).toEqual(lay(reparsed(part), 15, { measurer }).pages);
  // The rows below the edited one moved, and the replay rebuilt them.
  const moved = rowTops(updated).filter((top) => !rowTops(before).includes(top));
  expect(moved.length).toBeGreaterThan(20);
  expect(recorder.moved).toBeGreaterThan(10);
});

test('centering preserves subtraction order with unequal fractional cell margins', () => {
  const content = p('x').replace('w:before="66" w:after="47"', 'w:before="0" w:after="0"');
  const xml = table([
    tr(
      [tc(content, 'center'), tc(content, 'center'), tc(content, 'center')],
      '<w:trHeight w:val="374" w:hRule="atLeast"/>'
    ),
  ])
    .replace(BORDERS, '')
    .replace('w:top w:w="23"', 'w:top w:w="1"')
    .replace('w:bottom w:w="37"', 'w:bottom w:w="2"');
  const structure = readTableStructure(tableNode(load(xml)), 310, 0, styleCascade)!;
  const row = structure.rows[0]!;
  const cols = structure.columnWidthsPt;
  const deps = flowDeps();
  const base = layoutRowFragment(row, cols, 0, 41.3, false, 0, deps);
  const rebuilt = moveRowToTop(row, base.record, cols, 0, 0, deps);
  expect(rebuilt).not.toBeNull();
  const fresh = layoutRowFragment(row, cols, 0, 0, false, 0, deps);
  expectSame(rebuilt!.record, fresh.record);
});
