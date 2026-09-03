import JSZip from "jszip";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function slideNumber(path: string) {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function textFromSlideXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS(A_NS, "t"))
    .map((item) => item.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function extractPptxReference(file: File): Promise<ExtractedReferenceContent> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => slideNumber(left) - slideNumber(right));

  if (!slideFiles.length) return { text: "", chunks: [], warnings: ["PPTX slides were not found."] };

  const chunks: ReferenceChunk[] = [];
  const slideTexts: string[] = [];
  for (const path of slideFiles) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const cleaned = cleanReferenceText(textFromSlideXml(xml));
    if (!cleaned.text) continue;
    const page = slideNumber(path);
    slideTexts.push(`Slide ${page}\n${cleaned.text}`);
    chunks.push({
      id: `${file.name}:slide:${page}`,
      source: file.name,
      page,
      text: cleaned.text,
      tokenEstimate: Math.max(1, Math.ceil(cleaned.text.length / 4)),
    });
  }

  const cleaned = cleanReferenceText(slideTexts.join("\n\n"));
  return {
    text: cleaned.text,
    chunks,
    warnings: cleaned.warnings,
    metadata: { pages: slideFiles.length },
  };
}
