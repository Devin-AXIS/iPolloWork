import type { ReferenceChunk, ReferenceIngestionResult } from "./types";

const TOPIC_KEYWORDS = [
  "audience",
  "target user",
  "goal",
  "requirement",
  "background",
  "scope",
  "conclusion",
  "deliverable",
  "brand",
  "cta",
  "受众",
  "目标用户",
  "面向谁",
  "目标",
  "需求",
  "要求",
  "背景",
  "范围",
  "结论",
  "交付物",
  "品牌",
];

function normalizeLimit(value: number | undefined, fallback: number, ceiling: number) {
  const limit = value ?? fallback;
  return Number.isFinite(limit) ? Math.min(ceiling, Math.max(0, Math.floor(limit))) : fallback;
}

function truncate(text: string, max: number) {
  const limit = normalizeLimit(max, 1200, 1200);
  if (text.length <= limit) return text;
  if (limit < 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function chunkScore(chunk: ReferenceChunk) {
  const text = `${chunk.heading ?? ""}\n${chunk.text}`.toLowerCase();
  let score = chunk.page === 1 ? 3 : 0;
  for (const keyword of TOPIC_KEYWORDS) {
    if (text.includes(keyword)) score += 2;
  }
  if (chunk.heading) score += 1;
  return score;
}

export function selectReferenceChunks(
  chunks: ReferenceChunk[],
  options: { maxChunks?: number; maxChunkChars?: number } = {},
) {
  const maxChunks = normalizeLimit(options.maxChunks, 8, 8);
  const maxChunkChars = normalizeLimit(options.maxChunkChars, 1200, 1200);
  return [...chunks]
    .sort((a, b) => chunkScore(b) - chunkScore(a) || a.id.localeCompare(b.id))
    .slice(0, maxChunks)
    .map((chunk) => ({ ...chunk, text: truncate(chunk.text, maxChunkChars) }));
}

export function buildDeterministicSummary(
  result: Pick<ReferenceIngestionResult, "fileName" | "mimeType" | "extractedText" | "chunks" | "warnings">,
) {
  const topics = TOPIC_KEYWORDS
    .filter((keyword) => result.extractedText.toLowerCase().includes(keyword))
    .slice(0, 8);
  const pages = new Set(result.chunks.map((chunk) => chunk.page).filter((page): page is number => typeof page === "number"));
  return [
    `File: ${result.fileName}`,
    `Type: ${result.mimeType}`,
    pages.size ? `Pages extracted: ${pages.size}` : "",
    `Readable text: about ${result.extractedText.length} chars`,
    topics.length ? `Detected topics: ${topics.join(", ")}` : "Detected topics: not enough labeled structure",
    result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
