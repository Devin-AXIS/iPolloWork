import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableRow } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { bodyLineId } from '../body-line-id.ts';
import {
  createRepeatedHeaderPlacements,
  repeatedHeaderReuseTestRecorder,
  type RepeatedHeaderPlacement,
} from '../table-header-repeat-reuse.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import type { RowVMergeLayoutOptions } from '../table-vmerge-heights.ts';
import type {
  PageRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const deps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;
const repeats = (pages: readonly PageRecord[]): TableRowFragmentRecord[] =>
  pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((fragment) => fragment.rows.filter((row) => row.isHeaderRepeat));
const lineIds = (row: TableRowFragmentRecord): string[] =>
  row.cells.flatMap((cell) =>
    cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).map((l) => l.id)
  );

/** One width-changing edit, applied with header reuse on and off from identical caches. */
function bothWays(xml: string, row: number, cell: number) {
  const part = load(xml);
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraphAt(part, row, cell),
    offset: 0,
    text: 'wider ',
  });
  if (!edit.ok) throw Error(edit.reason);
  const run = (disabled: boolean) => {
    const cache = createParagraphLayoutCache<never>();
    const previous = lay(part, 15, { cache });
    const recorder = repeatedHeaderReuseTestRecorder(disabled);
    const direct = updateTableText(tableNode(part), tableNode(edit.part), previous.pages, 310, {
      ...deps,
      cache,
    } as never);
    recorder.dispose();
    return {
      before: previous.pages,
      direct,
      keys: [...(tableCellBreakKeysOf(tableNode(edit.part)) ?? [])],
      stats: cache.stats,
      reused: recorder.reused,
      placed: recorder.placed,
    };
  };
  return { placed: run(true), reused: run(false), cold: lay(edit.part).pages };
}

test('a repeated header row is placed once and stamped for each page', () => {
  const header = tr([tc(p('Head A')), tc(p('Head B')), tc(p('Head C'))], '<w:tblHeader/>');
  const { placed, reused, cold } = bothWays(
    autofit([header, ...Array.from({ length: 40 }, (_, i) => body(i))]),
    20,
    2
  );
  const count = repeats(placed.before).length;
  expect(count).toBeGreaterThan(2);
  expect(placed.direct).not.toBeNull();
  expect(reused.direct).not.toBeNull();
  // Both paths give the full layout's pages, byte for byte.
  expect(JSON.stringify(reused.direct!.pages)).toBe(JSON.stringify(placed.direct!.pages));
  expect(reused.direct!.pages).toEqual(cold);
  // The same break keys in the same order, and the same break-cache reads.
  expect(reused.keys.length).toBeGreaterThan(0);
  expect(reused.keys).toEqual(placed.keys);
  expect(reused.stats).toEqual(placed.stats);
  // Off: every repeat is placed. On: the first is placed, the others are stamped from it.
  expect([placed.placed, placed.reused]).toEqual([count, 0]);
  expect([reused.placed, reused.reused]).toEqual([1, count - 1]);
  // Each page keeps its own occurrence stamp.
  const stamps = repeats(reused.direct!.pages).map((row) => {
    const ids = lineIds(row);
    expect(ids.length).toBeGreaterThan(0);
    const stamp = ids[0]!.slice(ids[0]!.lastIndexOf(':occ:'));
    for (const id of ids) expect(id.endsWith(stamp)).toBe(true);
    return stamp;
  });
  expect(new Set(stamps).size).toBe(count);
});

test('a header group with a planned vertical merge gives the same pages both ways', () => {
  const merged = tr(
    [tc(p('Group') + p('Two'), '<w:vMerge w:val="restart"/>'), tc(p('Top B')), tc(p('Top C'))],
    '<w:tblHeader/>'
  );
  const below = tr([tc(p(''), '<w:vMerge/>'), tc(p('Low B')), tc(p('Low C'))], '<w:tblHeader/>');
  const { placed, reused, cold } = bothWays(
    autofit([merged, below, ...Array.from({ length: 40 }, (_, i) => body(i))]),
    25,
    1
  );
  expect(repeats(placed.before).length).toBeGreaterThan(2);
  expect(placed.direct).not.toBeNull();
  expect(JSON.stringify(reused.direct!.pages)).toBe(JSON.stringify(placed.direct!.pages));
  expect(reused.direct!.pages).toEqual(cold);
  expect(reused.keys).toEqual(placed.keys);
  expect(reused.stats).toEqual(placed.stats);
  expect(reused.placed + reused.reused).toBe(placed.placed);
  expect(reused.reused).toBeGreaterThan(0);
});

// Unit fixture: one placed header row, as the width update records it.
const sink = () => {
  const reported: string[] = [];
  const read: string[] = [];
  const flowDeps = {
    nextLineId: bodyLineId,
    onCellBreakKey: (key: string) => void reported.push(key),
    cache: { get: (key: string) => void read.push(key) },
  } as unknown as TableFlowDeps;
  return { reported, read, deps: flowDeps };
};
const line = (occurrence: string, index: number) => ({
  id: bodyLineId('p1', index * 4, index, occurrence),
  range: { paragraphId: 'p1', start: index * 4, end: index * 4 + 4 },
  spans: [],
  box: { x: 1, y: 10 + index * 14, width: 50, height: 14 },
  contentX: 1,
  baseline: 11,
  leading: 0,
  trailingSpacing: 0,
});
const record = (occurrence: string, kind: 'paragraph' | 'table' = 'paragraph') =>
  ({
    id: 'row',
    rowIndex: 0,
    isHeaderRow: true,
    isHeaderRepeat: true,
    cells: [
      {
        id: 'cell',
        gridColumn: 0,
        gridSpan: 1,
        vMergeContinue: false,
        blocks: [
          {
            kind,
            id: 'p1#f0',
            paragraphId: 'p1',
            fragmentIndex: 0,
            range: { paragraphId: 'p1', start: 0, end: 8 },
            lines: [line(occurrence, 0), line(occurrence, 1)],
            box: { x: 1, y: 10, width: 50, height: 28 },
          },
        ],
        box: { x: 0, y: 10, width: 60, height: 28 },
      },
    ],
    box: { x: 0, y: 10, width: 60, height: 28 },
  }) as unknown as TableRowFragmentRecord;
const source = { id: 'row' } as unknown as SemanticTableRow;
const placement = (
  flowDeps: TableFlowDeps,
  extra: Partial<RepeatedHeaderPlacement> = {}
): RepeatedHeaderPlacement => ({
  index: 0,
  source,
  top: 10,
  deps: flowDeps,
  options: undefined,
  occurrence: '3',
  ...extra,
});

test('a stamped row differs from its placement only in line occurrence stamps', () => {
  const { reported, read, deps: flowDeps } = sink();
  const placements = createRepeatedHeaderPlacements();
  placements.remember(placement(flowDeps), record('3'), ['k1', 'k2']);
  const stamped = placements.take(placement(flowDeps, { occurrence: '17' }))!;
  expect(stamped).toEqual(record('17'));
  expect(JSON.stringify(stamped)).toBe(JSON.stringify(record('17')));
  // Fresh objects down to each line, in the key order a placement writes.
  const fresh = record('17');
  expect(stamped).not.toBe(fresh);
  expect(Object.keys(stamped)).toEqual(Object.keys(fresh));
  expect(Object.keys(stamped.cells[0]!)).toEqual(Object.keys(fresh.cells[0]!));
  const block = stamped.cells[0]!.blocks[0]!;
  expect(block.kind === 'paragraph' && Object.keys(block.lines[0]!)).toEqual(
    Object.keys(line('17', 0))
  );
  // Side effects replayed in report order: report, then the break-cache read.
  expect(reported).toEqual(['k1', 'k2']);
  expect(read).toEqual(['k1', 'k2']);
});

const options = (extra: object = {}): RowVMergeLayoutOptions =>
  ({
    detachedSpanHeightPtByCellId: new Map([
      ['a', 20],
      ['b', 30],
    ]),
    heightFloorPt: 12,
    ...extra,
  }) as RowVMergeLayoutOptions;

test('merge options are compared by value, keys and order included', () => {
  const { deps: flowDeps } = sink();
  const placements = createRepeatedHeaderPlacements();
  placements.remember(placement(flowDeps, { options: options() }), record('3'), []);
  const taken = (value: RowVMergeLayoutOptions | undefined) =>
    placements.take(placement(flowDeps, { options: value, occurrence: '4' }));
  expect(taken(options())).toBeDefined();
  expect(taken(undefined)).toBeUndefined();
  expect(taken(options({ heightFloorPt: 13 }))).toBeUndefined();
  expect(taken(options({ coveredFromAbove: true }))).toBeUndefined();
  expect(taken(options({ unknown: 1 }))).toBeUndefined();
  const spans = (entries: [string, number][]) =>
    options({ detachedSpanHeightPtByCellId: new Map(entries) });
  expect(
    taken(
      spans([
        ['a', 20],
        ['b', 31],
      ])
    )
  ).toBeUndefined();
  expect(
    taken(
      spans([
        ['b', 30],
        ['a', 20],
      ])
    )
  ).toBeUndefined();
  expect(taken(spans([['a', 20]]))).toBeUndefined();
  // Same keys, other order: refused rather than assumed equivalent.
  expect(
    taken({
      heightFloorPt: 12,
      detachedSpanHeightPtByCellId: options().detachedSpanHeightPtByCellId,
    })
  ).toBeUndefined();
});

test('any other source, top or deps places the row again', () => {
  const { deps: flowDeps } = sink();
  const placements = createRepeatedHeaderPlacements();
  placements.remember(placement(flowDeps, { top: 0 }), record('3'), ['k']);
  const other = sink();
  expect(placements.take(placement(flowDeps, { top: 0, occurrence: '4' }))).toBeDefined();
  expect(placements.take(placement(flowDeps, { top: -0, occurrence: '4' }))).toBeUndefined();
  expect(placements.take(placement(flowDeps, { top: 1, occurrence: '4' }))).toBeUndefined();
  expect(placements.take(placement(other.deps, { top: 0, occurrence: '4' }))).toBeUndefined();
  expect(
    placements.take(
      placement(flowDeps, { top: 0, occurrence: '4', source: { id: 'row' } as never })
    )
  ).toBeUndefined();
  expect(
    placements.take(placement(flowDeps, { top: 0, occurrence: '4', index: 1 }))
  ).toBeUndefined();
  expect(other.reported).toEqual([]);
});

test('records the stamp cannot rewrite are placed again, with nothing replayed', () => {
  const unstamped = sink();
  const placements = createRepeatedHeaderPlacements();
  // A line id without this placement's suffix.
  placements.remember(placement(unstamped.deps), record('2'), ['k']);
  expect(placements.take(placement(unstamped.deps, { occurrence: '4' }))).toBeUndefined();
  expect(unstamped.reported).toEqual([]);
  // A block that is not a paragraph.
  const blocks = sink();
  const other = createRepeatedHeaderPlacements();
  other.remember(placement(blocks.deps), record('3', 'table'), ['k']);
  expect(other.take(placement(blocks.deps, { occurrence: '4' }))).toBeUndefined();
  expect(blocks.reported).toEqual([]);
  // Another line id scheme is never kept.
  const scheme = createRepeatedHeaderPlacements();
  const custom = { ...sink().deps, nextLineId: () => 'x' } as TableFlowDeps;
  scheme.remember(placement(custom), record('3'), []);
  expect(scheme.take(placement(custom, { occurrence: '4' }))).toBeUndefined();
});

test('each header row keeps a few tops, and the recorder can turn reuse off', () => {
  const { deps: flowDeps } = sink();
  const placements = createRepeatedHeaderPlacements();
  for (let top = 0; top < 5; top += 1)
    placements.remember(placement(flowDeps, { top }), record('3'), []);
  expect(placements.take(placement(flowDeps, { top: 0, occurrence: '4' }))).toBeUndefined();
  expect(placements.take(placement(flowDeps, { top: 4, occurrence: '4' }))).toBeDefined();
  const off = repeatedHeaderReuseTestRecorder(true);
  expect(placements.take(placement(flowDeps, { top: 4, occurrence: '4' }))).toBeUndefined();
  off.dispose();
  expect(placements.take(placement(flowDeps, { top: 4, occurrence: '4' }))).toBeDefined();
});
