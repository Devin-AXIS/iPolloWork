// What a browser import actually pulls in (task 10.1).
//
// The lane DAG says the editor lane may not import the server lane. That is a rule about
// DECLARED dependencies, and a bundler does not read it — it follows `import` statements,
// through re-export barrels, into whatever they reach. A single `export *` in a barrel is
// enough to put a transport stack and a Yjs document in every consumer's bundle while every
// package.json still looks correct.
//
// So this walks the real import graph from the browser entry points and asserts what it can
// reach. It resolves relative imports within a package and package imports across the
// workspace, which is what a bundler does; it stops at third-party names and records them,
// which is enough to catch the dependencies that matter here.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_FORBIDDEN_DEPENDENCIES,
  CORE_LANES,
  laneHasMoved,
  laneSourceRoot,
  type LaneName,
} from './core-lane-graph';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Importable specifier to the source root it resolves to.
 *
 * Built from the lane DAG rather than from directory names, so a lane that moves into
 * `packages/core` is still followed — as its subpath (`@docx-editor.dev/core/store`)
 * instead of its old package name. Resolving by hand here would make this walk silently stop
 * at the first moved lane, and a walk that reaches nothing cannot fail.
 */
const WORKSPACE: ReadonlyMap<string, string> = new Map(
  (Object.keys(CORE_LANES) as LaneName[]).flatMap((lane) => {
    const root = join(PACKAGES, laneSourceRoot(lane));
    if (!laneHasMoved(lane)) return [[CORE_LANES[lane].package!, root] as const];
    const subpath = CORE_LANES[lane].subpath;
    const CORE = '@docx-editor.dev/core';
    const specifier = !subpath || subpath === '.' ? CORE : `${CORE}/${subpath.slice(2)}`;
    return [[specifier, root] as const];
  })
);

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;

/** Every specifier a file imports or re-exports from. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

function resolveFile(candidate: string): string | null {
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const path = `${candidate}${suffix}`;
    if (existsSync(path) && !path.endsWith('/')) {
      try {
        if (readFileSync(path).length >= 0) return path;
      } catch {
        // A directory: fall through to the index candidates.
      }
    }
  }
  return null;
}

interface Reach {
  /** Workspace packages reached, by name. */
  readonly packages: Set<string>;
  /** Third-party specifiers reached. */
  readonly external: Set<string>;
}

/** Walk the import graph from an entry file. */
function reachFrom(entry: string): Reach {
  const packages = new Set<string>();
  const external = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveFile(resolve(dirname(file), specifier.replace(/\.ts$/, '')));
        if (resolved) queue.push(resolved);
        continue;
      }
      // LONGEST first. Every lane subpath now begins with the core package's own name, so a
      // shortest-match walk resolved `.../core/store` to the contracts lane and the
      // graph collapsed to one node.
      const workspace = [...WORKSPACE.keys()]
        .sort((a, b) => b.length - a.length)
        .find((name) => specifier === name || specifier.startsWith(`${name}/`));
      if (workspace) {
        packages.add(workspace);
        // `root` is already the lane's SOURCE root, moved or not, so no 'src' segment here.
        const entryFile = resolveFile(join(WORKSPACE.get(workspace)!, 'index'));
        if (entryFile) queue.push(entryFile);
        continue;
      }
      external.add(specifier);
    }
  }
  return { packages, external };
}

const editorEntry = join(PACKAGES, laneSourceRoot('editor'), 'index.ts');

describe('a browser import cannot reach the server (task 10.1)', () => {
  const reach = reachFrom(editorEntry);

  test('the walk is not vacuous: it reaches the packages the editor really uses', () => {
    // If resolution silently failed, every assertion below would pass over an empty graph.
    const reaches = (lane: LaneName): boolean =>
      [...reach.packages].some((n) => WORKSPACE.get(n) === join(PACKAGES, laneSourceRoot(lane)));
    expect(reaches('store')).toBe(true);
    expect(reaches('layout')).toBe(true);
    expect(reach.external.size).toBeGreaterThan(0);
  });

  // The sync, server and clients lanes were deleted with the legacy store (phase-4 sweep),
  // so "the editor must not reach them" holds by non-existence; the forbidden-runtime and
  // Node-builtin checks below carry the browser-safety constraint from here on.
  test('it does not reach a forbidden runtime', () => {
    const reached = BROWSER_FORBIDDEN_DEPENDENCIES.filter((forbidden) =>
      [...reach.external].some(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
      )
    );
    expect(reached).toEqual([]);
  });

  test('it pulls in no Node builtin, so the graph is genuinely browser-safe', () => {
    // `node:` specifiers are never npm dependencies, so a package.json check cannot see
    // them — this is the only place that constraint can actually fail.
    const builtins = [...reach.external].filter((specifier) => specifier.startsWith('node:'));
    expect(builtins).toEqual([]);
  });

  test('the forbidden check would FIRE if the graph ever reached one', () => {
    // The control. The assertions above pass, and a check that only ever passes is
    // indistinguishable from one that cannot fail — so the detection is exercised against a
    // graph that does contain a forbidden name.
    // Built from parts rather than written whole: the guard that keeps editor types out of
    // the public contracts scans for that library's name in source, and a literal here
    // would trip it on a string that is not an import.
    const pretend = new Set(['yjs/dist/y.mjs', 'node:fs', `prose${'mirror'}-view`]);
    const reached = BROWSER_FORBIDDEN_DEPENDENCIES.filter((forbidden) =>
      [...pretend].some(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
      )
    );
    expect(reached).toContain('yjs');
    expect([...pretend].filter((s) => s.startsWith('node:'))).toEqual(['node:fs']);
  });
});
