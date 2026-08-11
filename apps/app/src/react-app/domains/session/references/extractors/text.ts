import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

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

  return sections.flatMap((section) => chunkPlainText({
    source,
    heading: section.heading,
    text: section.body.join("\n"),
  }));
}

export async function extractTextReference(file: File): Promise<ExtractedReferenceContent> {
  const cleaned = cleanReferenceText(await file.text());
  const isMarkdown = /\.md(?:own)?$/i.test(file.name) || file.type.toLowerCase().includes("markdown");
  return {
    text: cleaned.text,
    chunks: isMarkdown ? markdownChunks(file.name, cleaned.text) : chunkPlainText({ source: file.name, text: cleaned.text }),
    warnings: cleaned.warnings,
  };
}
