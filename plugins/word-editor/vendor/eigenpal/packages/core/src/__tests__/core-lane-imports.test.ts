// The lane DAG, enforced against the real import statements.
//
// `CORE_LANES` declares which lane may import which (`core-lane-graph.ts`). After the lanes
// moved into `packages/core`, the declaration-level check in `core-lane-graph.test.ts`
// short-circuits for every moved lane, and `check:lane-boundaries` only catches an illegal
// edge incidentally, when the imported lane happens to need a DOM lib. So this walks every
// source file of every lane and asserts each import statement's target lane is one the DAG
// allows.
//
// VALUE imports must obey the DAG, no exceptions. TYPE-ONLY imports (`import type` /
// `export type ... from`) are erased at compile time and cannot move code between
// environments, but they are still coupling — so a cross-lane type edge is permitted when the
// importing lane declares the target in `mayImportTypes`, and otherwise only when pinned in
// GRANDFATHERED_TYPE_EDGES below. The pin RATCHETS: an entry that stops matching fails, so the
// list can only shrink or be consciously edited.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_LANES, type LaneName } from './core-lane-graph';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANES = Object.keys(CORE_LANES) as LaneName[];

/**
 * Type-only cross-lane edges the DAG does not allow, pinned file by file.
 *
 * Adding an entry needs the same justification a DAG edit does: say WHY the type cannot
 * live in a lane both sides may import (usually `contracts` or `store`). The known bulk is
 * the contracts lane describing editor-facing shapes that reference store and layout types
 * — coupling that predates the lane move and is compile-time only.
 */
const GRANDFATHERED_TYPE_EDGES: readonly { readonly file: string; readonly to: LaneName }[] = [
  // The neutral export composition root shares the existing public FontOrigin type. This is
  // erased and does not make the browser editor depend on the Node-oriented export lane.
  { file: 'export/index.ts', to: 'editor' },
  { file: 'store/store/tree-op-types.ts', to: 'contracts' },
  // The public diagnostic codes live in the neutral automation lane, so a headless runtime can
  // name a refusal; the contract re-exports them beside the editor's event types. Erased.
  { file: 'contracts/diagnostics.ts', to: 'automation' },
];

/**
 * VALUE edges the DAG does not allow, pinned until their code moves lane.
 *
 * These are live coupling, not just compile-time — each one is a debt with a tracked
 * issue, and the pin ratchets exactly like the type list. Empty today: the export
 * composition root's font edges were retired when `font-composition.ts`/`font-resolver.ts`
 * moved to the layout lane and the rendered-font derivations moved to `store/package/`,
 * lanes every headless exporter may import.
 */
const GRANDFATHERED_VALUE_EDGES: readonly { readonly file: string; readonly to: LaneName }[] = [];

interface ImportEdge {
  readonly file: string; // relative to src/, posix separators
  readonly to: LaneName;
  readonly typeOnly: boolean;
  readonly specifier: string;
}

function laneOfFile(relativePath: string): LaneName | null {
  const first = relativePath.split('/')[0]!;
  return (LANES as string[]).includes(first) ? (first as LaneName) : null;
}

/** The lane a specifier lands in, or null for anything external to the lanes. */
function laneOfSpecifier(specifier: string, fromFile: string): LaneName | null {
  if (specifier.startsWith('.')) {
    const absolute = resolve(join(SRC, dirname(fromFile)), specifier);
    return laneOfFile(relative(SRC, absolute).split(sep).join('/'));
  }
  const CORE = '@docx-editor.dev/core';
  if (specifier !== CORE && !specifier.startsWith(`${CORE}/`)) return null;
  const subpath = specifier === CORE ? '.' : `./${specifier.slice(CORE.length + 1)}`;
  for (const lane of LANES) {
    const declared = CORE_LANES[lane];
    if (declared.subpath === subpath) return lane;
    if (declared.subpathPrefix && subpath.startsWith(declared.subpathPrefix)) return lane;
  }
  return null;
}

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

// One statement at a time, so `import type` classifies the whole statement. A mixed
// `import { value, type T }` counts as a VALUE import, which is the conservative reading.
//
// The scan is two-stage: find each `import`/`export` keyword at a line start, then match
// the clause up to `from '...'` with `;`, quotes and backticks EXCLUDED — after stripping
// comments from that bounded window. Each piece is load-bearing:
//  - a char budget here once silently DROPPED any import whose specifier list outgrew it
//    (a 39-line layout import already had);
//  - a clause that could cross a `;` let a from-less `export type X = ...;` pair with the
//    NEXT statement's `from`, recording a VALUE import as type-only — hiding it under a
//    pinned type grandfather;
//  - an unstripped comment inside the clause (`// don't ...`) carries a quote or backtick
//    and killed the match, silently dropping the statement (two real cases existed in
//    layout/index.ts).
// The synthetic-source suite at the bottom pins all three failure modes.
const IMPORT_KEYWORD = /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?/g;
const CLAUSE_TO_FROM = /^[^;'"`]*?from\s*['"]([^'"]+)['"]/;
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
// Also matches type-position `import('x').T`, which is erased at compile time. That
// over-reports type coupling as a VALUE edge — fail-closed, so it stays.
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]/g;

/**
 * Strip comments from one statement window. Safe HERE and only here: between an import
 * keyword and its `from`, `//` and `/*` always begin comments (no strings or regexes can
 * appear). Never applied to whole files, where that assumption would corrupt strings.
 */
function stripClauseComments(window: string): string {
  return window.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/** Every static `... from '...'` statement in `source`: specifier + type-only flag. */
function staticImportsOf(
  source: string
): readonly { readonly specifier: string; readonly typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const keyword of source.matchAll(IMPORT_KEYWORD)) {
    const clauseStart = keyword.index! + keyword[0].length;
    const window = stripClauseComments(source.slice(clauseStart, clauseStart + 8000));
    const clause = CLAUSE_TO_FROM.exec(window);
    if (clause) found.push({ specifier: clause[1]!, typeOnly: keyword[2] !== undefined });
  }
  return found;
}

function edgesOf(file: string): ImportEdge[] {
  return edgesOfSource(relative(SRC, file).split(sep).join('/'), readFileSync(file, 'utf8'));
}

/** The cross-lane edges of one source text, as if it lived at `relativePath` under src/. */
function edgesOfSource(relativePath: string, source: string): ImportEdge[] {
  const ownLane = laneOfFile(relativePath);
  if (!ownLane) return [];
  const edges: ImportEdge[] = [];
  const record = (specifier: string, typeOnly: boolean) => {
    const target = laneOfSpecifier(specifier, relativePath);
    if (target && target !== ownLane) {
      edges.push({ file: relativePath, to: target, typeOnly, specifier });
    }
  };
  for (const found of staticImportsOf(source)) record(found.specifier, found.typeOnly);
  for (const match of source.matchAll(BARE_IMPORT)) record(match[1]!, false);
  for (const match of source.matchAll(DYNAMIC_IMPORT)) record(match[1]!, false);
  return edges;
}

/** Value edges the DAG forbids: judged against `mayImport` only, never `mayImportTypes`. */
function offDagValueEdges(edges: readonly ImportEdge[]): ImportEdge[] {
  return edges.filter(
    (edge) => !edge.typeOnly && !CORE_LANES[laneOfFile(edge.file)!].mayImport.includes(edge.to)
  );
}

/** Type edges the DAG forbids: neither `mayImport` nor `mayImportTypes` names the target. */
function offDagTypeEdges(edges: readonly ImportEdge[]): ImportEdge[] {
  return edges.filter((edge) => {
    if (!edge.typeOnly) return false;
    const lane = CORE_LANES[laneOfFile(edge.file)!];
    return !lane.mayImport.includes(edge.to) && !(lane.mayImportTypes ?? []).includes(edge.to);
  });
}

const allEdges: ImportEdge[] = [];
for (const lane of LANES) {
  for (const file of sourceFiles(join(SRC, lane))) allEdges.push(...edgesOf(file));
}

describe('every lane import obeys the DAG (core-lane-graph.ts)', () => {
  test('the walk is not vacuous: it sees the editor lane import the others', () => {
    const fromEditor = allEdges.filter((edge) => edge.file.startsWith('editor/'));
    expect(fromEditor.some((edge) => edge.to === 'layout')).toBe(true);
    expect(fromEditor.some((edge) => edge.to === 'store')).toBe(true);
  });

  test('no VALUE import crosses an edge the DAG forbids, beyond the pinned debt', () => {
    const offDag = offDagValueEdges(allEdges);
    const actual = [...new Set(offDag.map((edge) => `${edge.file} → ${edge.to}`))].sort();
    const pinned = GRANDFATHERED_VALUE_EDGES.map((edge) => `${edge.file} → ${edge.to}`).sort();
    expect(actual).toEqual(pinned);
  });

  test('every off-DAG TYPE edge is pinned, and every pin is still real', () => {
    const offDag = offDagTypeEdges(allEdges);
    const actual = [...new Set(offDag.map((edge) => `${edge.file} → ${edge.to}`))].sort();
    const pinned = GRANDFATHERED_TYPE_EDGES.map((edge) => `${edge.file} → ${edge.to}`).sort();
    // Exact equality, both directions: a NEW off-DAG type edge fails until pinned with a
    // justification, and a pin whose edge was cleaned up fails until removed — the ratchet.
    expect(actual).toEqual(pinned);
  });
});

describe('the scanner itself, against the statement shapes that broke it', () => {
  test('a clause comment carrying quotes, backticks and semicolons does not drop the import', () => {
    const source = [
      'export {',
      '  buildStyleCascadeTable,',
      "  // Referenced by `SemanticTableCell`: don't remove; it is load-bearing.",
      '  caretAt,',
      "} from './style-cascade.ts';",
    ].join('\n');
    expect(staticImportsOf(source)).toEqual([{ specifier: './style-cascade.ts', typeOnly: false }]);
  });

  test('a from-less export type cannot bridge to the next statement and launder it', () => {
    const source = [
      'export type CommandGate = (command: string) => boolean;',
      "import { tableContextAt } from '../layout/table-context.ts';",
    ].join('\n');
    expect(staticImportsOf(source)).toEqual([
      { specifier: '../layout/table-context.ts', typeOnly: false },
    ]);
  });

  test('a very long specifier list is still scanned — no length budget', () => {
    const names = Array.from({ length: 120 }, (_, index) => `  someLongExportedName${index},`);
    const source = `import {\n${names.join('\n')}\n} from '../layout/index.ts';`;
    expect(staticImportsOf(source)).toEqual([{ specifier: '../layout/index.ts', typeOnly: false }]);
  });

  test('mayImportTypes admits a contracts TYPE import from store, never a VALUE import', () => {
    const value = edgesOfSource(
      'contracts/example.ts',
      "import { applyOps } from '../store/store/tree-ops.ts';"
    );
    expect(offDagValueEdges(value).map((edge) => `${edge.file} → ${edge.to}`)).toEqual([
      'contracts/example.ts → store',
    ]);
    const typeOnly = edgesOfSource(
      'contracts/example.ts',
      "import type { ReviewItem } from '../store/store/review-items.ts';"
    );
    expect(offDagTypeEdges(typeOnly)).toEqual([]);
    expect(offDagValueEdges(typeOnly)).toEqual([]);
  });

  test('import type classifies the whole statement as type-only', () => {
    expect(staticImportsOf("import type { ReviewItem } from '../layout/review-support.ts';")) //
      .toEqual([{ specifier: '../layout/review-support.ts', typeOnly: true }]);
  });
});
