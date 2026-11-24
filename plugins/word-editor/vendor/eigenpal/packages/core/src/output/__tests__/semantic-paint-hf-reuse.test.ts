// Opening a header used to fold rId + page index into the paint-reuse key (#355),
// which rebuilt every visible sheet even though the body ink had not moved.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function elevenPointDefaults(): ReturnType<typeof buildStyleCascadeTable> {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:sz w:val="22"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  return buildStyleCascadeTable(styles.part.root);
}

function layoutOf(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 7, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: elevenPointDefaults(),
  });
}

function pagesOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.docx-page')];
}

describe('header context stays off the paint-reuse key', () => {
  const long = `<w:p><w:r><w:t>${'word '.repeat(3000)}</w:t></w:r></w:p>`;

  test('setting the active header keeps every retained page', () => {
    const layout = layoutOf(long);
    expect(layout.pages.length).toBeGreaterThan(2);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const first = pagesOf(container);

    paintSemanticLayout(container, layout, {
      scale: 1,
      activeHeaderFooterRId: 'rId10',
      activeHeaderFooterPageIndex: 0,
    });
    const entered = pagesOf(container);
    expect(entered).toHaveLength(first.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(entered[index]).toBe(first[index]);
    }

    paintSemanticLayout(container, layout, {
      scale: 1,
      activeHeaderFooterRId: 'rId10',
      activeHeaderFooterPageIndex: 1,
    });
    const moved = pagesOf(container);
    for (let index = 0; index < first.length; index += 1) {
      expect(moved[index]).toBe(first[index]);
    }

    paintSemanticLayout(container, layout, { scale: 1 });
    const exited = pagesOf(container);
    for (let index = 0; index < first.length; index += 1) {
      expect(exited[index]).toBe(first[index]);
    }
  });
});
