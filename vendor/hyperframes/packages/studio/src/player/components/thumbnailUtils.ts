import { MAX_VISIBLE_THUMBNAIL_FRAMES } from "../lib/timelineViewportBudgets";
/** Rendered height of a timeline-clip thumbnail strip, in CSS px. */
export const THUMBNAIL_CLIP_HEIGHT = 24;
export const MAX_THUMBNAIL_TILES = 24;
export interface ThumbnailStripLayout {
  /** Width of a single tile, in CSS px. */
  frameW: number;
  /** Number of tiles needed to fill the container. */
  frameCount: number;
}

/**
 * Compute the film-strip tile layout for a clip thumbnail: fixed-height tiles
 * sized by the media's aspect ratio, repeated to fill the clip width.
 * Degenerate aspects (0, negative, NaN, Infinity) fall back to 16:9.
 */
export function computeThumbnailStrip(
  containerWidth: number,
  aspect: number,
  clipHeight: number = THUMBNAIL_CLIP_HEIGHT,
): ThumbnailStripLayout {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const naturalFrameWidth = Math.max(1, Math.round(clipHeight * safeAspect));
  const naturalFrameCount =
    containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / naturalFrameWidth)) : 1;
  const frameCount = Math.min(naturalFrameCount, MAX_THUMBNAIL_TILES);
  const frameW =
    naturalFrameCount > MAX_THUMBNAIL_TILES
      ? Math.max(1, Math.ceil(containerWidth / MAX_THUMBNAIL_TILES))
      : naturalFrameWidth;
  return { frameW, frameCount };
}

/**
 * Percent-encode each segment of a composition-relative media path so filenames
 * containing spaces, parentheses, a U+202F narrow no-break space (the macOS
 * screenshot artifact), or any other non-ASCII / URL-unsafe character yield a
 * valid URL instead of a 404. Slashes are preserved as separators.
 *
 * Shared by every timeline media-URL builder (filmstrip thumbnails, audio
 * waveform, sub-composition preview) so they encode identically to the assets
 * panel — a raw segment 404s on the exact filenames the assets panel loads fine.
 */
export function encodePreviewPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Resolve a timeline element's media src to a URL loadable from the studio
 * (parent) document. Composition-relative paths (e.g. "assets/image.png") are
 * routed through the project preview endpoint with each segment encoded.
 *
 * Already-loadable URLs pass through untouched: absolute http(s) URLs, plus
 * `data:` and `blob:` URLs. Routing a `data:`/`blob:` URL through the preview
 * endpoint would percent-encode the whole thing into a multi-KB path segment
 * that the server rejects with HTTP 431 (Request Header Fields Too Large).
 */
export function resolveMediaPreviewUrl(src: string, projectId: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return `/api/projects/${projectId}/preview/${encodePreviewPath(src)}`;
}

/** Quantize request identities so a pixel-by-pixel resize does not thrash the cache. */
export function quantizeThumbnailFrameCount(frameCount: number): number {
  const safeCount = Math.max(1, Number.isFinite(frameCount) ? Math.ceil(frameCount) : 1);
  const cap = 2 ** Math.floor(Math.log2(MAX_VISIBLE_THUMBNAIL_FRAMES));
  return Math.min(cap, 2 ** Math.ceil(Math.log2(safeCount)));
}

/**
 * The decoded frame tile `index` of `tileCount` shows, of a strip's `frameCount`: the last tile
 * shows the clip's last frame; the others the slice (videoThumbnailTimestamps) holding their centre.
 */
export function thumbnailFrameForTile(
  index: number,
  tileCount: number,
  frameCount: number,
): number {
  if (frameCount < 2) return 0;
  if (tileCount > 1 && index >= tileCount - 1) return frameCount - 1;
  const slices = frameCount - 1;
  return Math.min(slices - 1, Math.floor(((index + 0.5) * slices) / tileCount));
}


export function probeImageAspect(
  imageSrc: string,
  signal: AbortSignal,
  tolerateSvgError = false,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    image.onload = () => {
      cleanup();
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? image.naturalWidth / image.naturalHeight
          : 16 / 9,
      );
    };
    image.onerror = () => {
      cleanup();
      if (tolerateSvgError && /\.svg($|\?)/i.test(imageSrc)) resolve(16 / 9);
      else reject(new Error("Image thumbnail failed to load"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = imageSrc;
  });
}
