#!/usr/bin/env node
// Root CLI driver for the post-build `@packageDocumentation` injector.
// Each package's `build` script calls this with `--package <name>` after
// tsup runs. Centralized here so adding a new published package needs no
// per-package script — just a `PACKAGES` entry in `scripts/lib/packages.mjs`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES, packageByName } from './lib/packages.mjs';
import { injectPackageDocs } from './lib/inject-package-doc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { packageName: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--package') {
      args.packageName = argv[++i];
    }
  }
  return args;
}

function main() {
  const { packageName } = parseArgs(process.argv);
  const targets = packageName
    ? [packageByName(packageName)].filter(Boolean)
    : PACKAGES;
  if (packageName && targets.length === 0) {
    console.error(`Unknown package: ${packageName}`);
    process.exit(1);
  }
  for (const pkg of targets) {
    injectPackageDocs({
      packageRoot: path.join(repoRoot, pkg.root),
      packageName: pkg.name,
    });
  }
}

main();
