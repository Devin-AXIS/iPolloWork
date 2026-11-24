// Adapter authority checks (interactive-paginated-editing task 1.4). Proves React and
// Vue remain thin hosts: no ProseMirror imports, no document-geometry derivation, and
// no bypass of the public Editor facade (`createDocxEditor` from the composition root).

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES_DIR = PACKAGES_ROOT;

const ADAPTERS = [
  { name: '@docx-editor.dev/react', dir: 'react' },
  { name: '@docx-editor.dev/vue', dir: 'vue' },
] as const;

/** Runtime/package.json deps adapters must never declare. */
const FORBIDDEN_PACKAGE_ROOTS = [
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-transform',
  'prosemirror-history',
  'prosemirror-commands',
  'prosemirror-keymap',
  'prosemirror-inputrules',
  'prosemirror-schema-basic',
  'prosemirror-schema-list',
  '@docx-editor.dev/core/binding',
  '@docx-editor.dev/core/layout',
  '@docx-editor.dev/core/output',
];

/** Workspace dependencies that keep adapters thin without granting private engine authority. */
const ALLOWED_ENGINE_DEPS = new Set([
  '@docx-editor.dev/core',
  '@docx-editor.dev/core/editor',
  // A leaf string catalogue, not an engine lane: no document model, geometry, or editing
  // authority, so it cannot violate the "no engine internals in an adapter" rule.
  '@docx-editor.dev/i18n',
]);

/** Source tokens that indicate geometry derivation or PM bypass (comments stripped). */
const FORBIDDEN_SOURCE = [
  { id: 'EditorView', re: /\bEditorView\b/ },
  { id: 'ProseMirror identifier', re: /\bProseMirror\b/ },
  { id: 'prosemirror import', re: /\bfrom\s*['"]prosemirror[^'"]*['"]/ },
  { id: 'mountDocxEditor bypass', re: /\bmountDocxEditor\b/ },
  { id: 'docxEditorSession bypass', re: /\bdocxEditorSession\b/ },
  { id: 'resolveDomPosition geometry', re: /\bresolveDomPosition\b/ },
  { id: 'hitTest implementation', re: /\bfunction\s+hitTest\b/ },
  { id: 'getCaretRect implementation', re: /\bfunction\s+getCaretRect\b/ },
  { id: 'getSelectionRects implementation', re: /\bfunction\s+getSelectionRects\b/ },
  { id: 'getPageGeometry implementation', re: /\bfunction\s+getPageGeometry\b/ },
  { id: 'layoutBlocks geometry', re: /\blayoutBlocks\b/ },
  { id: 'measureParagraph geometry', re: /\bmeasureParagraph\b/ },
] as const;

function collectSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (
      entry === 'node_modules' ||
      entry === 'dist' ||
      entry === '__tests__' ||
      entry === 'test' ||
      entry === 'plugin-api'
    )
      continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    // This legacy declaration-only compatibility file names the old view in public
    // plugin callbacks, but contains no runtime adapter authority or geometry path.
    else if (full.endsWith(join('managers', 'types.ts'))) continue;
    else if (/\.(tsx?|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function packageRoot(spec: string): string {
  if (spec.startsWith('.')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Returns violation messages for forbidden import specifiers. */
export function auditImportSpecifiers(specifiers: readonly string[]): string[] {
  const violations: string[] = [];
  for (const spec of specifiers) {
    const root = packageRoot(spec);
    if (root.startsWith('.')) continue;
    if (/examples\/shared/.test(spec)) {
      violations.push(`example orchestration import: ${spec}`);
      continue;
    }
    // Two shapes, because section 10 turned lanes into subpaths of one package. A bare entry
    // ('prosemirror-view') is matched on the package root so any deep import counts; an entry
    // that names a subpath ('.../core/binding') has to be matched on the whole
    // specifier, since its package root is the shared core package the adapters MAY import.
    if (
      FORBIDDEN_PACKAGE_ROOTS.some((forbidden) =>
        forbidden.replace(/^@[^/]+\//, '').includes('/')
          ? spec === forbidden || spec.startsWith(`${forbidden}/`)
          : root === forbidden
      )
    ) {
      violations.push(`forbidden package import: ${spec}`);
      continue;
    }
    if (/^prosemirror/.test(root)) {
      violations.push(`prosemirror import: ${spec}`);
    }
  }
  return violations;
}

/** Returns violation messages for forbidden executable source patterns. */
export function auditForbiddenSource(code: string): string[] {
  const stripped = stripComments(code);
  const violations: string[] = [];
  for (const rule of FORBIDDEN_SOURCE) {
    if (rule.re.test(stripped)) violations.push(rule.id);
  }
  return violations;
}

/** Returns violation messages for adapter package.json dependency fields. */
export function auditAdapterPackageJson(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): string[] {
  const violations: string[] = [];
  const fields = [
    ['dependencies', pkg.dependencies ?? {}],
    ['devDependencies', pkg.devDependencies ?? {}],
    ['peerDependencies', pkg.peerDependencies ?? {}],
  ] as const;

  for (const [field, deps] of fields) {
    for (const dep of Object.keys(deps)) {
      if (FORBIDDEN_PACKAGE_ROOTS.includes(dep) || /^prosemirror/.test(dep)) {
        violations.push(`${field}: forbidden ${dep}`);
        continue;
      }
      if (dep.startsWith('@docx-editor.dev/') && !ALLOWED_ENGINE_DEPS.has(dep)) {
        violations.push(`${field}: undeclared engine package ${dep}`);
      }
    }
  }
  return violations;
}

/**
 * True when at least one source file constructs the editor through the composition
 * root facade.
 *
 * Phase 3 of the legacy-lane retirement moved both adapters from `createEditor` +
 * `EditorHost` (adapter-supplied DOM handles and a display sink) to `createDocxEditor`,
 * whose surface paints its own pages and owns interaction internally — so the host-DOM
 * contract requirement is gone with the pipeline that needed it.
 */
export function auditUsesPublicEditorFacade(sources: readonly string[]): boolean {
  for (const source of sources) {
    if (
      // Task 10.5 migrated adapters off the `engine-editor` alias onto the lane's subpath.
      // Both are accepted while the alias exists; task 10.6 drops the alias form.
      /from\s*['"]@docx-editor\.dev\/(?:engine-editor|core\/editor)['"]/.test(source) &&
      /\bcreateDocxEditor\b/.test(source)
    ) {
      return true;
    }
  }
  return false;
}

describe('public adapter authority (interactive-paginated-editing task 1.4)', () => {
  for (const adapter of ADAPTERS) {
    describe(adapter.name, () => {
      const srcRoot = join(PACKAGES_DIR, adapter.dir, 'src');
      const sources = collectSources(srcRoot).map((file) => readFileSync(file, 'utf8'));

      test('does not import ProseMirror or private geometry packages from source', () => {
        for (const source of sources) {
          expect(auditImportSpecifiers(importSpecifiers(source))).toEqual([]);
        }
      });

      test('does not implement document geometry or bypass Editor/EditorHost in source', () => {
        for (const source of sources) {
          expect(auditForbiddenSource(source)).toEqual([]);
        }
      });

      test('uses the public createDocxEditor facade', () => {
        expect(auditUsesPublicEditorFacade(sources)).toBe(true);
      });

      test('package.json declares no forbidden ProseMirror or private engine dependencies', () => {
        const pkg = JSON.parse(
          readFileSync(join(PACKAGES_DIR, adapter.dir, 'package.json'), 'utf8')
        );
        expect(auditAdapterPackageJson(pkg)).toEqual([]);
      });
    });
  }
});

describe('adapter authority rule fixtures', () => {
  test('detects prosemirror import violations', () => {
    expect(auditImportSpecifiers(['prosemirror-state', './local'])).toEqual([
      'forbidden package import: prosemirror-state',
    ]);
    expect(auditImportSpecifiers(['@docx-editor.dev/core/binding'])).toEqual([
      'forbidden package import: @docx-editor.dev/core/binding',
    ]);
    expect(auditImportSpecifiers(['examples/shared/mountDocxEditor'])).toEqual([
      'example orchestration import: examples/shared/mountDocxEditor',
    ]);
  });

  test('detects geometry and PM bypass source violations', () => {
    const bad = `
      import { EditorView } from 'prosemirror-view';
      function hitTest(x: number) { return x; }
      mountDocxEditor();
    `;
    const ids = auditForbiddenSource(bad);
    expect(ids).toContain('EditorView');
    expect(ids).toContain('prosemirror import');
    expect(ids).toContain('hitTest implementation');
    expect(ids).toContain('mountDocxEditor bypass');
  });

  test('ignores ProseMirror mentions inside comments', () => {
    const commented = `
      // adapters must not import ProseMirror
      /* EditorView is forbidden */
      import { createEditor } from '@docx-editor.dev/core/editor';
    `;
    expect(auditForbiddenSource(commented)).toEqual([]);
  });

  test('detects forbidden package.json dependencies', () => {
    expect(
      auditAdapterPackageJson({
        devDependencies: { 'prosemirror-view': '1.0.0' },
      })
    ).toEqual(['devDependencies: forbidden prosemirror-view']);
    expect(
      auditAdapterPackageJson({
        dependencies: { '@docx-editor.dev/core/layout': 'workspace:*' },
      })
    ).toEqual(['dependencies: forbidden @docx-editor.dev/core/layout']);
  });

  test('detects missing public editor facade wiring', () => {
    expect(auditUsesPublicEditorFacade(['const x = 1;'])).toBe(false);
    // The legacy pair no longer satisfies the audit: the retired pipeline's constructor
    // must not read as composition-root wiring.
    expect(
      auditUsesPublicEditorFacade([
        "import { createEditor } from '@docx-editor.dev/core/editor';",
        "import type { EditorHost } from '@docx-editor.dev/core/contracts/editor';",
      ])
    ).toBe(false);
    expect(
      auditUsesPublicEditorFacade([
        "import { createDocxEditor } from '@docx-editor.dev/core/editor';",
      ])
    ).toBe(true);
  });

  test('scans .vue single-file components', () => {
    const vueFixture = join(
      PACKAGES_DIR,
      'core',
      'src',
      'store',
      '__tests__',
      'fixtures',
      'adapter-authority-bad.vue'
    );
    expect(existsSync(vueFixture)).toBe(true);
    const source = readFileSync(vueFixture, 'utf8');
    expect(auditForbiddenSource(source)).toContain('resolveDomPosition geometry');
  });
});
