// The internal lane DAG holds, before and after the move (task 10.1).
//
// Written before section 10 moves anything, and checked against the packages that hold the
// code TODAY. That is what stops it being a document: if a lane's declared dependencies
// disagree with what the corresponding package actually depends on, this fails now — not
// after the move, when it would be indistinguishable from migration damage.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_FORBIDDEN_DEPENDENCIES,
  BROWSER_REACHABLE,
  CORE_LANES,
  laneHasMoved,
  laneSourceRoot,
  laneTopologicalOrder,
  reachableLanes,
  type LaneName,
} from './core-lane-graph';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const laneNames = Object.keys(CORE_LANES) as LaneName[];

const coreManifest = JSON.parse(readFileSync(join(PACKAGES, 'core', 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};

/** The package.json of the workspace package a lane occupies today. */
function manifestOf(lane: LaneName): Record<string, unknown> | null {
  const name = CORE_LANES[lane].package;
  if (!name) return null;
  const directory = name.replace('@docx-editor.dev/', '');
  const file = join(PACKAGES, directory === 'core' ? 'core' : directory, 'package.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

const workspaceDependencies = (manifest: Record<string, unknown>): string[] =>
  Object.keys((manifest.dependencies as Record<string, string>) ?? {}).filter((name) =>
    name.startsWith('@docx-editor.dev/')
  );

describe('the lane DAG is well formed (task 10.1)', () => {
  test('it is acyclic, so a topological order exists', () => {
    expect(() => laneTopologicalOrder()).not.toThrow();
    expect(laneTopologicalOrder()).toHaveLength(laneNames.length);
  });

  test('every declared dependency names a lane that exists', () => {
    for (const lane of laneNames) {
      for (const dependency of CORE_LANES[lane].mayImport) {
        expect({ lane, dependency, known: laneNames.includes(dependency) }).toEqual({
          lane,
          dependency,
          known: true,
        });
      }
    }
  });

  test('type-only edges name real lanes, never the lane itself, and never repeat a value edge', () => {
    for (const lane of laneNames) {
      for (const dependency of CORE_LANES[lane].mayImportTypes ?? []) {
        expect({ lane, dependency, known: laneNames.includes(dependency) }).toEqual({
          lane,
          dependency,
          known: true,
        });
        expect(dependency).not.toBe(lane);
        expect(CORE_LANES[lane].mayImport).not.toContain(dependency);
      }
    }
  });

  test('the cycle walk follows value edges only', () => {
    // `contracts` names store types and the store names contract types: a type-level loop that
    // the build erases. The order must still exist, and contracts must still come first.
    expect(CORE_LANES.contracts.mayImportTypes).toContain('store');
    const order = laneTopologicalOrder();
    expect(order.indexOf('contracts')).toBeLessThan(order.indexOf('layout'));
  });

  test('no lane depends on itself', () => {
    for (const lane of laneNames) {
      expect(CORE_LANES[lane].mayImport).not.toContain(lane);
    }
  });

  test('the base lanes depend on nothing, so there is something to build on', () => {
    expect(CORE_LANES.store.mayImport).toEqual([]);
    expect(CORE_LANES.contracts.mayImport).toEqual([]);
  });

  test('lane directories and subpaths are unique', () => {
    const directories = laneNames.map((lane) => CORE_LANES[lane].directory);
    expect(new Set(directories).size).toBe(directories.length);
    const subpaths = laneNames.map((lane) => CORE_LANES[lane].subpath).filter(Boolean);
    expect(new Set(subpaths).size).toBe(subpaths.length);
  });
});

describe('the DAG matches the packages that hold the code today (task 10.1)', () => {
  test('every lane resolves to source that exists, moved or not', () => {
    // Reads the DAG rather than a literal path, so this keeps holding as lanes move.
    for (const lane of laneNames) {
      const root = join(PACKAGES, laneSourceRoot(lane));
      expect({ lane, found: existsSync(root) }).toEqual({ lane, found: true });
    }
  });

  test('a lane still in its own package declares the dependencies the DAG gives it', () => {
    // Only meaningful BEFORE a lane moves: once it lives in `packages/core` its dependencies
    // merge into that manifest and the per-lane comparison stops being expressible.
    for (const lane of laneNames) {
      if (laneHasMoved(lane)) continue;
      expect(manifestOf(lane)).not.toBeNull();
    }
  });

  test("an UNMOVED lane's declared imports match its package's real dependencies", () => {
    // The migration is a REPACKAGING. A lane quietly gaining a dependency during the move
    // would be a design change smuggled in as a file move, and this is where that shows.
    for (const lane of laneNames) {
      if (laneHasMoved(lane)) continue;
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      const actual = workspaceDependencies(manifest)
        .map((name) => laneNames.find((candidate) => CORE_LANES[candidate].package === name))
        .filter((name): name is LaneName => name !== undefined)
        .sort();
      const declared = [...CORE_LANES[lane].mayImport].sort();
      expect({ lane, actual }).toEqual({ lane, actual: declared });
    }
  });
});

describe('a browser bundle cannot reach the server (task 10.1)', () => {
  test('nothing reachable from the editor lane is server-only', () => {
    // Without this, the browser editor importing the server lane would ship a transport
    // stack and a filesystem shim to every consumer that will never call them.
    for (const lane of reachableLanes('editor')) {
      expect({ lane, environment: CORE_LANES[lane].environment }).not.toEqual({
        lane,
        environment: 'node',
      });
    }
  });

  test('the browser-reachable set is exactly what the editor lane closes over', () => {
    const reachable = reachableLanes('editor');
    reachable.add('editor');
    expect([...reachable].sort()).toEqual([...BROWSER_REACHABLE].sort());
  });

  // The sync, server and clients lanes were deleted with the legacy PackageModel store
  // (phase-4 sweep), so "not browser-reachable" holds by non-existence.
  test('an UNMOVED browser-reachable package depends on no forbidden runtime', () => {
    // Only expressible for a lane that still owns a manifest. Once lanes share one, this
    // check cannot distinguish yjs arriving with the sync lane from yjs reaching the editor —
    // and the sync lane legitimately brings it. The real guarantee lives in the import-graph
    // walk (browser-bundle-graph.test.ts), which follows what a bundler follows.
    // A lane whose manifest is the SHARED core manifest cannot be checked this way either,
    // even if it has not moved: the contracts lane still owns `packages/core`, and every
    // moved lane's dependencies land in exactly that file.
    const shared = Object.keys(CORE_LANES).some((lane) => laneHasMoved(lane as LaneName));
    let checked = 0;
    for (const lane of BROWSER_REACHABLE) {
      if (laneHasMoved(lane)) continue;
      if (shared && CORE_LANES[lane].package === '@docx-editor.dev/core') continue;
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      checked += 1;
      const dependencies = Object.keys((manifest.dependencies as Record<string, string>) ?? {});
      for (const forbidden of BROWSER_FORBIDDEN_DEPENDENCIES) {
        expect({ lane, forbidden, present: dependencies.includes(forbidden) }).toEqual({
          lane,
          forbidden,
          present: false,
        });
      }
    }
    // Recorded, not asserted: as section 10 proceeds this reaches zero, and a check that
    // examines nothing must say so rather than read as a pass.
    if (checked === 0) {
      expect(
        BROWSER_REACHABLE.every(
          (lane) => laneHasMoved(lane) || CORE_LANES[lane].package === '@docx-editor.dev/core'
        )
      ).toBe(true);
    }
  });

  test('heavy lane runtimes are OPTIONAL peers, not dependencies', () => {
    // pdf-lib (output) and yjs (sync) are real runtimes of real lanes, but a consumer that
    // only parses and paints a document needs neither. As plain dependencies they were
    // installed by everyone; as optional peers they are installed only by consumers that use
    // those lanes. This is about INSTALL weight — it says nothing about what a bundle pulls
    // in, which is the import-graph walk's job, because a manifest cannot stop an import.
    const core = manifestOf('contracts') ?? {};
    const dependencies = Object.keys((core.dependencies as Record<string, string>) ?? {});
    const peers = (core.peerDependencies as Record<string, string>) ?? {};
    const meta = (core.peerDependenciesMeta as Record<string, { optional?: boolean }>) ?? {};

    for (const heavy of ['pdf-lib', 'yjs']) {
      expect({ heavy, inDependencies: dependencies.includes(heavy) }).toEqual({
        heavy,
        inDependencies: false,
      });
      expect({ heavy, declared: heavy in peers, optional: meta[heavy]?.optional === true }).toEqual(
        {
          heavy,
          declared: true,
          optional: true,
        }
      );
    }

    // What everyone genuinely needs stays a hard dependency.
    expect(dependencies).toContain('fflate');
    expect(dependencies).toContain('harfbuzzjs');
  });

  test('the guard is not vacuous: the editor lane really does close over its dependencies', () => {
    // If the graph were empty every reachability assertion above would pass trivially.
    expect(reachableLanes('editor').has('store')).toBe(true);
    expect(reachableLanes('editor').has('layout')).toBe(true);
    expect(reachableLanes('output').has('layout')).toBe(true);
  });
});

describe('every lane has somewhere to be imported from (task 10.1)', () => {
  test('every lane is importable at its own subpath', () => {
    // The store lane was the package root while it lived in `engine-core`. Now that it sits
    // inside the core package alongside `contracts`, the root belongs to the package itself
    // and every lane — store included — is reached by subpath.
    //
    // `contracts` is the exception, and declares itself one: it publishes a family under a
    // prefix, not a bare `./contracts`. It used to claim `subpath: './contracts'`, which no
    // `exports` entry ever answered — a lane graph that named an import path a consumer
    // could not use.
    for (const lane of laneNames) {
      const { subpath, subpathPrefix } = CORE_LANES[lane];
      expect({ lane, importableAs: subpath ?? subpathPrefix }).toEqual({
        lane,
        importableAs: subpathPrefix ? `./${lane}/` : `./${lane}`,
      });
    }
  });

  test('every declared subpath is actually in the package export map', () => {
    // The claim above is only worth anything if the name resolves. Without this, the graph can
    // say a lane is importable at `./x` while `exports` has no `./x` at all.
    const exports = Object.keys(coreManifest.exports);
    for (const lane of laneNames) {
      const { subpath, subpathPrefix } = CORE_LANES[lane];
      if (subpath) {
        expect({ lane, exported: exports.includes(subpath) }).toEqual({ lane, exported: true });
        continue;
      }
      const family = exports.filter((entry) => entry.startsWith(subpathPrefix!));
      expect({ lane, familySize: family.length > 0 }).toEqual({ lane, familySize: true });
    }
  });

  test('each lane declares the directory it will occupy under the core package', () => {
    for (const lane of laneNames) {
      expect(CORE_LANES[lane].directory).toBe(`src/${lane}`);
    }
  });
});

describe('the per-lane environment boundary is structurally enforced (task 10.1)', () => {
  // Restored. Section 10 collapsed eight packages into one, and the shared tsconfig must
  // include DOM for the browser lanes — which meant a `document` reference in the store or
  // layout lane compiled fine, where each neutral package's own config had made it an error.
  //
  // Each runtime-neutral lane now carries its own project with a DOM-free `lib`, compiled by
  // `bun run check:lane-boundaries`. These tests assert the projects EXIST and say what they
  // must; the script is what proves they compile.
  //
  // `contracts` is excluded on purpose: it is declaration-only and its public API names
  // HTMLElement for host-element accessors, which is a type reference, not a runtime need.
  const NEUTRAL_WITH_PROJECT = [
    'store',
    'layout',
    'export',
    'automation',
    'collaboration',
  ] as const;

  test('every runtime-neutral lane in core has its own DOM-free project', () => {
    for (const lane of NEUTRAL_WITH_PROJECT) {
      const path = join(PACKAGES, 'core', 'src', lane, 'tsconfig.json');
      expect({ lane, exists: existsSync(path) }).toEqual({ lane, exists: true });
      const lib: string[] = JSON.parse(readFileSync(path, 'utf8')).compilerOptions?.lib ?? [];
      expect({ lane, hasDom: lib.some((entry) => /dom/i.test(entry)) }).toEqual({
        lane,
        hasDom: false,
      });
    }
  });

  test('the shared config still carries DOM, which is why the per-lane projects are needed', () => {
    // If this ever goes false the per-lane projects are redundant; if it stays true and a
    // project goes missing, that lane silently regains the DOM.
    const lib: string[] =
      JSON.parse(readFileSync(join(PACKAGES, 'core', 'tsconfig.json'), 'utf8')).compilerOptions
        ?.lib ?? [];
    expect(lib.some((entry) => /dom/i.test(entry))).toBe(true);
  });

  test('no neutral lane is left without a project', () => {
    // The list above is hand-written; this is what catches a lane the DAG calls neutral that
    // nobody added a project for. `contracts` is the one documented exception.
    const neutral = (Object.keys(CORE_LANES) as LaneName[]).filter(
      (lane) =>
        CORE_LANES[lane].environment === 'neutral' && laneHasMoved(lane) && lane !== 'contracts'
    );
    expect([...neutral].sort()).toEqual([...NEUTRAL_WITH_PROJECT].sort());
  });

  test('the boundary check is wired into the repo scripts', () => {
    // A guard nothing runs is not a guard.
    const root = JSON.parse(readFileSync(join(PACKAGES, '..', 'package.json'), 'utf8'));
    expect(typeof root.scripts?.['check:lane-boundaries']).toBe('string');
  });

  test('every neutral lane with a project is compiled by the boundary script', () => {
    // The tsconfig existing proves nothing on its own — the script has to name the lane, or
    // the DOM-free `lib` is a file nobody compiles.
    const script = readFileSync(
      join(PACKAGES, '..', 'scripts', 'check-lane-boundaries.mjs'),
      'utf8'
    );
    const declared = /NEUTRAL_LANES\s*=\s*\[([^\]]*)\]/.exec(script)?.[1] ?? '';
    const named = [...declared.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect([...named].sort()).toEqual([...NEUTRAL_WITH_PROJECT].sort());
  });
});

describe('the automation lane is a neutral host port (Office-compatible automation)', () => {
  test('it is declared neutral, in its own directory, at its own subpath', () => {
    const lane = CORE_LANES.automation;
    expect({
      directory: lane.directory,
      environment: lane.environment,
      subpath: lane.subpath,
    }).toEqual({ directory: 'src/automation', environment: 'neutral', subpath: './automation' });
  });

  test('it may reach only neutral document capabilities', () => {
    // The whole point of the lane: one document-operation implementation that a server can
    // run. A dependency on binding, output or editor would put a DOM in the server host.
    // PAGE/NUMPAGES calculation uses the neutral document-layout coordinator. Contracts
    // supplies DOM-free public handle types; the lane-safety test narrows it to those files.
    expect([...CORE_LANES.automation.mayImport].sort()).toEqual([
      'collaboration',
      'contracts',
      'export',
      'layout',
      'store',
    ]);
    for (const forbidden of ['binding', 'output', 'editor'] as LaneName[]) {
      expect(CORE_LANES.automation.mayImport).not.toContain(forbidden);
    }
  });

  test('the browser editor lane is the one that reaches IN to it', () => {
    // Direction matters. The browser host adapter is built on top of the neutral protocol,
    // so the edge runs editor -> automation and never back.
    expect(CORE_LANES.editor.mayImport).toContain('automation');
    expect(reachableLanes('editor').has('automation')).toBe(true);
    expect(BROWSER_REACHABLE).toContain('automation');
  });

  test('it was declared straight into core, never a standalone package', () => {
    expect(CORE_LANES.automation.package).toBeNull();
    expect(CORE_LANES.automation.nativeToCore).toBe(true);
  });

  test('a consumer can import it, and it is not the store lane wearing a new name', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, 'core', 'package.json'), 'utf8'));
    const entry = manifest.exports?.['./automation'];
    // The package publishes a built dist, so the lane has its own entry point
    // rather than resolving into the store lane's files.
    expect(entry?.types).toBe('./dist/automation.d.ts');
    expect(entry?.import).toBe('./dist/automation.js');
    expect(entry?.require).toBe('./dist/automation.cjs');
  });
});
