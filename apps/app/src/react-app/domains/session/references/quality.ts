import type { ReferenceChunk, ReferenceQuality } from "./types";

const PDF_METADATA_PATTERNS = [
  /\bChromium\b/i,
  /\bSkia\/PDF\b/i,
  /^\s*(?:Producer|Creator|CreationDate|ModDate|CIDFont|ToUnicode|FontDescriptor)\s*:?.*$/i,
];

const GARBLE_PATTERN = /[\uFFFD\u25A0-\u25A3]|(?:[^\p{L}\p{N}\p{P}\p{Zs}\r\n\t]){2,}/gu;
const READABLE_PATTERN = /[\p{L}\p{N}]/gu;

export function cleanReferenceText(text: string): { text: string; warnings: string[] } {
  const warnings = new Set<string>();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (PDF_METADATA_PATTERNS.some((pattern) => pattern.test(line))) {
        warnings.add("Removed PDF renderer metadata.");
        return false;
      }
      return true;
    });

  const seen = new Set<string>();
  const deduped = lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { text: deduped.join("\n"), warnings: [...warnings] };
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

  const garbled = text.match(GARBLE_PATTERN)?.join("").length ?? 0;
  const readable = text.match(READABLE_PATTERN)?.join("").length ?? 0;
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
