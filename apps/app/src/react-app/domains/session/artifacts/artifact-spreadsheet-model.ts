import type { Data } from "./open-target";
import {
  parseDelimitedSpreadsheet,
  serializeDelimitedSpreadsheet,
  type SpreadsheetRows,
} from "../spreadsheets/delimited";
export type { SpreadsheetRows } from "../spreadsheets/delimited";

function extension(name: string) {
  const clean = name.toLowerCase().split(/[?#]/)[0] ?? name.toLowerCase();
  const index = clean.lastIndexOf(".");

  return index >= 0 ? clean.slice(index + 1) : "";
}

function delimiterForName(name: string) {
  return extension(name) === "tsv" ? "\t" : ",";
}

function normalizeRows(rows: unknown[][]): SpreadsheetRows {
  const next = rows.map((row) => row.map((cell) => cell == null ? "" : String(cell)));

  return next.length ? next : [[""]];
}

export async function parseSpreadsheet(input: { name: string; content: Data }): Promise<SpreadsheetRows> {
  const ext = extension(input.name);

  if (ext === "csv" || ext === "tsv") {
    return parseDelimitedSpreadsheet(input.content.kind === "text" ? input.content.data : "", delimiterForName(input.name));
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(input.content.kind === "binary" ? input.content.data : new ArrayBuffer(0), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [[""]];
  }

  const sheet = workbook.Sheets[firstSheetName];

  return normalizeRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: true }) as unknown[][]);
}

export async function serializeSpreadsheet(name: string, rows: SpreadsheetRows): Promise<Data> {
  const ext = extension(name);

  if (ext === "csv" || ext === "tsv") {
    return { kind: "text", data: serializeDelimitedSpreadsheet(rows, delimiterForName(name)) };
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");

  const bookType = ext === "xls" ? "xls" : ext === "ods" ? "ods" : "xlsx";
  const output = XLSX.write(workbook, { type: "array", bookType });

  if (output instanceof ArrayBuffer) {
    return { kind: "binary", data: output };
  }

  const view = output as Uint8Array;
  const copy = new Uint8Array(view.byteLength);

  copy.set(view);

  return { kind: "binary", data: copy.buffer };
}
