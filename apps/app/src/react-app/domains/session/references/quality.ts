import type { ReferenceChunk, ReferenceQuality } from "./types";

const GARBLE_PATTERN = /[\uFFFD\u25A0-\u25A3]|(?:[^\p{L}\p{N}\p{P}\p{Zs}\r\n\t]){2,}/gu;
const READABLE_PATTERN = /[\p{L}\p{N}]+/gu;
function matchedCharacters(text: string, pattern: RegExp) {
  let count = 0;
  for (const match of text.matchAll(pattern)) count += match[0].length;
  return count;
}

export function cleanReferenceText(text: string): { text: string; warnings: string[] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  // Repeated lines can be real table values or requirements. Preserve evidence.
  return { text: lines.join("\n").trimEnd(), warnings: [] };
}

export function assessReferenceQuality(input: {
  text: string;
  chunks?: ReferenceChunk[];
  warnings?: string[];
}): { quality: ReferenceQuality; warnings: string[] } {
  const warnings = new Set(input.warnings ?? []);
  const text = input.text.trim();
  if (text.length < 30) {
    warnings.add("No reliable body text was extracted.");
    return { quality: text ? "low" : "failed", warnings: [...warnings] };
  }

  const garbled = matchedCharacters(text, GARBLE_PATTERN);
  const readable = matchedCharacters(text, READABLE_PATTERN);
  const garbledRatio = garbled / Math.max(text.length, 1);
  const readableRatio = readable / Math.max(text.replace(/\s/g, "").length, 1);

  if (garbledRatio > 0.1 || readableRatio < 0.6) {
    warnings.add("Extracted text appears noisy.");
    return { quality: "low", warnings: [...warnings] };
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const unique = new Set(lines.map((line) => line.toLowerCase())).size;
  if (lines.length >= 8 && unique / lines.length < 0.6) {
    warnings.add("Extracted text contains many repeated lines.");
    return { quality: "medium", warnings: [...warnings] };
  }

  return { quality: "high", warnings: [...warnings] };
}
