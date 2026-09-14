import { cleanReferenceText } from "../quality";
import { chunkPlainText } from "../chunking";
import type { ExtractedReferenceContent, ReferenceAsset, ReferenceChunk, ReferenceProgress } from "../types";
import { descendants, officePackage, officeRelationships, officeTables, officeText, officeXml, REL_NS, xmlDocument } from "./office";

export async function extractPptxReference(file: File, onProgress?: ReferenceProgress): Promise<ExtractedReferenceContent> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const reader = officePackage(zip);
  const presentation = await officeXml(zip, "ppt/presentation.xml");
  const relationships = await officeRelationships(zip, "ppt/presentation.xml");
  const slideFiles = presentation
    ? descendants(xmlDocument(presentation), "sldId").flatMap((slide) => {
      const id = slide.getAttributeNS(REL_NS, "id");
      const target = relationships.find((rel) => rel.id === id && !rel.external)?.target;
      if (!target) reader.warnings.push(`Missing slide relationship: ${id}`);
      return target ? [target] : [];
    })
    : Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!presentation) reader.warnings.push("Presentation order was unavailable; used slide filenames.");
  if (!slideFiles.length) return { text: "", chunks: [], warnings: ["PPTX slides were not found."] };
  const chunks: ReferenceChunk[] = [];
  const assets: ReferenceAsset[] = [];
  const slides = [];
  for (const [index, part] of slideFiles.entries()) {
    try {
      const xml = await officeXml(zip, part);
      if (!xml) { reader.warnings.push(`Missing slide: ${part}`); continue; }
      const doc = xmlDocument(xml);
      const page = index + 1;
      const extracted = await reader.inspect(part, doc, page);
      const slideAssets = [...extracted.assets];
      for (const related of extracted.related.filter((item) => item.type === "notesSlide")) {
        const notesXml = await officeXml(zip, related.sourcePart);
        if (notesXml) slideAssets.push(...(await reader.inspect(related.sourcePart, xmlDocument(notesXml), page)).assets);
      }
      assets.push(...slideAssets);
      const text = cleanReferenceText(officeText(doc)).text;
      const tables = officeTables(doc);
      const fullText = [text, ...tables.map((table) => table.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n")), ...extracted.related.map((related) => `${related.type}: ${related.text}\n${JSON.stringify(related.data)}`)].filter(Boolean).join("\n\n");
      slides.push({ page, sourcePart: part, hidden: doc.documentElement.getAttribute("show") === "0", text, tables, related: extracted.related, media: slideAssets.map(({ file: _file, ...asset }) => asset) });
      if (!fullText) reader.warnings.push(`Slide ${page}: no readable text; visual review is required.`);
      chunks.push(...chunkPlainText({ source: file.name, page, text: fullText }));
      onProgress?.(10 + Math.round(80 * (index + 1) / slideFiles.length), `提取 PPT 第 ${index + 1}/${slideFiles.length} 页`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      reader.warnings.push(`${part}: ${error instanceof Error ? error.message : String(error)}; other readable parts preserved.`);
    }
  }
  return {
    text: slides.map((slide) => `Slide ${slide.page}\n${slide.text}\n${slide.related.map((related) => `${related.type}: ${related.text}\n${JSON.stringify(related.data)}`).join("\n")}`).join("\n\n"), chunks, assets, structuredData: { slides },
    warnings: [...reader.warnings, "Slide text, tables, notes and cached chart data were extracted; image interpretation and audio/video transcription are disabled."],
    metadata: { pages: slideFiles.length }, coverage: { text: "partial", visuals: "not-supported" },
  };
}
