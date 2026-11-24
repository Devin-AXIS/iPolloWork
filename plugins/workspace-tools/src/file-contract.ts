import type { Document } from './api.ts';

export type FileDocument = Document & { writable: boolean; delimited?: boolean; legacy?: boolean };

export const markdownExtensions = ['md', 'markdown'];
export const binarySpreadsheetExtensions = ['xlsx', 'xls', 'ods'];
export const spreadsheetExtensions = [...binarySpreadsheetExtensions, 'csv', 'tsv'];
export const sheetLimits = { rows: 1_048_576, columns: 16_384 } as const;
export const maxCellChanges = 1000;

export function addressOf(row: number, column: number) {
  let letters = '';
  for (let index = column; index > 0; index = Math.floor((index - 1) / 26)) {
    letters = String.fromCharCode(65 + (index - 1) % 26) + letters;
  }
  return letters + row;
}

export function cellPosition(address: string) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address);
  if (!match?.[1] || !match[2]) return;
  const row = Number(match[2]);
  const column = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  if (row <= sheetLimits.rows && column <= sheetLimits.columns) return { row, column };
}
