import { createParagraphLayoutCache } from '../layout-cache.ts';
import { bodyLineId } from '../body-line-id.ts';
import { finalizeTableRows } from '../table-fragment-finalize.ts';
import { rememberRowPlacement, isSettledPreviousRow } from '../table-row-placement-reuse.ts';
import { expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createRowProbeReuse } from '../table-row-probe-reuse.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, row, table, para, measurer, styleCascade } from './table-row-keep-fixtures.ts';

function fixture(xml = row('text', { first: para('first', 3) + para('second', 2) })) {
  const part = load(table([xml]));
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  return readTableStructure(node, 310, 0, styleCascade)!;
}
function deps(): TableFlowDeps {
  let n = 0;
  return {
    measurer,
    styleCascade,
    producer: 'test',
    nextLineId: (id, start, index) => `${id}:${start}:${index}:${n++}`,
  };
}

for (const top of [0, 14.123456789, 83.33333333333333]) {
  test(`reused row has exact placement and line identities at ${top}`, () => {
    const s = fixture();
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(s.rows[0]!, 2.3456789, top, d);
    const actual = p.take(s.rows[0]!, 2.3456789, top, { ...d, rowAtPageStart: false });
    expect(actual).not.toBeNull();
    expect(actual).toEqual(
      layoutRowFragment(
        s.rows[0]!,
        s.columnWidthsPt,
        2.3456789,
        top,
        false,
        0,
        deps(),
        s.cellSpacingPt
      )
    );
    expect(p.take(s.rows[0]!, 2.3456789, top, d)).toBeNull();
  });
}

test('changed geometry, inputs, and page admission invalidate a probe', () => {
  const s = fixture();
  const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
  const d = deps();
  for (const change of [
    { defaultTabStopPt: 80 },
    { rowAtPageStart: true },
    { producer: 'other' },
    { pageExclusionZones: () => [{}] },
  ]) {
    p.measure(s.rows[0]!, 0, 0, d);
    expect(p.take(s.rows[0]!, 0, 0, { ...d, ...change } as TableFlowDeps)).toBeNull();
  }
  p.measure(s.rows[0]!, 0, 0, d);
  expect(p.take(s.rows[0]!, 0, 0.001, d)).toBeNull();
  p.measure(s.rows[0]!, 0, 0, d);
  expect(p.take(s.rows[0]!, 1, 0, d)).toBeNull();
});

for (const xml of [
  row('header', { header: true }),
  row('nested', { first: table([row('inside')]) }),
  row('field', {
    first: '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>',
  }),
]) {
  test('complex row keeps the regular placement path', () => {
    const s = fixture(xml);
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(s.rows[0]!, 0, 0, d);
    expect(p.take(s.rows[0]!, 0, 0, d)).toBeNull();
  });
}

test('semantic merge continuations and vertical text cannot reuse probes', () => {
  const s = fixture();
  for (const change of [{ vMergeContinue: true }, { textDirection: 'btLr' as const }]) {
    const r = { ...s.rows[0]!, cells: s.rows[0]!.cells.map((c) => ({ ...c, ...change })) };
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(r, 0, 0, d);
    expect(p.take(r, 0, 0, d)).toBeNull();
  }
});

test('matching line ids preserve a settled previous placement and still call the id allocator', () => {
  const structure = fixture(row('plain'));
  const source = structure.rows[0]!;
  let calls = 0;
  const d: TableFlowDeps = {
    ...deps(),
    cache: createParagraphLayoutCache(),
    nextLineId: (id, start, index) => {
      calls++;
      return bodyLineId(id, start, index);
    },
  };
  const initial = layoutRowFragment(source, structure.columnWidthsPt, 0, 0, false, 0, d, 0);
  rememberRowPlacement(source, initial, 0, d);
  const finalized = finalizeTableRows([initial.record], structure, [source])[0]!;
  const probe = createRowProbeReuse(structure.columnWidthsPt, 0, new Map([[source.id, finalized]]));
  probe.measure(source, 0, 0, d);
  calls = 0;
  const answer = probe.take(source, 0, 0, d);
  expect(answer).not.toBeNull();
  expect(isSettledPreviousRow(answer!.record)).toBe(true);
  expect(calls).toBe(
    finalized.cells.reduce(
      (sum, cell) =>
        sum +
        cell.blocks.reduce(
          (n, block) => n + (block.kind === 'paragraph' ? block.lines.length : 0),
          0
        ),
      0
    )
  );
  const changed = {
    ...d,
    nextLineId: (id: string, start: number, index: number) =>
      'changed:' + bodyLineId(id, start, index),
  };
  probe.measure(source, 0, 0, changed);
  const remapped = probe.take(source, 0, 0, changed);
  expect(remapped).not.toBeNull();
  expect(isSettledPreviousRow(remapped!.record)).toBe(false);
  for (const cell of remapped!.record.cells)
    for (const block of cell.blocks) {
      if (block.kind === 'paragraph')
        for (const line of block.lines) expect(line.id.startsWith('changed:')).toBe(true);
    }
});

test('probe dependency comparison handles removed, undefined, and inherited keys', () => {
  const s = fixture();
  const source = s.rows[0]!;
  const probe = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
  const base = deps();
  probe.measure(source, 0, 0, { ...base, defaultTabStopPt: 80 });
  expect(probe.take(source, 0, 0, base)).toBeNull();
  probe.measure(source, 0, 0, { ...base, defaultTabStopPt: undefined });
  expect(probe.take(source, 0, 0, base)).not.toBeNull();
  const inherited = Object.assign(Object.create({ unrelated: 'ignored' }), base) as TableFlowDeps;
  probe.measure(source, 0, 0, base);
  expect(probe.take(source, 0, 0, inherited)).not.toBeNull();
});
