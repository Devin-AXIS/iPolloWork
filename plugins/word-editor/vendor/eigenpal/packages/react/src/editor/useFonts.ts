// The stable-identity wrapper every font source needs before it can be a prop.
//
// `DocxEditor.Root` replaces its fonts when `fonts` changes identity, which is right for a
// value — new bytes are a new font setup — and a trap for a function: `fonts={googleFonts()}`
// is a fresh resolver on every render, so the editor would resolve and lay out its fonts
// again on every render, forever. Awaiting a loader in the component has
// the same shape of problem from the other end (`useState` + an effect, cancelled on
// unmount, and nothing renders until it lands).
//
// `useFonts` gives back ONE resolver for the component's life, delegating to whatever was
// passed most recently. Inline objects, inline `googleFonts()`, a promise, a bare
// fragment: all fine, none of them replaces the fonts again.

import { useMemo, useRef } from 'react';
import {
  composeFontOrigins,
  defineFontResolver,
  type FontConfigurationFragment,
  type FontOrigin,
  type FontResolutionRequest,
  type FontResolver,
  type MarkedFontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';

/**
 * Anything that can describe fonts: a resolved configuration, a bare fragment, a promise
 * for either (what a loader like `defaultFonts()` returns), or an on-demand
 * {@link FontResolver} (what `packagedFonts()` and `googleFonts()` return).
 *
 * The resolver arm is BARE `FontResolver`, unmarked. `FontOrigin` — what a list position
 * takes — requires the `defineFontResolver` mark, because a list may also hold a
 * zero-argument loader and only the mark separates the two. There is no such ambiguity in
 * the first argument of {@link useFonts}, which has never accepted a loader, so it keeps
 * taking any resolver.
 *
 * @public
 */
export type FontsInput =
  | FontConfiguration
  | FontConfigurationFragment
  | FontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/**
 * Merge font origins into one stable value for `DocxEditor.Root`'s `fonts` prop.
 *
 * ```tsx
 * // The bundled substitutes: the families this document names, plus its default face.
 * const fonts = useFonts(packagedFonts());
 *
 * // The same, plus the Google catalog for everything they do not cover.
 * const fonts = useFonts(packagedFonts(), googleFonts());
 *
 * // Brand faces first, then whatever is left.
 * const fonts = useFonts(brandFragment, packagedFonts());
 *
 * return <DocxEditor.Root fonts={fonts}>{children}</DocxEditor.Root>;
 * ```
 *
 * EVERY argument takes the same union, so adding an origin is adding an argument and
 * never a change of shape. Origins compose first-wins in argument order, exactly like
 * `composeFontConfiguration`: the first argument beats later ones, and any of them beats
 * a substitution for a family some origin supplies directly.
 *
 * They resolve ONE AFTER ANOTHER, not concurrently, so that each can be told which faces
 * the ones before it already cover and skip fetching them. That costs one extra origin's
 * latency on the critical path and saves a duplicate download — and, for a network origin,
 * a request that would have told a font host which families the document uses for nothing.
 * Order origins cheapest-first.
 *
 * The returned resolver never changes identity, so the editor is never rebuilt on account
 * of this prop. Arguments are re-read when opening a document or requesting a new family.
 * Changing them alone does not replace already loaded faces; reload the document for that.
 *
 * It is marked (`defineFontResolver`), so it can itself be an origin of another list or
 * `useDocxSource`'s `fonts` option without being mistaken for a zero-argument loader.
 *
 * @public
 */
export function useFonts(
  source: FontsInput,
  ...fragments: readonly (FontConfigurationFragment | undefined)[]
): MarkedFontResolver;
/**
 * The uniform form: every position takes the same {@link FontOrigin}, so composing two
 * resolvers is one extra argument.
 *
 * A resolver in any position but the first must carry the `defineFontResolver` mark. The
 * first position keeps the older, looser type so that every call that compiled before this
 * overload existed still compiles.
 *
 * @public
 */
export function useFonts(...origins: readonly FontOrigin[]): MarkedFontResolver;
export function useFonts(...origins: readonly (FontsInput | FontOrigin)[]): MarkedFontResolver {
  // Read at resolve time, not captured: the resolver below outlives every render.
  const latest = useRef<readonly (FontsInput | FontOrigin)[]>(origins);
  latest.current = origins;

  return useMemo<MarkedFontResolver>(
    () =>
      defineFontResolver((request: FontResolutionRequest) =>
        // `composeFontOrigins` calls EVERY function origin with the request and never
        // reads the mark, so an unmarked resolver in the first position behaves exactly as
        // it did before the mark existed.
        composeFontOrigins(latest.current as readonly FontOrigin[], request)
      ),
    []
  );
}
