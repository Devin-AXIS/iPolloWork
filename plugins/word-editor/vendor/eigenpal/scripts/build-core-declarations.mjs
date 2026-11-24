// Emits packages/core/dist/**/*.d.ts: one declaration file per published subpath, with the
// declarations those subpaths share split into chunks.
//
// Two steps, because the one-step bundler cost four times the memory. tsup's `dts: true`
// hands TypeScript sources to rollup-plugin-dts, which keeps the whole program alive while
// it emits and re-parses every module through rollup. For core that peaked at 4.7 GiB of
// heap, above Node's default limit, so every caller had to know to raise the heap, and the
// one that did not (the documentation sync) failed the 2.22.0 release. Here TypeScript 7
// emits the declarations once, in its own process, and rollup-plugin-dts then bundles
// `.d.ts` files only. scripts/build-declarations.mjs does the same for the tsup packages.
//
// The subpath list is not written down again here. It comes from the two tables
// subpath-tables.test.ts already holds in step with the tsup entries: `exports` in
// package.json says which declaration file each subpath ships, and `paths` in tsconfig.json
// says which source file that subpath compiles from.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';
import ts from 'typescript';
import {
  absolutePaths,
  declarationCandidates,
  emitOptions,
  packageDocumentationOf,
  packageName,
  runTypeScript7,
} from './lib/declaration-files.mjs';

export { declarationCandidates, packageName };

const core = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');
const src = join(core, 'src');
const dist = join(core, 'dist');
const PACKAGE = '@docx-editor.dev/core';

/** Every published subpath: its rollup entry name and its source file. */
export function publishedEntries(manifest, paths) {
  const entries = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    if (typeof types !== 'string') {
      // Only a top-level `types` condition is read. A nested one would ship no declarations.
      if (JSON.stringify(target).includes('"types"'))
        throw new Error(`${subpath} nests its types condition; put \`types\` at the top level.`);
      continue;
    }
    const specifier = subpath === '.' ? PACKAGE : `${PACKAGE}${subpath.slice(1)}`;
    const source = paths[specifier]?.[0];
    if (!source) {
      throw new Error(`${specifier} ships ${types} but tsconfig.json has no path for its source.`);
    }
    const name = types.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '');
    entries.push({ specifier, name, source: resolve(core, source) });
  }
  if (entries.length === 0) throw new Error('package.json exports name no declaration files.');
  return entries;
}

/** Emit declarations for everything the entries reach, into `outDir`. */
async function emitDeclarations(entries, outDir, paths, pathsBase) {
  const tsconfig = join(outDir, 'tsconfig.json');
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: join(core, 'tsconfig.json'),
      // Rooted at the entries, not at tsconfig's `include`: test files and anything no
      // subpath reaches stay out of the program.
      files: entries.map((entry) => entry.source),
      include: [],
      compilerOptions: {
        paths: absolutePaths(paths, pathsBase),
        ...emitOptions(core, src, outDir),
      },
    })
  );
  await runTypeScript7(core, tsconfig);
}

const formatHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => core,
  getNewLine: () => '\n',
};

/** Remove the declarations of an earlier run: chunk names carry hashes, so none is overwritten. */
function removeDeclarations(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) removeDeclarations(path);
    else if (entry.name.endsWith('.d.ts')) rmSync(path);
  }
}

/** The emitted declaration file for a source file. */
function declarationFor(outDir, sourceFile) {
  return join(outDir, relative(src, sourceFile)).replace(/\.([cm]?)tsx?$/, '.d.$1ts');
}

/**
 * Resolve the imports inside the emitted declarations.
 *
 * TypeScript keeps each specifier as written, so relative imports still end in `.ts`, and
 * the engine's imports of its own subpaths (`@docx-editor.dev/core/store`) still name the
 * package. Both resolve to the emitted files, so they bundle like any other module. Every
 * other bare specifier stays an import, and must be a dependency or peer dependency.
 */
function declarationResolver(entries, outDir) {
  const manifest = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const selfImports = new Map(
    entries.map((entry) => [entry.specifier, declarationFor(outDir, entry.source)])
  );
  return {
    name: 'core-declaration-resolver',
    resolveId(source, importer) {
      const self = selfImports.get(source);
      if (self) return self;
      if (source.startsWith('.') && importer) {
        const target = resolve(dirname(importer), source);
        for (const candidate of declarationCandidates(target)) {
          if (existsSync(candidate)) return candidate;
        }
        throw new Error(`Cannot resolve ${source} from ${relative(outDir, importer)}.`);
      }
      if (!isAbsolute(source)) {
        const name = packageName(source);
        // A core subpath that is not published would leave consumers an import they cannot
        // resolve, even though tsconfig paths let the build see it.
        if (name === PACKAGE)
          throw new Error(`The declarations import ${source}, which package.json does not export.`);
        if (!declared.has(name))
          throw new Error(
            `The declarations import ${source}, but ${name} is not a dependency or peer ` +
              'dependency of the package, so consumers would not have its types.'
          );
        return { id: source, external: true };
      }
      return null;
    },
  };
}

async function bundleDeclarations(entries, outDir) {
  const bundle = await rollup({
    input: Object.fromEntries(
      entries.map((entry) => [entry.name, declarationFor(outDir, entry.source)])
    ),
    plugins: [declarationResolver(entries, outDir), dts()],
  });
  try {
    removeDeclarations(dist);
    const packageDocs = new Map(
      entries.map((entry) => [
        entry.name,
        packageDocumentationOf(readFileSync(entry.source, 'utf8')),
      ])
    );
    await bundle.write({
      dir: dist,
      format: 'es',
      // API Extractor reads the first doc comment of an entry as the package's own.
      banner: (chunk) => (chunk.isEntry ? (packageDocs.get(chunk.name) ?? '') : ''),
      entryFileNames: '[name].d.ts',
      // A chunk takes its name from its first module, `types-barrel.d.ts`, so drop the `.d`.
      chunkFileNames: (chunk) => `${chunk.name.replace(/\.d$/, '')}-[hash].d.ts`,
    });
  } finally {
    await bundle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The effective paths, read the way TypeScript reads them: comments, `extends`, errors.
  const { config, error } = ts.readConfigFile(join(core, 'tsconfig.json'), ts.sys.readFile);
  if (error) throw new Error(ts.formatDiagnostic(error, formatHost));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, core);
  if (parsed.errors.length > 0)
    throw new Error(
      `tsconfig.json is invalid:\n${ts.formatDiagnostics(parsed.errors, formatHost)}`
    );
  const entries = publishedEntries(
    JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')),
    parsed.options.paths ?? {}
  );
  const outDir = mkdtempSync(join(tmpdir(), 'docx-core-declarations-'));
  try {
    await emitDeclarations(
      entries,
      outDir,
      parsed.options.paths ?? {},
      parsed.options.pathsBasePath ?? core
    );
    await bundleDeclarations(entries, outDir);
    const missing = entries.filter((entry) => !existsSync(join(dist, `${entry.name}.d.ts`)));
    if (missing.length > 0)
      throw new Error(`No declarations written for ${missing.map((e) => e.specifier).join(', ')}.`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
