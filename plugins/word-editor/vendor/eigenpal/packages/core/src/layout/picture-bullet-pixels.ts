// The pixel height of each picture bullet image, read from the image header in the package.
//
// A picture bullet (§17.9.20 `w:numPicBullet`) is drawn at a height of `2 × (marker font size −
// 2)` points for each `v:shape` height point in an image pixel: the authored shape height is
// measured against the image's own pixel height. So a shape authored at the image's pixel size
// draws at the same height whatever that size is. The image's physical density does not count.
//
// Measured on picture bullets of 9, 18, 90 and 732 pixels at marker sizes of 10 to 24pt: a shape
// as tall as its image draws 16.08pt at 10pt and 19.92pt at 12pt, and a 9pt shape over a 90-pixel
// image draws 1.92pt at 12pt. PNG density of 72, 96 and 144 dpi, or none, gives the same size.
//
// Only the header is read, under the store's bounded validators. An image this cannot read has
// no pixel height, and the bullet keeps the authored-size rule.

import type { OoxmlElement, OoxmlPackage } from '@docx-editor.dev/core/store';
import { sniffImageMime, validateRasterHeader } from '../store/package/image-resources.ts';
import { resolveImageRelationship } from '../store/package/relationships.ts';

/** Reads the pixel height of an image a picture bullet names, by relationship id. */
export type PictureBulletPixelHeight = (relationshipId: string) => number | undefined;

/** The part name of `root` in `pkg`, or undefined when no part holds it. */
function partNameOf(pkg: OoxmlPackage, root: OoxmlElement): string | undefined {
  for (const [name, part] of pkg.parts) if (part.root === root) return name;
  return undefined;
}

/** The pixel heights of the images that the numbering part `root` of `pkg` names. */
export function pictureBulletPixelHeights(
  pkg: OoxmlPackage,
  root: OoxmlElement | null | undefined
): PictureBulletPixelHeight | undefined {
  if (!root) return undefined;
  const owner = partNameOf(pkg, root);
  if (owner === undefined) return undefined;
  const heights = new Map<string, number | undefined>();
  return (relationshipId) => {
    if (heights.has(relationshipId)) return heights.get(relationshipId);
    const resolved = resolveImageRelationship(pkg.relationships.get(owner), owner, relationshipId);
    const bytes = resolved.mode === 'internal' ? pkg.partBytes.get(resolved.partName) : undefined;
    const mime = bytes ? sniffImageMime(bytes) : 'unknown';
    const header =
      bytes &&
      (mime === 'image/png' ||
        mime === 'image/jpeg' ||
        mime === 'image/gif' ||
        mime === 'image/bmp' ||
        mime === 'image/webp')
        ? validateRasterHeader(bytes, mime)
        : null;
    const height = header && header.pixelHeight > 0 ? header.pixelHeight : undefined;
    heights.set(relationshipId, height);
    return height;
  };
}
