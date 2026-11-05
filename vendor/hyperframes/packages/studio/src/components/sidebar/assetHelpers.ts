import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, FONT_EXT } from "../../utils/mediaTypes";

export type MediaCategory = "audio" | "images" | "video" | "fonts";

export function getCategory(path: string): MediaCategory | null {
  if (AUDIO_EXT.test(path)) return "audio";
  if (IMAGE_EXT.test(path)) return "images";
  if (VIDEO_EXT.test(path)) return "video";
  if (FONT_EXT.test(path)) return "fonts";
  return null;
}

export function getAudioSubtype(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("/bgm/") || lower.includes("/music/")) return "BGM";
  if (lower.includes("/sfx/") || lower.includes("/sound")) return "SFX";
  if (lower.includes("/voice/") || lower.includes("/narrat")) return "Voice";
  return "Audio";
}

export function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ext(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

/**
 * Truncate a string to at most `maxLen` chars, preserving the start and end.
 * Middle characters are replaced with an ellipsis. If the string is short
 * enough it is returned unchanged.
 *
 * @example truncateMiddle("2a37eabf-long-uuid-887d8.mp4", 20) → "2a37eabf-…887d8.mp4"
 *
 * Pure — unit-tested.
 */
export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const keep = maxLen - 1; // 1 char for ellipsis
  const tail = Math.floor(keep / 3);
  const head = keep - tail;
  return str.slice(0, head) + "…" + str.slice(str.length - tail);
}

/**
 * Format a duration in seconds as MM:SS. Returns an empty string for
 * non-positive, NaN, or Infinity values. Pure — unit-tested.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Keep implementation files for generated avatars out of the material library.
 * They remain in the project for retries, audio preservation, and layered
 * cutout playback, but only the assembled movie is a user-facing material.
 */
export function filterMaterialLibraryAssets(
  paths: string[],
  usedPaths: ReadonlySet<string> = new Set(),
): string[] {
  const normalized = paths.map((path) => path.replaceAll("\\", "/"));
  const transparentLongAvatarIds = new Set<string>();
  const transparentShortAvatarIds = new Set<string>();
  const usedAssetBases = new Set(Array.from(usedPaths, basename));

  for (const path of normalized) {
    const long = /^assets\/avatar-long-(.+)\.(?:webm|mov)$/i.exec(path);
    if (long) {
      transparentLongAvatarIds.add(long[1]);
      continue;
    }
    const short = /^assets\/avatar-(.+)\.(?:webm|mov)$/i.exec(path);
    if (short) transparentShortAvatarIds.add(short[1]);
  }

  return paths.filter((path, index) => {
    const value = normalized[index];
    if (/^renders\/avatar-cutouts\//i.test(value)) return false;
    const legacyCutout = /^assets\/cutouts\/(.+)-cutout(?:-\d+)?\.[^.]+$/i.exec(value);
    if (
      legacyCutout &&
      !usedPaths.has(path) &&
      usedAssetBases.has(legacyCutout[1])
    )
      return false;
    if (/^assets\/avatar-(?:reference|voice)-/i.test(value)) return false;
    if (/^renders\/avatar-(?!long-).+-\d+-\d+\.mp4$/i.test(value)) return false;
    if (/^renders\/avatar-(?!long-).+-\d+\.wav$/i.test(value)) return false;

    const longSource = /^renders\/avatar-long-(.+)\.mp4$/i.exec(value);
    if (longSource && transparentLongAvatarIds.has(longSource[1])) return false;
    const shortSource = /^renders\/(.+)\.mp4$/i.exec(value);
    if (shortSource && transparentShortAvatarIds.has(shortSource[1])) return false;
    return true;
  });
}

export const CATEGORY_LABELS: Record<MediaCategory, string> = {
  audio: "Audio",
  images: "Images",
  video: "Video",
  fonts: "Fonts",
};

export const FILTER_ORDER: MediaCategory[] = ["images", "video", "audio", "fonts"];
