import JSZip from "jszip";
import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent } from "../types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textFromXml(xml: string) {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphStyle(paragraph: string) {
  return paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"[^>]*\/?\s*>/)?.[1] ?? "";
}

export async function extractDocxReference(file: File): Promise<ExtractedReferenceContent> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return { text: "", chunks: [], warnings: ["DOCX document.xml was not found."] };

  const body = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)?.[1];
  if (!body) return { text: "", chunks: [], warnings: ["DOCX body was not found."] };

  const lines: string[] = [];
  const headings: string[] = [];
  for (const child of body.matchAll(/<w:(p|tbl)\b[^>]*>[\s\S]*?<\/w:\1>/g)) {
    const childXml = child[0] ?? "";
    if (child[1] === "p") {
      const text = textFromXml(childXml);
      if (!text) continue;
      const style = paragraphStyle(childXml);
      if (/heading/i.test(style)) headings.push(text);
      lines.push(text);
    }
    if (child[1] === "tbl") {
      for (const row of childXml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)) {
        const cells = [...(row[0] ?? "").matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)]
          .map((cell) => textFromXml(cell[0] ?? ""))
          .filter(Boolean);
        if (cells.length) lines.push(cells.join(" | "));
      }
    }
  }

  const cleaned = cleanReferenceText(lines.join("\n\n"));
  const chunks = headings.length
    ? headings.flatMap((heading) => chunkPlainText({ source: file.name, heading, text: cleaned.text }))
    : chunkPlainText({ source: file.name, text: cleaned.text });

  return { text: cleaned.text, chunks, warnings: cleaned.warnings, metadata: { headings } };
}
