// Shared by the embedded editor and its host. Requests identify one authored
// media element, never pixels inside a video/canvas or an arbitrary host path.
export const VIDEO_IMAGE_OPEN = "ipollowork:video:image-open";
export const VIDEO_IMAGE_APPLY = "ipollowork:video:image-apply";
export const VIDEO_IMAGE_RESULT = "ipollowork:video:image-result";
export const VIDEO_IMAGE_CANCEL = "ipollowork:video:image-cancel";
export const MAX_VIDEO_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_MEDIA_BYTES = 100 * 1024 * 1024;
export type MediaKind = "image" | "video";

export function mediaKindForPath(value: string): MediaKind | null {
  if (/\.(png|jpe?g|webp)$/i.test(value)) return "image";
  return /\.(mp4|mov)$/i.test(value) ? "video" : null;
}

export function safeVideoMediaPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000 || !mediaKindForPath(value)) return null;
  if (/[\\\x00-\x1f?#:%"<>|]/.test(value)) return null;
  return value.split("/").every(part => part && part !== "." && part !== "..") ? value : null;
}

export type VideoImageRequest = {
  type: typeof VIDEO_IMAGE_OPEN;
  requestId: string;
  projectId: string;
  sourcePath: string;
  kind?: MediaKind;
};

export function safeVideoImagePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000 || !/\.(png|jpe?g|webp)$/i.test(value))
    return null;
  if (/[\\\x00-\x1f?#:%"<>|]/.test(value)) return null;
  return value.split("/").every((part) => part && part !== "." && part !== "..") ? value : null;
}

export function parseVideoImageRequest(value: unknown): VideoImageRequest | null {
  if (
    !isRecord(value) ||
    value.type !== VIDEO_IMAGE_OPEN ||
    typeof value.requestId !== "string" ||
    !/^[\da-f-]{36}$/i.test(value.requestId) ||
    typeof value.projectId !== "string"
  )
    return null;
  const sourcePath = safeVideoMediaPath(value.sourcePath);
  const kind = sourcePath ? mediaKindForPath(sourcePath) : null;
  if (value.kind !== undefined && value.kind !== kind) return null;
  return sourcePath
    ? { type: VIDEO_IMAGE_OPEN, requestId: value.requestId, projectId: value.projectId, sourcePath, kind: kind ?? "image" }
    : null;
}

export type VideoImageApply = {
  type: typeof VIDEO_IMAGE_APPLY;
  requestId: string;
  actionId: string;
  mode: "overwrite" | "copy";
  image?: { bytes: ArrayBuffer; name: string };
};

export function parseVideoImageApply(value: unknown): VideoImageApply | null {
  if (
    !isRecord(value) ||
    value.type !== VIDEO_IMAGE_APPLY ||
    typeof value.requestId !== "string" ||
    typeof value.actionId !== "string" ||
    !/^[\da-f-]{36}$/i.test(value.actionId) ||
    !/^[\da-f-]{36}$/i.test(value.requestId) ||
    (value.mode !== "overwrite" && value.mode !== "copy")
  )
    return null;
  if (value.mode === "overwrite")
    return {
      type: VIDEO_IMAGE_APPLY,
      requestId: value.requestId,
      actionId: value.actionId,
      mode: value.mode,
    };
  const image = value.image;
  if (
    !isRecord(image) ||
    !(image.bytes instanceof ArrayBuffer) ||
    image.bytes.byteLength === 0 ||
    !safeVideoMediaPath(image.name) ||
    image.bytes.byteLength > (typeof image.name === "string" && mediaKindForPath(image.name) === "video" ? MAX_VIDEO_MEDIA_BYTES : MAX_VIDEO_IMAGE_BYTES) ||
    typeof image.name !== "string" ||
    image.name.includes("/")
  )
    return null;
  return {
    type: VIDEO_IMAGE_APPLY,
    requestId: value.requestId,
    actionId: value.actionId,
    mode: value.mode,
    image: { bytes: image.bytes, name: image.name },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
