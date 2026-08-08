import { parseDelimitedSpreadsheet } from "../../spreadsheets/delimited";
import { chunkPlainText } from "../chunking";
import type { ExtractedReferenceContent } from "../types";

const TABLE_PROFILE_MAX_CHARS = 12_000;
const CSV_CELL_MAX_CHARS = 500;
const JSON_PROFILE_MAX_CHARS = 12_000;
const JSON_SAMPLE_MAX_DEPTH = 4;
const JSON_SAMPLE_MAX_NODES = 240;
const JSON_SAMPLE_MAX_STRING_CHARS = 240;

function boundProfile(profile: string, maxChars = TABLE_PROFILE_MAX_CHARS): string {
  if (profile.length <= maxChars) return profile;
  const marker = "\n[truncated]";
  return `${profile.slice(0, maxChars - marker.length)}${marker}`;
}

function compactCsvCell(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > CSV_CELL_MAX_CHARS
    ? `${trimmed.slice(0, CSV_CELL_MAX_CHARS)}... [truncated]`
    : trimmed;
}

function profileCsv(fileName: string, text: string): ExtractedReferenceContent {
  const [headerRow = [], ...parsedRows] = parseDelimitedSpreadsheet(text, ",");
  const rows = parsedRows.filter((row) => row.some((cell) => cell.trim()));
  const headers = headerRow.map(compactCsvCell);
  const sample = rows.slice(0, 20);
  const profile = boundProfile([
    `File: ${fileName}`,
    "Table type: CSV",
    `Rows: ${rows.length}`,
    `Columns: ${headers.length}`,
    `Column names: ${headers.join(", ")}`,
    "Sample rows:",
    ...sample.map((row, index) => `${index + 1}. ${row.map(compactCsvCell).join(" | ")}`),
  ].join("\n"));

  return {
    text: profile,
    chunks: chunkPlainText({ source: fileName, text: profile }),
    metadata: { rows: rows.length, columns: headers.length },
  };
}

function compactShape(value: unknown, depth = 0): unknown {
  if (depth >= JSON_SAMPLE_MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => compactShape(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, child]) => [key, compactShape(child, depth + 1)]));
  }
  return typeof value;
}

function compactJsonSample(value: unknown, state = { remaining: JSON_SAMPLE_MAX_NODES }, depth = 0): unknown {
  if (state.remaining <= 0) return "[truncated]";
  state.remaining -= 1;
  if (typeof value === "string") {
    return value.length > JSON_SAMPLE_MAX_STRING_CHARS
      ? `${value.slice(0, JSON_SAMPLE_MAX_STRING_CHARS)}... [truncated]`
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= JSON_SAMPLE_MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) {
    const sample = value.slice(0, 10).map((item) => compactJsonSample(item, state, depth + 1));
    if (value.length > sample.length) sample.push("[truncated]");
    return sample;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const sample = Object.fromEntries(entries.slice(0, 20).map(([key, child]) => [key, compactJsonSample(child, state, depth + 1)]));
  if (entries.length > 20) Object.assign(sample, { __truncated__: `${entries.length - 20} more keys` });
  return sample;
}

function boundJsonProfile(profile: string): string {
  return boundProfile(profile, JSON_PROFILE_MAX_CHARS);
}

function profileJson(fileName: string, text: string): ExtractedReferenceContent {
  const parsed = JSON.parse(text) as unknown;
  const topType = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
  const sampleSource = Array.isArray(parsed) ? parsed.slice(0, 20) : parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed).slice(0, 20)) : parsed;
  const sample = compactJsonSample(sampleSource);
  const profile = boundJsonProfile([
    `File: ${fileName}`,
    `Top-level type: ${topType}`,
    Array.isArray(parsed) ? `Array length: ${parsed.length}` : "",
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? `Top-level keys: ${Object.keys(parsed).slice(0, 30).join(", ")}` : "",
    "Compact shape:",
    JSON.stringify(compactShape(parsed), null, 2),
    "Sample:",
    JSON.stringify(sample, null, 2),
  ].filter(Boolean).join("\n"));

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
