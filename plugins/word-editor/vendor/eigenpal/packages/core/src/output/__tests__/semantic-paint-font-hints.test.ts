import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

test('East Asian hinted symbols reach the semantic painter without restyling adjacent ASCII', () => {
  const source =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hint="eastAsia"/></w:rPr><w:t>· 1 ·</w:t></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(source, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const layout = layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const text = Array.from(container.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(text.map((node) => node.textContent).join('')).toBe('· 1 ·');
  const family = (node: HTMLElement) =>
    node.style.fontFamily || node.parentElement!.style.fontFamily;
  expect(
    text
      .filter((node) => node.textContent?.includes('·'))
      .every((node) => family(node).includes('SimSun'))
  ).toBe(true);
  expect(
    text
      .filter((node) => node.textContent?.includes('1'))
      .every((node) => family(node).includes('Times New Roman'))
  ).toBe(true);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
});
