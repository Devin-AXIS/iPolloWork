// The painted document must not take its inline base direction from the host page.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const cssPath = resolve(import.meta.dir, '../../styles/editor.css');

function layoutOf(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: elevenPointDefaults(),
  });
}

function declarationsOf(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  postcss.parse(readFileSync(cssPath, 'utf8'), { from: cssPath }).walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((decl) => void found.set(decl.prop, decl.value));
  });
  return found;
}

describe('host page direction', () => {
  test('each painted page pins a left-to-right base under an rtl host', () => {
    const host = document.createElement('div');
    host.dir = 'rtl';
    host.style.direction = 'rtl';
    const container = document.createElement('div');
    host.append(container);
    document.body.append(host);
    try {
      const body =
        '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>שלום</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>left to right</w:t></w:r></w:p>';
      paintSemanticLayout(container, layoutOf(body), { scale: 1 });
      expect(getComputedStyle(container).direction).toBe('rtl');
      const pages = [...container.querySelectorAll<HTMLElement>('.docx-page')];
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        expect(getComputedStyle(page).direction).toBe('ltr');
        const line = page.querySelector<HTMLElement>('.docx-line')!;
        expect(getComputedStyle(line).direction).toBe('ltr');
      }
    } finally {
      host.remove();
    }
  });

  test('a page left unbuilt pins the same base, so building it later changes nothing', () => {
    const container = document.createElement('div');
    const breaks = '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
    paintSemanticLayout(container, layoutOf(breaks + breaks), {
      scale: 1,
      materialize: new Set([0]),
    });
    const shells = [...container.querySelectorAll<HTMLElement>('.docx-page')].filter(
      (page) => page.dataset.materialized === 'false'
    );
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) expect(shell.style.direction).toBe('ltr');
  });

  test('the scroll container keeps a left-to-right base, so scrollLeft stays non-negative', () => {
    expect(declarationsOf('.docx-editor__scroll-container').get('direction')).toBe('ltr');
  });
});
