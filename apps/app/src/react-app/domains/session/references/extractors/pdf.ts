import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceAsset, ReferenceChunk, ReferenceProgress } from "../types";

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
      const assets: ReferenceAsset[] = [];
      let renderedPages = 0;
      let visualPages = 0;
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
        pages.push({ page: pageNumber, text: cleaned.text, annotations });
        const operators = await page.getOperatorList();
        const hasVisuals = !cleaned.text.trim() || operators.fnArray.some((op) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.constructPath, pdfjs.OPS.shadingFill].includes(op));
        if (hasVisuals) {
          visualPages += 1;
          if (typeof document !== "undefined" && renderedPages < 12) {
            try {
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
              const canvas = document.createElement("canvas");
              canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              await page.render({ canvas, viewport }).promise;
              const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
              canvas.width = 0; canvas.height = 0;
              if (blob) {
                assets.push({ sourcePart: `page:${pageNumber}`, path: `page-${pageNumber}.png`, page: pageNumber, kind: "image", description: "Rendered source page; OCR and visual interpretation pending.", file: new File([blob], `page-${pageNumber}.png`, { type: "image/png" }) });
                renderedPages += 1;
              }
            } catch (error) { warnings.add(`Page ${pageNumber}: visual render failed: ${error instanceof Error ? error.message : String(error)}`); }
          }
        }
        cleaned.warnings.forEach((warning) => warnings.add(warning));
        onProgress?.(10 + Math.round(80 * pageNumber / pdf.numPages));
        if (!cleaned.text) {
          warnings.add(`Page ${pageNumber}: no readable text; OCR or visual review is required.`);
          page.cleanup();
          continue;
        }
        pageTexts.push(cleaned.text);
        chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, text: cleaned.text }));
        const annotationText = annotations.flatMap((item) => [item.text, item.fieldName && `${item.fieldName}: ${String(item.fieldValue ?? "")}`]).filter(Boolean).join("\n");
        if (annotationText) chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, heading: "Annotations and form fields", text: annotationText }).map((chunk, index) => ({ ...chunk, id: `${file.name}:page:${pageNumber}:annotations:${index}` })));
        page.cleanup();
      }

      const text = pageTexts.join("\n\n");
      return {
        text,
        chunks,
        assets,
        structuredData: { pages, outline },
        coverage: { text: "partial", visuals: visualPages ? "pending" : "none" },
        warnings: [...warnings, "PDF text, outline, annotations and form values were extracted. Visual layout still requires review.", ...(visualPages > renderedPages ? [`${visualPages - renderedPages} visual pages were not rendered (limit: 12); inspect the preserved original PDF for remaining pages.`] : []), ...(text ? [] : ["No readable PDF text was extracted."])],
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
