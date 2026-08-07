import { chunkPlainText } from "../chunking";
import type { ExtractedReferenceContent } from "../types";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function profileCsv(fileName: string, text: string): ExtractedReferenceContent {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map(parseCsvLine);
  const sample = rows.slice(0, 20);
  const profile = [
    `File: ${fileName}`,
    "Table type: CSV",
    `Rows: ${rows.length}`,
    `Columns: ${headers.length}`,
    `Column names: ${headers.join(", ")}`,
    "Sample rows:",
    ...sample.map((row, index) => `${index + 1}. ${row.join(" | ")}`),
  ].join("\n");

  return {
    text: profile,
    chunks: chunkPlainText({ source: fileName, text: profile }),
    metadata: { rows: rows.length, columns: headers.length },
  };
}

function compactShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 2).map(compactShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, child]) => [key, compactShape(child)]));
  }
  return typeof value;
}

function profileJson(fileName: string, text: string): ExtractedReferenceContent {
  const parsed = JSON.parse(text) as unknown;
  const topType = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
  const sample = Array.isArray(parsed) ? parsed.slice(0, 20) : parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed).slice(0, 20)) : parsed;
  const profile = [
    `File: ${fileName}`,
    `Top-level type: ${topType}`,
    Array.isArray(parsed) ? `Array length: ${parsed.length}` : "",
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? `Top-level keys: ${Object.keys(parsed).slice(0, 30).join(", ")}` : "",
    "Compact shape:",
    JSON.stringify(compactShape(parsed), null, 2),
    "Sample:",
    JSON.stringify(sample, null, 2),
  ].filter(Boolean).join("\n");

  return {
    text: profile,
    chunks: chunkPlainText({ source: fileName, text: profile }),
    metadata: { rows: Array.isArray(parsed) ? parsed.length : undefined },
  };
}

export async function extractTableReference(file: File): Promise<ExtractedReferenceContent> {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type.toLowerCase() === "application/json") return profileJson(file.name, text);
  return profileCsv(file.name, text);
}
