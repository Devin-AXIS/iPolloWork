import { expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { bodyLineId } from '../body-line-id.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableRow } from '../semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import { placementFromPrevious, rememberRowPlacement } from '../table-row-placement-reuse.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// A previous placement requires unchanged vertical inputs and a finalized height equal to
// the probe's height. A changed top can replay the original vertical calculations.

const tc = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${tc('A1')}${tc('B1', '<w:vAlign w:val="center"/>')}${tc('C1')}</w:tr></w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;

function setup(numeric = false) {
  const part = load(numeric ? table.replace('A1', '123456789') : table);
  lay(part);
  const row = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[0]!;
  const deps: TableFlowDeps = {
    measurer,
    styleCascade,
    // The move reads the placed line back from the break cache.
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup',
  } as TableFlowDeps;
  const narrow = numeric ? [27, 100, 110] : [90, 100, 110];
  const wide = numeric ? [27.125, 100, 110] : [100.5, 95.25, 104.125];
  const top = 40;
  const probe = layoutRowFragment(row, narrow, 3, top, false, 0, deps);
  rememberRowPlacement(row, probe, top, deps);
  return { row, deps, wide, top, previous: probe.record };
}

test('the unchanged case reuses the previous placement', () => {
  const { row, deps, wide, top, previous } = setup();
  const reused = placementFromPrevious(row, previous, wide, 2.5, top, deps);
  expect(reused).not.toBeNull();
  expect(reused!.record).toEqual(layoutRowFragment(row, wide, 2.5, top, false, 0, deps).record);
});

test('a different top replays the fresh placement', () => {
  const { row, deps, wide, top, previous } = setup();
  const reused = placementFromPrevious(row, previous, wide, 2.5, top + 1, deps);
  expect(reused).not.toBeNull();
  expect(JSON.stringify(reused!.record)).toBe(
    JSON.stringify(layoutRowFragment(row, wide, 2.5, top + 1, false, 0, deps).record)
  );
});

test('a different terminal height or row height rule refuses', () => {
  const { row, deps, wide, top, previous } = setup();
  // The terminal-row correction finalizes a different height than the probe measured.
  const terminal = { ...previous, box: { ...previous.box, height: previous.box.height + 2 } };
  expect(placementFromPrevious(row, terminal, wide, 2.5, top, deps)).toBeNull();
  const exact: SemanticTableRow = { ...row, height: { rule: 'exact', valuePt: 40 } };
  expect(placementFromPrevious(exact, previous, wide, 2.5, top, deps)).toBeNull();
});

test('each vertical input of any cell refuses when it differs', () => {
  const { row, deps, wide, top, previous } = setup();
  const target = row.cells[2]!;
  const base = cellContentInsets(target, true);
  const insets = (change: Partial<typeof base>) => new Map([[target.id, { ...base, ...change }]]);
  for (const changed of [
    { cellContentInsets: insets({ top: base.top + 1 }) },
    { cellContentInsets: insets({ bottom: base.bottom + 1 }) },
    { cellMinimumContentInsets: new Map([[target.id, { top: 3, bottom: 0 }]]) },
  ] as Partial<TableFlowDeps>[])
    expect(
      placementFromPrevious(row, previous, wide, 2.5, top, { ...deps, ...changed })
    ).toBeNull();
  // Left and right insets move x only, which the move recomputes: not a vertical input.
  const sideways = { cellContentInsets: insets({ left: base.left + 1 }) } as Partial<TableFlowDeps>;
  expect(
    placementFromPrevious(row, previous, wide, 2.5, top, { ...deps, ...sideways })
  ).not.toBeNull();
  const realigned: SemanticTableRow = {
    ...row,
    cells: row.cells.map((cell, index) => (index === 1 ? { ...cell, vAlign: 'bottom' } : cell)),
  };
  expect(placementFromPrevious(realigned, previous, wide, 2.5, top, deps)).toBeNull();
});

for (const numeric of [false, true])
  test(`compact ${numeric ? 'numeric' : 'ordinary'} offers validate inputs before direct placement`, async () => {
    const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
    const { createBodyWidthGroup } = await import('../table-body-width-group.ts');
    const { row, deps, wide, top, previous } = setup(numeric);
    const cells: import('../table-cell-width-placement.ts').CellWidthPlacement[] = [];
    expect(
      moveRowToWidths(row, previous, wide, 2.5, deps, (recipe) => {
        expect(recipe).not.toBeNull();
        cells.push(recipe!);
      })
    ).not.toBeNull();
    const group = createBodyWidthGroup([{ source: row, baseline: previous, cells }], 3, 'test')!;
    expect(group).not.toBeNull();
    const compact = group.rows[0]!;
    const candidate = {
      compact,
      baseline: { ...compact.baseline, cells: compact.cells.map((cell) => cell.baseline) },
    };
    const reused = placementFromPrevious(row, candidate, wide, 2.5, top, deps);
    expect(reused).not.toBeNull();
    const fresh = layoutRowFragment(row, wide, 2.5, top, false, 0, {
      ...deps,
      cache: createParagraphLayoutCache<never>(),
    });
    expect(JSON.stringify(reused!.record)).toBe(JSON.stringify(fresh.record));
    for (const shiftedTop of [0, top + 1, 311.125]) {
      const shifted = placementFromPrevious(row, candidate, wide, 2.5, shiftedTop, deps);
      expect(shifted).not.toBeNull();
      const freshShifted = layoutRowFragment(row, wide, 2.5, shiftedTop, false, 0, {
        ...deps,
        cache: createParagraphLayoutCache<never>(),
      });
      expect(shifted!.record).toEqual(freshShifted.record);
      expect(shifted!.bottom).toBe(freshShifted.bottom);
    }
    expect(placementFromPrevious({ ...row }, candidate, wide, 2.5, top, deps)).toBeNull();
    for (const changed of [
      { cache: createParagraphLayoutCache<never>() },
      { defaultTabStopPt: 72 },
      { displayMode: 'original' as const },
      { compatibilityMode: 14 },
      { measurer: { ...measurer } },
    ])
      for (const at of [top, top + 1])
        expect(
          placementFromPrevious(row, candidate, wide, 2.5, at, { ...deps, ...changed })
        ).toBeNull();
    const target = row.cells[0]!;
    const base = cellContentInsets(target, true);
    for (const side of ['left', 'right', 'top', 'bottom'] as const)
      expect(
        placementFromPrevious(row, candidate, wide, 2.5, top, {
          ...deps,
          cellContentInsets: new Map([[target.id, { ...base, [side]: base[side] + 1 }]]),
        })
      ).toBeNull();
    for (const at of [top, top + 1])
      expect(placementFromPrevious(row, candidate, [10, 10, 10], 2.5, at, deps)).toBeNull();
    if (numeric)
      expect(placementFromPrevious(row, candidate, [100, 100, 110], 2.5, top, deps)).toBeNull();
  });
