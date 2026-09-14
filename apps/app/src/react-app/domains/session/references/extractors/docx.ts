import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceAsset, ReferenceChunk, ReferenceProgress } from "../types";
import { descendants, officePackage, officeRelationships, officeTables, officeText, officeXml, WORD_NS, xmlDocument } from "./office";

export async function extractDocxReference(file: File, onProgress?: ReferenceProgress): Promise<ExtractedReferenceContent> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const main = "word/document.xml";
  if (!zip.file(main)) return { text: "", chunks: [], warnings: ["DOCX document.xml was not found."] };
  const reader = officePackage(zip);
  const relationships = await officeRelationships(zip, main);
  const parts = [...new Set([main, ...relationships.filter((rel) => !rel.external && ["header", "footer", "footnotes", "endnotes", "comments"].includes(rel.type)).flatMap((rel) => rel.target ? [rel.target] : [])])];
  const headings: string[] = [];
  const chunks: ReferenceChunk[] = [];
  const assets: ReferenceAsset[] = [];
  const sections = [];
  for (const [partIndex, part] of parts.entries()) {
    const xml = await officeXml(zip, part);
    if (!xml) { reader.warnings.push(`Missing document part: ${part}`); continue; }
    const doc = xmlDocument(xml);
    let heading: string | undefined;
    let sectionLines: string[] = [];
    let sectionIndex = 0;
    const flush = () => {
      if (!sectionLines.length) return;
      const sectionId = sectionIndex++;
      chunks.push(...chunkPlainText({ source: file.name, heading, text: sectionLines.join("\n") }).map((chunk, index) => ({ ...chunk, id: `${file.name}:${part}:section:${sectionId}:chunk:${index}` })));
      sectionLines = [];
    };
    const paragraphs = descendants(doc, "p").filter((node) => node.namespaceURI === WORD_NS);
    for (const paragraph of paragraphs) {
      const text = officeText(paragraph).trimEnd();
      if (!text.trim()) continue;
      const style = descendants(paragraph, "pStyle")[0]?.getAttributeNS(WORD_NS, "val") ?? "";
      if (/heading/i.test(style)) { flush(); heading = text; headings.push(text); }
      sectionLines.push(text);
    }
    flush();
    const tables = officeTables(doc);
    const extracted = await reader.inspect(part, doc);
    assets.push(...extracted.assets);
    const text = cleanReferenceText(officeText(doc)).text;
    sections.push({ sourcePart: part, type: part === main ? "body" : relationships.find((rel) => rel.target === part)?.type, text, tables, related: extracted.related });
    for (const [index, table] of tables.entries()) {
      chunks.push(...chunkPlainText({ source: file.name, heading: `Table ${index + 1} (${part})`, text: table.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n") }).map((chunk, n) => ({ ...chunk, id: `${file.name}:${part}:table:${index}:${n}` })));
    }
    onProgress?.(10 + Math.round(80 * (partIndex + 1) / parts.length));
  }
  const text = sections.flatMap((section) => [section.text, ...section.tables.map((table) => table.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n")), ...section.related.map((item) => `${item.type}: ${item.text}\n${JSON.stringify(item.data)}`)]).filter(Boolean).join("\n\n");
  return { text, chunks, assets, structuredData: { sections }, warnings: [...reader.warnings, ...(assets.some((asset) => asset.kind !== "link") ? ["Embedded media preserved with source locations; OCR, video transcription and visual interpretation remain pending."] : [])], metadata: { headings }, coverage: { text: "partial", visuals: assets.some((asset) => asset.kind !== "link") ? "pending" : "none" } };
}
