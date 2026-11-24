// Task 9 fix round 1 — table chrome CSS token and property evidence.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const repositoryRoot = resolve(import.meta.dir, '../../../../..');
const cssPath = resolve(repositoryRoot, 'packages/core/src/styles/editor.css');

function tableChromeBlock(css: string): string {
  const start = css.indexOf('/* Table chrome — contextual border/fill controls (Task 9). */');
  const end = css.indexOf(
    '/* ============================================================================\n  * LAYOUT TABLE COLUMN RESIZE'
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('table chrome stylesheet contract (Task 9 fix round 2)', () => {
  test('canonical --doc-destructive aliases resolve only through --doc-* tokens', () => {
    const css = readFileSync(cssPath, 'utf8');
    const root = postcss.parse(css, { from: cssPath });
    const aliases: Record<string, string> = {};
    root.walkRules((rule) => {
      if (rule.selector !== '.docx-editor') return;
      rule.walkDecls((decl) => {
        if (decl.prop === '--doc-destructive' || decl.prop === '--doc-destructive-hover-bg') {
          aliases[decl.prop] = decl.value.trim();
        }
      });
    });
    expect(aliases['--doc-destructive']).toBe('var(--doc-error)');
    expect(aliases['--doc-destructive-hover-bg']).toBe('var(--doc-error-bg)');
    for (const value of Object.values(aliases)) {
      expect(value).toMatch(/^var\(--doc-[a-z0-9-]+\)$/);
      expect(value).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(value).not.toMatch(/rgba?\(/);
    }
  });

  test('table chrome block uses only --doc-* custom properties in var()', () => {
    const css = readFileSync(cssPath, 'utf8');
    const block = tableChromeBlock(css);
    const root = postcss.parse(block, { from: cssPath });
    const bad: string[] = [];
    root.walkDecls((decl) => {
      const matches = decl.value.matchAll(/var\(\s*(--[^,)]+)/g);
      for (const match of matches) {
        const name = match[1]!;
        if (!name.startsWith('--doc-')) bad.push(`${decl.prop}: var(${name})`);
      }
    });
    expect(bad).toEqual([]);
  });

  test('table chrome block declares focus, disabled, swatch, previews, responsive, motion, destructive', () => {
    const css = readFileSync(cssPath, 'utf8');
    const block = tableChromeBlock(css);
    const root = postcss.parse(block, { from: cssPath });
    const serialized = root.toString();
    for (const fragment of [
      ':focus-visible',
      ':disabled',
      '.docx-table-chrome__swatch',
      '.docx-table-line--single',
      '.docx-table-line--dashed',
      '.docx-table-line--dotted',
      '.docx-table-line--double',
      '.docx-table-line--triple',
      '.docx-table-line--thick',
      '@media (max-width: 640px)',
      '@media (prefers-reduced-motion: reduce)',
      '.docx-table-chrome__destructive-row',
    ]) {
      expect(serialized.includes(fragment), fragment).toBe(true);
    }
    expect(serialized).toMatch(/opacity:\s*0\.3/);
    expect(serialized).toMatch(/outline:\s*2px\s+solid\s+var\(--doc-primary\)/);
  });

  test('table menus overlay the toolbar instead of growing its flex row', () => {
    const css = readFileSync(cssPath, 'utf8');
    const root = postcss.parse(tableChromeBlock(css), { from: cssPath });
    const declarations = new Map<string, string>();
    root.walkRules('.docx-table-chrome__panel', (rule) => {
      rule.walkDecls((decl) => {
        declarations.set(decl.prop, decl.value.trim());
      });
    });
    expect(declarations.get('position')).toBe('absolute');
    expect(declarations.get('top')).toBe('calc(100% + 6px)');
    expect(declarations.get('inset-inline-end')).toBe('0');
    // The panel is ambient chrome, so it takes the chrome band rather than a
    // literal. The band ordering itself is covered by chrome-layering.test.ts.
    expect(declarations.get('z-index')).toBe('var(--doc-z-chrome)');
  });
});
