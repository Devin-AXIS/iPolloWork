import type { Cell, CellChange, Sheet } from './api.ts';
import { parseDelimitedSpreadsheet, serializeDelimitedSpreadsheet } from './delimited.ts';
import { addressOf, cellPosition, maxCellChanges, sheetLimits } from './file-contract.ts';

export type Point = { row: number; column: number };
export type Range = { start: Point; end: Point };
export type Changes = Record<string, CellChange>;
export const noChanges: Changes = {};
export const firstCell = { row: 1, column: 1 };
export const singleCell = (point: Point): Range => ({ start: point, end: point });
export const editKey = (sheet: string, address: string) => JSON.stringify([sheet, address]);
export const cellAddress = ({ row, column }: Point) => addressOf(row, column);
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function rangeBounds({ start, end }: Range) {
  return { top: Math.min(start.row, end.row), bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column), right: Math.max(start.column, end.column) };
}

export function withinRange(point: Point, bounds: ReturnType<typeof rangeBounds>) {
  return point.row >= bounds.top && point.row <= bounds.bottom
    && point.column >= bounds.left && point.column <= bounds.right;
}

export function blockedCells(sheet: Sheet) {
  return (sheet.blocked ?? []).flatMap(range => {
    const [first, last] = range.split(':', 2);
    const start = first && cellPosition(first);
    const end = last && cellPosition(last);
    return start && end ? [{ first, bounds: rangeBounds({ start, end }) }] : [];
  });
}

export function canEditCell(sheet: Sheet, point: Point, original: Cell | undefined, blocked: ReturnType<typeof blockedCells>) {
  if (sheet.protected || original?.kind === 'formula' || original?.kind === 'locked') return false;
  return !blocked.some(range => range.first !== cellAddress(point) && withinRange(point, range.bounds));
}

function kindFor(value: string, original: Cell | undefined, delimited: boolean): CellChange['kind'] {
  if (!value) return 'empty';
  if (delimited || original?.kind === 'text') return 'text';
  if ((original?.kind === 'boolean' || !original) && /^(true|false)$/i.test(value)) return 'boolean';
  if (numeric.test(value) && Number.isFinite(Number(value)) && !/^[+-]?0\d/.test(value)) return 'number';
  return 'text';
}

export function cellChange(sheet: Sheet, point: Point, value: string, original: Cell | undefined, delimited: boolean, kind?: CellChange['kind']) {
  let type = kind ?? kindFor(value, original, delimited);
  const expanded = point.row > sheet.rows || point.column > sheet.columns;
  if (expanded && type === 'empty') type = 'text';
  const same = !expanded && value === (original?.value ?? '') && (!value || type === original?.kind);
  return same ? undefined : { address: cellAddress(point), sheet: sheet.name, kind: type, value };
}

export function rangeText(range: Range, read: (point: Point) => string) {
  const { top, bottom, left, right } = rangeBounds(range);
  if ((bottom - top + 1) * (right - left + 1) > maxCellChanges) return;
  if (top === bottom && left === right) {
    const value = read({ row: top, column: left });
    if (!/[\t\r\n]/.test(value)) return value;
  }
  const values = Array.from({ length: bottom - top + 1 }, (_, row) =>
    Array.from({ length: right - left + 1 }, (_, column) => read({ row: row + top, column: column + left })));
  return serializeDelimitedSpreadsheet(values, '\t').slice(0, -1);
}

export function clipboardCells(text: string, start: Point) {
  if (text.length > 2_000_000) return;
  const rows = /[\t\r\n]/.test(text) ? parseDelimitedSpreadsheet(text, '\t') : [[text]];
  let count = 0;
  const cells: Array<{ point: Point; value: string }> = [];
  let columnEnd = 0;
  for (const [row, values] of rows.entries()) {
    columnEnd = Math.max(columnEnd, values.length);
    for (const [column, value] of values.entries()) {
      const point = { row: row + start.row, column: column + start.column };
      if (++count > maxCellChanges || point.row > sheetLimits.rows || point.column > sheetLimits.columns || value.length > 32767)
        return;
      cells.push({ point, value });
    }
  }
  return { cells, range: { start, end: { row: start.row + rows.length - 1, column: start.column + columnEnd - 1 } } };
}
