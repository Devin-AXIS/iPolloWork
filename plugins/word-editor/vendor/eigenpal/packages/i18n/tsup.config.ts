import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';
import { readLocaleCodes } from './locale-files.mjs';

// Each shipped locale gets its own subpath entry
// (`@docx-editor.dev/i18n/<code>`) so consumer bundlers can code-split
// a single locale instead of pulling the whole locales map. `splitting: false`
// keeps each entry self-contained. The locale list comes from `locale-files.mjs`
// — same source `scripts/validate-i18n.mjs` reads, so the build and codegen
// can't drift on the BCP-47 filename rule.
const localeCodes = readLocaleCodes(import.meta.dirname);

export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: ['src/index.ts', ...localeCodes.map((code) => `src/${code}.ts`)],
    format: ['cjs', 'esm'],
    splitting: false,
    sourcemap: false,
    clean: true,
    minify: false,
    // Read by `scripts/generate-third-party-notices.mjs` — see the note in
    // `packages/react/tsup.config.ts`.
    metafile: true,
    // Keep non-ASCII characters raw instead of `\uHHHH`-escaping them. esbuild
    // defaults to `ascii` for max compatibility, but every script and tag in
    // these JSONs is BMP UTF-8 that consumers' bundlers handle natively.
    // Hebrew shrinks ~40% (54 KB → 32 KB), Chinese ~20% (34 KB → 27 KB),
    // and the index bundle drops in lockstep.
    esbuildOptions(options) {
      options.charset = 'utf8';
    },
  })
);
