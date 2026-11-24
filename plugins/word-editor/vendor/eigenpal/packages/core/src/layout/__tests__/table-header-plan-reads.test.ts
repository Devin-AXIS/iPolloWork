import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { bodyLineId } from '../body-line-id.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { measureRowHeight, type TableFlowDeps } from '../semantic-table-layout.ts';
import { planFixedHeaderGroup, planHeaderGroup } from '../table-header-vmerge.ts';
import {
  createRepeatedPlanReads,
  repeatedPlanReadsTestRecorder,
} from '../table-header-plan-reads.ts';
import type { RowVMergeLayoutOptions } from '../table-vmerge-heights.ts';
import type { PageRecord, TableFragmentRecord, TextMeasurer } from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines. Columns are 100pt with no cell margins.
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
// Two header rows. A merge inside the group: its head has two lines, so only the plan keeps
// the first header row one line tall.
const HEADERS = [
  tr(
    [tc(p('aa bb cc dd') + p('ee'), '<w:vMerge w:val="restart"/>'), tc(p('Top B')), tc(p('C'))],
    '<w:tblHeader/>'
  ),
  tr([tc(p(''), '<w:vMerge/>'), tc(p('Low B')), tc(p('Low C'))], '<w:tblHeader/>'),
];
const xml = (rows = 40) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  `${[...HEADERS, ...Array.from({ length: rows }, (_, i) => body(i))].join('')}</w:tbl>`;
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
const tableFragments = (pages: readonly PageRecord[]): TableFragmentRecord[] =>
  pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');

test('a width update serves each repeated plan read again, with the same pages, keys and cache reads', () => {
  const part = load(xml());
  const paragraphId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[25]!.cells[1]!
    .blocks[0]!.id;
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'wider ' });
  if (!edit.ok) throw Error(edit.reason);
  const run = (disabled: boolean) => {
    const cache = createParagraphLayoutCache<never>();
    const previous = lay(part, 15, { cache });
    const recorder = repeatedPlanReadsTestRecorder(disabled);
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
      served: recorder.served,
      computed: recorder.computed,
    };
  };
  const off = run(true);
  const on = run(false);
  expect(off.direct).not.toBeNull();
  expect(on.direct).not.toBeNull();
  expect(JSON.stringify(on.direct!.pages)).toBe(JSON.stringify(off.direct!.pages));
  expect(on.direct!.pages).toEqual(lay(edit.part).pages);
  expect(on.keys.length).toBeGreaterThan(0);
  expect(on.keys).toEqual(off.keys);
  expect(on.stats).toEqual(off.stats);

  // One read per header row per fragment that opens with the group. A plan is shared by the
  // fragments whose group opens at one top, and each of its rows is computed once there.
  const opening = tableFragments(off.before).filter((fragment) => fragment.rows[0]?.isHeaderRow);
  expect(opening.length).toBeGreaterThan(2);
  const reads = opening.length * HEADERS.length;
  const tops = new Set(opening.map((fragment) => fragment.rows[0]!.box.y)).size;
  expect([off.computed, off.served]).toEqual([reads, 0]);
  expect([on.computed, on.served]).toEqual([tops * HEADERS.length, reads - tops * HEADERS.length]);
  expect(on.served).toBeGreaterThan(0);
});

// Direct plans over the same structure. Text widens by `wide.factor` after planning, so a
// detached head no longer fits the span the plan measured and `settle` withdraws it.
const wide = { factor: 1 };
const fixed = createFixedMeasurer(6, 14);
const stretching: TextMeasurer = {
  measure: (text, style) => fixed.measure(text, style) * wide.factor,
  lineMetrics: (style) => fixed.lineMetrics(style),
};
const structure = (): SemanticTableStructure =>
  readTableStructure(tableNode(load(xml(2))), 310, 0, styleCascade)!;
const flowDeps = (extra: Partial<TableFlowDeps> = {}): TableFlowDeps => ({
  measurer: stretching,
  styleCascade,
  producer: 'plan-reads',
  nextLineId: bodyLineId,
  displayMode: 'all-markup',
  compatibilityMode: 15,
  ...extra,
});
const plans = (shape: SemanticTableStructure, on: TableFlowDeps, off: TableFlowDeps = on) => {
  const headers = shape.rows.filter((row) => row.isHeader);
  const rowHeightOf = (row: (typeof headers)[number], top: number, d: TableFlowDeps) =>
    measureRowHeight(row, shape.columnWidthsPt, 0, 0, d, 0, undefined, top);
  return {
    on: planFixedHeaderGroup(shape, headers, 0, 0, on, rowHeightOf),
    off: planHeaderGroup(shape, headers, () => 0, 0, off, rowHeightOf),
  };
};
/** Read both plans in the same order; every pair must be equal. */
const readBoth = (
  pair: ReturnType<typeof plans>,
  sequence: readonly (readonly [number, number])[]
): (RowVMergeLayoutOptions | undefined)[] =>
  sequence.map(([index, top]) => {
    const served = pair.on.optionsAt(index, top);
    const computed = pair.off.optionsAt(index, top);
    expect(served).toEqual(computed);
    return computed;
  });

test('a withdrawing read is computed and never served, and it invalidates every kept read', () => {
  wide.factor = 1;
  const pair = plans(structure(), flowDeps());
  expect(pair.on.planned).toBe(true);
  // Planned at the narrow width: the head is detached from header row 0.
  wide.factor = 4;
  const recorder = repeatedPlanReadsTestRecorder();
  const results = readBoth(pair, [
    [0, 0],
    [1, 14],
    [0, 0],
    [1, 14],
    [0, 0],
    [1, 14],
  ]);
  recorder.dispose();
  wide.factor = 1;
  // The first read withdrew the merge: both rows lose their options.
  expect(results).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  // Computed: the withdrawing read, then each row once at the new count. Served: the rest.
  expect([recorder.computed, recorder.served]).toEqual([3, 3]);
});

test('without a change, each row is computed once per top and served after that', () => {
  wide.factor = 1;
  const pair = plans(structure(), flowDeps());
  const recorder = repeatedPlanReadsTestRecorder();
  const results = readBoth(pair, [
    [0, 0],
    [1, 14],
    [0, 0],
    [1, 14],
    [0, 5],
    [0, 5],
    [0, 0],
    [0, -0],
  ]);
  recorder.dispose();
  expect(results[0]?.detachedSpanHeightPtByCellId?.size).toBe(1);
  // Computed: (0, 0), (1, 14), (0, 5), (0, 0) again after (0, 5) replaced it, and (0, -0).
  expect([recorder.computed, recorder.served]).toEqual([5, 3]);
});

test('deps with wrap zones never serve a read', () => {
  wide.factor = 1;
  const zoned = flowDeps({ pageExclusionZones: () => [] });
  const pair = plans(structure(), zoned);
  const recorder = repeatedPlanReadsTestRecorder();
  readBoth(pair, [
    [0, 0],
    [0, 0],
    [1, 14],
    [1, 14],
  ]);
  recorder.dispose();
  expect([recorder.computed, recorder.served]).toEqual([0, 0]);
});

/** A fixed plan takes the table edge as a number, so a moving edge cannot be passed. */
export function movingEdgeIsRejected(shape: SemanticTableStructure, d: TableFlowDeps): void {
  // @ts-expect-error A getter would let the edge move between reads.
  planFixedHeaderGroup(
    shape,
    shape.rows,
    () => 0,
    0,
    d,
    () => 0
  );
}

test('a served read reports exactly the settle probe keys a computed read reports', () => {
  wide.factor = 1;
  const sinks = { on: [] as string[], off: [] as string[] };
  const caches = {
    on: createParagraphLayoutCache<never>(),
    off: createParagraphLayoutCache<never>(),
  };
  const pair = plans(
    structure(),
    flowDeps({ cache: caches.on as never, onCellBreakKey: (key) => void sinks.on.push(key) }),
    flowDeps({ cache: caches.off as never, onCellBreakKey: (key) => void sinks.off.push(key) })
  );
  expect(sinks.on).toEqual(sinks.off);
  const recorder = repeatedPlanReadsTestRecorder();
  const slices: { on: string[]; off: string[] }[] = [];
  for (let read = 0; read < 3; read += 1) {
    const at = { on: sinks.on.length, off: sinks.off.length };
    readBoth(pair, [[0, 0]]);
    slices.push({ on: sinks.on.slice(at.on), off: sinks.off.slice(at.off) });
  }
  recorder.dispose();
  expect([recorder.computed, recorder.served]).toEqual([1, 2]);
  // The detached head is settled with a probe, which reports its cell paragraphs' keys.
  expect(slices[1]!.off.length).toBeGreaterThan(0);
  for (const slice of slices) expect(slice.on).toEqual(slice.off);
  expect(caches.on.stats).toEqual(caches.off.stats);
});

test('kept reads replay their keys in order and are dropped when the plan changes', () => {
  const reported: string[] = [];
  const read: string[] = [];
  const reads = createRepeatedPlanReads({
    onCellBreakKey: (key) => void reported.push(key),
    cache: { get: (key: string) => void read.push(key) } as never,
  });
  let changes = 0;
  let calls = 0;
  const value = { heightFloorPt: 1 } as RowVMergeLayoutOptions;
  const compute = (heard: string[] | undefined) => {
    calls += 1;
    heard?.push('a', 'b');
    return value;
  };
  const recorder = repeatedPlanReadsTestRecorder();
  expect(reads.read(0, 3, () => changes, compute)).toBe(value);
  expect(reads.read(0, 3, () => changes, compute)).toBe(value);
  expect([calls, reported, read]).toEqual([1, ['a', 'b'], ['a', 'b']]);
  // A change since the read was kept: computed again.
  changes += 1;
  expect(reads.read(0, 3, () => changes, compute)).toBe(value);
  expect(calls).toBe(2);
  // A new top forces a read. A change during that read must discard the old entry.
  const changing = (heard: string[] | undefined) => {
    changes += 1;
    return compute(heard);
  };
  reads.read(0, 4, () => changes, changing);
  // Even the same top must compute again: a mutating read was never kept.
  reads.read(0, 4, () => changes, compute);
  expect(calls).toBe(4);
  reads.read(0, 3, () => changes, compute);
  expect(calls).toBe(5);
  reads.read(0, 3, () => changes, compute);
  expect(calls).toBe(5);
  recorder.dispose();
  expect([recorder.computed, recorder.served]).toEqual([5, 2]);
  // Turned off: computed with no key list, never kept or served.
  const off = repeatedPlanReadsTestRecorder(true);
  let heardList: string[] | undefined = [];
  reads.read(
    0,
    3,
    () => changes,
    (heard) => {
      heardList = heard;
      return value;
    }
  );
  off.dispose();
  expect(heardList).toBeUndefined();
  expect([off.computed, off.served]).toEqual([1, 0]);
});
