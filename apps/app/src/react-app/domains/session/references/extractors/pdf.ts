import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

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
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
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
