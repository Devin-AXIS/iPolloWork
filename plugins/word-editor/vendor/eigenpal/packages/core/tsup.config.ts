import { copyFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * How the inlined HarfBuzz runtime locates its binary, verbatim from the minified glue.
 *
 * Two separate exactness claims, easy to conflate: the string must match the glue SOURCE
 * character for character (that is what the plugin's needle search is), while consumer
 * bundlers match the emitted `new URL(<literal>, import.meta.url)` pattern syntactically —
 * output whitespace does not matter to them, only that the rewrite keeps the expression a
 * recognisable URL construction rather than folding it into something else.
 *
 * Exported for `subpath-tables.test.ts`, which asserts the installed glue still contains it
 * exactly once — so a harfbuzzjs bump that reshapes the glue fails in the TEST suite, not
 * only later in the build.
 */
export const WASM_URL_EXPRESSION = 'new URL("harfbuzz.wasm",import.meta.url).href';

/**
 * Route the runtime's WASM URL through `setHarfBuzzWasmUrl` (#282's escape hatch).
 *
 * The glue reads `new URL("harfbuzz.wasm", import.meta.url)` once at instantiation.
 * Bundlers that emit that pattern as an asset (webpack, Turbopack, Vite) need nothing else;
 * bundlers that do not (esbuild, Bun) build clean and then 404 the fetch at runtime. The
 * consumer-facing fix for those is `setHarfBuzzWasmUrl` in `src/layout/harfbuzz-wasm-binary.ts`,
 * and this plugin is its other half: it wraps the glue's expression in a call through that
 * module, override first, original expression as the fallback argument — still syntactically
 * intact for the bundlers that rewrite it.
 *
 * TWO guards, because either one alone fails open. The count guard catches a glue that
 * changed shape. The applied guard catches a glue that MOVED: `onLoad` simply never fires,
 * nothing throws, and the build would otherwise ship an escape hatch wired to nothing.
 */
const harfBuzzWasmUrlEscapeHatch: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'harfbuzz-wasm-url-escape-hatch',
  setup(build) {
    let applied = 0;
    build.onLoad({ filter: /harfbuzzjs[/\\]dist[/\\]harfbuzz\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const occurrences = source.split(WASM_URL_EXPRESSION).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `expected exactly one \`${WASM_URL_EXPRESSION}\` in ${args.path}, found ${occurrences}. ` +
            'The harfbuzzjs glue changed shape; re-point this plugin before shipping, or ' +
            'setHarfBuzzWasmUrl silently stops working.'
        );
      }
      applied += 1;
      const resolver = JSON.stringify(resolve(here, 'src/layout/harfbuzz-wasm-binary.ts'));
      const contents =
        `import{resolveHarfBuzzWasmBinaryUrl as __docxResolveHarfBuzzWasmBinaryUrl}from${resolver};` +
        // A replacement FUNCTION, not a string: `$&`, `$'` and `$1` are substitution
        // patterns in a replacement string, so the day the needle grows a `$` a plain
        // string would silently rewrite into something else.
        source.replace(
          WASM_URL_EXPRESSION,
          () => `__docxResolveHarfBuzzWasmBinaryUrl(${WASM_URL_EXPRESSION})`
        );
      return { contents, loader: 'js' };
    });
    build.onEnd(() => {
      if (applied !== 1) {
        throw new Error(
          `harfbuzz-wasm-url-escape-hatch patched ${applied} files, expected exactly 1. ` +
            'The glue is no longer at harfbuzzjs/dist/harfbuzz.js, so setHarfBuzzWasmUrl ' +
            'would ship wired to nothing; re-point the onLoad filter.'
        );
      }
    });
  },
};

/**
 * Put HarfBuzz's `.wasm` beside the bundle that now contains its loader.
 *
 * The loader finds its binary with `new URL('harfbuzz.wasm', import.meta.url)`. Inlining the
 * loader into the ESM bundle moves that URL from harfbuzzjs's own directory to this
 * package's `dist/`, so the file has to be there — for Node, which reads it off disk, and
 * for every consumer bundler, which rewrites that expression into an emitted asset only if
 * the target exists at build time. Resolved through harfbuzzjs's export map rather than a
 * hand-written node_modules path, so a hoisted or linked install finds it the same way.
 */
async function copyHarfBuzzBinary(): Promise<void> {
  // Two assumptions worth naming when they break: `import.meta.resolve` survives only while
  // this config loads as ESM (a `.cts` rename or dropping `"type": "module"` kills it), and
  // the binary is assumed to sit beside harfbuzzjs's export-map entry.
  try {
    const entry = fileURLToPath(import.meta.resolve('harfbuzzjs'));
    await copyFile(resolve(dirname(entry), 'harfbuzz.wasm'), resolve(here, 'dist/harfbuzz.wasm'));
  } catch (error) {
    throw new Error(
      `copyHarfBuzzBinary: could not copy harfbuzz.wasm into dist/. Either import.meta.resolve ` +
        `is unavailable in this config's module format, or harfbuzzjs moved its binary. (${String(error)})`
    );
  }
}

/**
 * Everything the two format builds agree on.
 *
 * They are separate builds for ONE reason, spelled out at `esm` below: the ESM bundle
 * inlines harfbuzzjs and the CJS bundle cannot.
 */
const shared = {
  // One entry per published subpath. Keep this in step with `exports` in
  // package.json: a subpath with no entry here resolves to a missing file.
  entry: {
    index: 'src/index.ts',
    automation: 'src/automation/index.ts',
    binding: 'src/binding/index.ts',
    collaboration: 'src/collaboration/index.ts',
    'collaboration/replication': 'src/collaboration/replication.ts',
    'contracts/editor': 'src/contracts/editor.ts',
    'contracts/document': 'src/contracts/document.ts',
    'contracts/interaction': 'src/contracts/interaction.ts',
    'contracts/modules': 'src/contracts/modules.ts',
    'contracts/types': 'src/contracts/types-barrel.ts',
    layout: 'src/layout/index.ts',
    output: 'src/output/index.ts',
    store: 'src/store/index.ts',
    editor: 'src/editor/index.ts',
    export: 'src/export/index.ts',
  },
  // Same reason the adapter sets it: tsup defaults to `node`, which resolves
  // bundled deps through their `node` export condition, and fflate's node build
  // runs `createRequire` at module top level and throws in a browser.
  platform: 'browser',
  // Many entries share the engine's internals. Splitting emits them once into
  // shared chunks instead of copying them into all fourteen bundles.
  splitting: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  // `scripts/generate-third-party-notices.mjs` reads `dist/metafile-*.json` to learn
  // which third-party packages esbuild actually inlined into the shipped bundles, and
  // emits the attribution file for exactly those. This package is the one that inlines
  // the most of them: fast-xml-parser, fflate and the prosemirror-* family all end up as
  // source inside `dist/`.
  metafile: true,
  external: ['emf-converter', 'utif2'],
  // The engine's own files import it by package name ('@docx-editor.dev/core/store'
  // and friends), which resolved through the export map back when that map pointed
  // at src. Now that it points at dist, the build has to be told where source is,
  // or it chases a dist that does not exist yet.
  //
  // tsconfig.json carries the same table as `paths`, for the declaration pass and
  // for every consumer that compiles core's sources. It has no comment saying so
  // because core-lane-graph.test.ts reads that file with a plain JSON.parse.
  esbuildOptions(options) {
    options.alias = {
      '@docx-editor.dev/core': resolve(here, 'src/index.ts'),
      '@docx-editor.dev/core/automation': resolve(here, 'src/automation/index.ts'),
      '@docx-editor.dev/core/binding': resolve(here, 'src/binding/index.ts'),
      '@docx-editor.dev/core/collaboration/replication': resolve(
        here,
        'src/collaboration/replication.ts'
      ),
      '@docx-editor.dev/core/collaboration': resolve(here, 'src/collaboration/index.ts'),
      '@docx-editor.dev/core/contracts/editor': resolve(here, 'src/contracts/editor.ts'),
      '@docx-editor.dev/core/contracts/document': resolve(here, 'src/contracts/document.ts'),
      '@docx-editor.dev/core/contracts/interaction': resolve(here, 'src/contracts/interaction.ts'),
      '@docx-editor.dev/core/contracts/modules': resolve(here, 'src/contracts/modules.ts'),
      '@docx-editor.dev/core/contracts/types': resolve(here, 'src/contracts/types-barrel.ts'),
      '@docx-editor.dev/core/layout': resolve(here, 'src/layout/index.ts'),
      '@docx-editor.dev/core/output': resolve(here, 'src/output/index.ts'),
      '@docx-editor.dev/core/store': resolve(here, 'src/store/index.ts'),
      '@docx-editor.dev/core/editor': resolve(here, 'src/editor/index.ts'),
      '@docx-editor.dev/core/export': resolve(here, 'src/export/index.ts'),
    };
  },
} satisfies Options;

export default defineConfig([
  // tsup runs an array config CONCURRENTLY (Promise.all), so neither build may clean:
  // a `clean: true` here would race the other build's output. The package `build`
  // script empties `dist/` before tsup starts, which is the only ordering tsup
  // actually guarantees.
  {
    ...shared,
    format: ['esm'],
    // Declarations are not built by tsup. `scripts/build-core-declarations.mjs` emits
    // them after this build, in a quarter of the memory tsup's declaration bundler
    // needs. Every `types` condition in package.json points at that one graph,
    // whichever runtime the consumer selects.
    dts: false,
    clean: false,
    onSuccess: copyHarfBuzzBinary,
    // THE POINT OF THE SPLIT. Left external, harfbuzzjs reaches the consumer's bundler with
    // an `await import("module")` that no browser target can resolve, and every host has to
    // answer for it in its own config (#282). Inlined, the `module` alias above answers it
    // once, here. `external` alone would not do it: tsup externalizes every `dependencies`
    // entry by default, so it has to be named here to be pulled in.
    //
    // This also makes harfbuzzjs the one dependency esbuild inlines, so it is the one whose
    // licence `notices:generate` must reproduce — which it does, from the metafile, on its
    // own.
    noExternal: ['harfbuzzjs'],
    // Only meaningful here: the CJS build leaves harfbuzzjs external, so its glue never
    // passes through esbuild there.
    esbuildPlugins: [harfBuzzWasmUrlEscapeHatch],
    // Scoped to THIS build, not `shared`. Only the ESM bundle inlines the runtime that asks
    // for `module`, and aliasing a bare Node specifier package-wide would hand any future
    // bundled dependency a stub that silently lacks `builtinModules` instead of failing the
    // build. See `src/layout/node-module-shim.ts`.
    esbuildOptions(options) {
      shared.esbuildOptions(options);
      options.alias = {
        ...options.alias,
        module: resolve(here, 'src/layout/node-module-shim.ts'),
      };
    },
    // Which is exactly why `setHarfBuzzWasmUrl` has to know which build it is in: patched
    // here, inert in CJS, and it refuses rather than no-ops there.
    define: { __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__: 'true' },
  },
  {
    ...shared,
    format: ['cjs'],
    // Runtime-only, like the ESM build above. Keep this explicit so a future refactor
    // cannot restore a declaration bundler here.
    dts: false,
    clean: false,
    define: { __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__: 'false' },
    // harfbuzzjs stays EXTERNAL here, because it cannot be inlined: its entry is a
    // top-level `await` over the WASM instantiation, and CJS has no top-level await. That
    // costs nothing. This output exists for `require()`, which is Node, where `module`
    // resolves natively and #282 cannot happen. Browser bundlers take the `import`
    // condition and get the bundle above.
  },
]);
