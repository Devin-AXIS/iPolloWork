// Browser blob URL minting for ready drawing resources (typed-drawings-and-images task 10).
//
// Bytes stay behind an opaque validated handle — paint consumers never receive raw package bytes.

import type { ValidatedImageBytesHandle } from '../store/package/image-resources.ts';
import type { RenderableImageMime } from '../store/package/image-resources.ts';
import type { PaintImageUrlPort } from '../output/semantic-paint-drawings.ts';

/** Cache-owned validated-byte lookup; only the URL port factory receives this. */
export interface PaintImageUrlSource {
  readonly mintValidatedBytes: (
    handle: ValidatedImageBytesHandle,
    expectedContentId: string
  ) => Uint8Array | null;
}

/**
 * Mint `blob:` URLs from validated snapshotted bytes, or null when `URL.createObjectURL`
 * is unavailable (headless / test environments without a full browser URL API).
 */
export function createBrowserPaintImageUrlPort(
  source: PaintImageUrlSource
): PaintImageUrlPort | null {
  if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') {
    return null;
  }
  return Object.freeze({
    create(handle: ValidatedImageBytesHandle, mime: RenderableImageMime): string {
      const bytes = source.mintValidatedBytes(handle, handle.contentId);
      if (!bytes) {
        throw new Error(
          `PaintImageUrlSource: validated bytes unavailable for ${handle.resourceKey}`
        );
      }
      // Copy into a fresh ArrayBuffer so callers cannot mutate the cache-owned snapshot.
      const copy = new Uint8Array(bytes);
      return URL.createObjectURL(new Blob([copy], { type: mime }));
    },
    revoke(url: string): void {
      URL.revokeObjectURL(url);
    },
  });
}

/** Headless no-op port — ready images paint as placeholders, never mint URLs. */
export function createHeadlessPaintImageUrlPort(): null {
  return null;
}
