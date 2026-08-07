import { selectReferenceChunks } from "./compression";
import type { PromptPackOptions, ReferenceContextPack, ReferenceIngestionResult } from "./types";

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

export function packReferenceContext(files: ReferenceIngestionResult[], options: PromptPackOptions = {}): ReferenceContextPack {
  const maxSummaryChars = normalizeLimit(options.maxSummaryChars, 1200, 1200);
  const maxChunkChars = normalizeLimit(options.maxChunkChars, 1200, 1200);
  const maxChunksPerFile = normalizeLimit(options.maxChunksPerFile, 8, 8);
  const maxTotalChars = normalizeLimit(options.maxTotalChars, 12000, 12000);
  const accepted = files.filter((file) => file.quality === "high" || file.quality === "medium");
  const rejected = files.length - accepted.length;
  const warnings = rejected ? [`Excluded ${rejected} low-quality reference file${rejected === 1 ? "" : "s"}.`] : [];
  const sections: string[] = ["Reference context for this iPolloWork template task:"];

  for (const [index, file] of accepted.entries()) {
    const chunks = selectReferenceChunks(file.chunks, { maxChunks: maxChunksPerFile, maxChunkChars });
    sections.push([
      "",
      `File ${index + 1}: ${file.fileName}`,
      `Type: ${file.mimeType}`,
      `Quality: ${file.quality}`,
      "Use policy: extracted context only; original file not attached by default.",
      "",
      "Summary:",
      truncate(file.summary, maxSummaryChars),
      "",
      "Relevant excerpts:",
      ...chunks.map((chunk) => {
        const label = chunk.page ? `[page ${chunk.page}]` : chunk.rowRange ? `[rows ${chunk.rowRange[0]}-${chunk.rowRange[1]}]` : "[excerpt]";
        return `${label} ${chunk.text}`;
      }),
    ].join("\n"));
  }

  if (accepted.length) {
    sections.push([
      "",
      "When applying the selected template:",
      "- Prefer explicit facts from these excerpts.",
      "- Do not invent missing evidence.",
      "- Preserve the selected template layout and visual contract.",
    ].join("\n"));
  }

  const promptText = truncate(sections.join("\n"), maxTotalChars);
  return { files: accepted, promptText, totalChars: promptText.length, warnings };
}
