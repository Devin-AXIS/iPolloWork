import type { ComposerAttachment } from "@/app/types";
import { buildDeterministicSummary } from "./compression";
import { extractDocxReference } from "./extractors/docx";
import { extractPdfReference } from "./extractors/pdf";
import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";
import { assessReferenceQuality } from "./quality";
import type { ExtractedReferenceContent, ReferenceIngestionResult } from "./types";

export const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

const EXTENSIONS = new Set(["pdf", "docx", "md", "txt", "png", "jpg", "jpeg", "webp", "csv", "json"]);
const MIMES = new Set([
  PDF_MIME,
  DOCX_MIME,
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
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

async function extractReference(file: File): Promise<ExtractedReferenceContent> {
  const extension = referenceFileExtension(file.name);
  const mime = referenceMime(file);

  if (extension === "docx" || mime === DOCX_MIME) return extractDocxReference(file);
  if (extension === "csv" || extension === "json" || mime === "text/csv" || mime === "application/csv" || mime === "application/json") {
    return extractTableReference(file);
  }
  if (extension === "pdf" || mime === PDF_MIME) return extractPdfReference(file);
  if (extension === "md" || extension === "txt" || mime.startsWith("text/")) return extractTextReference(file);
  if (mime.startsWith("image/")) {
    return { text: "", chunks: [], warnings: ["Images are kept as optional visual attachments; OCR is not available."] };
  }
  return { text: "", chunks: [], warnings: ["No extractor is available for this file type."] };
}

export async function ingestReferenceFile(file: File): Promise<ReferenceIngestionResult> {
  const fileId = `${file.name}-${file.lastModified}`;
  const mimeType = referenceMime(file);

  if (file.size > REFERENCE_MAX_BYTES) {
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
      warnings: [`${file.name} is larger than 25 MB.`],
    };
  }

  const extracted = await extractReference(file).catch((error): ExtractedReferenceContent => ({
    text: "",
    chunks: [],
    warnings: [`Reference parsing failed: ${error instanceof Error ? error.message : String(error)}`],
  }));
  const quality = assessReferenceQuality({ text: extracted.text, chunks: extracted.chunks, warnings: extracted.warnings });
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
  if (file.size > REFERENCE_MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
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
