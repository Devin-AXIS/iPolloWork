// How this package asks for the engine, which decides whether a page ends up with one of it.
//
// The engine carries module-level state: the HarfBuzz shaper and its cache budget, the grapheme
// boundary strategy, and layout caches keyed by object identity. Two copies in one tree do not
// crash. They load the shaper twice, read a boundary configured on the other copy, and miss every
// identity-keyed cache — wrong and expensive, quietly.
//
// This is the package that CONSTRUCTS the editor, so it is the one a second copy hurts most, and
// it is the easiest place to acquire one: `@docx-editor.dev/core` is published and documented, so
// a consumer installing it directly is invited, not exotic. A regular dependency lets a package
// manager nest a second copy the moment the ranges diverge — and `workspace:*` publishes as an
// exact pin, so the ranges diverge as soon as the engine ships a version this adapter was not
// built against. A peer makes the manager resolve one, and say so at install when it cannot.
//
// `packages/pro/src/__tests__/package-dependencies.test.ts` asserts the same thing for the module
// package, for the same reason. Neither file is decoration: moving the engine back to a regular
// dependency is the failure both were written to catch.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};

const core = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'core', 'package.json'), 'utf8')
) as { version: string };

// A tilde range on the engine's current minor: patch drift is allowed, a different minor is
// not, so an app never pairs this adapter with an engine minor it did not ship with. The floor
// patch may lag within the minor because in-range releases do not rewrite the range.
const requiresSameMinor = (range: string | undefined, version: string) => {
  const match = /^~(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(range ?? '');
  if (!match) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return Number(match[1]) === major && Number(match[2]) === minor && Number(match[3]) <= patch!;
};

describe('how this package asks for the engine', () => {
  test('the engine is a peer, so the consumer resolves one copy of it', () => {
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/core'], core.version)
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the engine peer is REQUIRED, not optional', () => {
    // An optional peer is a suggestion: the manager installs nothing and stays silent, which is
    // the opposite of the point. React and react-dom are optional here because a consumer of the
    // headless surface genuinely may not have them. There is no such consumer for the engine —
    // this package cannot render a page without it.
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
  });

  test('it is still installed here, so this workspace builds and tests against it', () => {
    // A peer is what a CONSUMER resolves. It is not an install for this package's own build, so
    // the dev dependency is what makes `bun run build` and these tests see the engine at all.
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });

  test('does not install engine implementation dependencies', () => {
    expect(manifest.dependencies?.['emf-converter']).toBeUndefined();
  });
});

test('export converters require an explicit application installation', () => {
  for (const name of ['@docx-editor.dev/docx-to-markdown', '@docx-editor.dev/docx-to-pdf']) {
    expect(manifest.dependencies?.[name]).toBeUndefined();
    expect(manifest.optionalDependencies?.[name]).toBeUndefined();
    expect(manifest.peerDependencies?.[name]).toBeUndefined();
  }
});
