import {
  composeFontOrigins,
  defineFontResolver,
  type FontOrigin,
  type MarkedFontResolver,
} from './font-resolver.ts';

/**
 * Load an origin's faces after the document first paints, instead of before.
 *
 * The editor opens the document with the faces the other origins supply, then lays it out
 * again when these arrive. Use it for faces that are large or slow to fetch. Leave an origin
 * unwrapped to install its faces with the document's other waiting fonts: a large document
 * (over about 512 KB of uncompressed content) waits up to 2 seconds for them before its
 * first paint.
 *
 * ```ts
 * const fonts = [packagedFonts(), deferFonts(myBrandFonts())];
 * ```
 *
 * A document export that receives this origin waits for its faces, so exported pages use them.
 * The faces never change the configuration settings, such as `defaultFont` or `maxFontBytes`:
 * those come from the origins that answer at once, so the document does not change its
 * default font after it paints.
 *
 * @public
 */
export function deferFonts(origin: FontOrigin): MarkedFontResolver {
  return defineFontResolver((request) => {
    const failures: unknown[] = [];
    const deferred = composeFontOrigins([origin], request, {
      onOriginFailure: (failure) => failures.push(failure.cause),
    }).then(
      // Whoever receives the late answer reports these: the composition this sits in, or the
      // editor when this is its only resolver.
      (fragment) => (failures.length > 0 ? { sources: [], ...fragment, failures } : fragment),
      // Settles, never rejects: a cancelled load answers nothing, and any other refusal is
      // reported like the origin's own failures.
      (cause: unknown) => (request.signal?.aborted ? undefined : { sources: [], failures: [cause] })
    );
    return { sources: [], deferred };
  });
}
