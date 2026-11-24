// Where the HarfBuzz runtime finds its `.wasm`, and the one escape hatch for
// bundlers that lose it.
//
// The runtime ships inlined in this package's ESM build, and its loader locates the
// binary with `new URL('harfbuzz.wasm', import.meta.url)`. Webpack, Turbopack and
// Vite recognise that expression, emit `harfbuzz.wasm` as an asset and rewrite the
// URL — the reason a Next or Vite app needs no configuration. But the pattern is a
// convention, not a standard: esbuild and Bun leave the expression untouched and
// emit nothing, so the fetch 404s at runtime after a clean build.
//
// This module is the canonical explanation of that; everything else points here.

/** Set by the build. False in the CJS output, where the loader is never patched. */
declare const __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__: boolean | undefined;

/**
 * Whether the loader in THIS build was patched to read the override.
 *
 * Only the ESM build inlines harfbuzzjs and rewrites its glue, so only there does anything
 * read what the setter stores. Running from source — tests, and any consumer compiling
 * `src` — has no `define` and behaves like the ESM build, which is the one it mirrors.
 */
const wasmUrlSupported = (): boolean =>
  typeof __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__ === 'undefined' ||
  __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__;

let overrideUrl: string | null = null;
let readUrl: string | null = null;

/**
 * A URL safe to put in an error message or the console.
 *
 * Signed asset URLs carry their credential in the query string, and diagnostics end up in
 * logs and bug reports. The path is what a reader needs to recognise the file; the query
 * and fragment are dropped, with a marker so a redacted URL is not mistaken for the whole.
 */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    const carriesSecret =
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '';
    if (!carriesSecret) return url;
    // Rebuilt rather than `origin`, which is the string "null" for non-special schemes,
    // and which would silently keep `user:password@` in the userinfo case.
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}…`;
  } catch {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : `${url.slice(0, cut)}…`;
  }
}

/**
 * `redact` applied to every URL inside free text.
 *
 * The `cause` message appended to a diagnostic is written by whoever threw — a fetch error
 * or an Emscripten abort can embed the full URL it tried, signature and all, which would
 * put back exactly what redacting our own fields took out.
 */
function redactUrlsIn(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, (match) => redact(match));
}

/** Absolute where possible, so two spellings of one location compare equal. */
function normalize(url: string | URL): string {
  if (url instanceof URL) return url.href;
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/**
 * Point the text shaper at an externally hosted copy of `harfbuzz.wasm`.
 *
 * Needed only under bundlers that do not emit `new URL(..., import.meta.url)`
 * assets. esbuild and Bun are the common ones, and so is any build that inlines
 * dynamic imports, such as a library bundle. There, the build succeeds and the
 * shaper fails at runtime with an `EditorFontError` whose code is
 * `wasmUnavailable`; this function is the fix. Webpack, Turbopack and Vite emit
 * the binary on their own, and passing a URL there simply overrides theirs.
 *
 * ```ts
 * import { setHarfBuzzWasmUrl } from '@docx-editor.dev/core/layout';
 * setHarfBuzzWasmUrl('/static/harfbuzz.wasm');
 * ```
 *
 * Pass a URL your application controls. It is fetched and instantiated as
 * WebAssembly, so never derive it from user input, a query parameter, or remote
 * configuration. Serving it cross-origin needs that origin in your `connect-src`
 * CSP directive, and WebAssembly needs `wasm-unsafe-eval` in `script-src` either
 * way.
 *
 * Call it before the first editor is created. The runtime reads the location once
 * and caches the result, so a call afterwards warns and does nothing: fix the
 * call site and reload. The file to serve is exported as
 * `@docx-editor.dev/core/harfbuzz.wasm`, and it must be the copy from the
 * installed package version, because the runtime refuses a version mismatch at
 * load rather than shaping with unverified metrics.
 *
 * @public
 */
export function setHarfBuzzWasmUrl(url: string | URL): void {
  if (typeof url !== 'string' && !(url instanceof URL)) {
    throw new TypeError(`setHarfBuzzWasmUrl: expected a string or URL, received ${typeof url}`);
  }
  if (typeof url === 'string' && url.trim() === '') {
    throw new TypeError('setHarfBuzzWasmUrl: expected a non-empty URL');
  }
  if (!wasmUrlSupported()) {
    // Refused rather than ignored. The CommonJS build loads harfbuzzjs from node_modules
    // instead of inlining it, so nothing here would ever be read — and a setter that
    // silently does nothing is the exact failure this module exists to prevent.
    throw new Error(
      'setHarfBuzzWasmUrl is not supported by the CommonJS build, which loads the shaper ' +
        'from node_modules and finds its binary on disk. Import the ESM build instead.'
    );
  }
  const next = normalize(url);
  if (readUrl !== null && readUrl !== next) {
    // A warning, not a throw. The documented remedy for `wasmUnavailable` is to call this
    // function, and a consumer who does so from an error handler must not be met with a
    // second exception — the module cache pins the runtime either way, so the honest
    // answer is "noted, reload".
    console.warn(
      `setHarfBuzzWasmUrl: the shaper already read its binary location from ${redact(readUrl)}, ` +
        'so this call has no effect in the current session. Move the call before the first ' +
        'editor is created and reload the page.'
    );
    return;
  }
  if (overrideUrl !== null && overrideUrl !== next) {
    // Two modules configuring one host with DIFFERENT locations is a programming error worth
    // hearing about, but not worth crashing over: last write wins, said out loud, matching
    // how the after-read case is handled.
    console.warn(
      `setHarfBuzzWasmUrl: replacing ${redact(overrideUrl)} with ${redact(next)}. ` +
        'Two callers are configuring the shaper with different URLs; the later one wins.'
    );
  }
  overrideUrl = next;
}

/**
 * What the runtime's loader actually reads, wired in at build time.
 *
 * The build rewrites the loader's `new URL('harfbuzz.wasm', import.meta.url).href`
 * into a call through here, keeping the original expression as the argument so
 * asset-emitting bundlers still see the pattern they rewrite. Not public API: the
 * inlined runtime is its only intended caller.
 */
export function resolveHarfBuzzWasmBinaryUrl(bundlerResolvedUrl: string): string {
  readUrl = overrideUrl ?? bundlerResolvedUrl;
  return readUrl;
}

/**
 * Whether a load failure is the Node runtime itself, not the binary.
 *
 * The shim's throw is the marker: a Node that predates `process.getBuiltinModule` cannot
 * reach the builtin the inlined runtime needs. No URL fixes that, so it must not classify
 * as `wasmUnavailable` — a host branching on that code would suggest serving a WASM file
 * to someone whose problem is their Node version.
 */
export function isUnsupportedNodeRuntime(cause: unknown): boolean {
  return cause instanceof Error && /process\.getBuiltinModule/.test(cause.message);
}

/** The remedy text for {@link isUnsupportedNodeRuntime}: upgrade Node, nothing else. */
export function harfBuzzUnsupportedRuntimeDiagnostic(cause: unknown): string {
  const detail = redactUrlsIn(cause instanceof Error ? cause.message : String(cause));
  return (
    'the text shaper cannot start on this Node version: the ESM build reaches Node ' +
    'builtins through `process.getBuiltinModule`, added in Node 20.16.0 and 22.3.0. Upgrade ' +
    `Node; \`setHarfBuzzWasmUrl\` does not apply here. (${detail})`
  );
}

/**
 * The remedy text for a runtime that could not load its binary.
 *
 * Lives here, beside the API it names, so the advice and the setter cannot drift apart.
 */
export function harfBuzzWasmUnavailableDiagnostic(cause: unknown): string {
  const detail = redactUrlsIn(cause instanceof Error ? cause.message : String(cause));
  const location = readUrl === null ? 'its bundled location' : redact(readUrl);
  return (
    `the HarfBuzz WASM binary could not be loaded from ${location}. If this bundler does ` +
    'not emit `new URL(..., import.meta.url)` assets (esbuild, Bun, and library builds ' +
    'that inline dynamic imports), serve `@docx-editor.dev/core/harfbuzz.wasm` yourself, ' +
    "point `setHarfBuzzWasmUrl` from '@docx-editor.dev/core/layout' at it before creating " +
    `an editor, and reload the page. (${detail})`
  );
}

/**
 * Why the loaded runtime is the wrong version, and what to do about it.
 *
 * Worth its own text because the likely cause differs by how the binary got there. A
 * self-hosted copy (the esbuild/Bun path) goes stale the moment the package is upgraded and
 * nobody re-copies it — so that case names the file and the step, rather than leaving the
 * consumer with two version numbers and no instruction.
 */
export function harfBuzzVersionMismatchDiagnostic(expected: string, loaded: string): string {
  const mismatch = `expected HarfBuzz ${expected}, loaded ${loaded}`;
  if (overrideUrl === null) {
    return `${mismatch}. The bundled binary does not match this build of the engine.`;
  }
  return (
    `${mismatch}. The copy served at ${redact(overrideUrl)} is from a different version of ` +
    '`@docx-editor.dev/core`. Re-copy `@docx-editor.dev/core/harfbuzz.wasm` from the ' +
    'installed package into your served assets, and reload the page.'
  );
}

/** Test seam: forget both URLs so one test's override cannot leak into the next. */
export function resetHarfBuzzWasmUrlForTests(): void {
  overrideUrl = null;
  readUrl = null;
}
