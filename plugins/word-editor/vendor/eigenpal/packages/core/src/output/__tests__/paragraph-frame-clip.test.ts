import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

function fixture() {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>0123456789</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const original = layout.pages[0]!.fragments[0] as ParagraphFragmentRecord;
  const framed: ParagraphFragmentRecord = {
    ...original,
    clipToBox: true,
    box: { ...original.box, width: 20 },
  };
  const withFragment = (fragment: ParagraphFragmentRecord): SemanticLayout => ({
    ...layout,
    pages: [{ ...layout.pages[0]!, fragments: [fragment] }],
  });
  return { source: parsed.part, original, framed, withFragment };
}

test('fixed paragraph clips ink without deleting text nodes or changing source ranges', () => {
  const { source, original, framed, withFragment } = fixture();
  const before = serializeOoxmlPart(source),
    container = document.createElement('div');
  paintSemanticLayout(container, withFragment(framed), { scale: 2 });
  const paragraph = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
  expect(paragraph.style.overflow).toBe('hidden');
  expect(paragraph.style.width).toBe('40px');
  expect(paragraph.textContent).toBe('0123456789');
  expect(framed.lines).toBe(original.lines);
  expect(framed.range).toBe(original.range);
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('retained paint notices clip-only changes and ordinary paragraphs remain unclipped', () => {
  const { original, framed, withFragment } = fixture();
  const sameBox: ParagraphFragmentRecord = { ...original, box: framed.box };
  const container = document.createElement('div');
  paintSemanticLayout(container, withFragment(sameBox), { scale: 1 });
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.style.overflow).not.toBe(
    'hidden'
  );
  paintSemanticLayout(container, withFragment(framed), { scale: 1 });
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.style.overflow).toBe(
    'hidden'
  );
  paintSemanticLayout(container, withFragment(sameBox), { scale: 1 });
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.style.overflow).not.toBe(
    'hidden'
  );
});
