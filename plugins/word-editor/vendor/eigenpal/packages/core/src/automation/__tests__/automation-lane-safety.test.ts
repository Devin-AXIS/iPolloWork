// The automation lane must run where there is no browser.
//
// That claim is what makes a headless host possible at all, and it is the kind of claim that
// decays silently: one convenience import of a binding helper, one `document.createElement`
// behind a type, and the lane still typechecks in a browser-shaped build while a server
// crashes on the first call.
//
// Three independent guards, because each catches what the others cannot:
//
// - DECLARED — the lane's own tsconfig omits the DOM lib, so a DOM reference fails to COMPILE
//   rather than failing a text scan. `bun run check:lane-boundaries` runs that compile.
// - REACHED — the import graph from the lane's entry, followed the way a bundler follows it,
//   through re-export barrels. A manifest cannot stop an import; this can.
// - RUN — this file deliberately does not register happy-dom, so the assertions below execute
//   in a process with no `document` and no `window`, and the headless host still opens, reads
//   and writes a document. That is the property, exercised rather than described.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = join(LANE, '..');
/** Contract files this lane may name: DOM-free, types only. Paths are relative to `src`. */
const NEUTRAL_CONTRACT_FILES = new Set(['contracts/editor-scope', 'contracts/document-compare']);

/** Every source file of the lane itself, tests excluded — the lane as it ships. */
function laneFiles(): string[] {
  return readdirSync(LANE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(LANE, name));
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) if (match[1]) found.push(match[1]);
  return found;
}

function resolveFile(candidate: string): string | null {
  for (const suffix of ['', '.ts', '/index.ts']) {
    const path = `${candidate}${suffix}`;
    if (existsSync(path) && path.endsWith('.ts')) return path;
  }
  return null;
}

/** Every file reachable from an entry by following relative imports, and every bare name. */
function reachFrom(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of specifiersOf(file)) {
      if (!specifier.startsWith('.')) {
        external.add(specifier);
        continue;
      }
      const resolved = resolveFile(resolve(dirname(file), specifier.replace(/\.ts$/, '')));
      if (resolved) queue.push(resolved);
    }
  }
  return { files, external };
}

/**
 * Source with comments removed.
 *
 * The scans below look for identifiers like `document.`, and this lane's comments are dense
 * prose about documents — scanning raw source would report a paragraph of explanation as a DOM
 * reference. Inline `//` is only treated as a comment when it is not part of a `://` scheme, so
 * a URL in a string survives intact.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/([^:])\/\/.*$/, '$1')))
    .join('\n');
}

describe('the lane imports nothing that assumes a browser', () => {
  const files = laneFiles();

  test('it reaches only provider-neutral store, collaboration, layout and export lanes', () => {
    // Every assertion below is over this list. Keep its setup guard on the actual graph test.
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.map((file) => file.split('/').pop())).toContain('server-host.ts');
    // The DAG entry says `mayImport: ['store']`. This is the same rule read off the source,
    // which is the half a declaration cannot enforce.
    const foreign: string[] = [];
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(file), specifier);
        if (target.startsWith(LANE)) continue;
        if (target.startsWith(join(CORE_SRC, 'store'))) continue;
        if (target.startsWith(join(CORE_SRC, 'collaboration'))) continue;
        if (target.startsWith(join(CORE_SRC, 'layout'))) continue;
        if (target.startsWith(join(CORE_SRC, 'export'))) continue;
        // Contracts only where a file is DOM-free and holds no behavior: the history group
        // handle types a headless runtime names. Most contract files name DOM types.
        if (NEUTRAL_CONTRACT_FILES.has(relative(CORE_SRC, target).replace(/\.ts$/, ''))) continue;
        foreign.push(`${file.split('/').pop()} -> ${specifier}`);
      }
    }
    expect(foreign).toEqual([]);
  });

  test('it imports no package at all — no framework, no Node builtin, no editor library', () => {
    const bare = new Set<string>();
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) bare.add(specifier);
      }
    }
    expect([...bare]).toEqual([]);
  });

  test('the whole graph from the lane entry is free of Node builtins and framework code', () => {
    // Through the barrel and into the store lane, the way a bundler resolves it: a transitive
    // `node:fs` would make every consumer's headless host a Node-only host.
    const reach = reachFrom(join(LANE, 'index.ts'));
    expect(reach.files.size).toBeGreaterThan(10);
    const builtins = [...reach.external].filter((name) => name.startsWith('node:'));
    expect(builtins).toEqual([]);
    const frameworks = [...reach.external].filter((name) =>
      ['react', 'react-dom', 'vue', 'yjs', `prose${'mirror-view'}`, `prose${'mirror-model'}`].some(
        (forbidden) => name === forbidden || name.startsWith(`${forbidden}/`)
      )
    );
    expect(frameworks).toEqual([]);
  });

  test('the graph reaches no browser lane, however indirectly', () => {
    const reach = reachFrom(join(LANE, 'index.ts'));
    const browserLanes = ['binding', 'output', 'editor'].map((lane) => join(CORE_SRC, lane));
    const leaked = [...reach.files].filter((file) => browserLanes.some((l) => file.startsWith(l)));
    expect(leaked).toEqual([]);
  });
});

describe('the lane touches no DOM and no unsafe sink', () => {
  const files = laneFiles();

  test('no DOM global appears in the lane, in code or behind a type', () => {
    const hits: string[] = [];
    const globals = [
      /\bdocument\s*\./,
      /\bwindow\s*\./,
      // `globalThis.crypto` is the ONE exception, and the test below pins it to that name:
      // handle scoping needs the platform CSPRNG, which is reachable in a browser, in Bun and
      // in Node under exactly this name and no other. Anything else read off `globalThis`
      // would be the DOM arriving by the back door.
      /\bglobalThis\s*\.(?!crypto\b)/,
      /\bHTML[A-Z]\w*Element\b/,
      /\bnavigator\b/,
      /\bDocumentFragment\b/,
      /\bNode\s*\)/,
    ];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'))
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""');
      for (const pattern of globals) {
        if (pattern.test(source)) hits.push(`${file.split('/').pop()} ${String(pattern)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('the one global the lane reads is the CSPRNG, and only for handle scoping', () => {
    const references = files.flatMap((file) => {
      const source = withoutComments(readFileSync(file, 'utf8'));
      return [...source.matchAll(/globalThis\s*\.\s*(\w+)/g)].map(
        (match) => `${file.split('/').pop()} globalThis.${match[1]}`
      );
    });
    expect(references).toEqual(['handles.ts globalThis.crypto']);
  });

  test('no HTML-from-strings sink, no fetch, no dynamic evaluation', () => {
    // The repository's audit list for anything that handles a file an attacker wrote. A host
    // that hands file-derived text to one of these turns a `.docx` into script.
    const hits: string[] = [];
    const sinks = [
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'document.write',
      'window.open',
      'XMLHttpRequest',
      'importScripts',
      'eval(',
      'new Function',
      'fetch(',
      'require(',
    ];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const sink of sinks)
        if (source.includes(sink)) hits.push(`${file.split('/').pop()} ${sink}`);
    }
    expect(hits).toEqual([]);
  });

  test('the DOM-free claim is COMPILED, not only scanned: the lane tsconfig omits DOM', () => {
    // The guard that a text scan cannot be: a DOM reference behind a type annotation still
    // fails to typecheck under this `lib`.
    const config = JSON.parse(readFileSync(join(LANE, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { lib?: string[] };
    };
    const lib = config.compilerOptions?.lib ?? [];
    expect(lib.length).toBeGreaterThan(0);
    expect(lib.map((entry) => entry.toLowerCase()).some((entry) => entry.includes('dom'))).toBe(
      false
    );
  });

  test('the repository script that runs that compile knows about this lane', () => {
    // A tsconfig nothing runs is decoration. The lane must be in the script's neutral list.
    const script = readFileSync(
      join(CORE_SRC, '..', '..', '..', 'scripts', 'check-lane-boundaries.mjs'),
      'utf8'
    );
    const neutral = /const NEUTRAL_LANES = \[([^\]]*)\]/.exec(script)?.[1] ?? '';
    expect(neutral).toContain("'automation'");
  });
});

describe('the headless host runs with no browser present', () => {
  // The runtime half of the claim, and it cannot be asserted in here: `bunfig.toml` preloads
  // happy-dom into every test module, so a test file always has a `document` whether the code
  // under test wants one or not. `headless-smoke.ts` is therefore a plain script, run in its
  // own process where the preload does not reach, and this spawns it.
  const smoke = join(LANE, '__tests__', 'headless-smoke.ts');

  test('a document opens, reads, writes and saves in a process with no DOM', () => {
    const run = Bun.spawnSync({ cmd: ['bun', smoke], cwd: CORE_SRC, stderr: 'pipe' });
    const stdout = run.stdout.toString();
    // The sentinel carries the DOM verdict, so a run that somehow acquired a browser cannot
    // pass as a run that proved the point.
    expect({ code: run.exitCode, stdout: stdout.trim(), stderr: run.stderr.toString() }).toEqual({
      code: 0,
      stdout: 'automation-headless-ok dom=false',
      stderr: '',
    });
  });
});
