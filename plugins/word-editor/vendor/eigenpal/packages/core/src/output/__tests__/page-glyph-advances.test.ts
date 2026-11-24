// Painted glyphs must sit at the advances that layout measured.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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

test('each painted page asks for unhinted glyph advances, also under a host that hints', () => {
  const host = document.createElement('div');
  host.style.textRendering = 'optimizeSpeed';
  const container = document.createElement('div');
  host.append(container);
  document.body.append(host);
  try {
    const breaks = '<w:p><w:r><w:t>53.227±4.058</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
    paintSemanticLayout(container, layoutOf(breaks + breaks), {
      scale: 1,
      materialize: new Set([0]),
    });
    const pages = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    // A page left unbuilt asks for the same advances, so building it later changes nothing.
    expect(pages.some((page) => page.dataset.materialized === 'false')).toBe(true);
    for (const page of pages) {
      expect(page.style.textRendering).toBe('geometricPrecision');
      expect(getComputedStyle(page).textRendering).toBe('geometricPrecision');
    }
  } finally {
    host.remove();
  }
});
