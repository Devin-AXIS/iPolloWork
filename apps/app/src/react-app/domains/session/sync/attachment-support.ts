/** Keep the browser -> provider attachment contract in one place. */
export const MAX_MODEL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const OFFICE_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-word",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.template.macroenabled.12",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.template",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-word.template.macroenabled.12",
  "application/rtf",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".doc": "application/msword",
  ".docm": "application/vnd.ms-word.document.macroenabled.12",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".dotm": "application/vnd.ms-word.template.macroenabled.12",
  ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".pot": "application/vnd.ms-powerpoint",
  ".potm": "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  ".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptm": "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsb": "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  ".xlsm": "application/vnd.ms-excel.sheet.macroenabled.12",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xltm": "application/vnd.ms-excel.template.macroenabled.12",
  ".xltx": "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
};

function extensionMimeType(fileName: string): string | null {
  const normalized = fileName.trim().toLowerCase();
  const extension = normalized.slice(normalized.lastIndexOf("."));
  return extension.length > 1 ? EXTENSION_MIME_TYPES[extension] ?? null : null;
}

/** Resolve missing Finder/browser MIME types before validating or sending. */
export function resolveModelAttachmentMimeType(fileName: string, mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return extensionMimeType(fileName) ?? "text/plain";
}

/**
 * Which attachment media types can be sent to the model as file parts.
 *
 * This mirrors the practical file inputs supported by Codex-style providers:
 * images, PDFs, common Office/ODF documents, and text/code formats. Unknown
 * empty MIME types remain text/plain for source files whose browser type is
 * unavailable; arbitrary known binary formats are rejected before sending so
 * they cannot poison the server-side session history.
 */
export function isModelReadableAttachment(mimeType: string, fileName = "") {
  const mime = resolveModelAttachmentMimeType(fileName, mimeType);
  if (mime.startsWith("image/") || mime.startsWith("text/")) return true;
  if (mime === "application/pdf" || mime === "application/json") return true;
  if (OFFICE_MIME_TYPES.has(mime)) return true;
  return mime.endsWith("+json") || mime.endsWith("+xml") || mime === "application/xml" || mime === "application/javascript";
}
