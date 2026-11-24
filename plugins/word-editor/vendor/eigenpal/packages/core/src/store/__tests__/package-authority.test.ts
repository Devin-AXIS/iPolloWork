// Package-authority checks (document-engine task 0.5). Proves that no current or
// future stack object becomes an alternate public authority:
//   - the future EditorHost contract stays PM-free (no ProseMirror/EditorView type);
//   - DocxEditor.* is the only object-model namespace — no competing `export namespace`;
//   - no public package entry exports a `DocxEditorEngine` orchestration object as
//     an authority (orchestration, if it exists, is internal, not a public model).

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingLanePath, PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES_DIR = PACKAGES_ROOT;

// Public source surfaces to police: the declaration contract, the adapters, and
// every production engine package.
const PUBLIC_SRC_DIRS = [
  'core/src',
  'react/src',
  'vue/src',
  'core/src/store',
  'core/src/binding',
  'core/src/layout',
  'core/src/output',
];

function collectSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'test')
      continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('package authority (task 0.5)', () => {
  test('the EditorHost contract is PM-free', () => {
    const editor = stripComments(
      readFileSync(existingLanePath('core/src/contracts/editor.ts'), 'utf8')
    );
    // No import from a prosemirror module.
    expect(/from\s*['"]prosemirror[^'"]*['"]/.test(editor)).toBe(false);
    // No ProseMirror view/state types surfaced by the host contract.
    expect(/\bEditorView\b/.test(editor)).toBe(false);
    expect(/\bProseMirror\b/.test(editor)).toBe(false);
  });

  test('DocxEditor is the only exported object-model namespace', () => {
    const namespaceRe = /export\s+namespace\s+([A-Za-z_$][\w$]*)/g;
    for (const dir of PUBLIC_SRC_DIRS) {
      for (const file of collectSources(existingLanePath(dir))) {
        const source = readFileSync(file, 'utf8');
        let m: RegExpExecArray | null;
        while ((m = namespaceRe.exec(source)) !== null) {
          expect(m[1]).toBe('DocxEditor');
        }
      }
    }
  });

  test('no public package exports a DocxEditorEngine authority object', () => {
    // A `DocxEditorEngine` (shared React/Vue orchestration, memory: engine-unification)
    // may exist internally but must never be a public, authoritative export.
    const exportRe =
      /export\s+(?:abstract\s+)?(?:class|interface|const|function|type)\s+DocxEditorEngine\b/;
    const reExportRe = /export\s*\{[^}]*\bDocxEditorEngine\b[^}]*\}/;
    for (const dir of PUBLIC_SRC_DIRS) {
      // Only the package entry points constitute the public surface.
      for (const entry of ['index.ts', 'index.tsx', 'editor.ts']) {
        const file = join(existingLanePath(dir), entry);
        if (!existsSync(file)) continue;
        const source = readFileSync(file, 'utf8');
        expect(exportRe.test(source)).toBe(false);
        expect(reExportRe.test(source)).toBe(false);
      }
    }
  });
});
