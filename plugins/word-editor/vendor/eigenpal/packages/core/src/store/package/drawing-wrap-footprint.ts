// The footprint of an `mc:AlternateContent` payload the engine cannot draw.
//
// Such a payload (a shape group with a member it cannot paint, a group whose picture resource
// fails) stays invisible: no placeholder card. An anchor still states an extent, a position
// and a wrap, and text flows around that area whether or not the graphic paints. An inline
// drawing still takes its extent on its line. The footprint keeps exactly those layout facts
// and removes every paint payload, so layout reserves the space and every
// output sees a hidden record with nothing to draw.

import type { DrawingProjection, ImageWrapTarget } from './drawing-projection.ts';

/**
 * Wraps that move text. `wrapNone` resolves to `inFront` or `behind` (from `behindDoc`), and
 * neither reserves space; `behindDoc` with a wrapping mode wraps as a picture does.
 */
const FOOTPRINT_WRAPS: ReadonlySet<ImageWrapTarget> = new Set([
  'square',
  'squareLeft',
  'squareRight',
  'tight',
  'through',
  'topAndBottom',
]);

// Keyed by the source projection, so every read of one atom answers the same object and
// layout caches keyed by projection identity keep hitting.
const footprints = new WeakMap<DrawingProjection, DrawingProjection | null>();

/**
 * The layout-only stand-in for `projection`, or null when it reserves no space: a hidden
 * drawing, or an anchor whose wrap moves no text.
 *
 * The result keeps the projection's kind, carries `footprintOnly: true`, and has no picture,
 * group picture, vector shape, text box story or hyperlink. Its geometry is the authored
 * extent and anchor, already bounded by the projection's extent and offset reads.
 */
export function wrapFootprintProjection(projection: DrawingProjection): DrawingProjection | null {
  const cached = footprints.get(projection);
  if (cached !== undefined) return cached;
  const footprint =
    !projection.hidden && (projection.kind === 'inline' || FOOTPRINT_WRAPS.has(projection.wrap))
      ? Object.freeze({
          ...projection,
          relationshipId: null,
          hyperlinkHref: null,
          picture: null,
          vectorShape: null,
          groupPicture: null,
          groupPictureLayers: undefined,
          textboxStory: null,
          groupTextboxes: undefined,
          legacyGraphic: undefined,
          footprintOnly: true as const,
        })
      : null;
  footprints.set(projection, footprint);
  return footprint;
}
