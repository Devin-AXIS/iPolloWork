import { expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { initialCellCursors, layoutRowFragmentBounded } from '../semantic-table-layout.ts';
import { tableTerminalDeps } from '../table-exact-terminal-border.ts';
import type { TableCellFragmentRecord } from '../semantic-records.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import {
  exactTerminalFixture,
  tableNode,
  type ExactTerminalOptions,
} from './table-exact-terminal-fixtures.ts';

function deps(): TableFlowDeps {
  return {
    measurer: createFixedMeasurer(5, 12),
    producer: 'terminal-rule-test',
    nextLineId: (id, start, index) => `${id}:${start}:${index}`,
  };
}
function structure(options: ExactTerminalOptions = {}) {
  const part = exactTerminalFixture(options);
  const table = readTableStructure(tableNode(part.root), 464, 0);
  if (!table) throw new Error('The fixture table was not read');
  return { part, table };
}
function center(cell: TableCellFragmentRecord, side: 'top' | 'bottom'): number {
  const edge = cell.borders?.[side];
  if (!edge) throw new Error('The outer rule is missing');
  const strokes = cell.borders?.strokes?.filter((s) => s.side === side) ?? [];
  if (strokes.length) {
    const points = strokes.map((s) => cell.box.y + s.y + s.height / 2);
    return side === 'top' ? Math.min(...points) : Math.max(...points);
  }
  return cell.box.y + (side === 'top' ? edge.widthPt / 2 : cell.box.height - edge.widthPt / 2);
}

// Independent reference stroke centers: 2 × 19.85pt and 8 × 19.85pt exact row pitch.
// The mixed prefix uses authored minima of 23.85pt and 24.85pt, then six exact rows.
for (const [name, options, pitch] of [
  ['half-point', { width: 0.5 }, 39.7],
  ['one-and-half-point', {}, 39.7],
  ['horizontal-prefix', { rows: 8, columns: 7, horizontalPrefix: true }, 158.8],
  ['mixed-horizontal-prefix', { rows: 8, columns: 7, horizontalPrefix: true, mixed: true }, 169.8],
  ['vertical-prefix', { rows: 8, columns: 7, horizontalPrefix: true, verticalPrefix: true }, 158.8],
  [
    'mixed-vertical-prefix',
    { rows: 8, columns: 7, horizontalPrefix: true, verticalPrefix: true, mixed: true },
    169.8,
  ],
] satisfies [string, ExactTerminalOptions, number][]) {
  test(`terminal exact rule preserves the authored row pitch: ${name}`, () => {
    const part = exactTerminalFixture(options);
    const before = serializeOoxmlPart(part);
    const context = { measurer: createFixedMeasurer(5, 12), session: createLayoutSession() };
    const result = layoutSemanticDocument(part, 0, context);
    expect(result.pages).toHaveLength(1);
    const table = result.pages[0]!.fragments.find((f) => f.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('The table is missing');
    const first = table.rows[0]!.cells[0]!;
    const lastRow = table.rows.at(-1)!;
    const last = lastRow.cells[0]!;
    expect(center(last, 'bottom') - center(first, 'top')).toBeCloseTo(pitch, 6);
    expect(lastRow.box.height).toBeCloseTo(19.85 + (options.width ?? 1.5), 6);
    const after = result.pages[0]!.fragments.find(
      (f) => f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text === 'AFTER'))
    );
    expect(after?.box.y).toBeCloseTo(table.box.y + table.box.height, 6);
    expect(layoutSemanticDocument(part, 0, context).pages).toEqual(result.pages);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
}

for (const [name, options] of [
  ['auto', { rule: 'auto' }],
  ['minimum', { rule: 'atLeast' }],
  ['nil', { border: 'nil' }],
  ['compound', { border: 'double' }],
  ['cell spacing', { spacing: true }],
  ['nested middle cell', { rows: 3, middleNested: true }],
  ['supported vertical text', { rows: 3, middleVertical: true }],
  ['bounded scan refusal', { large: true }],
] satisfies [string, ExactTerminalOptions][]) {
  test(`unsupported terminal budget keeps the original dependencies: ${name}`, () => {
    const { part, table } = structure(options);
    const before = serializeOoxmlPart(part);
    const original = deps();
    expect(tableTerminalDeps(table, original)).toBe(original);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
}

for (const align of ['top', 'center', 'bottom'] as const) {
  for (const [name, authored, room] of [
    ['authored height only', 19.85, 19.85],
    ['partial border room', 19.85, 20.5],
    ['one point', 19.85, 1],
    ['oversized row', 1000, 40],
    ['complete border room', 19.85, 21.35],
  ] as const) {
    test(`bounded ${align} row preserves authored content: ${name}`, () => {
      const { table } = structure({ align, lines: 3 });
      const row = { ...table.rows.at(-1)!, height: { rule: 'exact' as const, valuePt: authored } };
      const original = deps();
      const place = (d: TableFlowDeps) =>
        layoutRowFragmentBounded(
          row,
          table.columnWidthsPt,
          0,
          0,
          room,
          false,
          false,
          0,
          d,
          initialCellCursors(row)
        );
      const before = place(original);
      const after = place({ ...original, exactTerminalBorder: { row, widthPt: 1.5 } });
      if (room >= authored) {
        expect(after.record.box.height - before.record.box.height).toBeCloseTo(1.5, 6);
        for (const [index, cell] of after.record.cells.entries()) {
          const original = before.record.cells[index]!;
          // Overfull text keeps its origins. Its visible clip reaches the authored bottom.
          expect(cell.blocks).toHaveLength(original.blocks.length);
          for (const [blockIndex, block] of cell.blocks.entries()) {
            const previous = original.blocks[blockIndex]!;
            expect({ ...block, box: { ...block.box, height: previous.box.height } }).toEqual(
              previous
            );
            expect(block.box.height).toBeCloseTo(Math.min(12, authored - block.box.y), 6);
          }
        }
      } else expect(after).toEqual(before);
    });
  }
}

test('terminal rule admission moves the last row when its authored height does not fit', () => {
  const part = exactTerminalFixture({ pageHeight: 1740 });
  const result = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(5, 12),
    session: createLayoutSession(),
  });
  const tables = result.pages.flatMap((p) => p.fragments.filter((f) => f.kind === 'table'));
  expect(tables).toHaveLength(2);
  expect(tables.map((t) => t.rows.length)).toEqual([1, 1]);
  for (const page of result.pages)
    for (const fragment of page.fragments) {
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(51.001);
    }
});

for (const refused of [false, true])
  test(`the immutable structure caches ${refused ? 'refusal' : 'eligibility'}`, () => {
    const { table } = structure(
      refused
        ? { border: 'double' }
        : { rows: 8, columns: 7, horizontalPrefix: true, verticalPrefix: true }
    );
    let reads = 0;
    const watched = {
      ...table,
      get rows() {
        reads++;
        return table.rows;
      },
    };
    const original = deps();
    const first = tableTerminalDeps(watched, original);
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    const second = tableTerminalDeps(watched, original);
    expect(reads).toBe(0);
    expect(second.exactTerminalBorder).toBe(first.exactTerminalBorder);
    expect(table.rows[1]!.cells[0]!.vMergeContinue).toBe(!refused);
  });

test('nested and text-box dependencies refuse before scanning the structure', () => {
  const { table } = structure();
  const watched = {
    ...table,
    get rows(): typeof table.rows {
      throw new Error('Do not scan this story');
    },
  };
  for (const original of [
    { ...deps(), tableNestingOffset: 1 as const },
    { ...deps(), textBoxStory: true as const },
  ]) {
    expect(tableTerminalDeps(watched, original)).toBe(original);
  }
});
