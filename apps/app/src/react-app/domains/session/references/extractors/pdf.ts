import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk, ReferenceProgress } from "../types";

type Uint8ArrayPrototypeWithHex = Uint8Array & { toHex?: () => string };

export function ensurePdfTypedArrayHexSupport() {
  const prototype = Uint8Array.prototype as Uint8ArrayPrototypeWithHex;
  if (typeof prototype.toHex === "function") return;

  Object.defineProperty(Uint8Array.prototype, "toHex", {
    configurable: true,
    writable: true,
    value: function toHex(this: Uint8Array) {
      let hex = "";
      for (let index = 0; index < this.length; index += 1) {
        hex += this[index]!.toString(16).padStart(2, "0");
      }
      return hex;
    },
  });
}

async function loadPdfjs() {
  ensurePdfTypedArrayHexSupport();

  if (typeof window === "undefined") {
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if ("GlobalWorkerOptions" in pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
  }
  return pdfjs;
}

export async function extractPdfReference(file: File, onProgress?: ReferenceProgress): Promise<ExtractedReferenceContent> {
  const warnings = new Set<string>();

  try {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false });
    const pdf = await loadingTask.promise;
    onProgress?.(10);
    try {
      const chunks: ReferenceChunk[] = [];
      const pageTexts: string[] = [];
      const pages = [];
      let readablePages = 0;
      const outline = await pdf.getOutline();

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const raw = content.items
          .map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
          .join("");
        const cleaned = cleanReferenceText(raw);
        const annotations = (await page.getAnnotations()).map((annotation) => ({
          type: annotation.subtype, text: annotation.contentsObj?.str, title: annotation.titleObj?.str,
          url: annotation.url, fieldName: annotation.fieldName, fieldValue: annotation.fieldValue,
        }));
        pages.push({ page: pageNumber, text: cleaned.text, annotations,
          textItems: content.items.flatMap((item) => "str" in item ? [{ text: item.str, transform: item.transform, width: item.width, height: item.height, direction: item.dir }] : []),
        });
        if (cleaned.text.trim()) readablePages += 1;
        cleaned.warnings.forEach((warning) => warnings.add(warning));
        onProgress?.(10 + Math.round(80 * pageNumber / pdf.numPages), `提取 PDF 第 ${pageNumber}/${pdf.numPages} 页`);
        const annotationText = annotations.flatMap((item) => [item.text, item.fieldName && `${item.fieldName}: ${String(item.fieldValue ?? "")}`]).filter(Boolean).join("\n");
        if (annotationText) chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, heading: "Annotations and form fields", text: annotationText }).map((chunk, index) => ({ ...chunk, id: `${file.name}:page:${pageNumber}:annotations:${index}` })));
        pageTexts.push([cleaned.text, annotationText].filter(Boolean).join("\n"));
        if (!cleaned.text) {
          warnings.add(`Page ${pageNumber}: no readable body text; provide a text-based source. Image interpretation is disabled.`);
          page.cleanup();
          continue;
        }
        chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, text: cleaned.text }));
        page.cleanup();
      }

      const text = pageTexts.join("\n\n");
      return {
        text, chunks, structuredData: { pages, outline, coverage: { totalPages: pdf.numPages, readablePages, unreadablePages: pages.filter((page) => !page.text.trim()).map((page) => page.page) } },
        coverage: { text: readablePages === pdf.numPages ? "complete" : readablePages ? "partial" : "none", visuals: "none" },
        warnings: [...warnings, "Extracted PDF text, positions, outline, annotations and form values locally. Image contents are not interpreted.", ...(readablePages < pdf.numPages ? [`${pdf.numPages - readablePages} pages have no readable text. Scanned/image-only pages require a text-based original; no OCR or model is used.`] : [])],
        metadata: { pages: pdf.numPages },
      };
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: "", chunks: [], warnings: [...warnings, `PDF parsing failed: ${message}`] };
  }
}
