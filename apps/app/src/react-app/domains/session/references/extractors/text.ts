import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

export async function readReferenceText(file: File): Promise<{ text: string; warnings: string[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes), warnings: [] };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes), warnings: [] };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), warnings: [] }; }
  catch {
    return { text: new TextDecoder("gb18030").decode(bytes), warnings: ["Not valid UTF-8; decoded as GB18030. Verify the original encoding if text looks incorrect."] };
  }
}

function markdownChunks(source: string, text: string): ReferenceChunk[] {
  const sections: Array<{ heading?: string; body: string[] }> = [];
  let current: { heading?: string; body: string[] } = { body: [] };
  sections.push(current);

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = { heading: heading[1]?.trim(), body: [line] };
      sections.push(current);
    } else {
      current.body.push(line);
    }
  }

  return sections.flatMap((section, sectionIndex) => chunkPlainText({
    source,
    heading: section.heading,
    text: section.body.join("\n"),
  }).map((chunk, index) => ({ ...chunk, id: `${source}:section:${sectionIndex + 1}:chunk:${index + 1}` })));
}

export async function extractTextReference(file: File): Promise<ExtractedReferenceContent> {
  const decoded = await readReferenceText(file);
  const cleaned = cleanReferenceText(decoded.text);
  const isMarkdown = /\.md(?:own)?$/i.test(file.name) || file.type.toLowerCase().includes("markdown");
  return {
    text: cleaned.text,
    chunks: isMarkdown ? markdownChunks(file.name, cleaned.text) : chunkPlainText({ source: file.name, text: cleaned.text }),
    warnings: [...decoded.warnings, ...cleaned.warnings],
    coverage: { text: decoded.warnings.length ? "partial" : "complete", visuals: "none" },
  };
}
