// Bounded projection of `w:numPicBullet` (§17.9.20) for list markers that draw an image.
//
// A picture bullet is a VML `w:pict` inside `numbering.xml`: a `v:shape` with an authored
// `style="width:…;height:…"` and a `v:imagedata r:id`. The relationship belongs to the
// NUMBERING part, not the document part, so the resolved id is only meaningful together
// with the part that owns it.
//
// Projection only. Every value here is file-derived: counts are capped, sizes are clamped,
// and a shape this cannot read resolves to "no picture bullet", which leaves the level's
// `w:lvlText` in force rather than failing the document.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import { attribute, children, points, styleOf, VML } from '../store/package/legacy-vml-values.ts';

/** Relationship namespace of `r:id` on `v:imagedata`. */
const RELATIONSHIP_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Soft ceiling on `w:numPicBullet` entries read from one numbering part. */
export const MAX_PICTURE_BULLETS = 64;

/** Deepest VML nesting walked below one `w:numPicBullet` before the search gives up. */
const MAX_PICT_DEPTH = 8;

/** Widest VML fan-out walked below one `w:numPicBullet`. */
const MAX_PICT_ELEMENTS = 256;

/** Authored marker extent ceiling, in points (22"): the same bound level indents take. */
const MAX_PICTURE_BULLET_PT = 1584;

/** Relationship ids are bounded strings; anything longer is not one. */
const MAX_RELATIONSHIP_ID_LENGTH = 64;

/**
 * One `w:numPicBullet`: the image a level draws instead of its `w:lvlText`.
 *
 * `relationshipId` is unresolved on purpose — it names a relationship of the numbering part,
 * and resolving it is the image-resource lookup's job, under its own validation and caps.
 * @public
 */
export interface NumberingPictureBullet {
  /** `w:numPicBulletId` — what a level's `w:lvlPicBulletId` names. */
  readonly picBulletId: string;
  /** `v:imagedata/@r:id`, relative to the NUMBERING part's relationships. */
  readonly relationshipId: string;
  /** Authored `v:shape` width in points. */
  readonly width: number;
  /** Authored `v:shape` height in points. */
  readonly height: number;
  /** Pixel height of the image, when its header could be read. */
  readonly pixelHeight?: number;
}

/**
 * A level's picture bullet with the size it is actually DRAWN at.
 *
 * Separate from {@link NumberingPictureBullet} because the authored `v:shape` extent is not
 * the painted extent: Word scales it by the marker run's font size. Layout, hit testing and
 * both paint sinks read `width` / `height`; `authored` is kept so the scale stays inspectable.
 * @public
 */
export interface ResolvedPictureBullet {
  /** `v:imagedata/@r:id`, relative to the NUMBERING part's relationships. */
  readonly relationshipId: string;
  /** Painted width in points, after the marker font scale. */
  readonly width: number;
  /** Painted height in points, after the marker font scale. */
  readonly height: number;
  /** The `v:shape` extent exactly as the file authored it. */
  readonly authored: NumberingPictureBullet;
}

/**
 * How much bigger than its authored extent a picture bullet is drawn, at one marker size, for an
 * image 12 pixels tall. {@link pictureBulletScale} generalizes it to any pixel height.
 *
 * Established by capture, exact on six controls that varied the authored extent (4.5pt, 9pt,
 * 18pt) and the marker font size (12pt, 18pt, 24pt) independently: the scale is LINEAR in the
 * marker font size and rises by exactly 1.0 for every 6pt of font — 5/3 at 12pt, 8/3 at 18pt,
 * 11/3 at 24pt. It is NOT proportional to the font size (that predicts 10/3 at 24pt against a
 * measured 11/3), and the authored extent is NOT used unchanged (that predicts 9pt against a
 * measured 15pt). Evidence lives with the captures, not here.
 *
 * Unquantized on purpose. The reference's painted values sit on its own 0.24pt paint grid;
 * layout must carry the exact number and leave quantization to whatever paints.
 */
export function pictureBulletFontScale(markerFontSizePt: number): number {
  return (markerFontSizePt - 2) / 6;
}

/**
 * The scale of an authored bullet extent at one marker size. Each authored point is measured
 * against an image pixel: an image `pixelHeight` pixels tall draws `2 × (size − 2)` points tall
 * when its shape is as tall as the image (`picture-bullet-pixels.ts`). Without a pixel height,
 * the 12-pixel scale of {@link pictureBulletFontScale} stays.
 */
export function pictureBulletScale(markerFontSizePt: number, pixelHeight?: number): number {
  return pixelHeight !== undefined && pixelHeight > 0
    ? (2 * (markerFontSizePt - 2)) / pixelHeight
    : pictureBulletFontScale(markerFontSizePt);
}

/**
 * Apply {@link pictureBulletFontScale} to an authored bullet, or answer null.
 *
 * Null is the marker falling back to the level's `w:lvlText`, which is what every other
 * picture-bullet refusal does. It covers a marker font small enough to make the scale zero or
 * negative (`w:sz` of 2pt or less — Word allows 1pt), a non-finite size, and a result past the
 * same extent ceiling the authored value is clamped to.
 *
 * `markerFontSizePt` is the marker run's RESOLVED size, so it already carries the documented
 * cascade: `w:docDefaults`, then the paragraph style, then the paragraph mark's `w:rPr`, then
 * the level's own `w:rPr`. A level that authors no `w:rPr` therefore inherits rather than
 * taking a constant, and a document that authors no `w:sz` anywhere lands on the
 * application-defined 10pt terminal fallback the rest of run resolution uses.
 */
export function resolvePictureBullet(
  authored: NumberingPictureBullet,
  markerFontSizePt: number
): ResolvedPictureBullet | null {
  if (!Number.isFinite(markerFontSizePt)) return null;
  const scale = pictureBulletScale(markerFontSizePt, authored.pixelHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const width = authored.width * scale;
  const height = authored.height * scale;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width > MAX_PICTURE_BULLET_PT || height > MAX_PICTURE_BULLET_PT) return null;
  return { relationshipId: authored.relationshipId, width, height, authored };
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function clampExtent(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > MAX_PICTURE_BULLET_PT ? MAX_PICTURE_BULLET_PT : value;
}

/**
 * The first `v:shape`/`v:rect`/`v:image` under `w:pict` that carries an image and a size.
 *
 * Bounded breadth-first: a hostile part can nest `w:pict` as deep and as wide as it likes,
 * so the walk is capped by both element count and depth rather than by the file's shape.
 */
function pictureBulletShape(
  picBullet: OoxmlElement
): { readonly relationshipId: string; readonly width: number; readonly height: number } | null {
  const queue: { readonly node: OoxmlElement; readonly depth: number }[] = [
    { node: picBullet, depth: 0 },
  ];
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited >= MAX_PICT_ELEMENTS) return null;
    visited += 1;
    const node = current.node;
    if (node.namespaceUri === VML) {
      const style = styleOf(node);
      const width = style ? clampExtent(points(style.get('width'))) : null;
      const height = style ? clampExtent(points(style.get('height'))) : null;
      if (width !== null && height !== null) {
        for (const child of children(node)) {
          if (child.namespaceUri !== VML || child.localName !== 'imagedata') continue;
          const relationshipId = attribute(child, 'id', RELATIONSHIP_NAMESPACE_URI);
          if (
            relationshipId === undefined ||
            relationshipId.length === 0 ||
            relationshipId.length > MAX_RELATIONSHIP_ID_LENGTH
          ) {
            continue;
          }
          return { relationshipId, width, height };
        }
      }
    }
    if (current.depth >= MAX_PICT_DEPTH) continue;
    for (const child of node.children) {
      if (!isElement(child)) continue;
      queue.push({ node: child, depth: current.depth + 1 });
    }
  }
  return null;
}

/**
 * Project every `w:numPicBullet` under a `w:numbering` root, keyed by `w:numPicBulletId`.
 *
 * Duplicate ids keep the first declaration, matching the rest of the numbering projection.
 * An entry whose shape has no readable size or no embedded image relationship is DROPPED,
 * so the level that names it falls back to its `w:lvlText`.
 */
export function readNumberingPictureBullets(
  root: OoxmlElement | null | undefined,
  pixelHeightOf?: (relationshipId: string) => number | undefined
): ReadonlyMap<string, NumberingPictureBullet> {
  const bullets = new Map<string, NumberingPictureBullet>();
  if (!root) return bullets;
  let seen = 0;
  for (const child of root.children) {
    if (!isElement(child)) continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI || child.localName !== 'numPicBullet') continue;
    if (seen >= MAX_PICTURE_BULLETS) break;
    seen += 1;
    const picBulletId = attribute(child, 'numPicBulletId', WML_NAMESPACE_URI);
    if (picBulletId === undefined || picBulletId.length === 0 || picBulletId.length > 64) continue;
    if (bullets.has(picBulletId)) continue;
    const shape = pictureBulletShape(child);
    if (!shape) continue;
    const pixelHeight = pixelHeightOf?.(shape.relationshipId);
    bullets.set(picBulletId, {
      picBulletId,
      ...shape,
      ...(pixelHeight !== undefined ? { pixelHeight } : {}),
    });
  }
  return bullets;
}
