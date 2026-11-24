// Fails a package build when a sibling package it types against has no current build.
//
// Package declaration builds read their siblings' built `dist/*.d.ts`, not their sources
// (compiling the sources again used four times the memory). `bun run typecheck` still reads
// sources, so a stale sibling build would pass typecheck and then publish old types without
// a word. `build:packages` builds siblings first; this names the sibling to build when a
// package is built by itself.
//
// The siblings are the `@docx-editor.dev/*` `dependencies` and `peerDependencies` of the
// package in the current directory, followed transitively: core's declarations import
// i18n's, so every package that reads core also reads i18n.
//
// Usage, from a package directory: node ../../scripts/check-built-siblings.mjs

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packages = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** Workspace package name → directory. */
function workspace() {
  const byName = new Map();
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    const dir = join(packages, entry.name);
    if (entry.isDirectory() && existsSync(join(dir, 'package.json')))
      byName.set(manifest(dir).name, dir);
  }
  return byName;
}

/** The workspace packages `dir` depends on, directly or through another sibling. */
export function siblingsOf(dir, byName = workspace()) {
  const found = new Map();
  const visit = (current) => {
    const { dependencies = {}, peerDependencies = {} } = manifest(current);
    for (const name of Object.keys({ ...dependencies, ...peerDependencies })) {
      const sibling = byName.get(name);
      if (!sibling || found.has(name)) continue;
      found.set(name, sibling);
      visit(sibling);
    }
  };
  visit(dir);
  return found;
}

/** Modification times of the files under `dir` that match `test`, skipping tests. */
function mtimes(dir, test) {
  const times = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      // A directory's own time moves when a file in it is deleted or renamed.
      if (entry.isDirectory()) {
        times.push(statSync(path).mtimeMs);
        walk(path);
      } else if (test(entry.name)) times.push(statSync(path).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return times;
}

/** Why a sibling's build cannot be read, or null when it is current. */
export function staleness(name, dir) {
  const built = mtimes(join(dir, 'dist'), (file) => file.endsWith('.d.ts'));
  if (built.length === 0) return `${name} has no built declarations`;
  // Everything that shapes the emitted declarations: sources, package.json exports, the
  // tsconfig files, and en.json, the locale i18n's types come from. The other locale files
  // do not change any type.
  const inputs = [
    ...mtimes(
      join(dir, 'src'),
      (file) => /\.(tsx?|vue|json)$/.test(file) && !/\.test\./.test(file)
    ),
    ...readdirSync(dir)
      .filter((file) => /^(package|tsconfig.*|en)\.json$/.test(file))
      .map((file) => statSync(join(dir, file)).mtimeMs),
  ];
  const oldestBuilt = built.reduce((a, b) => Math.min(a, b));
  const newestInput = inputs.reduce((a, b) => Math.max(a, b), 0);
  return newestInput > oldestBuilt
    ? `${name}'s built declarations are older than its source`
    : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const problems = [...siblingsOf(process.cwd())]
    .map(([name, dir]) => staleness(name, dir))
    .filter(Boolean);
  if (problems.length > 0) {
    console.error(
      `${problems.join('; ')}. This package's declarations read them. ` +
        'Run `bun run build:packages`, or build those packages first.'
    );
    process.exit(1);
  }
}
