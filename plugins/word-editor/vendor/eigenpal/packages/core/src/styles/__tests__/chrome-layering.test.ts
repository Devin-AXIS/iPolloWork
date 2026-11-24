// Chrome layering contract.
//
// A surface the user just opened has to paint over furniture that was already
// on screen. That ordering used to live in a dozen hand-picked z-index values,
// which drifted: the menus sat at 30 while the navigation gutter sat at 40, so
// opening File put the menu UNDERNEATH the navigation toggle.
//
// The values are now three tokens. These tests fail if a floating surface goes
// back to a literal, or if the bands invert.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const repositoryRoot = resolve(import.meta.dir, '../../../../..');
const cssPath = resolve(repositoryRoot, 'packages/core/src/styles/editor.css');

/** Every floating surface, and the band it belongs to. */
const OVERLAY_SELECTORS = [
  '.docx-menubar__menu',
  '.docx-hyperlink-popup',
  '.docx-toolbar__swatch-popup',
  '.docx-toolbar__alignment-popup',
  '.docx-toolbar__zoom-menu',
  '.docx-toolbar__line-spacing-menu',
  '.docx-toolbar__font-size-menu',
  '.docx-toolbar__more-panel',
  '.docx-toolbar__mode-menu',
  '.docx-toolbar__image-wrap-menu',
  '.docx-toolbar__alt-text-panel',
  '.docx-toolbar__font-family-content',
  '.docx-toolbar__style-content',
];
const CHROME_SELECTORS = ['.docx-nav', '.docx-table-chrome__panel', '.docx-editor__outline-toggle'];
const CONTEXT_SELECTORS = ['.docx-contextmenu'];

function tokenValues(css: string): Record<string, number> {
  const root = postcss.parse(css, { from: cssPath });
  const out: Record<string, number> = {};
  root.walkRules((rule) => {
    if (rule.selector !== '.docx-editor') return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--doc-z-')) out[decl.prop] = Number(decl.value.trim());
    });
  });
  return out;
}

/** z-index declarations keyed by the selector they were found on. */
function zIndexDecls(css: string): Array<{ selector: string; value: string }> {
  const root = postcss.parse(css, { from: cssPath });
  const found: Array<{ selector: string; value: string }> = [];
  root.walkDecls('z-index', (decl) => {
    const rule = decl.parent;
    if (!rule || rule.type !== 'rule') return;
    found.push({ selector: (rule as postcss.Rule).selector, value: decl.value.trim() });
  });
  return found;
}

describe('chrome layering', () => {
  const css = readFileSync(cssPath, 'utf8');

  test('the three bands are defined, and ordered chrome < overlay < context', () => {
    const t = tokenValues(css);
    expect(t['--doc-z-chrome']).toBeGreaterThan(0);
    expect(t['--doc-z-overlay']).toBeGreaterThan(t['--doc-z-chrome']);
    expect(t['--doc-z-context']).toBeGreaterThan(t['--doc-z-overlay']);
  });

  test('every transient overlay sits in the overlay or context band', () => {
    const decls = zIndexDecls(css);
    for (const selector of [...OVERLAY_SELECTORS, ...CONTEXT_SELECTORS]) {
      const matches = decls.filter((d) => d.selector.includes(selector));
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.value).toMatch(/^var\(--doc-z-(overlay|context)\)$/);
      }
    }
  });

  test('ambient chrome sits in the chrome band', () => {
    const decls = zIndexDecls(css);
    for (const selector of CHROME_SELECTORS) {
      const matches = decls.filter((d) => d.selector.includes(selector));
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.value).toBe('var(--doc-z-chrome)');
      }
    }
  });

  test('no floating surface reintroduces a literal z-index', () => {
    const named = [...OVERLAY_SELECTORS, ...CHROME_SELECTORS, ...CONTEXT_SELECTORS];
    const offenders = zIndexDecls(css)
      .filter((d) => named.some((s) => d.selector.includes(s)))
      .filter((d) => !/^var\(--doc-z-[a-z]+\)$/.test(d.value));
    expect(offenders).toEqual([]);
  });

  // The context menu opens in the top layer, so a host header or docked pane with its own
  // stacking context cannot paint over it. The popover defaults would center it.
  test('the context menu popover keeps the pointer placement', () => {
    const root = postcss.parse(css, { from: cssPath });
    const decls: Record<string, string> = {};
    root.walkRules((rule) => {
      if (rule.selector !== '.docx-contextmenu[popover]') return;
      rule.walkDecls((decl) => {
        decls[decl.prop] = decl.value.trim();
      });
    });
    expect(decls).toEqual({ inset: 'auto', margin: '0' });
  });
});
