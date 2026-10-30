import { normalizeLimit, selectReferenceChunks, truncate } from "./compression";
import type { PromptPackOptions, ReferenceContextPack, ReferenceIngestionResult } from "./types";

export function packReferenceContext(files: ReferenceIngestionResult[], options: PromptPackOptions = {}): ReferenceContextPack {
  const maxSummaryChars = normalizeLimit(options.maxSummaryChars, 300, 1200);
  const maxChunkChars = normalizeLimit(options.maxChunkChars, 500, 1200);
  const maxChunksPerFile = normalizeLimit(options.maxChunksPerFile, 3, 8);
  const maxTotalChars = normalizeLimit(options.maxTotalChars, 4000, 12000);
  const accepted = files.filter((file) => file.quality === "high" || file.quality === "medium");
  const rejected = files.length - accepted.length;
  const warnings = rejected ? [`Excluded ${rejected} low-quality reference file${rejected === 1 ? "" : "s"}.`] : [];
  if (!accepted.length) return { files: [], promptText: "", totalChars: 0, warnings };

  const sections: string[] = ["Reference preview for this template task (bounded; full evidence is in reference-context.json).", "Use extracted context only; original files are not attached by default."];

  for (const [index, file] of accepted.entries()) {
    const chunks = selectReferenceChunks(file.chunks, { maxChunks: maxChunksPerFile, maxChunkChars });
    sections.push([
      "",
      `File ${index + 1}: ${file.fileName}`,
      `Type: ${file.mimeType}`,
      `Quality: ${file.quality}`,
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

  sections.push([
    "",
    "When applying the selected template:",
    "- Use explicit facts; report missing evidence.",
    "- Treat the selected template as a visual and technical system, not a finished artifact to copy.",
    "- Derive the content structure from the current brief; retain sample content/layout only when it fits.",
    "- Preserve the template's design tokens, distinctive visual language, editor hooks, and export/runtime contracts.",
  ].join("\n"));

  const promptText = truncate(sections.join("\n"), maxTotalChars, 12000);
  return { files: accepted, promptText, totalChars: promptText.length, warnings };
}
