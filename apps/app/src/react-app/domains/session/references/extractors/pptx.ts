import { cleanReferenceText } from "../quality";
import { chunkPlainText } from "../chunking";
import type { ExtractedReferenceContent, ReferenceChunk, ReferenceProgress } from "../types";

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

export async function extractPptxReference(file: File, onProgress?: ReferenceProgress): Promise<ExtractedReferenceContent> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  onProgress?.(10);
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => slideNumber(left) - slideNumber(right));

  if (!slideFiles.length) return { text: "", chunks: [], warnings: ["PPTX slides were not found."] };

  const chunks: ReferenceChunk[] = [];
  const slideTexts: string[] = [];
  const warnings = ["Slide text was extracted; images, charts and visual layout require review."];
  for (const [index, path] of slideFiles.entries()) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const cleaned = cleanReferenceText(textFromSlideXml(xml));
    const page = slideNumber(path);
    onProgress?.(10 + Math.round(80 * (index + 1) / slideFiles.length));
    if (!cleaned.text) {
      warnings.push(`Slide ${page}: no readable text; visual review is required.`);
      continue;
    }
    slideTexts.push(`Slide ${page}\n${cleaned.text}`);
    chunks.push(...chunkPlainText({ source: file.name, page, text: cleaned.text }));
  }

  const cleaned = cleanReferenceText(slideTexts.join("\n\n"));
  return {
    text: cleaned.text,
    chunks,
    warnings: [...warnings, ...cleaned.warnings],
    metadata: { pages: slideFiles.length },
  };
}
