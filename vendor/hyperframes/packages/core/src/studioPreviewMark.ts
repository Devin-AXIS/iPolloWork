export const STUDIO_PREVIEW_MARK_META = "hyperframes-studio-preview";
export const STUDIO_PREVIEW_UPCOMING_ATTR = "data-hf-upcoming";
export const STUDIO_PREVIEW_LAZY_ATTR = "data-hf-preview-lazy";
export const STUDIO_PREVIEW_ERRORS = "__hfPreviewErrors";
export const STUDIO_PREVIEW_TIME_PARAM = "__hf_preview_time";
export const STUDIO_PREVIEW_FRAME_ONLY_PARAM = "__hf_preview_frame_only";

/** First displayed position in Studio; rendering and ordinary embeds still start at zero. */
export function readStudioPreviewTime(search: string): number {
  const time = Number(new URLSearchParams(search).get(STUDIO_PREVIEW_TIME_PARAM));
  return Number.isFinite(time) && time >= 0 ? Math.min(time, 7200) : 0;
}
