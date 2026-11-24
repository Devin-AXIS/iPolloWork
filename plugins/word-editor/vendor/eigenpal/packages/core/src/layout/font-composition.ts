import { supportedFontFamilies } from './supported-font-families.ts';
// Font configuration composition — the ONE documented way the three font origins
// (explicit app bytes, embedded document faces, substitute packages) become a single
// immutable `FontConfiguration`.
//
// Precedence is positional and first-wins: the base's sources beat every fragment's, and
// an earlier fragment beats a later one, keyed by (family, weight, style) — the same key
// `createFontResourceSnapshot` uses, which THROWS on duplicates. Composition is therefore
// also the dedup point: without it, handing an explicit Calibri and an embedded Calibri
// to the snapshot is a construction error rather than a precedence decision.
//
// Substitutions concatenate first-wins by their `from` face — and any substitution whose
// `from` is covered by a direct source is DROPPED here. The resource snapshot consults
// substitutions BEFORE sources, so an unfiltered Calibri→Carlito entry would beat real
// Calibri bytes; the contract says a direct source always wins, and this filter is where
// that promise is kept.

import type {
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';
import { HARD_MAX_FONT_BYTES, fontRequestKey } from './font-resource.ts';

/**
 * A partial font configuration one origin contributes: sources, substitutions, or both.
 * `loadDefaultFonts()` (the substitute package) and `loadFonts()` (the fetch helper) both
 * return this shape, so every origin composes through `composeFontConfiguration` the
 * same way.
 */
export interface FontConfigurationFragment {
  /** Selectable provider families, independent of loaded bytes. Listing them performs no fetch. */
  readonly supportedFamilies?: readonly string[];
  readonly sources?: readonly FontSource[];
  readonly substitutions?: readonly FontSourceSubstitution[];
  /**
   * Faces that arrive after the document first paints. The editor lays the document out
   * with `sources` and `substitutions`, then lays it out again once this settles. Use it
   * for large faces, such as CJK fonts, that would otherwise hold back the first paint.
   *
   * Late faces add faces only: the configuration settings (`defaultFont`, `maxFontBytes`) come
   * from the origins that answer at once, so the default font never changes after the paint.
   * Settings on a late answer, including `language`, are ignored.
   *
   * It must never reject: report failures and settle with what loaded, or `undefined`.
   * `composeFontOrigins()` keeps it on the merged result. A synchronous merge, such as
   * `composeFontConfiguration()`, drops it.
   */
  readonly deferred?: Promise<FontConfigurationFragment | undefined>;
}

/**
 * The base of a composition: everything a `FontConfiguration` carries, all optional.
 * Omitted fields take the documented defaults (`epoch` 0, `maxFontBytes` at the engine
 * hard maximum, `defaultFont` Calibri at 11pt — Word's own default face and size).
 */
export interface FontConfigurationBase extends FontConfigurationFragment {
  /**
   * Identity of this configuration's byte set. The engine uses it to tell one resolved
   * font set from another; leave it unset and the editor supplies the load sequence.
   */
  readonly epoch?: number;
  /** Per-face byte ceiling. Defaults to the engine hard maximum; lower it to tighten intake. */
  readonly maxFontBytes?: number;
  /** The face used when a run names no font. Defaults to Word's own: Calibri at 11pt. */
  readonly defaultFont?: FontConfiguration['defaultFont'];
  /** BCP-47 tag passed to the shaper for language-sensitive shaping. */
  readonly language?: string;
}

/**
 * What the document turned out to need, handed to an on-demand resolver.
 *
 * The families are the ones the file actually names — already name-validated and capped,
 * so a resolver may treat them as a list to look up, never as URLs or paths to build.
 */
export interface FontResolutionRequest {
  /**
   * Families needed by the document, deduped and capped at {@link MAX_RESOLVER_FAMILIES}.
   * Order is deterministic but may express host priority; do not sort it before resolving.
   */
  readonly families: readonly string[];
  /** The face a run naming no font resolves to, so a resolver can cover it too. */
  readonly defaultFamily: string;
  /** Cancels document-scoped resolution; network-backed resolvers should pass it to fetch. */
  readonly signal?: AbortSignal;
  /**
   * The faces to load: each family with the weight and style that its laid-out runs ask for,
   * the same faces of the families that stand in for it (font-table alternates and script or
   * class defaults), the caret's face, and the regular face of a family in `families` that no
   * laid-out text uses. Every family in `families` has a face here, so a resolver can load
   * only these faces.
   *
   * When an edit makes text use another face, such as bold, the engine asks again. That
   * request names only the new families in `families`, and the faces of the families it asks
   * about. The engine keeps the faces of earlier answers, so answer only for this request.
   *
   * Absent when the engine has laid out no text yet, such as for a large document that
   * resolves its fonts before the first layout. Load every face of each family then.
   */
  readonly faces?: readonly FontFaceRequest[];
  /**
   * Faces an EARLIER origin in the same composition can already PAINT — either because it
   * supplied the bytes, or because it mapped that face onto one it did supply.
   *
   * Absent, not empty, when there is nothing to report: the engine calling a resolver
   * directly, and the first origin of a composition.
   *
   * FACES, not families, and only faces backed by bytes. Both narrowings are load-bearing.
   * A family-grained list would let an origin holding only regular Arial suppress the bold
   * and italic a later origin would have supplied, and a list built from substitutions
   * alone would let an origin whose fetches all failed suppress the failover behind it,
   * because both shipped resolvers emit their substitution map before fetching. Together
   * they are what makes honouring this an OPTIMIZATION rather than a correctness
   * requirement: skipping a reported face cannot lose one, so a resolver that ignores this
   * list only spends bytes on a face first-wins composition would drop anyway.
   *
   * Match it case-insensitively. Word matches font names that way and both shipped
   * resolvers do.
   */
  readonly resolvedFaces?: readonly FontFaceRequest[];
}

/**
 * Resolve fonts once the document's needs are known, instead of ahead of them.
 *
 * Called after the file is mounted and again when editing requests a new family.
 * Results compose with previously supplied faces; resolvedFaces identifies that coverage.
 * Returning nothing is a valid answer — it means "I cover none of this", and the
 * document stays on the fixed measurer.
 *
 * A resolver that fetches makes opening a document perform network requests. That is a
 * real change in posture and it must stay the APP's decision: the engine never supplies
 * one, and the families here are file-derived, so a resolver must look them up in a set
 * it shipped rather than interpolate them into a URL.
 */
export type FontResolver = (
  request: FontResolutionRequest
) =>
  | FontConfiguration
  | FontConfigurationFragment
  | undefined
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>;

/** Normalize an on-demand resolver answer that covers none of the requested families. */
export function normalizeFontResolverResult(
  result: FontConfigurationBase | null | undefined
): FontConfigurationBase | undefined {
  const failures = result && 'failures' in result ? result.failures : undefined;
  const empty =
    result == null ||
    ((result.sources?.length ?? 0) === 0 &&
      (result.substitutions?.length ?? 0) === 0 &&
      (failures === undefined || (Array.isArray(failures) && failures.length === 0)));
  return empty ? undefined : result;
}

/**
 * Ceiling on the families one document can put in front of a resolver.
 *
 * A resolver typically turns each family into up to four faces, and the resource snapshot
 * refuses more than `HARD_MAX_FONT_SOURCES` (256) sources — so 64 families is the point
 * past which a document could no longer be served anyway. Capping here means a file
 * declaring thousands of distinct `w:rFonts` cannot fan a resolver out across thousands
 * of lookups (or fetches) before that limit is ever reached.
 */
export const MAX_RESOLVER_FAMILIES = 64;

/** The document default font when nothing else says otherwise: Calibri at 11pt. */
export const DEFAULT_FONT: FontConfiguration['defaultFont'] = Object.freeze({
  family: 'Calibri',
  sizeHalfPoints: 22,
});

/** @deprecated Use {@link DEFAULT_FONT}. */
export const WORD_DEFAULT_FONT: FontConfiguration['defaultFont'] = DEFAULT_FONT;

/**
 * Merge a base and any number of fragments into one frozen `FontConfiguration`.
 *
 * A bare fragment IS a valid base, so the single-origin case is one argument:
 * `composeFontConfiguration(await loadDefaultFonts())`. Pass extra fragments to layer
 * origins, and set `epoch`/`maxFontBytes`/`defaultFont` on the base only when you need
 * something other than the documented defaults.
 *
 * - Sources dedupe first-wins by (family, weight, style), in argument order — base
 *   before fragments, earlier fragments before later ones.
 * - Substitutions dedupe first-wins by their `from` face, in the same order, and every
 *   substitution whose `from` face has a direct source anywhere in the composition is
 *   dropped: a real face always beats a stand-in.
 * - The result is frozen (arrays included); the byte arrays themselves are the callers'
 *   and are not copied here — the resource snapshot takes its own defensive copy.
 */
export function composeFontConfiguration(
  base: FontConfigurationBase,
  ...fragments: readonly FontConfigurationFragment[]
): FontConfiguration {
  const origins: readonly FontConfigurationFragment[] = [base, ...fragments];

  const sources: FontSource[] = [];
  const sourceKeys = new Set<string>();
  for (const origin of origins) {
    for (const source of origin.sources ?? []) {
      const key = fontRequestKey(source.request);
      if (sourceKeys.has(key)) continue;
      sourceKeys.add(key);
      sources.push(source);
    }
  }

  const substitutions: FontSourceSubstitution[] = [];
  const substitutionKeys = new Set<string>();
  for (const origin of origins) {
    for (const substitution of origin.substitutions ?? []) {
      const key = fontRequestKey(substitution.from);
      if (sourceKeys.has(key) || substitutionKeys.has(key)) continue;
      substitutionKeys.add(key);
      substitutions.push(substitution);
    }
  }

  const supportedFamilies = supportedFontFamilies(
    origins.map((origin) => origin.supportedFamilies)
  );
  return Object.freeze({
    ...(supportedFamilies.length ? { supportedFamilies } : {}),
    epoch: base.epoch ?? 0,
    maxFontBytes: base.maxFontBytes ?? HARD_MAX_FONT_BYTES,
    sources: Object.freeze(sources),
    ...(substitutions.length > 0 ? { substitutions: Object.freeze(substitutions) } : {}),
    defaultFont: base.defaultFont ?? DEFAULT_FONT,
    ...(base.language !== undefined ? { language: base.language } : {}),
  });
}

/**
 * The same family-name bound `document-catalog.ts` and the paint sink enforce: kept in
 * sync by value because each module re-validates at its own boundary. Every name this
 * module emits can end up in a CSS `font-family` declaration.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

/** A configuration in either public spelling — full or fragment-with-defaults. */
export type FontCatalogConfiguration = FontConfiguration | FontConfigurationBase;

/**
 * The face a run with no authored font is measured and reported as: the configured
 * default when it names a valid family, Word's own (Calibri) otherwise.
 */
export function configuredDefaultFontFamily(configuration?: FontCatalogConfiguration): string {
  const family = configuration?.defaultFont?.family;
  return family !== undefined && FONT_NAME.test(family) ? family : DEFAULT_FONT.family;
}
