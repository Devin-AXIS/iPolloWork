// Navigation shift padding must match both scroll-container compositions:
// descendant (packaged chrome wrapper) and self-scoped (Root + Viewport / chrome={false}).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const repositoryRoot = resolve(import.meta.dir, '../../../../..');
const cssPath = resolve(repositoryRoot, 'packages/core/src/styles/editor.css');

function selectorsForProp(css: string, prop: string, valueFragment: string): string[] {
  const root = postcss.parse(css, { from: cssPath });
  const found: string[] = [];
  root.walkDecls(prop, (decl) => {
    if (!decl.value.includes(valueFragment)) return;
    const rule = decl.parent;
    if (!rule || rule.type !== 'rule') return;
    found.push((rule as postcss.Rule).selector);
  });
  return found;
}

describe('navigation scroll padding selectors', () => {
  const css = readFileSync(cssPath, 'utf8');

  test('nav shift padding matches descendant and self-scoped scroll containers', () => {
    const selectors = selectorsForProp(css, 'padding-inline-start', '--docx-nav-shift');
    const joined = selectors.join('\n');
    expect(joined).toContain('.docx-editor .docx-editor__scroll-container');
    expect(joined).toContain('.docx-editor.docx-editor__scroll-container');
  });

  test('fit mode and reduced-motion both kill the padding transition on self-scoped scrollers', () => {
    expect(css).toContain('.docx-editor.docx-editor__scroll-container[data-zoom-fit]');
    const reduce = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*docx-editor__scroll-container[^}]*\}/s
    );
    expect(reduce?.[0] ?? '').toContain('.docx-editor.docx-editor__scroll-container');
  });

  test('a pane inside the scroll container is sticky and cancels the start padding', () => {
    // Absolute inside the positioned scroller would scroll the pane away with the pages.
    const sticky = selectorsForProp(css, 'position', 'sticky').join('\n');
    expect(sticky).toContain('.docx-editor .docx-editor__scroll-container > .docx-nav');
    expect(sticky).toContain('.docx-editor.docx-editor__scroll-container > .docx-nav');
    // Sticky offsets resolve inside the padding, so the margin moves the strip back over it
    // and the negative offset lets sticky hold it there. Either alone leaves it displaced.
    for (const prop of ['margin-inline-start', 'inset-inline-start']) {
      const selectors = selectorsForProp(css, prop, '--docx-nav-shift').join('\n');
      expect(selectors).toContain('.docx-editor__scroll-container > .docx-nav');
    }
  });
});
