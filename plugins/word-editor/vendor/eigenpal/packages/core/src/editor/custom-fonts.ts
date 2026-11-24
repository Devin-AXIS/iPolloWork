import type { FontFaceRequest } from '../contracts/editor.ts';
import type { FontResolutionRequest } from './font-composition.ts';
import { defineFontResolver, type MarkedFontResolver } from './font-resolver.ts';
import {
  loadFonts,
  type FontLoadFailure,
  type LoadFontsRequest,
  type LoadFontsResult,
} from './load-fonts.ts';

/** Options for loading application fonts when the editor resolves its font configuration. @public */
export interface CustomFontsOptions extends Omit<LoadFontsRequest, 'signal'> {
  /** Reports each failed face. Defaults to a console warning. Cancellation does not call this handler. */
  readonly onFailure?: (failure: FontLoadFailure) => void;
}

/** A font origin that supplies validated application font bytes on demand. @public */
export type CustomFontsResolver = MarkedFontResolver<
  (request: FontResolutionRequest) => Promise<LoadFontsResult>
>;

const familyKey = (family: string): string => family.trim().toLowerCase();
const faceKey = (face: FontFaceRequest): string =>
  JSON.stringify([familyKey(face.family), face.weight, face.style]);

/**
 * Supply application fonts without manual resolver wiring.
 *
 * Loads all listed faces when the editor resolves fonts, including families the document
 * does not use yet. This makes company fonts available in the font picker for new documents.
 * Faces supplied by earlier origins are skipped by family, weight, and style; family
 * matching ignores case. URLs always come from `sources`, never from document text.
 *
 * Uses {@link loadFonts} for validation, optional hash checks, and browser caching.
 * The editor registers the returned bytes under private aliases. This function does not
 * change the document's selected fonts or register page-wide family names.
 *
 * Constructing the resolver does not fetch. Cancellation of the document load rejects
 * with `signal.reason`, without warnings or `onFailure` calls. Other face failures are
 * reported once per resolution, and successful faces remain available to the editor.
 *
 * ```ts
 * const fonts = useFonts(
 *   customFonts({ sources: companyFontFiles, onFailure: reportFontFailure }),
 *   packagedFonts(),
 *   googleFonts(),
 * );
 * ```
 *
 * Use {@link loadFonts} directly to load every listed face eagerly.
 * @public
 */
export function customFonts(options: CustomFontsOptions): CustomFontsResolver {
  return defineFontResolver(async (request: FontResolutionRequest): Promise<LoadFontsResult> => {
    if (request.signal?.aborted) throw request.signal.reason;
    const resolved = new Set((request.resolvedFaces ?? []).map(faceKey));
    const sources = options.sources.filter((source) => !resolved.has(faceKey(source)));
    if (sources.length === 0) return { sources: [], failures: [] };
    const { onFailure, ...loadOptions } = options;
    const result = await loadFonts({ ...loadOptions, sources, signal: request.signal });
    if (request.signal?.aborted) throw request.signal.reason;
    for (const failure of result.failures) {
      if (onFailure) onFailure(failure);
      else console.warn(`[fonts] ${failure.request.family} (${failure.url}): ${failure.reason}`);
    }
    return result;
  });
}
