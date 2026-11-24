import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { everyStoryOrder } from '../document-order.ts';
import { caretStops } from '../semantic-interaction.ts';
import {
  selectionRects,
  keyedRangeRects,
  presenceSelectionRects,
  selectionMarkRects,
} from '../selection-rects.ts';

const measurer = createFixedMeasurer(6, 14);
function layout(text: string, width = 120, next = '', rtl = true, runRtl = rtl) {
  const paragraph = (value: string) =>
    `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}</w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/>${runRtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(text)}${next ? paragraph(next) : ''}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  return layoutSemanticDocument(parsed.part, 0, {
    measurer,
    geometry: { width, height: 300, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}
function bands(text: string, start: number, end: number, runRtl = true) {
  const doc = layout(text, 120, '', true, runRtl);
  const order = everyStoryOrder(doc);
  const selection = {
    anchor: { paragraphId: order[0]!, offset: start },
    head: { paragraphId: order[0]!, offset: end },
  };
  return [
    selectionRects(doc, selection, order, measurer),
    presenceSelectionRects(doc, selection, order, undefined, measurer),
    keyedRangeRects(
      doc,
      [{ key: 'comment', from: selection.anchor, to: selection.head }],
      undefined,
      measurer
    ).get('comment')!,
  ].map((rects) => rects.map(({ x, width }) => ({ x, width })));
}

test('RTL first and last characters highlight their physical glyph bands', () => {
  for (const actual of bands('אבג', 0, 1)) expect(actual).toEqual([{ x: 114, width: 6 }]);
  for (const actual of bands('אבג', 1, 3)) expect(actual).toEqual([{ x: 102, width: 12 }]);
});

test('mixed-direction logical selection keeps unselected visual characters clear', () => {
  // אבג and its following space occupy96..120; A occupies78..84.
  // BC at84..96 must remain outside this logical range.
  for (const actual of bands('אבג ABC דהו', 0, 5))
    expect(actual).toEqual([
      { x: 78, width: 6 },
      { x: 96, width: 24 },
    ]);
  for (const actual of bands('אבג ABC דהו', 0, 11)) expect(actual).toEqual([{ x: 54, width: 66 }]);
});

test('reversed presence and text selections keep the same physical bands', () => {
  const doc = layout('אבג ABC דהו');
  const order = everyStoryOrder(doc);
  const selection = {
    anchor: { paragraphId: order[0]!, offset: 5 },
    head: { paragraphId: order[0]!, offset: 0 },
  };
  const expected = [
    { x: 78, width: 6 },
    { x: 96, width: 24 },
  ];
  for (const rects of [
    selectionRects(doc, selection, order, measurer),
    presenceSelectionRects(doc, selection, order, undefined, measurer),
  ])
    expect(rects.map(({ x, width }) => ({ x, width }))).toEqual(expected);
});

test('caret stops include the logical start and end at opposite RTL edges', () => {
  const doc = layout('אבג');
  expect(caretStops(doc, measurer).map((stop) => stop.x)).toEqual([120, 114, 108, 102]);
});

test('wrapped RTL highlights stay inside each selected line', () => {
  const doc = layout('אבג דהו זחט', 30);
  const order = everyStoryOrder(doc);
  const rects = selectionRects(
    doc,
    { anchor: { paragraphId: order[0]!, offset: 0 }, head: { paragraphId: order[0]!, offset: 11 } },
    order,
    measurer
  );
  expect(rects.length).toBe(linesOf(doc).length);
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(30);
  }
});

test('selected RTL paragraph marks extend left of the logical text end', () => {
  const doc = layout('אבג', 120, 'דהו');
  const order = everyStoryOrder(doc);
  const marks = selectionMarkRects(
    doc,
    { anchor: { paragraphId: order[0]!, offset: 0 }, head: { paragraphId: order[1]!, offset: 0 } },
    order,
    measurer
  );
  expect(marks).toHaveLength(1);
  expect(marks[0]!.x + marks[0]!.width).toBe(102);
});

test.each(['אבג ABC', 'אבג 123'])('RTL paragraph marks follow the visual edge after %s', (text) => {
  const doc = layout(text, 120, 'דהו');
  const order = everyStoryOrder(doc);
  const marks = selectionMarkRects(
    doc,
    {
      anchor: { paragraphId: order[0]!, offset: 0 },
      head: { paragraphId: order[1]!, offset: 0 },
    },
    order,
    measurer
  );
  expect(marks).toHaveLength(1);
  expect(marks[0]!.x + marks[0]!.width).toBe(78);
});

test('LTR paragraph marks follow the visual right edge after a Hebrew ending', () => {
  const doc = layout('ABC אבג', 120, 'next', false);
  const order = everyStoryOrder(doc);
  const marks = selectionMarkRects(
    doc,
    {
      anchor: { paragraphId: order[0]!, offset: 0 },
      head: { paragraphId: order[1]!, offset: 0 },
    },
    order,
    measurer
  );
  expect(marks).toHaveLength(1);
  expect(marks[0]!.x).toBe(42);
});

test('unmarked mixed Hebrew uses Word LTR run context while selection remains source-based', () => {
  for (const actual of bands('אבג ABC דהו', 0, 5, false))
    expect(actual).toEqual([{ x: 54, width: 30 }]);
});
