import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk, ReferenceProgress } from "../types";
import type { ReferenceDesign } from "@ipollowork/types/reference-context";
import { addDesignElement, createReferenceDesign, finishReferenceDesign, styleWithDesign } from "./design";

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
    const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, maxImageSize: 16_777_216 });
    const pdf = await loadingTask.promise;
    onProgress?.(10);
    try {
      const chunks: ReferenceChunk[] = [];
      const pageTexts: string[] = [];
      const pages = [];
      const design = createReferenceDesign("pdf");
      design.limitations.push("PDF 字体与坐标来自文本层；标题角色按字号差异推断。绘制颜色只表示颜色指令，不代表文字色或背景色；扫描图像、透明叠加和复杂效果未识别。");
      let readablePages = 0;
      const outline = await pdf.getOutline();

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const designPage: ReferenceDesign["pages"][number] = { sourcePart: `page:${pageNumber}`, page: pageNumber, widthPt: viewport.width, heightPt: viewport.height, elements: [] };
        design.pages.push(designPage);
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const position = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontSizePt = Math.hypot(item.transform[2]!, item.transform[3]!);
          addDesignElement(design, designPage, { kind: "text", role: "unknown", roleOrigin: "unknown", text: item.str.slice(0, 160), sources: [`page:${pageNumber}`],
            fontFamily: content.styles[item.fontName]?.fontFamily, fontSizePt, xPt: position[4], yPt: position[5]! - fontSizePt * (content.styles[item.fontName]?.ascent ?? 1), widthPt: item.width, heightPt: item.height,
          });
        }
        try {
          const operators = await page.getOperatorList();
          for (let index = 0; index < operators.fnArray.length; index++) {
            const operation = operators.fnArray[index];
            if (operation !== pdfjs.OPS.setFillRGBColor && operation !== pdfjs.OPS.setStrokeRGBColor) continue;
            const value: unknown = operators.argsArray[index]?.[0];
            if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) continue;
            const hex = value.toUpperCase(); const role = operation === pdfjs.OPS.setFillRGBColor ? "drawing-fill-state" : "drawing-stroke-state";
            const item = design.palette.find((entry) => entry.color === hex && entry.role === role);
            if (item) item.count++; else if (design.palette.length < 256) design.palette.push({ color: hex, role, count: 1 });
            else design.limitations.push("PDF 绘制颜色仅记录前 256 个不同颜色与用途组合。");
          }
        } catch { design.limitations.push(`第 ${pageNumber} 页绘制颜色未能读取，文本和字体仍保留。`); }
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
        style: styleWithDesign(undefined, finishReferenceDesign(design)),
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
