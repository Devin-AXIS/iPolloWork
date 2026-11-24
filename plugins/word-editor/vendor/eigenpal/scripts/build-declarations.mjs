// Emits a package's published declaration files: TypeScript 7 writes one `.d.ts` per source
// file, and rollup-plugin-dts bundles them into one file per entry, with the declarations
// that entries share split into chunks.
//
// tsup's `dts` option cannot do the first step. It compiles through the TypeScript library
// API, which TypeScript 7 does not have, and it sets `baseUrl`, which TypeScript 7 removed.
// So each tsup config is wrapped in `withDeclarations`, which turns `dts` off and builds the
// declarations from `onSuccess`, honoring tsup's `--no-dts` and `--out-dir` flags.
//
// The output keeps tsup's layout: `.d.ts` beside the JavaScript, plus `.d.cts` for an ESM
// package or `.d.mts` for a CommonJS one, each with its own copy of the chunks.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';
import { declarationCompilerOptions } from './declaration-options.mjs';
import {
  absolutePaths,
  declarationCandidates,
  emitOptions,
  packageDocumentationOf,
  packageName,
  runTypeScript7,
} from './lib/declaration-files.mjs';

/** The declaration extensions tsup wrote for this package, `.d.ts` first. */
export function declarationExtensions(manifest) {
  return manifest.type === 'module' ? ['.d.ts', '.d.cts'] : ['.d.ts', '.d.mts'];
}

/** Normalize tsup's `entry` (array or object) to `{ name: source }`. */
export { packageDocumentationOf };

export function entryMap(entry) {
  if (!Array.isArray(entry)) return entry;
  return Object.fromEntries(
    entry.map((source) => [source.replace(/^src\//, '').replace(/\.[cm]?tsx?$/, ''), source])
  );
}

const JSON_MODULE = '.json.d.ts';
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The type TypeScript gives a JSON module: literals widen to their primitive, and an array
 * is an array of its element union.
 */
export function jsonType(value, indent = '', siblingKeys = []) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    // Like an array literal: object elements with different keys each get the keys they
    // lack as optional `undefined`, so a property read works on every element.
    const objects = value.filter(
      (item) => item && typeof item === 'object' && !Array.isArray(item)
    );
    const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))];
    const elements = [
      ...new Set(
        value.map((item) =>
          objects.includes(item) ? jsonType(item, indent, keys) : jsonType(item, indent)
        )
      ),
    ];
    if (elements.length === 0) return 'never[]';
    return elements.length === 1 ? `${elements[0]}[]` : `(${elements.join(' | ')})[]`;
  }
  if (typeof value === 'object') {
    const inner = `${indent}    `;
    const label = (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));
    // Inside an array, every element lists the keys of all elements in first-seen order.
    const keys = siblingKeys.length > 0 ? siblingKeys : Object.keys(value);
    const members = keys.map((key) =>
      Object.hasOwn(value, key)
        ? `${inner}${label(key)}: ${jsonType(value[key], inner)};`
        : `${inner}${label(key)}?: undefined;`
    );
    return members.length === 0 ? '{}' : `{\n${members.join('\n')}\n${indent}}`;
  }
  return typeof value;
}

/** The first `types` condition in an export target, at any depth, in condition order. */
export function typesCondition(target) {
  if (typeof target !== 'object' || target === null) return undefined;
  if (typeof target.types === 'string') return target.types;
  for (const value of Object.values(target)) {
    const found = typesCondition(value);
    if (found) return found;
  }
  return undefined;
}

/** The directory of an installed package, found the way Node looks: up through node_modules. */
function packageDirectory(name, fromDir) {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`${name} is not installed.`);
  }
}

/**
 * The built declaration file a package publishes for `specifier`: its `types` export
 * condition, or for the root, its `types` field.
 */
export function publishedDeclaration(specifier, fromDir) {
  const name = packageName(specifier);
  const directory = packageDirectory(name, fromDir);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
  // `exports` is either a map of subpaths or, for the root alone, a map of conditions.
  const map = manifest.exports && typeof manifest.exports === 'object' ? manifest.exports : {};
  const subpaths = Object.keys(map).some((key) => key.startsWith('.'));
  const target = subpaths ? map[subpath] : subpath === '.' ? map : undefined;
  const declared =
    typesCondition(target) ?? (subpath === '.' ? (manifest.types ?? manifest.typings) : undefined);
  if (typeof declared !== 'string')
    throw new Error(`${specifier} publishes no declaration file to inline.`);
  const file = resolve(directory, declared);
  if (!existsSync(file))
    throw new Error(`${specifier} declares ${declared}, which is not built. Build ${name} first.`);
  return file;
}

/**
 * Resolve imports inside the emitted declarations. Relative imports still name `.ts`
 * sources, so they map to the emitted files, and a JSON import becomes a declaration of
 * its type. A bare specifier stays external when it is a dependency or peer dependency;
 * any other package's types are inlined from its built declarations.
 */
function declarationResolver(packageDir, outDir, manifest, selfImports = []) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  // Emitted files sit under `outDir/emit`, mirroring the package, so a JSON import
  // resolves against the same relative path in the package itself.
  const emitRoot = join(outDir, 'emit');
  return {
    name: 'package-declaration-resolver',
    resolveId(source, importer) {
      if (source.startsWith('.') && source.endsWith('.json') && importer) {
        // Only this package's own emitted files can import its JSON; an inlined package's
        // declarations come from its build, which already resolved them.
        if (relative(emitRoot, importer).startsWith('..'))
          throw new Error(`${importer} imports ${source}, which cannot be inlined.`);
        const json = resolve(packageDir, relative(emitRoot, dirname(importer)), source);
        if (!existsSync(json)) throw new Error(`Cannot resolve ${source} from ${importer}.`);
        return `${json.slice(0, -'.json'.length)}${JSON_MODULE}`;
      }
      if (source.startsWith('.') && importer) {
        const target = resolve(dirname(importer), source);
        for (const candidate of declarationCandidates(target)) {
          if (existsSync(candidate)) return candidate;
        }
        throw new Error(`Cannot resolve ${source} from ${relative(outDir, importer)}.`);
      }
      if (!isAbsolute(source)) {
        const name = packageName(source);
        if (name === manifest.name) {
          // An entry that imports another entry's types by name, so both name one declaration.
          if (selfImports.includes(source)) return { id: source, external: true };
          throw new Error(`The declarations import their own package through ${source}.`);
        }
        if (declared.has(name) || isBuiltin(source)) return { id: source, external: true };
        // Consumers do not install anything else, so its types are inlined, as tsup did.
        try {
          return publishedDeclaration(source, packageDir);
        } catch (error) {
          throw new Error(
            `The declarations of ${manifest.name} import ${source}, which is not a dependency ` +
              `or peer dependency, and its types cannot be inlined: ${error.message} ` +
              'Declare it as a dependency or peer dependency.'
          );
        }
      }
      return null;
    },
    load(id) {
      if (!id.endsWith(JSON_MODULE)) return null;
      const json = `${id.slice(0, -JSON_MODULE.length)}.json`;
      const type = jsonType(JSON.parse(readFileSync(json, 'utf8')));
      // Bundled declarations keep this name (`en.json` → `enJson`, `pt-BR.json` → `ptBRJson`),
      // so the API reports read `typeof enJson`, as the sources do.
      const name = `${basename(json, '.json').replace(/[^A-Za-z0-9]+(.)?/g, (_, c = '') => c.toUpperCase())}Json`;
      return `declare const ${name}: ${type};\nexport default ${name};\n`;
    },
  };
}

/**
 * @param {string | URL} configUrl the calling tsup config's `import.meta.url`
 * @param {{
 *   entry: string[] | Record<string, string>,
 *   outDir?: string,
 *   banner?: string,
 *   compilerOptions?: Record<string, unknown>,
 *   ambient?: string[],
 *   selfImports?: string[],
 * }} options `ambient` lists declaration files no import reaches, such as a
 *   `declare module` for an untyped dependency. `selfImports` lists the package's own
 *   specifiers that the declarations may import and keep external, such as a helper entry
 *   that names the root entry's types.
 */
export async function buildDeclarations(configUrl, options) {
  const packageDir = dirname(fileURLToPath(configUrl));
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const entries = entryMap(options.entry);
  const extensions = declarationExtensions(manifest);
  const dist = resolve(packageDir, options.outDir ?? 'dist');
  const outDir = mkdtempSync(join(tmpdir(), 'docx-declarations-'));
  try {
    // Sibling packages resolve to their built declarations, as in every declaration build.
    const { paths, pathsBase, ...extra } = declarationCompilerOptions(
      configUrl,
      options.compilerOptions
    );
    const tsconfig = join(outDir, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({
        extends: join(packageDir, 'tsconfig.json'),
        // Rooted at the entries: tests and sources no entry reaches stay out. Ambient
        // declarations are not reached by any import, so the config names them.
        files: [...Object.values(entries), ...(options.ambient ?? [])].map((source) =>
          resolve(packageDir, source)
        ),
        include: [],
        compilerOptions: {
          ...extra,
          paths: absolutePaths(paths, pathsBase),
          ...emitOptions(packageDir, packageDir, join(outDir, 'emit')),
        },
      })
    );
    await runTypeScript7(packageDir, tsconfig);

    const emitted = (source) =>
      join(outDir, 'emit', relative(packageDir, resolve(packageDir, source))).replace(
        /\.([cm]?)tsx?$/,
        '.d.$1ts'
      );
    const packageDocs = new Map(
      Object.entries(entries).map(([name, source]) => [
        name,
        packageDocumentationOf(readFileSync(resolve(packageDir, source), 'utf8')),
      ])
    );
    const bundle = await rollup({
      input: Object.fromEntries(
        Object.entries(entries).map(([name, source]) => [name, emitted(source)])
      ),
      plugins: [declarationResolver(packageDir, outDir, manifest, options.selfImports), dts()],
    });
    try {
      // tsup's `clean` (or the package build script) already emptied `dist`.
      for (const extension of extensions) {
        await bundle.write({
          dir: dist,
          format: 'es',
          // API Extractor reads the first doc comment of an entry as the package's own.
          banner: (chunk) =>
            [options.banner, chunk.isEntry ? packageDocs.get(chunk.name) : null]
              .filter(Boolean)
              .join('\n'),
          entryFileNames: `[name]${extension}`,
          // A chunk takes its name from its first module, `types.d.ts`, so drop the `.d`.
          chunkFileNames: (chunk) => `${chunk.name.replace(/\.d$/, '')}-[hash]${extension}`,
        });
      }
    } finally {
      await bundle.close();
    }
    const missing = Object.keys(entries).filter(
      (name) => !extensions.every((extension) => existsSync(join(dist, `${name}${extension}`)))
    );
    if (missing.length > 0)
      throw new Error(`No declarations written for ${missing.join(', ')} in ${manifest.name}.`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Wrap a tsup config (or array of configs) so TypeScript 7 builds its declarations. Each
 * config may carry `declarations: { banner, compilerOptions, ambient, selfImports }`. tsup's `--no-dts`
 * skips them, and `--out-dir` moves them with the JavaScript.
 */
export function withDeclarations(configUrl, config) {
  return (cli = {}) => {
    const wrap = ({ declarations = {}, ...options }) => {
      if (cli.dts === false) return { ...options, dts: false };
      const outDir = cli.outDir ? resolve(process.cwd(), cli.outDir) : options.outDir;
      const previous = options.onSuccess;
      if (typeof previous === 'string')
        throw new Error('withDeclarations needs `onSuccess` as a function, not a command.');
      return {
        ...options,
        dts: false,
        onSuccess: async () => {
          await previous?.();
          // A list builds one declaration program per item, each over its own entries: one
          // bundle can hold entries that type-check under different compiler options, as
          // React and Vue JSX do.
          const programs = Array.isArray(declarations)
            ? declarations
            : [{ ...declarations, entry: options.entry }];
          for (const program of programs) {
            await buildDeclarations(configUrl, { ...program, outDir });
          }
        },
      };
    };
    return Array.isArray(config) ? config.map(wrap) : wrap(config);
  };
}
