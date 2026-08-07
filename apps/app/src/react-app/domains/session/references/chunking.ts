import type { ReferenceChunk } from "./types";

export function estimateTokens(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const nonAsciiChars = text.replace(/[\x00-\x7F\s]/g, "").length;
  return Math.max(1, Math.ceil(asciiWords * 1.3 + nonAsciiChars * 0.8));
}

export function chunkPlainText(input: {
  source: string;
  text: string;
  page?: number;
  heading?: string;
  maxChunkChars?: number;
}): ReferenceChunk[] {
  const maxChunkChars = input.maxChunkChars ?? 1200;
  const blocks = input.text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks.length ? blocks : [input.text.trim()].filter(Boolean)) {
    if (!current) {
      current = block;
    } else if (`${current}\n\n${block}`.length <= maxChunkChars) {
      current = `${current}\n\n${block}`;
    } else {
      chunks.push(current);
      current = block;
    }

    while (current.length > maxChunkChars) {
      chunks.push(current.slice(0, maxChunkChars));
      current = current.slice(maxChunkChars);
    }
  }

  if (current) chunks.push(current.slice(0, maxChunkChars));

  return chunks.map((text, index) => ({
    id: `${input.source}:chunk:${index + 1}`,
    source: input.source,
    ...(input.page ? { page: input.page } : {}),
    ...(input.heading ? { heading: input.heading } : {}),
    text,
    tokenEstimate: estimateTokens(text),
  }));
}
