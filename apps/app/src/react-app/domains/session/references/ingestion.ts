import { styleWithDesign, textReferenceDesign } from "./extractors/design";
import type { ComposerAttachment } from "@/app/types";
import { buildDeterministicSummary } from "./compression";
import { extractDocxReference } from "./extractors/docx";
import { extractPdfReference } from "./extractors/pdf";
import { extractPptxReference } from "./extractors/pptx";
import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";
import { assessReferenceQuality } from "./quality";
import type { ExtractedReferenceContent, ReferenceIngestionResult, ReferenceProgress } from "./types";

import { REFERENCE_MAX_BYTES } from "@ipollowork/types/reference-context";
export { REFERENCE_MAX_BYTES };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const REFERENCE_FILE_EXTENSIONS = ["pdf", "docx", "pptx", "md", "txt", "csv", "json"];
const EXTENSIONS = new Set(REFERENCE_FILE_EXTENSIONS);
export const REFERENCE_FILE_ACCEPT = REFERENCE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const MIMES = new Set([
  PDF_MIME,
  DOCX_MIME,
  PPTX_MIME,
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

export function referenceFileExtension(name: string): string {
  return name.includes(".") ? name.split(".").pop()?.trim().toLowerCase() ?? "" : "";
}

export function referenceMime(file: Pick<File, "name" | "type">): string {
  return MIME_BY_EXTENSION[referenceFileExtension(file.name)] ?? (MIMES.has(file.type.trim().toLowerCase()) ? file.type.trim().toLowerCase() : "application/octet-stream");
}

export function isReferenceFile(file: Pick<File, "name" | "type">): boolean {
  const extension = referenceFileExtension(file.name);
  if (extension) return EXTENSIONS.has(extension);
  const mime = file.type.trim().toLowerCase();
  return Boolean(mime && MIMES.has(mime));
}

export function canSendOriginalReference(file: Pick<File, "name" | "type" | "size">): boolean {
  return file.size <= REFERENCE_MAX_BYTES && isReferenceFile(file);
}

async function extractReference(file: File, onProgress?: ReferenceProgress): Promise<ExtractedReferenceContent> {
  const extension = referenceFileExtension(file.name);
  const mime = referenceMime(file);

  if (extension === "docx" || mime === DOCX_MIME) return extractDocxReference(file, onProgress);
  if (extension === "pptx" || mime === PPTX_MIME) return extractPptxReference(file, onProgress);
  if (extension === "csv" || extension === "json" || mime === "text/csv" || mime === "application/csv" || mime === "application/json") {
    return extractTableReference(file);
  }
  if (extension === "pdf" || mime === PDF_MIME) return extractPdfReference(file, onProgress);
  if (extension === "md" || extension === "txt" || mime.startsWith("text/")) return extractTextReference(file);
  return { text: "", chunks: [], warnings: ["No extractor is available for this file type."] };
}

function extractTextInWorker(file: File, table: boolean, signal?: AbortSignal): Promise<ExtractedReferenceContent> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(new URL("./reference-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Reference parsing cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: ExtractedReferenceContent; error?: string }>) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || "Reference worker returned no result"));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "Reference worker failed")); };
    worker.postMessage({ file, table });
  });
}

export async function ingestReferenceFile(file: File, onProgress?: ReferenceProgress, signal?: AbortSignal): Promise<ReferenceIngestionResult> {
  const report: ReferenceProgress = (percent, detail) => { signal?.throwIfAborted(); onProgress?.(percent, detail); };
  report(0, "检查文件");
  const fileId = `${file.name}-${file.lastModified}`;
  const mimeType = referenceMime(file);

  if (file.size > REFERENCE_MAX_BYTES || !isReferenceFile(file)) {
    onProgress?.(100);
    return {
      id: fileId,
      fileName: file.name,
      mimeType,
      size: file.size,
      sourceMode: "memory",
      extractedText: "",
      summary: "",
      chunks: [],
      quality: "failed",
      warnings: [file.size > REFERENCE_MAX_BYTES ? `${file.name} exceeds 50 MB (50,000,000 bytes).` : "Unsupported reference type. Upload PDF, DOCX, PPTX, Markdown, TXT, CSV or JSON."],
    };
  }

  report(5, "读取文件内容");
  const extension = referenceFileExtension(file.name);
  const useWorker = typeof window !== "undefined" && typeof Worker !== "undefined" && ["txt", "md", "csv", "json"].includes(extension);
  const extracted = await (useWorker ? extractTextInWorker(file, ["csv", "json"].includes(extension), signal) : extractReference(file, report)).catch((error): ExtractedReferenceContent => ({
    text: "",
    chunks: [],
    warnings: [`Reference parsing failed: ${error instanceof Error ? error.message : String(error)}`],
  }));
  report(95, "检查解析覆盖情况");
  const quality = assessReferenceQuality({ text: extracted.qualityText ?? extracted.text, chunks: extracted.chunks, warnings: extracted.warnings });
  if (quality.quality === "high" && (extracted.coverage?.text === "partial" || extracted.coverage?.visuals === "pending")) quality.quality = "medium";
  const draft: ReferenceIngestionResult = {
    id: fileId,
    fileName: file.name,
    mimeType,
    size: file.size,
    sourceMode: "memory",
    extractedText: extracted.text,
    summary: "",
    chunks: extracted.chunks ?? [],
    quality: quality.quality,
    warnings: quality.warnings,
    metadata: extracted.metadata,
    structuredData: extracted.structuredData,
    style: styleWithDesign(extracted.style, extracted.style?.design ?? textReferenceDesign(extension, extracted)),
    rawText: extracted.rawText,
    assets: [...extracted.assets ?? [], { sourcePart: file.name, path: file.name, kind: "document", file }],
    coverage: extracted.coverage,
  };

  const result = { ...draft, summary: buildDeterministicSummary(draft) };
  report(100, "解析结束");
  return result;
}

export async function prepareOriginalReferenceAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > REFERENCE_MAX_BYTES) throw new Error(`${file.name} is larger than 50 MB (50,000,000 bytes).`);
  if (!isReferenceFile(file)) throw new Error(`${file.name} is not a supported reference document.`);

  const mimeType = referenceMime(file);
  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType,
    size: file.size,
    kind: "file",
    file,
  };
}
