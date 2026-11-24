import { read, set_cptable, SSF, utils, writeXLSX } from 'xlsx';
import * as codepages from 'xlsx/dist/cpexcel.full.mjs';
import { Failure, type FileHost } from '../../_shared/workspace-document-files.ts';
import type { Cell, Sheet } from './api.ts';
import { endpoint } from './api.ts';
import { cellPosition, sheetLimits } from './file-contract.ts';
import { applyFileRoutes, inject } from './file-host.ts';
import { descendants, parseXml, parts } from './workbook.ts';

export const name = endpoint;
export { inject };

const maxCells = 100_000;
const formatter: { format(code: string | number, value: number, options: { date1904: boolean }): string } = SSF;
set_cptable(codepages);

function formatted(value: number, code: string | number, date1904: boolean, fallback: string) {
  try { return formatter.format(code, value, { date1904 }); }
  catch { return fallback; }
}

function verifyOds(bytes: Uint8Array) {
  const archive = parts(bytes);
  const content = parseXml(archive['content.xml']);
  let expanded = 0;
  for (const row of descendants(content, 'table-row')) {
    const repeat = Number(row.getAttribute('table:number-rows-repeated') ?? 1);
    if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > sheetLimits.rows) throw new Failure('too-large', 413);
    for (const cell of Array.from(row.childNodes)) {
      if (cell.nodeType !== 1) continue;
      const element = cell as (typeof row);
      if (element.localName !== 'table-cell' && element.localName !== 'covered-table-cell') continue;
      const columns = Number(element.getAttribute('table:number-columns-repeated') ?? 1);
      if (!Number.isSafeInteger(columns) || columns < 1 || columns > sheetLimits.columns) throw new Failure('too-large', 413);
      if (element.childNodes.length || element.hasAttribute('office:value-type') || element.hasAttribute('table:formula')) {
        expanded += repeat * columns;
        if (expanded > maxCells) throw new Failure('too-large', 413);
      }
    }
  }
}

function openLegacy(bytes: Uint8Array, path: string) {
  if (/\.ods$/i.test(path)) verifyOds(bytes);
  else {
    const header = Buffer.from(bytes.subarray(0, 8)).toString('hex');
    if (header !== 'd0cf11e0a1b11ae1' && !/^09(?:00|02|04|08)/.test(header)) throw new Failure('unsupported-file', 415);
  }
  try {
    const workbook = read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellNF: true });
    if (workbook.SheetNames.length > 120) throw new Failure('too-large', 413);
    let count = 0;
    const sheets = workbook.SheetNames.flatMap((name, index): Sheet[] => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet) return [];
      const cells: Cell[] = [];
      let rows = 1, columns = 1;
      for (const [address, cell] of Object.entries(worksheet)) {
        if (address.startsWith('!')) continue;
        const point = cellPosition(address);
        if (!point || ++count > maxCells) throw new Failure('too-large', 413);
        if (cell.t === 'z') continue;
        rows = Math.max(rows, point.row); columns = Math.max(columns, point.column);
        const value = cell.t === 'b' ? String(cell.v).toUpperCase() : String(cell.v ?? '');
        const kind = cell.f ? 'formula' : cell.F || cell.t === 'e' ? 'locked'
          : cell.t === 'n' ? 'number' : cell.t === 'b' ? 'boolean' : 'text';
        const input = cell.f ? '=' + cell.f : value;
        const display = cell.t === 'n' && typeof cell.v === 'number' && cell.z !== undefined
          ? formatted(cell.v, cell.z, Boolean(workbook.Workbook?.WBProps?.date1904), cell.w ?? value)
          : cell.w ?? value;
        cells.push({ address, value: input, kind, ...(display !== input && { display }) });
      }
      if (workbook.Workbook?.Sheets?.[index]?.Hidden) return [];
      const blocked = worksheet['!merges']?.map(range => utils.encode_range(range)) ?? [];
      for (const range of worksheet['!merges'] ?? []) {
        rows = Math.max(rows, range.e.r + 1); columns = Math.max(columns, range.e.c + 1);
      }
      return [{ name, rows, columns, cells, ...(blocked.length && { blocked }),
        ...(worksheet['!protect'] && { protected: true }) }];
    });
    if (!sheets.length) throw new Failure('unsupported-file', 415);
    return { workbook, sheets };
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('unsupported-file', 415);
  }
}

export function apply(ctx: FileHost) {
  return applyFileRoutes(ctx, {
    format: (code, value, date1904) => formatted(value, code, date1904, String(value)),
    readLegacy: (bytes, path) => openLegacy(bytes, path).sheets,
    convert: (bytes, path) => {
      const { workbook } = openLegacy(bytes, path);
      const output: unknown = writeXLSX(workbook, { type: 'buffer', compression: true });
      if (!(output instanceof Uint8Array)) throw new Failure('unsupported-file', 415);
      return output;
    },
  });
}
