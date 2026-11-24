import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: {
      index: 'src/index.ts',
    },
    // The adapter runs in the browser. tsup's default platform is `node`, which
    // resolves bundled deps through their `node` export condition — fflate then
    // brings its worker_threads loader, whose `createRequire("/")` runs at module
    // top level and throws in a browser (`createRequire is not a function`), so
    // the demo died before first paint. `browser` picks fflate's browser build,
    // exactly what the Vite-built vue adapter already ships; the CJS output stays
    // SSR-safe because fflate touches Worker/Blob only inside its async APIs,
    // which the editor never calls.
    //
    // fflate reaches this bundle transitively, through the contract package below.
    // It is listed in this package's devDependencies only because the tests build
    // DOCX fixtures with it; tsup externalizes `dependencies`/`peerDependencies`
    // and bundles everything else, so moving that entry into `dependencies` would
    // silently externalize fflate and change the published output. Leave it where
    // it is.
    platform: 'browser',
    format: ['cjs', 'esm'],
    splitting: false,
    sourcemap: false,
    clean: true,
    treeshake: true,
    minify: true,
    // `scripts/generate-third-party-notices.mjs` reads `dist/metafile-*.json` to
    // learn which third-party packages esbuild actually inlined into the shipped
    // bundles, and emits the attribution file for exactly those. Deriving it from
    // the real build output rather than from `dependencies` is what keeps the
    // notice honest when `external` below changes.
    metafile: true,
    // The engine stays external. It is a published package, and `@docx-editor.dev/pro`
    // imports it directly, so inlining a copy here would give a page running both
    // packages two engines: pro's modules would register against one instance while
    // the adapter painted from another.
    external: ['react', 'react-dom'],
  })
);
