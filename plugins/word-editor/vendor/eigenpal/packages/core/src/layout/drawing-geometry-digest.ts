// Digests of drawing geometry for the drawing layout reuse token. Split from
// inline-drawing-source.ts, which joins these digests with the projection's scalar fields.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';

// Scratch view used to fold a coordinate in by its exact IEEE-754 bits. Coordinates are not
// integers once a group transform has scaled them, so rounding would fold real geometry
// changes together.
const COORDINATE_SCRATCH = new Float64Array(1);
const COORDINATE_BITS = new Uint32Array(COORDINATE_SCRATCH.buffer);

/**
 * Digest of one vector shape's geometry and chrome, for the layout reuse token.
 *
 * Deliberately NOT a serialization. `JSON.stringify` of a shape at the 1024-point budget is
 * ~48 KB and ~230 us, and `isCompatibleWith` reads this token twice per atom whenever the
 * atom-identity fast path misses, so the serialization dominated a document full of shapes.
 * Every other field in the enclosing token is a cheap scalar join; this one folds the point
 * stream into two 32-bit FNV-1a accumulators and joins the scalars verbatim. The shape of
 * the component list (its length, and each subpath's length) is joined literally rather than
 * hashed, so a structural change can never hide inside the digest.
 *
 * This is a cache key, NOT a security primitive. FNV-1a is trivially invertible — its round
 * is `h = (h ^ d) * p` with an odd, hence modularly invertible, `p` — so a chosen last
 * coordinate can drive both accumulators to any target in closed form. That buys nothing
 * here, because forging a collision needs two shapes under the same `drawingNodeId` in two
 * revisions of one document, and the payoff is a stale repaint. Do not reuse this digest
 * anywhere an attacker profits from a collision.
 */
export function vectorShapeLayoutToken(
  vector: NonNullable<DrawingProjection['vectorShape']>
): string {
  HASH_SCRATCH[0] = 0x811c_9dc5;
  HASH_SCRATCH[1] = 0x1000_0193;
  const scalars: string[] = [];
  for (const component of vector.components) {
    scalars.push(
      component.fillHex ?? '',
      String(component.fillAlpha),
      component.strokeHex ?? '',
      String(component.strokeAlpha),
      String(component.strokeWidthEmu),
      // An inset outline paints inside its geometry, at twice the width under a clip.
      component.strokeInset === true ? 'in' : '',
      // Line ends and joins change the painted outline and its ink clip, not the points.
      component.strokeCap ?? '',
      component.strokeJoin ?? '',
      // Gradient stops and placement are file-derived numbers and names: JSON is stable.
      component.fillGradient ? JSON.stringify(component.fillGradient) : '',
      component.fillPattern ? JSON.stringify(component.fillPattern) : '',
      component.clipEmu ? JSON.stringify(component.clipEmu) : '',
      component.shadow ? JSON.stringify(component.shadow) : '',
      component.shadowOnly ? 'shadow-only' : '',
      component.strokeDash ? component.strokeDash.join(' ') : '',
      component.belowPicture ? 'below-picture' : '',
      String(component.strokeOutsetEmu ?? ''),
      String(component.subpathsEmu.length)
    );
    const subpaths = component.subpathsEmu;
    for (let index = 0; index < subpaths.length; index += 1) {
      const subpath = subpaths[index]!;
      // An omitted close flag paints closed, exactly like `true`; only `false` leaves the
      // path open, so that is the one value that must separate two otherwise equal shapes.
      scalars.push(String(subpath.length), component.subpathsClosed?.[index] === false ? '0' : '1');
      foldPointsInto(subpath, HASH_SCRATCH);
    }
    // Line-end triangles are generated geometry the painter fills separately, so a changed
    // `a:headEnd`/`a:tailEnd` moves nothing in the subpath stream. Their vertices join the
    // same accumulators, framed by their counts, so the token cannot reuse a stale record.
    const arrowheads = component.arrowheadsEmu;
    scalars.push(String(arrowheads?.length ?? 0));
    if (arrowheads) {
      for (const arrowhead of arrowheads) {
        scalars.push(String(arrowhead.length));
        foldPointsInto(arrowhead, HASH_SCRATCH);
      }
    }
  }
  return [
    String(vector.extentEmu.cx),
    String(vector.extentEmu.cy),
    String(vector.components.length),
    scalars.join(','),
    HASH_SCRATCH[0]!.toString(36),
    HASH_SCRATCH[1]!.toString(36),
  ].join(';');
}

/** The two FNV-1a accumulators {@link vectorShapeLayoutToken} folds every point stream into. */
const HASH_SCRATCH = new Uint32Array(2);

type EmuPoints = readonly Readonly<{ x: number; y: number }>[];

/** A standalone digest of one point list, for the wrap polygon. */
export function pointsDigest(points: EmuPoints): string {
  HASH_SCRATCH[0] = 0x811c_9dc5;
  HASH_SCRATCH[1] = 0x1000_0193;
  foldPointsInto(points, HASH_SCRATCH);
  return `${HASH_SCRATCH[0]!.toString(36)}:${HASH_SCRATCH[1]!.toString(36)}`;
}

/** One fold shared by subpaths, line ends and wrap polygons, so all hash the same way. */
function foldPointsInto(points: EmuPoints, hash: Uint32Array): void {
  let hashA = hash[0]!;
  let hashB = hash[1]!;
  for (const point of points) {
    COORDINATE_SCRATCH[0] = point.x;
    hashA = Math.imul(hashA ^ COORDINATE_BITS[0]!, 0x0100_0193);
    hashB = Math.imul(hashB ^ COORDINATE_BITS[1]!, 0x0100_01b3);
    COORDINATE_SCRATCH[0] = point.y;
    hashA = Math.imul(hashA ^ COORDINATE_BITS[1]!, 0x0100_0193);
    hashB = Math.imul(hashB ^ COORDINATE_BITS[0]!, 0x0100_01b3);
  }
  hash[0] = hashA;
  hash[1] = hashB;
}
