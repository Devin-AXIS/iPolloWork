import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { createSurfaceCaret } from '../surface-caret.ts';

test('pending font metrics respect the paragraph frame clipping boundary', () => {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>abcdef</w:t></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const measurer = createFixedMeasurer(6, 14);
  const initial = layoutSemanticDocument(parsed.part, 0, { measurer });
  const original = initial.pages[0]!.fragments[0] as ParagraphFragmentRecord;
  const fragment: ParagraphFragmentRecord = {
    ...original,
    clipToBox: true,
    box: { ...original.box, y: original.box.y + 4, height: 6 },
  };
  const layout: SemanticLayout = {
    ...initial,
    pages: [{ ...initial.pages[0]!, fragments: [fragment] }],
  };
  const position = { paragraphId: fragment.paragraphId, offset: 2 };
  const pages = document.createElement('div');
  pages.tabIndex = 0;
  pages.innerHTML = '<div data-page-index="0"><div class="docx-page-content"></div></div>';
  document.body.append(pages);
  pages.focus();
  const caret = createSurfaceCaret(
    pages,
    () => 1,
    () => ({
      layout,
      selection: { anchor: position, head: position },
      measurer,
      typingStyle: () => ({
        fontSizePt: 36,
        fontFamily: null,
        bold: false,
        italic: false,
        verticalAlign: 'baseline',
      }),
    })
  );
  try {
    caret.update();
    const painted = pages.querySelector<HTMLElement>('[data-docx-caret]')!;
    expect(painted).not.toBeNull();
    const top = parseFloat(painted.style.top);
    const bottom = top + parseFloat(painted.style.height);
    expect(top).toBeGreaterThanOrEqual(fragment.box.y);
    expect(bottom).toBeLessThanOrEqual(fragment.box.y + fragment.box.height);
  } finally {
    caret.destroy();
    pages.remove();
  }
});
