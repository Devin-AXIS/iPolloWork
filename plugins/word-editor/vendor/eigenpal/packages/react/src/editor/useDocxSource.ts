// Opening a document, as a hook.
//
// Every host was writing the same thirty lines to get one document on screen: fetch the
// bytes, load and install the fonts, compose them into a `FontConfiguration`, keep the two
// from racing, cancel both if the component unmounts or the source changes, and turn a
// failure into something renderable. None of that is about the host's product, and getting
// the cancellation wrong is the kind of bug that only shows up as a React warning in
// somebody else's console.
//
// FONTS ARE PASSED IN, not imported. `@docx-editor.dev/fonts` ships font BYTES; making this
// package depend on it would put megabytes in the bundle of every consumer who brings their
// own faces or wants none. So the hook takes the origins — `{ fonts: packagedFonts() }` for
// Word's defaults — and owns only the wiring around them.
//
// TWO FONT PATHS, and which one a caller is on decides whether the document waits:
//
//   EAGER — a value, a promise, or a zero-argument loader. The answer is complete before
//   the file is parsed, so the bytes are held back until it lands and the document
//   paginates exactly once.
//
//   ON DEMAND — a resolver marked by `defineFontResolver` (`packagedFonts()`,
//   `googleFonts()`). Its answer depends on the families the file declares, which nothing
//   knows until the engine has parsed it. There is nothing to wait FOR, so the bytes go
//   straight through and the engine calls the resolver after the parse.
//
// The two are indistinguishable as types — `() => X` is assignable to `(request) => X` —
// which is why the mark exists and why `isFontResolver`, not arity, is what picks the path.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  composeFontConfiguration,
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
} from '@docx-editor.dev/core/editor';
import type {
  FontConfigurationFragment,
  FontOrigin,
  FontResolutionRequest,
  FontResolver,
  MarkedFontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';

/** A complete configuration, or a fragment this hook composes with the defaults. @public */
export type DocxFontsInput = FontConfiguration | FontConfigurationFragment;

/**
 * How a host supplies fonts: one origin, or a list of them in precedence order.
 *
 * `packagedFonts()` and `googleFonts()` are the useful ones — they resolve per document,
 * loading a family when the file names it or when it is that file's default face, rather
 * than loading every family they could serve. A list composes them first-wins:
 * `{ fonts: [packagedFonts(), googleFonts()] }` serves the bundled faces and reaches the
 * catalog only for what they do not cover.
 *
 * The zero-argument loader form (`{ fonts: defaultFonts }`) still works and still loads
 * everything up front. It is the one form that holds the document back until fonts settle.
 *
 * @public
 */
export type DocxFontsSource = DocxFontOrigin | readonly DocxFontOrigin[];

/**
 * One entry of a `fonts` list: any {@link FontOrigin}, or the older zero-argument loader.
 *
 * The resolver arm of `FontOrigin` is a MARKED resolver, so handing this a function that
 * takes a request but never went through `defineFontResolver` is a compile error rather
 * than a silent total loss of fonts — it matches neither arm, because a one-argument
 * function is not assignable to the zero-argument loader.
 *
 * @public
 */
export type DocxFontOrigin = FontOrigin | (() => DocxFontsInput | Promise<DocxFontsInput>);

/**
 * What the document itself can be: a URL to fetch, or bytes already in hand.
 *
 * A string here is ALWAYS a URL — this hook exists to fetch one. That is the opposite of
 * the `document` prop, whose `DocumentSource` reads the string `'blank'` as Word's blank
 * template; `useDocxSource('blank')` would request `./blank` and report the 404. There is
 * nothing to fetch for an empty document, so pass `'blank'` straight to `document`.
 *
 * @public
 */
export type DocxSource = string | URL | Uint8Array | ArrayBuffer;

/** Options for {@link useDocxSource}. @public */
export interface UseDocxSourceOptions {
  fonts?: DocxFontsSource;
  /** Passed to `fetch` for a URL source — credentials, headers, an AbortSignal's siblings. */
  fetchOptions?: RequestInit;
}

/** What {@link useDocxSource} reports. @public */
export interface UseDocxSourceResult {
  /** Bytes for `DocxEditor`'s `document` prop; undefined until they arrive. */
  readonly document: Uint8Array | undefined;
  /**
   * What to hand the `fonts` prop; undefined until there is something to hand it.
   *
   * A composed `FontConfiguration` on the eager path, and a stable `FontResolver` on the
   * on-demand one — the prop takes either, so the call site does not change. The resolver
   * keeps ONE identity for the hook's life, so the editor is never rebuilt on account of
   * it even when the origins are written inline.
   */
  readonly fonts: FontConfiguration | FontResolver | undefined;
  /** Why the DOCUMENT could not be opened. Font failures never land here — see below. */
  readonly error: Error | null;
  /** True until the document either arrives or fails. */
  readonly isLoading: boolean;
}

/** A URL source needs fetching; bytes are already what the editor wants. */
function bytesOf(source: DocxSource): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return null;
}

/** One origin or several — the rest of the hook only ever deals with a list. */
function fontOrigins(source: DocxFontsSource): readonly DocxFontOrigin[] {
  return Array.isArray(source) ? source : [source as DocxFontOrigin];
}

/**
 * A loader sitting in an ON-DEMAND list is still a loader: wrapped so it is called with no
 * argument, per font request, and so a throw lands in `composeFontOrigins`' per-origin catch
 * rather than escaping the surrounding `.map`.
 */
function asFontOrigin(origin: DocxFontOrigin): FontOrigin {
  if (typeof origin !== 'function' || isFontResolver(origin)) return origin as FontOrigin;
  const loader = origin as () => DocxFontsInput | Promise<DocxFontsInput>;
  return defineFontResolver(async () => loader());
}

/**
 * Whether ANY origin resolves per document. One is enough: the others may be complete
 * ahead of the parse, but the composition as a whole is not, so nothing can be waited for.
 */
function isOnDemand(source: DocxFontsSource | undefined): boolean {
  return source !== undefined && fontOrigins(source).some((origin) => isFontResolver(origin));
}

/** Eager path only: a zero-argument loader is called, everything else is taken as it is. */
async function resolveEagerOrigin(origin: DocxFontOrigin): Promise<DocxFontsInput | undefined> {
  if (typeof origin !== 'function') return await origin;
  // `isOnDemand` already answered false for this list, so no function here is a marked
  // resolver and the loader form is the only one left.
  return (await (origin as unknown as () => DocxFontsInput | Promise<DocxFontsInput>)()) as
    DocxFontsInput | undefined;
}

/**
 * Load a document (and optionally fonts) for `DocxEditor`.
 *
 * ```tsx
 * const { document, fonts, error } = useDocxSource(url, { fonts: packagedFonts() });
 * if (error) return <p>{error.message}</p>;
 * return <DocxEditor document={document} fonts={fonts} />;
 * ```
 *
 * FONTS NEVER FAIL THE DOCUMENT. A face that will not load degrades that family to
 * fixed-width measurement — the document still opens, it just paginates less like Word — so
 * a font failure leaves `error` null and is the loader's to report. A document failure is
 * different: there is nothing to show, so it lands on `error`.
 *
 * THE DOCUMENT WAITS FOR THE FONTS, on the eager path. They fetch concurrently, but
 * `document` stays undefined until fonts have settled — resolved OR failed — because layout
 * MEASURES with them. Handing the editor bytes first paginates the whole document on the
 * fixed fallback and then re-paginates when the real faces arrive, which the reader sees as
 * the text jumping. One slightly longer wait beats a visible reflow. Without a `fonts`
 * option there is nothing to wait for and the bytes go straight through.
 *
 * AN ON-DEMAND ORIGIN CANNOT BE WAITED FOR, and this hook does not pretend otherwise. A
 * resolver is answered with the families the file declares, which nothing knows until the
 * engine has parsed it, so holding the bytes back would wait on work that only the bytes
 * can start. `document` is released at once, `fonts` is a stable resolver, and the engine
 * re-paginates when the faces land. That one reflow is what buys loading the faces a
 * document uses rather than everything an origin would load up front; `{ fonts: defaultFonts }` is
 * still there when the no-reflow guarantee matters more than the megabytes.
 *
 * A URL is fetched with the browser's own `fetch`, exactly as the caller wrote it. Validate
 * it first if it came from user input: this hook adds no allowlist of its own, and inventing
 * one would only give callers a false sense of where the trust boundary is.
 *
 * @public
 */
export function useDocxSource(
  source: DocxSource | null | undefined,
  options: UseDocxSourceOptions = {}
): UseDocxSourceResult {
  const [bytes, setBytes] = useState<Uint8Array | undefined>(undefined);
  const [fonts, setFonts] = useState<FontConfiguration | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [documentLoading, setDocumentLoading] = useState(source != null);
  // Which path this hook is on, re-read every render rather than latched at mount. Latched,
  // `{ fonts: ready ? packagedFonts() : undefined }` — a host waiting on something before
  // it can build its origins — decided "eager" on the first render and never resolved
  // fonts at all. The Vue twin re-decides, and `check:parity` is signature-only and cannot
  // see the difference.
  const onDemand = isOnDemand(options.fonts);
  // What SHAPE the `fonts` option has this render: absent, answerable up front, or only
  // after the parse. The font effect keys on this rather than on `onDemand` alone, because
  // `{ fonts: ready ? defaultFonts : undefined }` — the same host shape, with an eager
  // loader instead of a resolver — leaves `onDemand` false on both renders and the effect
  // never re-ran, so the fonts never loaded.
  //
  // A SHAPE, deliberately, not `options.fonts` itself. Options are rebuilt every render by
  // any caller writing them inline, so keying on identity would re-run the eager load on
  // every render. Vue keys on the value because Vue's `setup` runs once and a plain options
  // object is not reactive; that difference is in the frameworks, not in this contract, and
  // `check:parity` compares signatures and cannot see either.
  const fontsShape = options.fonts === undefined ? 'absent' : onDemand ? 'on-demand' : 'eager';
  // Whether the font question is answered — resolved, failed, never asked, or not
  // answerable ahead of the parse. The document is held back until it is; see the note on
  // reflow above. The effect below is the ONE place that decides for a `fonts` option that
  // is present, on-demand included: a second decision here would be a second thing to keep
  // in step with `onDemand`, and it bought no render — the settle batches with the bytes.
  const [fontsSettled, setFontsSettled] = useState(options.fonts === undefined);

  // Options are rebuilt every render by any caller writing them inline, which is the normal
  // case. Read from a ref so a fresh object literal cannot restart a fetch.
  const latest = useRef(options);
  latest.current = options;

  // ONE resolver for the hook's life, delegating to whatever the latest render passed. Built
  // unconditionally because hooks are, and returned only on the on-demand path. Inline
  // `{ fonts: packagedFonts() }` is a fresh function every render; without this the `fonts`
  // prop would change identity every render and rebuild the editor forever.
  const resolver = useMemo<MarkedFontResolver>(
    () =>
      defineFontResolver((request: FontResolutionRequest) =>
        composeFontOrigins(fontOrigins(latest.current.fonts ?? []).map(asFontOrigin), request)
      ),
    []
  );

  // Fonts load ONCE per PATH, not per document: the faces are a property of the app, not of
  // the file open in it, and re-fetching them on every navigation would be pure waste. The
  // dependency is `fontsShape` rather than `[]` so a host that switches shapes — nothing
  // first, then a loader or a resolver once it is ready — actually gets the fonts it asked
  // for.
  //
  // Swapping one eager loader for ANOTHER eager loader does not re-run it here, and does
  // in Vue, whose watcher keys on the option value. Keying on the value is not open to
  // this hook: React rebuilds the options object every render, so `{ fonts: [a, b] }`
  // written inline would re-run the whole eager load on every render. Neither behaviour is
  // a contract — pass a new `fonts` value, or load a document, to change fonts deliberately.
  useEffect(() => {
    const fontsSource = latest.current.fonts;
    if (fontsSource === undefined) {
      // Cleared, not left standing. Removing the option and keeping the previous
      // composition would hand the editor fonts the host has stopped asking for, and the
      // Vue twin has always cleared it.
      setFonts(undefined);
      setFontsSettled(true);
      return undefined;
    }
    if (isOnDemand(fontsSource)) {
      // Nothing to await ahead of the parse; release the bytes.
      setFontsSettled(true);
      return undefined;
    }
    setFontsSettled(false);
    let live = true;
    void (async () => {
      try {
        // `allSettled`, not `all`: one origin that rejects must not take the answers
        // around it down with it. `all` rejected wholesale, so a single flaky loader in a
        // list left the document with no fonts at all rather than with the others'.
        const settled = await Promise.allSettled(fontOrigins(fontsSource).map(resolveEagerOrigin));
        const resolved: DocxFontsInput[] = [];
        for (const outcome of settled) {
          if (outcome.status === 'rejected') {
            console.warn(
              '[fonts] font loading failed for one origin; the others still compose',
              outcome.reason
            );
            continue;
          }
          // An origin that answered `undefined` contributed nothing; composing it would
          // only make the first-wins order harder to read.
          if (outcome.value !== undefined) resolved.push(outcome.value);
        }
        // A fragment composes with the defaults; a complete configuration passes through.
        if (live && resolved.length > 0) {
          setFonts(
            composeFontConfiguration(
              resolved[0] as FontConfigurationFragment,
              ...(resolved.slice(1) as readonly FontConfigurationFragment[])
            )
          );
        }
      } catch (cause) {
        // Never fatal — the engine measures on its fixed fallback, which is a
        // worse-looking document rather than a missing one — but never silent either. A
        // loader reports its own per-face failures; a THROW from here is something else,
        // and the one that used to reach this catch unannounced was an unmarked resolver
        // being called as a loader, which loses every font with no diagnostic at all.
        console.warn('[fonts] font loading failed; the fixed measurer stays in effect', cause);
      } finally {
        // `finally`, so a font failure releases the document instead of holding it forever.
        if (live) setFontsSettled(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [fontsShape]);

  useEffect(() => {
    if (source == null) {
      setBytes(undefined);
      setError(null);
      setDocumentLoading(false);
      return undefined;
    }
    const immediate = bytesOf(source);
    if (immediate) {
      setBytes(immediate);
      setError(null);
      setDocumentLoading(false);
      return undefined;
    }

    // `live` rather than only the AbortController: aborting stops the request, but a
    // response already in flight to `.arrayBuffer()` can still resolve after unmount, and
    // setting state then is the warning nobody can trace back here.
    let live = true;
    const controller = new AbortController();
    setDocumentLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(String(source), {
          ...latest.current.fetchOptions,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`could not open the document: ${response.status} ${response.statusText}`);
        }
        const loaded = new Uint8Array(await response.arrayBuffer());
        if (!live) return;
        setBytes(loaded);
        setDocumentLoading(false);
      } catch (cause) {
        // An abort is this hook cancelling itself, not a failure the caller should render.
        if (!live || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause : new Error('could not open the document'));
        setDocumentLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [source]);

  return {
    // Held back until fonts settle, so the first layout is the only layout. On the
    // on-demand path the font effect settles it immediately — there is nothing to hold
    // FOR — and that settle batches with the bytes, so it costs no render.
    document: fontsSettled ? bytes : undefined,
    fonts: onDemand ? resolver : fonts,
    error,
    isLoading: documentLoading || !fontsSettled,
  };
}
