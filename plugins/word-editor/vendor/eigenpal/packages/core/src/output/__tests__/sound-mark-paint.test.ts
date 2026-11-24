// A kana sound mark that its face spaces paints as a span of its own, and that span keeps the
// cell layout gave it: a browser can draw a lone combining mark with no advance, which would
// shift the rest of the line away from the caret geometry.
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
  // The fixed measurer gives every character, the mark too, one 6 pt cell at 11 pt.
  paintSemanticLayout(
    container,
    layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer() }),
    { scale: 1 }
  );
  return container;
}

test('a spaced sound mark paints in its own span with the width of its cell', () => {
  const spans = [
    ...paint(
      '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>があ</w:t></w:r></w:p>'
    ).querySelectorAll<HTMLElement>('.layout-run-text'),
  ];
  expect(spans.map((span) => span.textContent)).toEqual(['か', '゙', 'あ']);
  expect(spans[1]!.style.width).toBe('6px');
});
