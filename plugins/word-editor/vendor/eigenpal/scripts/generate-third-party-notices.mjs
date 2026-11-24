#!/usr/bin/env bun
//
// Writes `packages/<pkg>/THIRD_PARTY_NOTICES.md` for every publishable package.
//
//   bun run notices:generate     # write the files (release + local)
//   bun run notices:check        # fail if the files on disk are stale
//
// WHY THIS EXISTS
//
// A published bundle can hold third-party source: a tsup config that inlines a
// dependency (`noExternal`, as core does with harfbuzzjs) copies that code into
// `dist/*.js`. Redistributing MIT and Apache-2.0 code means redistributing its
// copyright and permission notice with it, and a `dist/` of minified JavaScript
// carries neither. Material copied into source, such as icon path data, is not
// in a metafile; its license lives in the package `licenses/` folder.
//
// HOW THE LIST IS DERIVED
//
// From `dist/metafile-*.json`, which esbuild writes with the real input set for
// the real build — not from `dependencies`, which describes what a consumer
// installs rather than what we ship. That distinction is the whole point: a
// change to `external`/`noExternal` in a tsup config silently moves a package
// between "consumer installs it, with its own LICENSE" and "we copy its source
// into our tarball", and only the metafile notices.
//
// FAILURE IS ALL-OR-NOTHING
//
// Every notice claims its licenses are reproduced in full, so a partially
// rendered one is an affirmatively false statement — worse than no file. The
// run therefore renders everything first, and only touches the disk once every
// package came out clean. On any problem it deletes whatever it would have
// replaced, so a failed run can never leave a stale or incomplete notice behind
// for a later `changeset publish` to pack.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(root, 'packages');
const OUTPUT_FILE = 'THIRD_PARTY_NOTICES.md';
const WORKSPACE_SCOPE = '@docx-editor.dev/';

// `LICENSE`, `LICENCE`, `COPYING`, `UNLICENSE`, with an optional suffix
// (`LICENSE-MIT`, `LICENSE-APACHE` — dual-licensed packages ship both and no
// plain `LICENSE`) and an optional text extension. Extensions are allowlisted
// so tooling config like `license-check.json` can't be quoted as license text.
const LICENSE_FILE =
  /^(?:licen[cs]e|copying|unlicen[cs]e)(?:[-_][a-z0-9._-]+)?(?:\.(?:md|txt|rst))?$/i;
// Apache-2.0 §4(d): a NOTICE file travels with the derivative work.
const NOTICE_FILE = /^notice(?:\.(?:md|txt|rst))?$/i;

const check = process.argv.includes('--check');
// Explicit selection also supports private, locally distributed exporters.
const selectedArg = process.argv.find((arg) => arg.startsWith('--package='));
const selectedPackage = selectedArg?.slice('--package='.length);
if (selectedArg && !selectedPackage) throw new Error('--package requires a package name');
const problems = [];

/** Publishable packages, in a stable order. */
function publishablePackages() {
  return readdirSync(packagesDir)
    .filter((entry) => statSync(path.join(packagesDir, entry)).isDirectory())
    .sort()
    .map((entry) => {
      const dir = path.join(packagesDir, entry);
      const manifestPath = path.join(dir, 'package.json');
      if (!existsSync(manifestPath)) return null;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      return selectedPackage
        ? manifest.name === selectedPackage
          ? { dir, entry, manifest }
          : null
        : manifest.private === true
          ? null
          : { dir, entry, manifest };
    })
    .filter(Boolean);
}

/**
 * Walk up from a bundled input file to the package that owns it. Stops at the
 * enclosing `node_modules` so a file can never be attributed to the workspace
 * root — and handles bun's `.bun/<name>@<version>/node_modules/<name>` store,
 * pnpm's `.pnpm`, flat npm/yarn layouts and nested `node_modules` without any
 * of them being spelled out here.
 *
 * A manifest counts only when it has BOTH a name and a version. Packages ship
 * sub-directory `package.json` shims that carry a name and nothing else
 * (`web-streams-polyfill/ponyfill/es6/` is one in this tree); treating those as
 * the owner attributes the file to a unit that has no license of its own.
 */
function owningPackage(absoluteInput) {
  let dir = path.dirname(absoluteInput);
  while (dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name && manifest.version) return { dir, manifest };
      } catch {
        // A malformed package.json mid-walk: keep climbing to the real owner.
      }
    }
    if (path.basename(dir) === 'node_modules') return null;
    dir = path.dirname(dir);
  }
  return null;
}

/** Every license text a package ships, so a dual-licensed one keeps both. */
function licenseTextsIn(dir, pattern) {
  return readdirSync(dir)
    .filter((entry) => pattern.test(entry) && statSync(path.join(dir, entry)).isFile())
    .sort()
    .map((filename) => ({ filename, text: readFileSync(path.join(dir, filename), 'utf8').trim() }))
    .filter(({ text }) => text.length > 0);
}

/** SPDX id from any of the shapes package.json has used over the years. */
function licenseIdOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && typeof license.type === 'string') {
    return license.type;
  }
  if (Array.isArray(licenses)) {
    const ids = licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter((id) => typeof id === 'string');
    if (ids.length > 0) return ids.join(' OR ');
  }
  return null;
}

/**
 * Every JavaScript bundle in this package's `dist/`, keyed the way esbuild keys its
 * `outputs`: a path relative to the package, with forward slashes.
 *
 * Only executable output counts. Declarations carry no third-party code, and assets
 * (`harfbuzz.wasm`, `editor.css`, the font files) reach `dist/` by a copy step no
 * metafile describes.
 */
function shippedBundles(dir) {
  const bundles = [];
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(?:js|cjs|mjs)$/.test(item.name)) continue;
      bundles.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(dir, 'dist'));
  return bundles.sort();
}

/** Every third-party package esbuild inlined into this package's bundles. */
function bundledDependencies({ dir, entry }) {
  const dist = path.join(dir, 'dist');
  if (!existsSync(dist)) {
    problems.push(
      `${entry}: publishable but has no dist/ — if it builds with tsup, run ` +
        `\`bun run build:packages\` first; if it ships source or assets instead, its ` +
        `third-party content cannot come from a build metafile and needs its own ` +
        `attribution path`
    );
    return null;
  }

  const metafiles = readdirSync(dist).filter((file) => /^metafile-.*\.json$/.test(file));
  if (metafiles.length === 0) {
    problems.push(
      `${entry}: dist/ has no metafile-*.json — a tsup build must set \`metafile: true\`; ` +
        `a package built by another bundler needs its own attribution path`
    );
    return null;
  }

  const found = new Map();
  const accountedFor = new Set();
  for (const metafile of metafiles) {
    let build;
    try {
      build = JSON.parse(readFileSync(path.join(dist, metafile), 'utf8'));
    } catch (error) {
      problems.push(
        `${entry}: dist/${metafile} is not valid JSON (${error.message}) — tsup names this ` +
          `file after the build FORMAT alone, so two configs in one array config that share ` +
          `a format write the same path at the same time and can interleave. Give one of ` +
          `them a name of its own; \`writeMetafileAs\` in packages/pro/tsup.config.ts does that`
      );
      continue;
    }
    for (const output of Object.keys(build.outputs ?? {})) accountedFor.add(output);
    for (const input of Object.keys(build.inputs)) {
      if (!input.includes('node_modules')) continue;
      // esbuild writes inputs relative to the build's cwd, which is the package.
      const owner = owningPackage(path.resolve(dir, input));
      if (!owner) {
        problems.push(`${entry}: cannot resolve the package that owns bundled input ${input}`);
        continue;
      }
      const { name, version } = owner.manifest;
      // Workspace packages are our own code under the repo's own license.
      if (name.startsWith(WORKSPACE_SCOPE)) continue;
      found.set(`${name}@${version}`, { ...owner.manifest, dir: owner.dir });
    }
  }

  // A metafile that lost a race is still valid JSON — it just describes one build
  // instead of two, and the notice comes out short with nothing to say so. Every
  // shipped bundle has to appear in some metafile's `outputs`, or the list above is
  // derived from less than the package ships.
  for (const bundle of shippedBundles(dir)) {
    if (accountedFor.has(bundle)) continue;
    problems.push(
      `${entry}: ${bundle} ships but appears in no dist/metafile-*.json, so nothing ` +
        `records what it inlined. Either its build does not write a metafile, or two ` +
        `builds wrote the same metafile-<format>.json and one overwrote the other`
    );
  }

  // Plain comparison, not `localeCompare`: collation is locale-dependent (a
  // Nordic locale sorts `aa` after `z`) and bun and node disagree about whether
  // to honour `LANG` at all, which would make `--check` fail on output that is
  // correct.
  return [...found.values()].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.version < b.version ? -1 : 1;
  });
}

function homepageOf(manifest) {
  if (typeof manifest.homepage === 'string') return manifest.homepage;
  const repository = manifest.repository;
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (!url) return null;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function renderNotices(pkg, dependencies) {
  const { name } = pkg.manifest;
  const license = licenseIdOf(pkg.manifest) ?? 'a proprietary license';
  const lines = [
    '# Third-party notices',
    '',
    `\`${name}\` is distributed under ${license}. Its published bundles also contain`,
    'source from the open-source packages listed below, redistributed here under',
    'their own licenses, reproduced in full.',
    '',
    'Those copies are not verbatim. The build inlines, minifies and tree-shakes',
    'them, and includes only the parts each bundle reaches, so what ships is a',
    'modified form of the original source.',
    '',
  ];

  // Apache-2.0 permits adding your own terms, but a reader of a proprietary
  // license needs to be told those terms stop at the open-source portions —
  // otherwise this package's own "no production use, no redistribution" reads
  // as if it reached code the recipient is independently entitled to use.
  if (/^LicenseRef-/i.test(licenseIdOf(pkg.manifest) ?? '')) {
    lines.push(
      `The terms of ${license} do not apply to the portions of these bundles`,
      'derived from the packages listed below. Those portions are licensed to you',
      'under their own terms.',
      ''
    );
  }

  lines.push(
    'This file covers code copied INTO the published bundles. Packages this one',
    'declares as `dependencies` or `peerDependencies` are installed separately by',
    'the consumer and are not repeated here.',
    '',
    `Generated by \`bun run notices:generate\` from the build's esbuild metafile.`,
    'Do not edit by hand.',
    ''
  );

  // A metafile only sees what esbuild READ. Binary assets copied into `dist/` after the
  // bundle — `harfbuzz.wasm`, the font files — are shipped third-party code this generator
  // is structurally blind to, so their attribution is carried by hand in `licenses/` and
  // pointed at from here rather than being silently omitted.
  if (existsSync(path.join(pkg.dir, 'licenses'))) {
    const carried = readdirSync(path.join(pkg.dir, 'licenses')).sort();
    if (carried.length > 0) {
      lines.push(
        'This package also ships prebuilt third-party assets that are not esbuild inputs,',
        'so they cannot appear below. Their licenses travel with the package in',
        '`licenses/`:',
        '',
        ...carried.map((file) => `- \`licenses/${file}\``),
        ''
      );
    }
  }

  if (dependencies.length === 0) {
    lines.push('No third-party code is bundled into this package.', '');
    return lines.join('\n');
  }

  lines.push('## Bundled packages', '');
  for (const dependency of dependencies) {
    const homepage = homepageOf(dependency);
    lines.push(
      `- ${dependency.name} ${dependency.version} — ${licenseIdOf(dependency) ?? 'see below'}${
        homepage ? ` (${homepage})` : ''
      }`
    );
  }
  lines.push('');

  for (const dependency of dependencies) {
    const licenseTexts = licenseTextsIn(dependency.dir, LICENSE_FILE);
    if (licenseTexts.length === 0) {
      problems.push(
        `${pkg.entry}: ${dependency.name}@${dependency.version} is bundled but ships no ` +
          `license text (looked for LICENSE / LICENCE / COPYING / UNLICENSE in ` +
          `${path.relative(root, dependency.dir)})`
      );
      continue;
    }

    lines.push(
      '---',
      '',
      `## ${dependency.name} ${dependency.version}`,
      '',
      `License: ${licenseIdOf(dependency) ?? 'see text below'}`,
      ''
    );

    for (const { filename, text } of [
      ...licenseTexts,
      ...licenseTextsIn(dependency.dir, NOTICE_FILE),
    ]) {
      lines.push(`### ${filename}`, '', '```', text, '```', '');
    }
  }

  return lines.join('\n');
}

const renders = [];
if (selectedPackage && publishablePackages().length === 0)
  throw new Error(`Unknown package: ${selectedPackage}`);

for (const pkg of publishablePackages()) {
  // npm silently packs a tarball without a `files` entry that doesn't exist, so
  // a package that generates a notice but never lists it ships exactly the way
  // this whole script exists to prevent — with no error anywhere.
  const declaredFiles = pkg.manifest.files;
  if (Array.isArray(declaredFiles) && !declaredFiles.includes(OUTPUT_FILE)) {
    problems.push(
      `${pkg.entry}: package.json "files" does not list ${OUTPUT_FILE}, so npm would ` +
        `pack a tarball without it`
    );
  }

  const dependencies = bundledDependencies(pkg);
  if (dependencies === null) continue;
  renders.push({ pkg, dependencies, contents: renderNotices(pkg, dependencies) });
}

if (problems.length > 0) {
  // Nothing generated is trustworthy, so leave nothing behind that a later
  // publish could pack. `--check` reports without touching the tree.
  if (!check) {
    for (const pkg of publishablePackages()) {
      rmSync(path.join(pkg.dir, OUTPUT_FILE), { force: true });
    }
  }
  console.error(problems.join('\n'));
  process.exit(1);
}

let stale = 0;
for (const { pkg, dependencies, contents } of renders) {
  const outputPath = path.join(pkg.dir, OUTPUT_FILE);
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;

  if (check) {
    if (current !== contents) {
      stale += 1;
      console.error(
        `${pkg.entry}: ${OUTPUT_FILE} is ${current === null ? 'missing' : 'out of date'} — run \`bun run notices:generate\``
      );
    }
    continue;
  }

  if (current !== contents) writeFileSync(outputPath, contents);
  console.log(
    `${pkg.manifest.name}: ${dependencies.length} bundled third-party package${
      dependencies.length === 1 ? '' : 's'
    } -> ${path.relative(root, outputPath)}`
  );
}

if (stale > 0) process.exit(1);
if (check) console.log('Third-party notices are up to date.');
