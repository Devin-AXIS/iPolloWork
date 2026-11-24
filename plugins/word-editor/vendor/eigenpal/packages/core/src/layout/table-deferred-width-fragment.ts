import {
  bodyWidthGroupHolds,
  materializeBodyWidthGroup,
  type BodyWidthGroup,
} from './table-body-width-group.ts';
import {
  createTableBorderWidthProof,
  tableBorderWidthProofHolds,
  type TableBorderWidthProof,
} from './table-border-width-proof.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { annotateRowIndex, columnEdgesFromWidths } from './semantic-table-interaction.ts';
import type {
  TableCellFragmentRecord,
  TableRowFragmentRecord,
  TableFragmentRecord,
} from './semantic-records.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';

export interface WidthHeaderPlacement {
  readonly record: TableRowFragmentRecord;
  readonly insets: ReadonlyMap<string, CellContentInsets> | undefined;
}
export interface DeferredWidthRecipe {
  readonly body: BodyWidthGroup;
  readonly bodySources: readonly SemanticTableRow[];
  readonly sources: readonly SemanticTableRow[];
  readonly headers: readonly WidthHeaderPlacement[];
  readonly border: TableBorderWidthProof;
  readonly borderKey: string;
  readonly ordinals: Map<string, number>;
}
const recipes = new WeakMap<TableFragmentRecord, DeferredWidthRecipe>();
export const deferredWidthRecipe = (fragment: TableFragmentRecord) => recipes.get(fragment);
export const rememberDeferredWidthRecipe = (
  fragment: TableFragmentRecord,
  recipe: DeferredWidthRecipe
) => void recipes.set(fragment, recipe);

/** Finite vertical inputs keep deferred finalization within the captured geometry. */
function finiteCell(cell: TableCellFragmentRecord): boolean {
  return (
    Number.isFinite(cell.box.y) &&
    Number.isFinite(cell.box.height) &&
    cell.blocks.every(
      (block) =>
        block.kind === 'paragraph' &&
        [block.box.y, block.box.height, block.spacing.before, block.spacing.after].every(
          Number.isFinite
        ) &&
        block.lines.every(
          (line) =>
            !line.drawings?.length &&
            [
              line.box.y,
              line.box.height,
              line.baseline,
              line.leading,
              line.trailingSpacing ?? 0,
            ].every(Number.isFinite)
        )
    )
  );
}

/** Insets participate in merge and vertical-alignment finalization. */
export function sameWidthHeaderInsets(a: WidthHeaderPlacement, b: WidthHeaderPlacement): boolean {
  if (a.insets === b.insets) return true;
  if (!a.insets || !b.insets || a.insets.size !== b.insets.size) return false;
  for (const [id, before] of a.insets) {
    const after = b.insets.get(id);
    if (
      !after ||
      before.top !== after.top ||
      before.right !== after.right ||
      before.bottom !== after.bottom ||
      before.left !== after.left
    )
      return false;
  }
  return true;
}

/** Capture original raw headers, not an earlier transformed fragment or layout. */
export function captureDeferredWidthRecipe(
  fragment: TableFragmentRecord,
  body: BodyWidthGroup,
  headers: readonly WidthHeaderPlacement[],
  headerSources: readonly SemanticTableRow[],
  structure: SemanticTableStructure
): void {
  if (
    !headers.length ||
    headers.length !== headerSources.length ||
    headers.length > 256 ||
    headers.some(
      ({ record }) => !record.isHeaderRepeat || record.isContinuation || record.hasContinuation
    )
  )
    return;
  if (
    headers.some(
      ({ record, insets }) =>
        !Number.isFinite(record.box.y) ||
        !Number.isFinite(record.box.height) ||
        !record.cells.every(finiteCell) ||
        (insets &&
          [...insets.values()].some(
            (inset) => ![inset.top, inset.right, inset.bottom, inset.left].every(Number.isFinite)
          ))
    ) ||
    body.rows.some(
      (row) =>
        !Number.isFinite(row.baseline.box.y) ||
        !Number.isFinite(row.baseline.box.height) ||
        !row.cells.every((cell) => finiteCell(cell.baseline))
    )
  )
    return;
  const bodySources = body.rows.map((row) => row.source);
  const sources = [...headerSources, ...bodySources];
  const border = createTableBorderWidthProof(
    sources,
    structure.tableBorders,
    structure.columnWidthsPt
  );
  if (!border || structure.cellSpacingPt !== 0) return;
  const ordinals = new Map(fragment.rows.map((row) => [row.id, row.rowIndex!]));
  recipes.set(fragment, {
    body,
    bodySources,
    sources,
    headers,
    border,
    borderKey: JSON.stringify(structure.tableBorders),
    ordinals,
  });
}

/** All source, scope, width, and border decisions precede deferred publication. */
export function deferredWidthRecipeHolds(
  recipe: DeferredWidthRecipe,
  sources: ReadonlyMap<string, SemanticTableRow>,
  structure: SemanticTableStructure,
  left: number,
  scope: string
): boolean {
  return (
    recipe.sources.every((row) => sources.get(row.id) === row) &&
    structure.cellSpacingPt === 0 &&
    JSON.stringify(structure.tableBorders) === recipe.borderKey &&
    tableBorderWidthProofHolds(recipe.border, structure.columnWidthsPt) &&
    bodyWidthGroupHolds(recipe.body, recipe.bodySources, structure.columnWidthsPt, left, scope)
  );
}

interface DeferredInput {
  readonly recipe: DeferredWidthRecipe;
  readonly headers: readonly WidthHeaderPlacement[];
  readonly structure: SemanticTableStructure;
  readonly left: number;
  readonly scope: string;
  readonly id: string;
  readonly tableId: string;
  readonly fragmentIndex: number;
  readonly top: number;
  readonly height: number;
}

/** One memoized getter per fragment; its closure holds compact inputs only. */
export function deferredWidthFragment(input: DeferredInput): TableFragmentRecord {
  const { recipe, headers, structure, left, scope } = input;
  let rows: readonly TableRowFragmentRecord[] | undefined;
  return {
    kind: 'table',
    id: input.id,
    tableId: input.tableId,
    fragmentIndex: input.fragmentIndex,
    get rows() {
      if (rows) return rows;
      const body = materializeBodyWidthGroup(
        recipe.body,
        recipe.bodySources,
        structure.columnWidthsPt,
        left,
        scope
      );
      if (!body) throw new Error('Validated table width recipe failed to materialize');
      const raw = [...headers.map((header) => header.record), ...body];
      const insets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
      for (const header of headers) if (header.insets) insets.set(header.record, header.insets);
      const finalized = finalizeTableRows(
        raw,
        structure,
        recipe.sources,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        insets,
        new Set(body)
      );
      rows = finalized.map((row) => annotateRowIndex(row, recipe.ordinals));
      return rows;
    },
    box: {
      x: left,
      y: input.top,
      width: structure.columnWidthsPt.reduce((sum, width) => sum + width, 0),
      height: input.height,
    },
    nestingDepth: 0,
    columnEdges: columnEdgesFromWidths(structure.columnWidthsPt),
  };
}
