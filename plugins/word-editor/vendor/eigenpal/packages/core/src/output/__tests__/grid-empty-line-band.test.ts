import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildNumberingIndex,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { caretBoxOnLine } from '../../layout/semantic-hit-test.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

// The fixed measurer gives an 11pt line a 14pt band with its baseline at 11.2pt. Under an
// 18pt line grid the line is 18pt tall with 2pt of centring space above and below the band.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GRID = '<w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr>';
const NUM = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`;
const ITEM = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
const measurer = createFixedMeasurer(6, 14);

function layoutOf(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const numbering = readOoxmlPart(`<w:numbering xmlns:w="${W}">${NUM}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!numbering.ok) throw new Error(numbering.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer,
    styleCascade: elevenPointDefaults(),
    numberingIndex: buildNumberingIndex(numbering.part.root),
  });
}

test('the caret in an empty grid line is as tall as the text band, not the grid line', () => {
  const layout = layoutOf('<w:p/>' + GRID);
  const fragment = layout.pages[0]!.fragments.find((f) => f.kind === 'paragraph')!;
  const line = fragment.kind === 'paragraph' ? fragment.lines[0]! : undefined;
  expect(line!.box.height).toBeCloseTo(18, 5);
  const caret = caretBoxOnLine(line!, 0, measurer);
  expect(caret.height).toBeCloseTo(14, 5);
  expect(caret.y).toBeCloseTo(line!.box.y + 2, 5);
});

test('an empty list item on a grid paints its marker in the same band as a text item', () => {
  // Every item's marker sits on the same baseline within its grid line, empty or not.
  const layout = layoutOf(`<w:p>${ITEM}<w:r><w:t>Item</w:t></w:r></w:p><w:p>${ITEM}</w:p>` + GRID);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const markers = [...container.querySelectorAll<HTMLElement>('.docx-list-marker')];
  expect(markers).toHaveLength(2);
  const [text, empty] = markers as [HTMLElement, HTMLElement];
  const glyph = (marker: HTMLElement) => marker.firstElementChild as HTMLElement;
  expect(empty.style.lineHeight).toBe(text.style.lineHeight);
  expect(empty.style.paddingBottom).toBe(text.style.paddingBottom);
  expect(glyph(empty).style.height).toBe(glyph(text).style.height);
  expect(parseFloat(glyph(empty).style.height)).toBeCloseTo(16, 5);
});
