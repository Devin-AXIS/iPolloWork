import type { ComposerAttachment } from "@/app/types";
import { buildDeterministicSummary } from "./compression";
import { extractDocxReference } from "./extractors/docx";
import { extractPdfReference } from "./extractors/pdf";
import { extractPptxReference } from "./extractors/pptx";
import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";
import { assessReferenceQuality } from "./quality";
import type { ExtractedReferenceContent, ReferenceIngestionResult } from "./types";

export const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;
export const REFERENCE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const REFERENCE_FILE_EXTENSIONS = ["pdf", "docx", "pptx", "md", "txt", "png", "jpg", "jpeg", "webp", "mp4", "mov", "csv", "json"];
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
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  csv: "text/csv",
  json: "application/json",
};

export function referenceFileExtension(name: string): string {
  return name.split(".").pop()?.trim().toLowerCase() ?? "";
}

export function referenceMime(file: Pick<File, "name" | "type">): string {
  const mime = file.type.trim().toLowerCase();
  if (MIMES.has(mime)) return mime;
  return MIME_BY_EXTENSION[referenceFileExtension(file.name)] ?? "text/plain";
}

export function isReferenceFile(file: Pick<File, "name" | "type">): boolean {
  const extension = referenceFileExtension(file.name);
  if (EXTENSIONS.has(extension)) return true;
  const mime = file.type.trim().toLowerCase();
  return Boolean(mime && MIMES.has(mime));
}

export function canSendOriginalReference(file: Pick<File, "name" | "type" | "size">): boolean {
  return file.size <= referenceMaxBytes(file) && isReferenceFile(file);
}

export function isVisualReference(file: Pick<File, "name" | "type">): boolean {
  const mime = referenceMime(file);
  return mime.startsWith("image/") || mime.startsWith("video/");
}

function referenceMaxBytes(file: Pick<File, "name" | "type">): number {
  return referenceMime(file).startsWith("video/") ? REFERENCE_VIDEO_MAX_BYTES : REFERENCE_MAX_BYTES;
}

async function extractReference(file: File): Promise<ExtractedReferenceContent> {
  const extension = referenceFileExtension(file.name);
  const mime = referenceMime(file);

  if (extension === "docx" || mime === DOCX_MIME) return extractDocxReference(file);
  if (extension === "pptx" || mime === PPTX_MIME) return extractPptxReference(file);
  if (extension === "csv" || extension === "json" || mime === "text/csv" || mime === "application/csv" || mime === "application/json") {
    return extractTableReference(file);
  }
  if (extension === "pdf" || mime === PDF_MIME) return extractPdfReference(file);
  if (extension === "md" || extension === "txt" || mime.startsWith("text/")) return extractTextReference(file);
  if (mime.startsWith("image/")) {
    return { text: "", chunks: [], warnings: ["Images are kept as optional visual attachments; OCR is not available."] };
  }
  if (mime.startsWith("video/")) {
    return { text: "", chunks: [], warnings: ["Video is indexed as a visual source; scene and transcript analysis is completed by the active AI media tools."] };
  }
  return { text: "", chunks: [], warnings: ["No extractor is available for this file type."] };
}

export async function ingestReferenceFile(file: File): Promise<ReferenceIngestionResult> {
  const fileId = `${file.name}-${file.lastModified}`;
  const mimeType = referenceMime(file);

  const maxBytes = referenceMaxBytes(file);
  if (file.size > maxBytes) {
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
      warnings: [`${file.name} is larger than ${maxBytes === REFERENCE_VIDEO_MAX_BYTES ? 100 : 25} MB.`],
    };
  }

  const extracted = await extractReference(file).catch((error): ExtractedReferenceContent => ({
    text: "",
    chunks: [],
    warnings: [`Reference parsing failed: ${error instanceof Error ? error.message : String(error)}`],
  }));
  const visualOnly = mimeType.startsWith("image/") || mimeType.startsWith("video/");
  const quality = visualOnly
    ? { quality: "medium" as const, warnings: extracted.warnings ?? [] }
    : assessReferenceQuality({ text: extracted.text, chunks: extracted.chunks, warnings: extracted.warnings });
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
  };

  return { ...draft, summary: buildDeterministicSummary(draft) };
}

export async function prepareOriginalReferenceAttachment(file: File): Promise<ComposerAttachment> {
  const maxBytes = referenceMaxBytes(file);
  if (file.size > maxBytes) throw new Error(`${file.name} is larger than ${maxBytes === REFERENCE_VIDEO_MAX_BYTES ? 100 : 25} MB.`);
  if (!isReferenceFile(file)) throw new Error(`${file.name} is not a supported reference document.`);

  const mimeType = referenceMime(file);
  const kind = mimeType.startsWith("image/") ? "image" as const : "file" as const;
  const previewUrl = kind === "image" && typeof URL !== "undefined" && "createObjectURL" in URL
    ? URL.createObjectURL(file)
    : undefined;

  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType,
    size: file.size,
    kind,
    file,
    previewUrl,
  };
}
