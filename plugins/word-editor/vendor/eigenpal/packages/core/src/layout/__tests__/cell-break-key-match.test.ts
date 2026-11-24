import { expect, test } from 'bun:test';
import {
  cellBreakKeyParts,
  cellBreakKeyPartsMatch,
  sameCellBreakKeyParts,
  type CellBreakKeyParts,
} from '../cell-break-key.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { load } from './table-row-keep-fixtures.ts';

test('the allocation-free key match agrees with building and comparing the parts', () => {
  const paragraph = load('<w:p><w:r><w:t>Text</w:t></w:r></w:p>').root as OoxmlElement;
  const tokens = { drawing: 'd', projection: 'p' };
  const deps = {
    producer: 'unit',
    drawingTokenForParagraph: () => tokens.drawing,
    projectionTokenForParagraph: () => tokens.projection,
    inlineDrawingLayout: undefined,
  } as unknown as TableFlowDeps;
  const built = cellBreakKeyParts(paragraph, deps, true, false, false);
  // A part added to the builder must be added to the match too.
  expect(Object.keys(built).sort()).toEqual(
    [
      'producer',
      'drawing',
      'drawingContext',
      'projection',
      'inTableCell',
      'cellEndMark',
      'rowsClearOutOfCellFloats',
    ].sort()
  );
  const agree = (known: CellBreakKeyParts, inTable: boolean, endMark: boolean, clear: boolean) =>
    expect(cellBreakKeyPartsMatch(paragraph, deps, inTable, endMark, clear, known)).toBe(
      sameCellBreakKeyParts(cellBreakKeyParts(paragraph, deps, inTable, endMark, clear), known)
    );
  agree(built, true, false, false);
  for (const key of Object.keys(built) as (keyof CellBreakKeyParts)[]) {
    const value = built[key];
    const changed = { ...built, [key]: typeof value === 'string' ? `${value}x` : !value };
    agree(changed, true, false, false);
    expect(cellBreakKeyPartsMatch(paragraph, deps, true, false, false, changed)).toBe(false);
  }
  agree(built, false, false, false);
  agree(built, true, true, false);
  agree(built, true, false, true);
  tokens.drawing = '';
  agree(built, true, false, false);
  tokens.projection = 'q';
  agree(built, true, false, false);
});
