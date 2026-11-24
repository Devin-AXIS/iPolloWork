// One list of published subpaths, written down in four places, with nothing checking they agree.
//
// A subpath has to appear in all four or it breaks differently in each direction:
//   - `package.json` exports        — what a consumer is allowed to import
//   - `tsup.config.ts` entry        — what gets BUILT into dist; missing means the export map
//                                     points at a file that was never emitted
//   - `tsup.config.ts` esbuild alias— how the engine's own `@docx-editor.dev/core/*` imports
//                                     resolve during that build, now that exports point at dist
//   - `tsconfig.json` paths         — the same, for the declaration pass and for every consumer
//                                     that compiles core's sources
//
// tsup.config.ts already carries the comment "keep this in step with `exports` in package.json: a
// subpath with no entry here resolves to a missing file". This is the part that makes it true.
//
// The failure is not hypothetical or slow to surface as a type error: an export map entry with no
// build entry produces a package that installs fine and throws MODULE_NOT_FOUND on import.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tsupConfig, { WASM_URL_EXPRESSION } from '../../tsup.config.ts';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifest = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
};
const tsconfig = JSON.parse(readFileSync(join(CORE, 'tsconfig.json'), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

type BuildConfig = {
  entry: Record<string, string>;
  esbuildOptions: (options: { alias?: Record<string, string> }) => void;
};

/**
 * The two format builds — ESM and CJS. They exist separately only because the ESM one
 * inlines harfbuzzjs and the CJS one cannot; every table below has to be identical across
 * them, which the last test in this file asserts outright.
 */
const configs = tsupConfig as unknown as readonly BuildConfig[];
const config = configs[0]!;

/** The alias table of one build, read by running the hook the way tsup does. */
function esbuildAliasOf(build: BuildConfig): Record<string, string> {
  const options: { alias?: Record<string, string> } = {};
  build.esbuildOptions(options);
  return options.alias ?? {};
}

/**
 * The SELF-reference aliases: the `@docx-editor.dev/core/*` rows the four tables are about.
 *
 * The table also carries `module`, which is not a subpath of this package at all — it is
 * what the inlined HarfBuzz runtime's `await import("module")` resolves to, so that no
 * consumer's browser bundler has to answer for it (#282). It has no export map entry, no
 * build entry and no tsconfig path, and it must not be compared against any of them.
 */
function esbuildAlias(): Record<string, string> {
  const alias = esbuildAliasOf(config);
  return Object.fromEntries(
    Object.entries(alias).filter(([specifier]) => specifier.startsWith('@docx-editor.dev/core'))
  );
}

/** `./contracts/editor` → `contracts/editor`; `.` → `index`. Package-relative, no extension. */
const asEntryKey = (subpath: string): string =>
  subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');

/** `.` → `@docx-editor.dev/core`, `./store` → `@docx-editor.dev/core/store`. */
const asSpecifier = (subpath: string): string =>
  subpath === '.' ? '@docx-editor.dev/core' : `@docx-editor.dev/core${subpath.slice(1)}`;

/**
 * The JS subpaths, which is what the four tables are about.
 *
 * `./styles/editor.css` and `./dist/harfbuzz.wasm` are copied assets with no build entry,
 * and `./package.json` is the conventional self-reference; none is a module and none
 * belongs in the other three tables.
 */
const jsSubpaths = Object.keys(manifest.exports).filter(
  (subpath) =>
    subpath !== './package.json' && !subpath.endsWith('.css') && !subpath.endsWith('.wasm')
);

describe('the published subpath tables agree', () => {
  test('the guard is not vacuous: there are subpaths to check', () => {
    expect(jsSubpaths.length).toBeGreaterThan(5);
    expect(jsSubpaths).toContain('.');
  });

  test('every exported subpath has a build entry', () => {
    const entries = Object.keys(config.entry);
    const missing = jsSubpaths.filter((subpath) => !entries.includes(asEntryKey(subpath)));
    expect({ missingBuildEntry: missing }).toEqual({ missingBuildEntry: [] });
  });

  test('every build entry is an exported subpath', () => {
    // The other direction: an entry nobody can import is dead weight in every bundle that
    // shares its chunks, and reads as a public surface when it is not one.
    const exported = new Set(jsSubpaths.map(asEntryKey));
    const orphans = Object.keys(config.entry).filter((entry) => !exported.has(entry));
    expect({ unexportedBuildEntry: orphans }).toEqual({ unexportedBuildEntry: [] });
  });

  test('the build alias table and the tsconfig paths name the same specifiers', () => {
    const alias = Object.keys(esbuildAlias()).sort();
    const paths = Object.keys(tsconfig.compilerOptions.paths).sort();
    expect(alias).toEqual(paths);
  });

  test('every exported subpath resolves to source in both self-reference tables', () => {
    // These are what let the engine import ITSELF by package name while `exports` points at a
    // dist that does not exist during the build.
    const alias = esbuildAlias();
    const paths = tsconfig.compilerOptions.paths;
    const missing = jsSubpaths.filter((subpath) => {
      const specifier = asSpecifier(subpath);
      return alias[specifier] === undefined || paths[specifier] === undefined;
    });
    expect({ missingSelfReference: missing }).toEqual({ missingSelfReference: [] });
  });

  test('both self-reference tables point at the same file, and at the build entry', () => {
    const alias = esbuildAlias();
    const paths = tsconfig.compilerOptions.paths;
    const disagreements: string[] = [];
    for (const subpath of jsSubpaths) {
      const specifier = asSpecifier(subpath);
      const aliased = relative(CORE, alias[specifier]!);
      const typed = paths[specifier]![0]!.replace(/^\.\//, '');
      const built = config.entry[asEntryKey(subpath)];
      if (aliased !== typed || aliased !== built) {
        disagreements.push(`${subpath}: alias=${aliased} tsconfig=${typed} entry=${built}`);
      }
    }
    expect({ disagreements }).toEqual({ disagreements: [] });
  });

  test('the format builds publish the same subpaths from the same sources', () => {
    // The ESM and CJS builds differ only in how they reach harfbuzzjs, and the split makes
    // it possible to change one and forget the other. A subpath added to only one of them
    // ships an export map entry that resolves under `import` and 404s under `require`, or
    // the reverse. The SELF-REFERENCE aliases must agree for the same reason; the `module`
    // alias is compared separately below, since it is deliberately ESM-only.
    const selfReferenceAliases = (build: BuildConfig): Record<string, string> =>
      Object.fromEntries(
        Object.entries(esbuildAliasOf(build)).filter(([specifier]) =>
          specifier.startsWith('@docx-editor.dev/core')
        )
      );

    expect(configs).toHaveLength(2);
    for (const build of configs.slice(1)) {
      expect(build.entry).toEqual(config.entry);
      expect(selfReferenceAliases(build)).toEqual(selfReferenceAliases(config));
    }
  });

  test('one declaration graph, selected by every export, built outside tsup', () => {
    // `types` is the outer condition for every JS subpath, so import and require
    // consumers both select the same `.d.ts` declaration graph. The package build emits
    // it with `scripts/build-core-declarations.mjs`. tsup's own declaration bundler needed
    // more than Node's default heap for this package, so neither tsup build may turn it
    // back on.
    const typeTargets = jsSubpaths.map((subpath) => {
      const value = manifest.exports[subpath] as { types?: unknown };
      return value.types;
    });
    expect(
      typeTargets.every((target) => typeof target === 'string' && target.endsWith('.d.ts'))
    ).toBe(true);

    const [esm, cjs] = configs as readonly (BuildConfig & { dts?: boolean })[];
    expect({ esm: esm!.dts, cjs: cjs!.dts }).toEqual({ esm: false, cjs: false });
    expect(manifest.scripts.build).toContain('node ../../scripts/build-core-declarations.mjs');
  });

  test('only the build that inlines the runtime aliases Node’s `module`', () => {
    // `module` is a bare Node specifier, not a subpath of this package. Aliasing it is how
    // the inlined HarfBuzz runtime stops reaching for a builtin no browser bundler can
    // resolve (#282) — but scoped to the ESM build alone, because a package-wide override
    // would hand any FUTURE bundled dependency a stub silently missing `builtinModules`
    // instead of failing the build.
    const [esm, cjs] = configs;
    expect({
      esm: 'module' in esbuildAliasOf(esm!),
      cjs: 'module' in esbuildAliasOf(cjs!),
    }).toEqual({ esm: true, cjs: false });
  });

  test('the split carries its reason: exactly the ESM build inlines and patches harfbuzzjs', () => {
    // Everything that makes the two-build split WORTH having lives on the ESM side: the
    // inline (no `module` specifier reaches a consumer bundler, #282), the escape-hatch
    // plugin (setHarfBuzzWasmUrl is wired into the glue), and the wasm copy. Dropping any
    // of them still builds and still passes every other test — the regression only shows
    // in a consumer's app. And neither build may clean: tsup runs an array config
    // concurrently, so cleaning belongs to the package `build` script alone.
    const [esm, cjs] = configs as readonly (BuildConfig & {
      format?: readonly string[];
      clean?: boolean;
      noExternal?: readonly string[];
      esbuildPlugins?: readonly unknown[];
      onSuccess?: unknown;
    })[];
    expect({
      esm: {
        format: esm!.format,
        clean: esm!.clean,
        noExternal: esm!.noExternal,
        patchesGlue: (esm!.esbuildPlugins?.length ?? 0) > 0,
        copiesWasm: typeof esm!.onSuccess === 'function',
      },
      cjs: {
        format: cjs!.format,
        clean: cjs!.clean,
        noExternal: cjs!.noExternal,
        patchesGlue: (cjs!.esbuildPlugins?.length ?? 0) > 0,
        copiesWasm: typeof cjs!.onSuccess === 'function',
      },
    }).toEqual({
      esm: {
        format: ['esm'],
        clean: false,
        noExternal: ['harfbuzzjs'],
        patchesGlue: true,
        copiesWasm: true,
      },
      cjs: {
        format: ['cjs'],
        clean: false,
        noExternal: undefined,
        patchesGlue: false,
        copiesWasm: false,
      },
    });
  });

  test('the installed harfbuzzjs glue still contains the exact expression the plugin patches', () => {
    // The escape-hatch plugin rewrites ONE exact string in harfbuzzjs's minified glue. The
    // build refuses when the count is not exactly one, but that guard fires at build time;
    // this puts the same tripwire in the test suite, so a harfbuzzjs bump that reshapes
    // the glue fails here first — with the same remedy: re-point the plugin.
    //
    // Resolved through the export map like `copyHarfBuzzBinary` does, not a hand-written
    // node_modules path, so a hoisted or re-laid-out install cannot fail this test while
    // the build still passes.
    const entry = fileURLToPath(import.meta.resolve('harfbuzzjs'));
    const glue = readFileSync(join(dirname(entry), 'harfbuzz.js'), 'utf8');
    expect(glue.split(WASM_URL_EXPRESSION).length - 1).toBe(1);
  });
});
