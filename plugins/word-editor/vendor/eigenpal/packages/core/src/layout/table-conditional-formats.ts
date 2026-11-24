// Which of a table style's conditional formats apply to one cell: `w:tblLook`, the header
// block and the layering order of the result.
import type { OoxmlElement } from '@docx-editor.dev/core/store';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * `w:tblLook` (17.4.56): which conditional formats of the table style are live.
 *
 * The element has two encodings: the legacy `w:val` bitmask and six named attributes
 * (`w:firstRow`, `w:lastRow`, `w:firstColumn`, `w:lastColumn`, `w:noHBand`, `w:noVBand`).
 * They are never merged:
 *
 *   - With any named attribute present, the named attributes are the whole statement and
 *     `w:val` is ignored. A named attribute the element leaves out reads as ON, so
 *     `<w:tblLook w:firstRow="1"/>` also turns on the last row, both columns, and both
 *     "no band" flags.
 *   - With only `w:val`, the bitmask decides.
 *   - With neither, including no element at all, the look is `04A0`: header row, first
 *     column and row banding.
 *
 * Measured against reference renders in compatibility modes 12, 14 and 15 with a style
 * that shades every condition differently.
 */
export interface TableLook {
  readonly firstRow: boolean;
  readonly lastRow: boolean;
  readonly firstColumn: boolean;
  readonly lastColumn: boolean;
  readonly rowBanding: boolean;
  readonly columnBanding: boolean;
}

/** `04A0`: the look of a table with no `w:tblLook`, or one that states nothing. */
const DEFAULT_TABLE_LOOK: TableLook = Object.freeze({
  firstRow: true,
  lastRow: false,
  firstColumn: true,
  lastColumn: false,
  rowBanding: true,
  columnBanding: false,
});

const NAMED_LOOK_ATTRIBUTES = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'noHBand',
  'noVBand',
] as const;

function onOff(node: OoxmlElement, name: string): boolean | undefined {
  const raw = attributeValue(node, name);
  if (raw === undefined) return undefined;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * `w:tblLook` is read from the TABLE's own `w:tblPr` only, never cascaded from the style it
 * names. The schema admits `w:tblLook` inside a table style's `w:tblPr`, but the look
 * (ECMA-376 Part 1 §17.4.55) selects which conditional formats this table uses. It is a
 * property of this table's use of the style, not of the style itself.
 */
export function readTableLook(tblPr: OoxmlElement | undefined): TableLook {
  return tableLookOf(tblPr && childNamed(tblPr, 'tblLook'));
}

/** {@link readTableLook} for the `w:tblLook` element itself. */
export function tableLookOf(look: OoxmlElement | null | undefined): TableLook {
  if (!look) return DEFAULT_TABLE_LOOK;
  if (NAMED_LOOK_ATTRIBUTES.some((name) => attributeValue(look, name) !== undefined)) {
    // A named attribute the element leaves out reads as on.
    const named = (name: (typeof NAMED_LOOK_ATTRIBUTES)[number]): boolean =>
      onOff(look, name) ?? true;
    return {
      firstRow: named('firstRow'),
      lastRow: named('lastRow'),
      firstColumn: named('firstColumn'),
      lastColumn: named('lastColumn'),
      rowBanding: !named('noHBand'),
      columnBanding: !named('noVBand'),
    };
  }
  const rawVal = attributeValue(look, 'val');
  if (rawVal === undefined || !/^[0-9A-Fa-f]{1,4}$/.test(rawVal)) return DEFAULT_TABLE_LOOK;
  // The legacy bitmask: 0x0020 firstRow, 0x0040 lastRow, 0x0080 firstColumn,
  // 0x0100 lastColumn, 0x0200 NO row banding, 0x0400 NO column banding.
  const mask = Number.parseInt(rawVal, 16);
  return {
    firstRow: (mask & 0x0020) !== 0,
    lastRow: (mask & 0x0040) !== 0,
    firstColumn: (mask & 0x0080) !== 0,
    lastColumn: (mask & 0x0100) !== 0,
    rowBanding: (mask & 0x0200) === 0,
    columnBanding: (mask & 0x0400) === 0,
  };
}

/**
 * ECMA-376 Part 1 §17.7.6 layers a table style's conditional formats weakest first: the whole table,
 * then the row bands, then the column bands, then first/last column, then first/last row,
 * then the four corners. A column band paints over a row band where the two cross.
 */
const CONDITION_PRECEDENCE = [
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'firstCol',
  'lastCol',
  'firstRow',
  'lastRow',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;

/**
 * How many leading rows form the table's header block.
 *
 * The header row condition does not stop at row 0. With the look's header row on, it covers
 * row 0 and then every following row that repeats as a header (`w:tblHeader`, 17.4.49),
 * whether or not row 0 itself repeats. With the header row off, the block is the run of
 * repeating rows that starts at row 0, or nothing. Rows in the block take no row band, and
 * banding counts from the first row after it. The last row format still reaches a block row
 * when the header row format is off.
 *
 * `repeats(rowIndex)` answers for one row; it is asked in order and only while the run lasts.
 */
export function headerBlockRowCount(
  look: TableLook,
  rowCount: number,
  repeats: (rowIndex: number) => boolean
): number {
  if (rowCount === 0 || (!look.firstRow && !repeats(0))) return 0;
  let count = 1;
  while (count < rowCount && repeats(count)) count += 1;
  return count;
}

/**
 * Which of the style's conditional formats apply to one cell, weakest first.
 *
 * Everything is derived from the look and the cell's place in the grid. A `w:cnfStyle`
 * (17.4.7, 17.4.8) is a record the producer wrote of the conditions it applied; it can be
 * stale after an edit and is not read. Structural conditions key on the GRID COLUMN the
 * cell occupies, so a `gridSpan` or a `w:gridBefore` earlier in the row cannot shift them.
 */
export function conditionalTypesFor(input: {
  readonly look: TableLook;
  readonly rowIndex: number;
  readonly rowCount: number;
  /** Leading rows of the header block ({@link headerBlockRowCount}). */
  readonly headerRows: number;
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly columnCount: number;
}): readonly string[] {
  const active = new Set<string>();
  const { look, rowIndex, rowCount, headerRows, gridColumn, gridSpan, columnCount } = input;
  const inHeaderBlock = rowIndex < headerRows;
  const isFirstRow = look.firstRow && inHeaderBlock;
  // The header row format, where it covers the last row, takes it from the last row format.
  const isLastRow = look.lastRow && rowIndex === rowCount - 1 && !isFirstRow;
  const isFirstColumn = look.firstColumn && gridColumn === 0;
  const isLastColumn = look.lastColumn && gridColumn + gridSpan >= columnCount;

  if (look.columnBanding && !isFirstColumn && !isLastColumn) {
    const band = gridColumn - (look.firstColumn ? 1 : 0);
    active.add(band % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  if (look.rowBanding && !inHeaderBlock && !isLastRow) {
    const band = rowIndex - headerRows;
    active.add(band % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (isFirstColumn) active.add('firstCol');
  if (isLastColumn) active.add('lastCol');
  if (isFirstRow) active.add('firstRow');
  if (isLastRow) active.add('lastRow');
  if (isFirstRow && isFirstColumn) active.add('nwCell');
  if (isFirstRow && isLastColumn) active.add('neCell');
  if (isLastRow && isFirstColumn) active.add('swCell');
  if (isLastRow && isLastColumn) active.add('seCell');

  const ordered: string[] = [];
  for (const condition of CONDITION_PRECEDENCE) if (active.has(condition)) ordered.push(condition);
  return ordered;
}

/**
 * The conditions a whole row is under: the cell conditions of one cell spanning the grid.
 *
 * Whether a row repeats (`w:tblHeader` through a conditional format) decides how far the
 * header block reaches, and the block decides the row's conditions, so the caller reads the
 * repeat flags first with only row 0 as the header row.
 */
export function rowConditionTypes(
  look: TableLook,
  rowIndex: number,
  rowCount: number,
  headerRows: number,
  columnCount: number
): readonly string[] {
  const columns = Math.max(1, columnCount);
  return conditionalTypesFor({
    look,
    rowIndex,
    rowCount,
    headerRows,
    gridColumn: 0,
    gridSpan: columns,
    columnCount: columns,
  });
}
