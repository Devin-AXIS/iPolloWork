import type { ComposerAttachment } from "@/app/types";
import { buildDeterministicSummary } from "./compression";
import { extractDocxReference } from "./extractors/docx";
import { extractPdfReference } from "./extractors/pdf";
import { extractPptxReference } from "./extractors/pptx";
import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";
import { assessReferenceQuality } from "./quality";
import type { ExtractedReferenceContent, ReferenceAsset, ReferenceIngestionResult, ReferenceProgress } from "./types";

export const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const REFERENCE_FILE_EXTENSIONS = ["pdf", "docx", "pptx", "md", "txt", "png", "jpg", "jpeg", "webp", "csv", "json"];
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
  if (mime.startsWith("image/")) {
    return { text: "", chunks: [], assets: [{ sourcePart: file.name, path: file.name, kind: "image", file }], coverage: { text: "none", visuals: "pending" }, warnings: ["Image preserved for visual inspection during generation. Upload-stage OCR is not available; no image text or description has been inferred."] };
  }
  return { text: "", chunks: [], warnings: ["No extractor is available for this file type."] };
}

function mediaEvent(media: HTMLMediaElement, event: string, action: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); media.removeEventListener(event, ready); media.removeEventListener("error", failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Media is unavailable or uses an unsupported codec.")); };
    const timer = setTimeout(failed, 4000);
    media.addEventListener(event, ready, { once: true });
    media.addEventListener("error", failed, { once: true });
    try { action(); } catch { failed(); }
  });
}

/** Decode local media only. No remote fetch or paid model request during upload. */
async function inspectReferenceMedia(extracted: ExtractedReferenceContent) {
  if (typeof document === "undefined") return;
  const frames: ReferenceAsset[] = [];
  const inspected = new Map<File, ReferenceAsset["media"]>();
  let videos = 0;
  for (const asset of extracted.assets ?? []) {
    const file = asset.file;
    if (!file || !["image", "video", "audio"].includes(asset.kind)) continue;
    if (inspected.has(file)) { asset.media = inspected.get(file); continue; }
    inspected.set(file, undefined);
    try {
      if (asset.kind === "image") {
        const bitmap = await createImageBitmap(file);
        asset.media = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } else {
        if (videos++ >= 4) { (extracted.warnings ??= []).push(`Preview limit reached for ${asset.path}; original media preserved.`); continue; }
        const media = document.createElement(asset.kind === "video" ? "video" : "audio");
        media.preload = "auto";
        const url = URL.createObjectURL(file);
        try {
          await mediaEvent(media, "loadeddata", () => { media.src = url; media.load(); });
          asset.media = { durationSeconds: Number.isFinite(media.duration) ? media.duration : undefined };
          if (media instanceof HTMLVideoElement && media.videoWidth && media.videoHeight) {
            asset.media.width = media.videoWidth; asset.media.height = media.videoHeight;
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 1280 / Math.max(media.videoWidth, media.videoHeight));
            canvas.width = Math.max(1, Math.round(media.videoWidth * scale)); canvas.height = Math.max(1, Math.round(media.videoHeight * scale));
            const context = canvas.getContext("2d");
            if (context && Number.isFinite(media.duration) && media.duration > 0) {
              for (const fraction of [0.1, 0.5, 0.9]) {
                const seconds = media.duration * fraction;
                await mediaEvent(media, "seeked", () => { media.currentTime = seconds; });
                context.drawImage(media, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
                if (blob) frames.push({ sourcePart: asset.sourcePart, path: `${asset.path}#t=${seconds.toFixed(3)}`, page: asset.page, kind: "image", description: `Sampled video frame from ${asset.path}; does not represent the entire video.`, media: { width: canvas.width, height: canvas.height, frameTimeSeconds: seconds }, file: new File([blob], `${file.name}-frame-${fraction}.jpg`, { type: "image/jpeg" }) });
              }
            }
            canvas.width = 0; canvas.height = 0;
          }
        } finally { media.removeAttribute("src"); media.load(); URL.revokeObjectURL(url); }
      }
      inspected.set(file, asset.media);
    } catch (error) { (extracted.warnings ??= []).push(`${asset.path}: ${error instanceof Error ? error.message : "Media preview unavailable"}; original preserved.`); }
  }
  if (frames.length) extracted.assets?.push(...frames);
}

export async function ingestReferenceFile(file: File, onProgress?: ReferenceProgress): Promise<ReferenceIngestionResult> {
  onProgress?.(0);
  const fileId = `${file.name}-${file.lastModified}`;
  const mimeType = referenceMime(file);

  if (file.size > REFERENCE_MAX_BYTES) {
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
      warnings: [`${file.name} is larger than 25 MB.`],
    };
  }

  const extracted = await extractReference(file, onProgress).catch((error): ExtractedReferenceContent => ({
    text: "",
    chunks: [],
    warnings: [`Reference parsing failed: ${error instanceof Error ? error.message : String(error)}`],
  }));
  onProgress?.(92);
  await inspectReferenceMedia(extracted);
  onProgress?.(95);
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
    rawText: extracted.rawText,
    assets: [DOCX_MIME, PPTX_MIME, PDF_MIME].includes(mimeType)
      ? [...extracted.assets ?? [], { sourcePart: file.name, path: file.name, kind: "document", file }]
      : extracted.assets,
    coverage: extracted.coverage,
  };

  const result = { ...draft, summary: buildDeterministicSummary(draft) };
  onProgress?.(100);
  return result;
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
