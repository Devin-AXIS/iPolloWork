import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
function paint(body: string): HTMLElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const container = document.createElement('div');
  paintSemanticLayout(
    container,
    layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer() }),
    { scale: 1 }
  );
  return container;
}
test('paint honors default, explicit-zero, and size-threshold kerning', () => {
  for (const [properties, expected] of [
    ['', 'none'],
    ['<w:kern w:val="0"/>', 'none'],
    ['<w:kern w:val="24"/>', 'normal'],
    ['<w:kern w:val="28"/>', 'none'],
  ]) {
    const span = paint(
      `<w:p><w:r><w:rPr><w:sz w:val="24"/>${properties}</w:rPr><w:t>AV</w:t></w:r></w:p>`
    ).querySelector<HTMLElement>('.layout-run-text')!;
    expect(span.style.fontKerning).toBe(expected);
  }
});

test('paint leaves full-width East Asian text unkerned in a kerned run', () => {
  const spans = [
    ...paint(
      '<w:p><w:r><w:rPr><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>AVアイウエオ</w:t></w:r></w:p>'
    ).querySelectorAll<HTMLElement>('.layout-run-text'),
  ];
  const kerning = Object.fromEntries(
    spans.map((span) => [span.textContent, span.style.fontKerning])
  );
  expect(kerning).toEqual({ AV: 'normal', アイウエオ: 'none' });
});

test('browser paint retains native ligature behavior for its canvas fallback', () => {
  const span = paint(
    '<w:p><w:r><w:rPr><w14:ligatures xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:val="none"/></w:rPr><w:t>office</w:t></w:r></w:p>'
  ).querySelector<HTMLElement>('.layout-run-text')!;
  expect(span.style.fontFeatureSettings).toBe('');
});
