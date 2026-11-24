// ProseMirror isolation guards (tasks 6.5 and 6.6).
//
// `import-graph.test.ts` already forbids a `prosemirror-*` IMPORT in the PM-free packages.
// That is necessary and not sufficient for what these two tasks ask:
//
//   6.5 — no ProseMirror types or view access in store, layout, output, or the PUBLIC HOST
//         CONTRACTS. The contract package is not in `PACKAGE_RULES` at all, so nothing was
//         checking it, and a structurally-typed leak (a parameter shaped like an
//         `EditorView`, a re-exported PM type alias) needs no import to exist.
//   6.6 — save, layout, and semantic history must not READ the ProseMirror document or its
//         history plugin. An import ban does not express that; a reference ban does.
//
// So this scans for the IDENTIFIERS as well, across every lane that must stay PM-free.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { existingLanePath, NESTED_LANE_DIRECTORIES, PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES = PACKAGES_ROOT;
const REPO = join(PACKAGES, '..');
const API_ROOT = join(REPO, 'docs/api');
const BINDING_API_REPORT = 'docs/api/docx-editor-core/binding.api.md';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);
const TEST_DIRECTORIES = new Set(['__tests__', 'test', 'tests']);

/**
 * Lanes that must never see ProseMirror.
 *
 * `packages/core` is the PUBLIC contract package — the one task 6.5 names and the one the
 * per-package import rules never covered.
 */
const PM_FREE_ROOTS: readonly { readonly label: string; readonly dir: string }[] = [
  { label: 'public host contracts', dir: 'core/src' },
  { label: 'store + save + semantic history', dir: 'core/src/store' },
  { label: 'collaboration', dir: 'core/src/collaboration' },
  { label: 'layout', dir: 'core/src/layout' },
  { label: 'output', dir: 'core/src/output' },
  // The browser editor facade is the composition root the adapters bind to, so it is a
  // public host contract in practice even though it is not the contract package.
  { label: 'editor facade', dir: 'core/src/editor' },
];

/**
 * ProseMirror surface tokens.
 *
 * Deliberately specific. A generic word like `Transaction` or `Selection` would fire on
 * this repo's own vocabulary (`transact`, `SelectionMark`) and a guard that cries wolf gets
 * disabled. Each token below only exists if ProseMirror does.
 */
const PM_TOKENS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bprosemirror-[a-z]/i, why: 'ProseMirror module specifier' },
  { pattern: /\bProseMirror\b/, why: 'ProseMirror identifier' },
  { pattern: /\bEditorView\b/, why: 'ProseMirror view access' },
  { pattern: /\bEditorState\b/, why: 'ProseMirror state access' },
  { pattern: /\bpmViewDesc\b/, why: 'ProseMirror view-desc access' },
  { pattern: /\bundoDepth\b|\bredoDepth\b/, why: 'ProseMirror history plugin' },
  { pattern: /\bdocView\b/, why: 'ProseMirror document view' },
];

const CONCRETE_SESSION_TOKENS: readonly RegExp[] = [
  /\bTreeDocxSession\b/,
  /\bOpenTreeSessionResult\s*\[\s*['"]session['"]\s*\]/,
  /\bReturnType\s*<\s*typeof\s+openTreeSession\s*>\s*\[\s*['"]session['"]\s*\]/,
];

function collectFiles(
  root: string,
  matches: (file: string) => boolean,
  skipDirectory: (name: string, depth: number) => boolean = () => false,
  depth = 0
): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry) || skipDirectory(entry, depth)) continue;
      out.push(...collectFiles(full, matches, skipDirectory, depth + 1));
    } else if (matches(full)) {
      out.push(full);
    }
  }
  return out;
}

function collectSources(root: string, includeTests = false): string[] {
  const contractsRoot = existingLanePath('core/src');
  return collectFiles(
    root,
    (file) => /\.tsx?$/.test(file),
    (entry, depth) =>
      (!includeTests && TEST_DIRECTORIES.has(entry)) ||
      (root === contractsRoot && depth === 0 && NESTED_LANE_DIRECTORIES.has(entry))
  );
}

function repoPath(file: string): string {
  return relative(REPO, file).replaceAll('\\', '/');
}

/**
 * Strip comments before scanning.
 *
 * This file's own lanes explain WHY they avoid ProseMirror, and several do so by naming it.
 * Banning the word in prose would push those explanations out of the code, which is worse
 * for the next reader than the leak the guard is looking for.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function violations(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const token of PM_TOKENS) {
    if (token.pattern.test(code)) found.push(token.why);
  }
  return found;
}

describe('ProseMirror stays inside the binding (tasks 6.5, 6.6)', () => {
  for (const root of PM_FREE_ROOTS) {
    test(`${root.label} references no ProseMirror type or view`, () => {
      const offenders: string[] = [];
      for (const file of collectSources(existingLanePath(root.dir))) {
        const found = violations(readFileSync(file, 'utf8'));
        if (found.length > 0) {
          offenders.push(`${relative(REPO, file)}: ${[...new Set(found)].join(', ')}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  test('the save path reads the canonical tree, never a ProseMirror document', () => {
    // Task 6.6, stated as the files that actually produce output bytes.
    // The legacy byte-capsule save path (wml-serialize.ts, docx/write.ts) was deleted with
    // the legacy store; the tree serializer and the package writer are the whole save path.
    const savePath = [
      'core/src/store/package/ooxml-tree.ts',
      'core/src/store/package/ooxml-package.ts',
    ];
    for (const relativePath of savePath) {
      const file = existingLanePath(relativePath);
      if (!existsSync(file)) continue;
      expect({ [relativePath]: violations(readFileSync(file, 'utf8')) }).toEqual({
        [relativePath]: [],
      });
    }
  });

  test('public API rollups expose ProseMirror only through the binding entry', () => {
    const reports = collectFiles(API_ROOT, (file) => file.endsWith('.api.md'));
    const offenders = reports
      .filter((file) => repoPath(file) !== BINDING_API_REPORT)
      .map((file) => ({ file: repoPath(file), found: violations(readFileSync(file, 'utf8')) }))
      .filter(({ found }) => found.length > 0);
    expect(offenders).toEqual([]);
    expect(reports.length).toBeGreaterThan(1);
    const bindingApi = reports.find((file) => repoPath(file) === BINDING_API_REPORT);
    expect(bindingApi).toBeDefined();
    expect(violations(readFileSync(bindingApi!, 'utf8'))).toContain('ProseMirror module specifier');
  });

  test('only the paginated surface names the concrete binding session', () => {
    const owners = collectSources(existingLanePath('core/src/editor'), true)
      .filter((file) => {
        const source = stripComments(readFileSync(file, 'utf8'));
        return CONCRETE_SESSION_TOKENS.some((pattern) => pattern.test(source));
      })
      .map((file) => relative(PACKAGES, file).replaceAll('\\', '/'));
    expect(owners).toEqual(['core/src/editor/paginated-surface.ts']);
  });

  test('semantic history reads the canonical tree, never the PM history plugin', () => {
    const file = existingLanePath('core/src/store/store/tree-store.ts');
    expect(violations(readFileSync(file, 'utf8'))).toEqual([]);
    // Positive statement of the same fact: entries are canonical parts and revisions.
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('OoxmlPart');
  });

  test('the guard actually detects a leak (it cannot pass by scanning nothing)', () => {
    // A guard that silently matches no files is the failure mode these replace, so prove
    // the detector fires on each token and that the corpus is non-empty.
    expect(violations('const view: EditorView = get();')).toEqual(['ProseMirror view access']);
    expect(violations("import { EditorState } from 'prosemirror-state';").length).toBeGreaterThan(
      0
    );
    expect(violations('if (undoDepth(state) > 0) {}')).toEqual(['ProseMirror history plugin']);
    for (const source of [
      'const session: TreeDocxSession = get();',
      "type Session = OpenTreeSessionResult['session'];",
      "type Session = ReturnType<typeof openTreeSession>['session'];",
    ]) {
      expect(CONCRETE_SESSION_TOKENS.some((pattern) => pattern.test(source))).toBe(true);
    }
    // ...and that a comment mentioning it is NOT a violation.
    expect(violations('// ProseMirror is deliberately absent here\nconst x = 1;')).toEqual([]);

    let scanned = 0;
    for (const root of PM_FREE_ROOTS) scanned += collectSources(existingLanePath(root.dir)).length;
    expect(scanned).toBeGreaterThan(50);
  });

  test('the binding IS allowed to own ProseMirror, so the guard is not vacuous', () => {
    // If engine-binding were also clean, the whole suite would pass for the wrong reason:
    // ProseMirror having been removed entirely rather than confined.
    const bindingFiles = collectSources(existingLanePath('core/src/binding'));
    const owning = bindingFiles.filter((file) => violations(readFileSync(file, 'utf8')).length > 0);
    expect(owning.length).toBeGreaterThan(0);
  });
});
