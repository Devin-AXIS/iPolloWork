import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';
import { caretAt, caretStops, spansInSelection } from '../semantic-interaction.ts';
import { selectionRects, keyedRangeRects } from '../selection-rects.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import { clipParagraphBox } from '../paragraph-frame-clip.ts';

function fixture() {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>abcdef</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const initial = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const original = initial.pages[0]!.fragments[0] as ParagraphFragmentRecord;
  const clipped: ParagraphFragmentRecord = {
    ...original,
    clipToBox: true,
    box: { x: 12, y: 4, width: 12, height: 6 },
  };
  const layout: SemanticLayout = {
    ...initial,
    pages: [{ ...initial.pages[0]!, fragments: [clipped] }],
  };
  const position = (offset: number) => ({ paragraphId: clipped.paragraphId, offset });
  return { layout, clipped, position };
}

test('clips selection, review and caret geometry while retaining the complete model text', () => {
  const { layout, clipped, position } = fixture();
  const selection = { anchor: position(0), head: position(6) },
    order = [clipped.paragraphId];
  const expected = [{ pageIndex: 0, ...clipped.box }];
  expect(selectionRects(layout, selection, order)).toEqual(expected);
  expect(
    keyedRangeRects(layout, [{ key: 'review', from: selection.anchor, to: selection.head }]).get(
      'review'
    )
  ).toEqual(expected);
  expect(caretAt(layout, position(0))).toBeNull();
  expect(caretAt(layout, position(3))).toMatchObject({ x: 18, y: 4, height: 6 });
  expect(caretStops(layout).map((stop) => stop.position.offset)).toEqual([2, 3, 4]);
  expect(caretStops(layout).every((stop) => stop.y === 4 && stop.height === 6)).toBe(true);
  expect(
    spansInSelection(layout, selection, order)
      .map((span) => span.text)
      .join('')
  ).toBe('abcdef');
});

test('frame hit results stay inside the clip rectangle', () => {
  const { layout, clipped } = fixture();
  expect(hitTestFragments(layout, 0, [clipped], { x: 13, y: 5 })?.caret).toMatchObject({
    x: 12,
    y: 4,
    height: 6,
  });
  expect(hitTestFragments(layout, 0, [clipped], { x: 25, y: 5 })).toBeNull();
  expect(hitTestFragments(layout, 0, [clipped], { x: 15, y: 11 })).toBeNull();
});

test('clip intersections preserve zero-width caret edges and leave ordinary geometry unchanged', () => {
  const frame = { x: 10, y: 10, width: 20, height: 20 };
  const caret = { x: 30, y: 5, width: 0, height: 15 };
  expect(clipParagraphBox(caret, frame)).toEqual({ x: 30, y: 10, width: 0, height: 10 });
  expect(clipParagraphBox({ ...caret, x: 31 }, frame)).toBeNull();
  expect(clipParagraphBox(caret, undefined)).toBe(caret);
});
