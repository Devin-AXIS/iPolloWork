// Regression cases for the shifted-row replay (`moveRowToTop`), beyond the base suite in
// `table-row-shifted-replay.test.ts` and the centred AutoFit growth of
// `table-row-placement-reuse.test.ts`.
//
// Every session step is compared with a fresh layout of the same tree by `JSON.stringify`, so
// finalized records must match in key order too, not only by value. Each test checks the
// fixture assumption it depends on before the property it guards.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { bodyLineId } from '../body-line-id.ts';
import {
  moveRowToTop,
  movedRowsTestRecorder,
  shiftedRowsTestRecorder,
} from '../table-row-geometry-reuse.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall. Fractional spacing (3.3pt before, 2.35pt after), exact
// 13.7pt lines, 5.4pt side margins, a 1.85pt bottom margin and NO top margin, so a row's top
// inset is its top rule alone: shared (half) inside a fragment, whole at a fragment's top.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:spacing w:before="66" w:after="47" w:line="274" w:lineRule="exact"/>` +
  `</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, vAlign: string) =>
  `<w:tc><w:tcPr><w:vAlign w:val="${vAlign}"/></w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr: string) =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
  '<w:bottom w:w="37" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="6"/>`)
    .join('') +
  '</w:tblBorders>';
/** atLeast below the content, atLeast above it, and auto, in turn. */
const HEIGHTS = [
  '<w:trHeight w:val="300" w:hRule="atLeast"/>',
  '<w:trHeight w:val="497" w:hRule="atLeast"/>',
  '',
];
/** Centred, bottom and top cells in every row. */
const ALIGNS = ['center', 'bottom', 'top'];
const bodyRow = (index: number) =>
  tr(
    ALIGNS.map((vAlign, c) => tc(p(`r${index}c${c}`), vAlign)),
    HEIGHTS[index % HEIGHTS.length]!
  );
const HEADER = tr(
  ALIGNS.map((vAlign, c) => tc(p(`h${c}`), vAlign)),
  '<w:tblHeader/>'
);
const table = (rows: number, header = false) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}` +
  `${MARGINS}</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  `${header ? HEADER : ''}${Array.from({ length: rows }, (_, i) => bodyRow(i)).join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
/** Each body row's top, by row id, with the index of the page it stands on. */
const placesOf = (layout: SemanticLayout): Map<string, { page: number; y: number }> => {
  const places = new Map<string, { page: number; y: number }>();
  layout.pages.forEach((page, index) => {
    for (const fragment of page.fragments)
      if (fragment.kind === 'table')
        for (const row of fragment.rows)
          if (!row.isHeaderRepeat && !row.isHeaderRow)
            places.set(row.id, { page: index, y: row.box.y });
  });
  return places;
};

type Op = Parameters<typeof applyTreeOp>[1];

/** A retained session over one document; each edit is laid out and checked against a fresh layout. */
function session(xml: string) {
  let part = load(xml);
  const retained = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session: retained, cache });
  return {
    get part() {
      return part;
    },
    get layout() {
      return layout;
    },
    apply(op: Op) {
      const edit = applyTreeOp(part, op);
      if (!edit.ok) throw Error(edit.reason);
      part = edit.part;
      const previous = layout;
      const shifted = shiftedRowsTestRecorder();
      const inPlace = movedRowsTestRecorder();
      layout = lay(part, 15, { session: retained, cache });
      shifted.dispose();
      inPlace.dispose();
      // Finalized records, key order included, equal a fresh layout of the same tree.
      expect(JSON.stringify(layout.pages)).toBe(JSON.stringify(lay(part).pages));
      return {
        previous,
        shifted: shifted.moved,
        refused: { ...shifted.refused },
        inPlace: inPlace.moved,
      };
    },
  };
}

const GROWTH = 'aaaa bbbb cccc dddd eeee ';

test('mixed alignments and heights: shifted finalized rows match a fresh layout in key order', () => {
  const run = session(table(30));
  expect(tables(run.layout).length).toBeGreaterThan(2);
  const step = run.apply({
    op: 'insertText',
    paragraphId: paragraphAt(run.part, 2, 1),
    offset: 0,
    text: GROWTH,
  });
  // Assumption: the edit grows row 2, so later rows stand lower.
  const before = placesOf(step.previous);
  const after = placesOf(run.layout);
  const lower = [...after].filter(([id, place]) => {
    const old = before.get(id)!;
    return place.page > old.page || (place.page === old.page && place.y > old.y);
  });
  expect(lower.length).toBeGreaterThan(10);
  expect(step.shifted).toBeGreaterThan(0);
});

test('deleting the growth moves rows back up, and the replay rebuilds them', () => {
  const run = session(table(30));
  const original = JSON.stringify(run.layout.pages);
  const paragraphId = paragraphAt(run.part, 2, 1);
  run.apply({ op: 'insertText', paragraphId, offset: 0, text: GROWTH });
  const step = run.apply({ op: 'deleteText', paragraphId, start: 0, end: GROWTH.length });
  // Assumption: the deletion restores the original row, so later rows stand higher.
  const before = placesOf(step.previous);
  const after = placesOf(run.layout);
  const higher = [...after].filter(([id, place]) => {
    const old = before.get(id)!;
    return place.page < old.page || (place.page === old.page && place.y < old.y);
  });
  expect(higher.length).toBeGreaterThan(10);
  expect(step.shifted).toBeGreaterThan(0);
  // Back to the geometry the session started from.
  expect(JSON.stringify(run.layout.pages)).toBe(original);
});

test('a second edit moves rows from the tops the first replay remembered', () => {
  // Five rows stay on one page: no row changes fragment, so no inset changes with its top.
  const run = session(table(5));
  expect(tables(run.layout)).toHaveLength(1);
  const paragraphId = paragraphAt(run.part, 1, 1);
  // About 14 characters fit a line: each insert adds a line to row 1.
  const first = run.apply({ op: 'insertText', paragraphId, offset: 0, text: 'aaaa bbbb cccc ' });
  const second = run.apply({ op: 'insertText', paragraphId, offset: 0, text: 'dddd eeee ffff ' });
  // Assumption: both edits add lines to row 1, so rows 2 to 4 move down twice.
  expect(tables(run.layout)).toHaveLength(1);
  for (const step of [first, second]) {
    const moved = [...placesOf(run.layout)].filter(
      ([id, place]) => placesOf(step.previous).get(id)!.y !== place.y
    );
    expect(moved.length).toBeGreaterThanOrEqual(3);
  }
  expect(first.shifted).toBeGreaterThanOrEqual(3);
  // Without the probe remembering each rebuilt row at its new top, the second edit would find
  // every moved row's record at a top the memo no longer names, and refuse it as 'record'.
  expect(second.shifted).toBeGreaterThanOrEqual(3);
  expect([first.refused.record, second.refused.record]).toEqual([0, 0]);
});

test('a row that moves to or from a fragment top changes its insets and is placed fresh', () => {
  const run = session(table(30));
  const step = run.apply({
    op: 'insertText',
    paragraphId: paragraphAt(run.part, 2, 1),
    offset: 0,
    text: GROWTH,
  });
  // Assumption: some row opens a page fragment now that did not before, or the reverse.
  const firstRows = (layout: SemanticLayout) =>
    new Set(tables(layout).map((fragment) => fragment.rows[0]!.id));
  const was = firstRows(step.previous);
  const now = firstRows(run.layout);
  expect([...now].some((id) => !was.has(id))).toBe(true);
  // With no top margin, a fragment's first row reserves its whole top rule and any other row
  // half of it: the remembered vertical inputs differ, so the replay refuses by its record.
  expect(step.refused.record).toBeGreaterThan(0);
});

test('a body row that moves below a repeated header is exact either way', () => {
  const run = session(table(30, true));
  const step = run.apply({
    op: 'insertText',
    paragraphId: paragraphAt(run.part, 3, 1),
    offset: 0,
    text: GROWTH,
  });
  // Assumption: the row right below some page's repeated header is now a different row.
  const belowRepeats = (layout: SemanticLayout) =>
    tables(layout)
      .filter((fragment) => fragment.rows[0]?.isHeaderRepeat)
      .map((fragment) => fragment.rows.find((row) => !row.isHeaderRepeat)?.id);
  const was = belowRepeats(step.previous);
  const now = belowRepeats(run.layout);
  expect(now.length).toBeGreaterThan(0);
  expect(now.some((id) => !was.includes(id))).toBe(true);
  // Rebuilt or refused, the step was already compared with a fresh layout in `apply`.
  expect(step.shifted + step.refused.record + step.inPlace).toBeGreaterThan(0);
});

// A paragraph mark much larger than its text: the cell's end-mark floor, not its line, sizes it.
// Single (auto) spacing: an exact line rule would also fix the mark's line (`endMarkBox`).
const BIG_MARK = '<w:rPr><w:sz w:val="72"/></w:rPr>';
const pAuto = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>` +
  `</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cellDeps = (): TableFlowDeps => ({
  measurer,
  styleCascade,
  producer: 'shifted-replay-mark-floor',
  nextLineId: bodyLineId,
  displayMode: 'all-markup',
  compatibilityMode: 15,
  cache: createParagraphLayoutCache(),
});

/** Every number by `Object.is`, every key list in order. */
function expectSame(actual: unknown, expected: unknown, path: string): void {
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

test('a row under a large paragraph mark rebuilds exactly at new tops', () => {
  const rowOf = (pPr: string) =>
    readTableStructure(
      tableNode(
        load(
          `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
            `${BORDERS}${MARGINS}</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}` +
            `</w:tblGrid>${tr(
              ALIGNS.map((vAlign, c) => tc(pAuto(`m${c}`, pPr), vAlign)),
              HEIGHTS[0]!
            )}</w:tbl>`
        )
      ),
      310,
      0,
      styleCascade
    )!;
  const big = rowOf(BIG_MARK);
  const plain = rowOf('');
  const cols = big.columnWidthsPt;
  // The large mark leaves the paragraph's own box alone, and under text it sets no row
  // minimum either: the text line sizes the row.
  const placedAtZero = (structure: typeof big) =>
    layoutRowFragment(structure.rows[0]!, cols, 0, 0, false, 0, cellDeps()).record;
  const bigRow = placedAtZero(big);
  const plainRow = placedAtZero(plain);
  expect(bigRow.cells[2]!.blocks[0]!.box.height).toBe(plainRow.cells[2]!.blocks[0]!.box.height);
  expect(bigRow.box.height).toBe(plainRow.box.height);
  const row = big.rows[0]!;
  const deps = cellDeps();
  const base = layoutRowFragment(row, cols, 3.25, 41.3, false, 0, deps);
  const tops = [0, 0.1 + 0.2, 1e-9, 12.345678, 99.99999999, 170.0000001, 3.3 + 2.35, 41.3 - 1e-7];
  for (const at of [cols, cols.map((column) => column * 1.1)]) {
    // Rebuild first: a fresh placement at other widths transfers the cache entry.
    const recorder = shiftedRowsTestRecorder();
    const rebuilt = tops.map((top) => moveRowToTop(row, base.record, at, 3.25, top, deps));
    recorder.dispose();
    expect(recorder.moved).toBe(tops.length);
    tops.forEach((top, index) => {
      const fresh = layoutRowFragment(row, at, 3.25, top, false, 0, deps);
      expect(rebuilt[index]).not.toBeNull();
      expectSame(rebuilt[index]!.bottom, fresh.bottom, `@${top} bottom`);
      expectSame(rebuilt[index]!.record, fresh.record, `@${top}`);
    });
  }
});
