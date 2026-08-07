import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if ("GlobalWorkerOptions" in pdfjs && typeof window !== "undefined") {
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return pdfjs;
}

export async function extractPdfReference(file: File): Promise<ExtractedReferenceContent> {
  const warnings = new Set<string>();

  try {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false });
    const pdf = await loadingTask.promise;
    const chunks: ReferenceChunk[] = [];
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const raw = content.items
        .map((item) => "str" in item ? String(item.str) : "")
        .join(" ");
      const cleaned = cleanReferenceText(raw);
      cleaned.warnings.forEach((warning) => warnings.add(warning));
      if (!cleaned.text) continue;
      pageTexts.push(cleaned.text);
      chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, text: cleaned.text }));
    }

    const text = pageTexts.join("\n\n");
    return {
      text,
      chunks,
      warnings: [...warnings, ...(text ? [] : ["No readable PDF text was extracted."])],
      metadata: { pages: pdf.numPages },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: "", chunks: [], warnings: [...warnings, `PDF parsing failed: ${message}`] };
  }
}
