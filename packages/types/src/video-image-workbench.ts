// Shared by the embedded editor and its host. Requests identify one authored
// image, never pixels inside a video/canvas or an arbitrary host filesystem path.
export const VIDEO_IMAGE_OPEN = "ipollowork:video:image-open";
export const VIDEO_IMAGE_APPLY = "ipollowork:video:image-apply";
export const VIDEO_IMAGE_RESULT = "ipollowork:video:image-result";
export const VIDEO_IMAGE_CANCEL = "ipollowork:video:image-cancel";
export const MAX_VIDEO_IMAGE_BYTES = 25 * 1024 * 1024;

export type VideoImageRequest = {
  type: typeof VIDEO_IMAGE_OPEN;
  requestId: string;
  projectId: string;
  sourcePath: string;
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
  const sourcePath = safeVideoImagePath(value.sourcePath);
  return sourcePath
    ? { type: VIDEO_IMAGE_OPEN, requestId: value.requestId, projectId: value.projectId, sourcePath }
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
    image.bytes.byteLength > MAX_VIDEO_IMAGE_BYTES ||
    !safeVideoImagePath(image.name) ||
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
