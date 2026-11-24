// Paint a `w:lvlPicBulletId` list marker's IMAGE, from the geometry layout published for it.
//
// Its own module because it is a different SINK from the glyph marker beside it: no font
// face, no text band, no baseline arithmetic — one `<img>` in a box layout already placed.
// The trust rules are the drawing painter's: the element is built node by node with
// `createElement` plus `setAttribute`, never from an HTML string, and the only URL it takes
// is one the host's port minted from validated bytes.

import type { ParagraphFragmentRecord } from '../layout/semantic-records.ts';
import type { PaintImageUrlPort } from './semantic-paint-drawings.ts';
import type { ValidatedImageBytesHandle } from '../store/package/validated-image-bytes.ts';

/** The one registry member this sink needs, narrowed so the module takes no paint context. */
export interface ListMarkerImageUrlSource {
  readonly urlForReady: (
    handle: ValidatedImageBytesHandle,
    mime: Parameters<PaintImageUrlPort['create']>[1]
  ) => string | null;
}

/**
 * Paint the marker image, or null when there is nothing drawable.
 *
 * Null covers every fall back the marker has — no picture bullet, a missing, external,
 * malformed or oversized one, a host with no image URL port, and a resource still decoding.
 * The caller then paints the level's `w:lvlText`, which is what Word's own fallback shows.
 *
 * Geometry is the one layout published: the image sits on the first line's baseline and the
 * line was made tall enough for it. Paint never rescales from the resource's intrinsic pixels.
 */
export function paintListMarkerPicture(
  document: Document,
  fragment: ParagraphFragmentRecord,
  ctx: {
    readonly scale: number;
    readonly urlRegistry: ListMarkerImageUrlSource | null;
  }
): HTMLElement | null {
  const picture = fragment.marker?.picture;
  const urls = ctx.urlRegistry;
  if (!picture || picture.resource.kind !== 'ready' || !urls) return null;
  const scale = ctx.scale;
  const url = urls.urlForReady(picture.resource.validatedHandle, picture.resource.mime);
  if (url === null) return null;
  const box = picture.box;
  const element = document.createElement('span');
  element.className = 'docx-list-marker';
  element.dataset.docxMarker = '';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.left = `${(box.x - fragment.box.x) * scale}px`;
  element.style.top = `${(box.y - fragment.box.y) * scale}px`;
  element.style.width = `${box.width * scale}px`;
  element.style.height = `${box.height * scale}px`;
  element.style.display = 'block';
  element.style.overflow = 'hidden';
  const image = document.createElement('img');
  image.className = 'docx-list-marker-image';
  image.setAttribute('src', url);
  // Empty `alt` on purpose: the marker is furniture and is already `aria-hidden`.
  image.setAttribute('alt', '');
  image.setAttribute('draggable', 'false');
  image.style.display = 'block';
  image.style.width = `${box.width * scale}px`;
  image.style.height = `${box.height * scale}px`;
  image.style.maxWidth = 'none';
  image.style.maxHeight = 'none';
  element.append(image);
  return element;
}
