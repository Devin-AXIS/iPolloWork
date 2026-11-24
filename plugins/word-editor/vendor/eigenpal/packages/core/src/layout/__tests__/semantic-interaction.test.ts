import { selectionMarkRects } from '../selection-rects.ts';
// Semantic caret stops, hit regions, selection and navigation (task 7.4).
//
// Every answer here comes from the layout records: no DOM ranges, no element rectangles.
// That is what makes interaction testable headlessly and identical between adapters.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { documentOrder } from '../document-order.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';
import { type PageGeometry, type TextMeasurer } from '../semantic-records.ts';
import {
  caretAt,
  caretStops,
  compositionAnchor,
  hitTestSemantic,
  moveCaret,
  selectionRects,
  spansInSelection,
  type SemanticPosition,
} from '../semantic-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, geometry?: PageGeometry) =>
  layoutSemanticDocument(part, 1, {
    measurer,
    styleCascade: elevenPointDefaults(),
    ...(geometry ? { geometry } : {}),
  });

const P0 = '/word/document.xml#0.0.0';
const P1 = '/word/document.xml#0.0.1';
const P2 = '/word/document.xml#0.0.2';
const at = (paragraphId: string, offset: number): SemanticPosition => ({ paragraphId, offset });

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('caret stops', () => {
  test('one per character boundary, including the end', () => {
    const stops = caretStops(lay(load(paragraph('abc'))));
    expect(stops.map((stop) => stop.position.offset)).toEqual([0, 1, 2, 3]);
    expect(stops.every((stop) => stop.position.paragraphId === P0)).toBe(true);
  });

  test('stops advance across the line as x increases', () => {
    const stops = caretStops(lay(load(paragraph('abc'))));
    expect(stops[0]!.x).toBe(0);
    expect(stops[1]!.x).toBe(6);
    expect(stops[3]!.x).toBe(18);
  });

  test('an empty paragraph still has one stop, or it could not be clicked into', () => {
    const stops = caretStops(lay(load('<w:p/>')));
    expect(stops).toHaveLength(1);
    expect(stops[0]!.position.offset).toBe(0);
  });

  test('every paragraph contributes stops, in document order', () => {
    const stops = caretStops(lay(load(paragraph('ab') + paragraph('cd'))));
    expect(
      stops.map((stop) => `${stop.position.paragraphId.slice(-5)}:${stop.position.offset}`)
    ).toEqual(['0.0.0:0', '0.0.0:1', '0.0.0:2', '0.0.1:0', '0.0.1:1', '0.0.1:2']);
  });

  test('a wrapped line does not duplicate the boundary position', () => {
    const narrow: PageGeometry = {
      width: 100,
      height: 1000,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const stops = caretStops(lay(load(paragraph('aaa bbb ccc ddd eee')), narrow));
    const offsets = stops.map((stop) => stop.position.offset);
    // Each model position appears exactly once even though lines share a boundary.
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});

describe('caret geometry for a model position', () => {
  test('resolves a position to a rectangle', () => {
    const layout = lay(load(paragraph('hello')));
    const caret = caretAt(layout, at(P0, 2));
    expect(caret).not.toBeNull();
    expect(caret!.x).toBe(12);
    expect(caret!.height).toBeGreaterThan(0);
  });

  test('a position outside the document resolves to nothing', () => {
    expect(caretAt(lay(load(paragraph('hi'))), at(P0, 99))).toBeNull();
    expect(caretAt(lay(load(paragraph('hi'))), at('no-such-paragraph', 0))).toBeNull();
  });

  test('an EMPTY spaced paragraph gets a text-height caret, not a line-box one', () => {
    // There is no run to size the caret against, so the line box is all there is — and on a
    // double-spaced paragraph that box is mostly leading. Taking it whole drew a caret twice
    // the height of the text about to be typed, starting a full line above it.
    const spaced = lay(
      load(
        '<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:p>' +
          '<w:p><w:r><w:t>reference</w:t></w:r></w:p>'
      )
    );
    const emptyLine = spaced.pages[0]!.fragments[0]!;
    if (emptyLine.kind !== 'paragraph') throw new Error('expected a paragraph');
    const line = emptyLine.lines[0]!;
    // `auto` extras grow the box BELOW the glyphs, so the band starts at the line top and
    // there is no above-band leading to step over (see `LineRecord.leading`).
    expect(line.leading).toBe(0);

    const caret = caretAt(spaced, at(P0, 0))!;
    expect(caret).not.toBeNull();
    // The glyph band is where the text will appear, and it is a fraction of the box the
    // double spacing produced — taking the box whole is the bug this test exists for.
    expect(caret.height).toBeLessThan(line.box.height);
    expect(caret.y).toBe(line.box.y + line.leading);
    // Same height a single-spaced empty paragraph would get: the spacing changed the box,
    // not the text.
    const single = lay(load('<w:p/>'));
    const singleFragment = single.pages[0]!.fragments[0]!;
    if (singleFragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(caret.height).toBe(singleFragment.lines[0]!.box.height);
  });
});

describe('hit testing', () => {
  test('a point inside the text picks the nearest boundary', () => {
    const layout = lay(load(paragraph('abcdef')));
    // 6pt per character; x=13 is nearest the boundary at 12.
    expect(hitTestSemantic(layout, { x: 13, y: 5 })!.position.offset).toBe(2);
  });

  test('a click past the end of a line lands at the line end, not nowhere', () => {
    const layout = lay(load(paragraph('abc')));
    expect(hitTestSemantic(layout, { x: 9999, y: 5 })!.position.offset).toBe(3);
  });

  test('a click below the last line lands on the last line', () => {
    const layout = lay(load(paragraph('ab') + paragraph('cd')));
    const hit = hitTestSemantic(layout, { x: 0, y: 9999 })!;
    expect(hit.position.paragraphId).toBe(P1);
  });

  test('a click in the margin above the first line lands on the first line', () => {
    const layout = lay(load(paragraph('ab')));
    expect(hitTestSemantic(layout, { x: 0, y: -500 })!.position.offset).toBe(0);
  });

  test('a hit test on an empty document answers nothing rather than guessing', () => {
    expect(hitTestSemantic({ revision: 1, pages: [] }, { x: 0, y: 0 })).toBeNull();
  });

  test('a hit test result is directly usable as an edit position', () => {
    // The point of one coordinate system: no translation step between click and op.
    const layout = lay(load(paragraph('hello')));
    const hit = hitTestSemantic(layout, { x: 18, y: 5 })!;
    expect(hit.position).toEqual({ paragraphId: P0, offset: 3 });
  });
});

describe('selection geometry', () => {
  test('a selection within one line is one rectangle', () => {
    const layout = lay(load(paragraph('abcdef')));
    const rects = selectionRects(
      layout,
      { anchor: at(P0, 1), head: at(P0, 4) },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBe(6);
    expect(rects[0]!.width).toBe(18);
  });

  test('a backwards selection produces the same rectangles', () => {
    const layout = lay(load(paragraph('abcdef')));
    const forward = selectionRects(
      layout,
      { anchor: at(P0, 1), head: at(P0, 4) },
      documentOrder(layout)
    );
    const backward = selectionRects(
      layout,
      { anchor: at(P0, 4), head: at(P0, 1) },
      documentOrder(layout)
    );
    expect(backward).toEqual(forward);
  });

  test('a selection across paragraphs produces one rectangle per line', () => {
    const layout = lay(load(paragraph('abcd') + paragraph('efgh')));
    const rects = selectionRects(
      layout,
      { anchor: at(P0, 2), head: at(P1, 2) },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(2);
  });

  test('a selected paragraph mark paints a small block after the line', () => {
    const layout = lay(load(paragraph('abcd') + paragraph('efgh')));
    const rects = selectionRects(
      layout,
      { anchor: at(P0, 4), head: at(P1, 0) },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBe(24);
    expect(rects[0]!.width).toBeGreaterThan(0);
    expect(rects[0]!.width).toBeLessThan(6);
  });

  test('a selection crossing an empty paragraph shows its selected line', () => {
    const layout = lay(load(paragraph('a') + '<w:p/>' + paragraph('b')));
    const rects = selectionRects(
      layout,
      { anchor: at(P0, 1), head: at(P2, 0) },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(2);
    expect(rects.every((rect) => rect.width > 0)).toBe(true);
    expect(rects[1]!.x).toBe(0);
  });

  test('selected authored whitespace keeps its measured width', () => {
    const layout = lay(load('<w:p><w:r><w:t xml:space="preserve">a  b</w:t></w:r></w:p>'));
    const rects = selectionRects(
      layout,
      { anchor: at(P0, 1), head: at(P0, 3) },
      documentOrder(layout)
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]!.width).toBe(12);
  });

  test('an empty selection covers nothing without visiting layout pages', () => {
    const layout = lay(load(paragraph('abc')));
    const order = documentOrder(layout);
    const withoutPageReads = new Proxy(layout, {
      get(target, property, receiver) {
        if (property === 'pages') throw new Error('collapsed range visited layout pages');
        return Reflect.get(target, property, receiver);
      },
    });
    const selection = { anchor: at(P0, 1), head: at(P0, 1) };
    expect(selectionRects(withoutPageReads, selection, order)).toEqual([]);
    expect(selectionMarkRects(withoutPageReads, selection, order)).toEqual([]);
  });

  test('the spans a selection touches are reported, for active formatting', () => {
    const part = load(
      '<w:p><w:r><w:t>plain</w:t></w:r>' + '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const layout = lay(part);
    const spans = spansInSelection(layout, { anchor: at(P0, 6), head: at(P0, 8) });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.style.bold).toBe(true);
  });

  test('a caret reads the span of the character to its left', () => {
    const part = load(
      '<w:p><w:r><w:t>plain</w:t></w:r>' + '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const layout = lay(part);
    const spans = spansInSelection(layout, { anchor: at(P0, 7), head: at(P0, 7) });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.style.bold).toBe(true);
  });

  test('a caret on a span boundary sides with the left span', () => {
    const part = load(
      '<w:p><w:r><w:t>plain</w:t></w:r>' + '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const layout = lay(part);
    // Offset 5 is the boundary: "plain" ends there, "bold" starts there.
    const spans = spansInSelection(layout, { anchor: at(P0, 5), head: at(P0, 5) });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.style.bold).toBe(false);
  });

  test('a caret at paragraph start reads the span to its right', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>');
    const layout = lay(part);
    const spans = spansInSelection(layout, { anchor: at(P0, 0), head: at(P0, 0) });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.style.bold).toBe(true);
  });
});

describe('keyboard navigation', () => {
  const layout = lay(load(paragraph('abc') + paragraph('defgh')));

  test('left and right walk one stop at a time', () => {
    expect(moveCaret(layout, at(P0, 1), 'right')!.position).toEqual(at(P0, 2));
    expect(moveCaret(layout, at(P0, 1), 'left')!.position).toEqual(at(P0, 0));
  });

  test('character and vertical moves derive stops only for adjacent paragraphs', () => {
    const long = lay(load(Array.from({ length: 100 }, () => paragraph('abcdef')).join('')));
    let measurements = 0;
    const counting: TextMeasurer = {
      measure(text, style) {
        measurements += 1;
        return measurer.measure(text, style);
      },
      lineMetrics: (style) => measurer.lineMetrics(style),
    };
    expect(moveCaret(long, at(P0, 1), 'right', null, { measurer: counting })!.position).toEqual(
      at(P0, 2)
    );
    // A whole-document stop build measures hundreds of prefixes here. The local path only
    // needs the handful of boundaries in "abcdef".
    expect(measurements).toBeLessThan(20);

    measurements = 0;
    expect(moveCaret(long, at(P0, 1), 'down', null, { measurer: counting })!.position).toEqual(
      at(P1, 1)
    );
    expect(measurements).toBeLessThan(20);
  });

  test('right at a paragraph end crosses into the next paragraph', () => {
    expect(moveCaret(layout, at(P0, 3), 'right')!.position).toEqual(at(P1, 0));
  });

  test('left at a paragraph start crosses back', () => {
    expect(moveCaret(layout, at(P1, 0), 'left')!.position).toEqual(at(P0, 3));
  });

  test('left at the document start stays put rather than failing', () => {
    expect(moveCaret(layout, at(P0, 0), 'left')!.position).toEqual(at(P0, 0));
  });

  test('lineStart and lineEnd', () => {
    expect(moveCaret(layout, at(P1, 3), 'lineStart')!.position).toEqual(at(P1, 0));
    expect(moveCaret(layout, at(P1, 1), 'lineEnd')!.position).toEqual(at(P1, 5));
  });

  test('documentStart and documentEnd', () => {
    expect(moveCaret(layout, at(P1, 2), 'documentStart')!.position).toEqual(at(P0, 0));
    expect(moveCaret(layout, at(P0, 0), 'documentEnd')!.position).toEqual(at(P1, 5));
  });

  test('down moves to the nearest column on the next line', () => {
    const moved = moveCaret(layout, at(P0, 2), 'down')!;
    expect(moved.position.paragraphId).toBe(P1);
    expect(moved.position.offset).toBe(2);
  });

  test('a desired column survives a short line', () => {
    // The classic bug: travelling through a short line collapses the caret to its end and
    // the column is lost on the way back. The desired x is threaded instead.
    const stepped = lay(load(paragraph('abcdefgh') + paragraph('xy') + paragraph('abcdefgh')));
    const P2 = '/word/document.xml#0.0.2';
    const first = moveCaret(stepped, at(P0, 6), 'down')!;
    expect(first.position.paragraphId).toBe(P1);
    expect(first.position.offset).toBe(2); // clamped to the short line
    const second = moveCaret(stepped, first.position, 'down', first.desiredX)!;
    expect(second.position.paragraphId).toBe(P2);
    expect(second.position.offset).toBe(6); // the original column, restored
  });

  test('up at the first line goes to the document start', () => {
    expect(moveCaret(layout, at(P0, 2), 'up')!.position).toEqual(at(P0, 0));
  });

  test('down at the last line goes to the document end', () => {
    expect(moveCaret(layout, at(P1, 2), 'down')!.position).toEqual(at(P1, 5));
  });

  test('navigating from a position that is not laid out answers nothing', () => {
    expect(moveCaret(layout, at('no-such-paragraph', 0), 'right')).toBeNull();
  });
});

describe('composition anchor', () => {
  test('is expressed in model coordinates and re-resolved per layout', () => {
    const part = load(paragraph('hello'));
    const anchor = compositionAnchor(lay(part), at(P0, 3));
    expect(anchor!.position).toEqual(at(P0, 3));
    // The same model position resolves against a DIFFERENT layout without being cached as
    // geometry, which is what lets it survive the transactions an IME emits.
    const narrow = lay(part, {
      width: 60,
      height: 1000,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(compositionAnchor(narrow, at(P0, 3))!.position).toEqual(at(P0, 3));
  });
});

describe('hit testing needs the PAGE, because caret stops are page-relative', () => {
  // Line 3 of page 1 and line 3 of page 4 sit at the same y, so a hit test given only a
  // point can match either. Without the page, a click near the top of the first page landed
  // thousands of characters into the document. The surface used to guard this; the contract
  // it guards belongs here, with the function that has it.
  const SMALL: PageGeometry = {
    width: 200,
    height: 60,
    margin: { top: 5, right: 5, bottom: 5, left: 5 },
  };
  const many = Array.from({ length: 30 }, (_, index) => paragraph(`para ${index}`)).join('');
  const layout = lay(load(many), SMALL);

  test('the fixture really does span several pages, or the test proves nothing', () => {
    expect(layout.pages.length).toBeGreaterThan(3);
  });

  test('a point on page 0 resolves on page 0 when the page is given', () => {
    const hit = hitTestSemantic(layout, { x: 0, y: 2, pageIndex: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.pageIndex).toBe(0);
  });

  test('the SAME point resolves on a later page when that page is given', () => {
    // Identical coordinates, different answer — which is the whole reason the page index is
    // part of the query rather than derived from y.
    const last = layout.pages.length - 1;
    const hit = hitTestSemantic(layout, { x: 0, y: 2, pageIndex: last });
    expect(hit).not.toBeNull();
    expect(hit!.pageIndex).toBe(last);
  });

  test('the two answers are different positions, not the same one twice', () => {
    const first = hitTestSemantic(layout, { x: 0, y: 2, pageIndex: 0 })!;
    const later = hitTestSemantic(layout, { x: 0, y: 2, pageIndex: layout.pages.length - 1 })!;
    expect(later.position.paragraphId).not.toBe(first.position.paragraphId);
  });

  test('an out-of-range page falls back to the whole document rather than answering nothing', () => {
    // A click has to put the caret somewhere; refusing would make it do nothing at all.
    expect(hitTestSemantic(layout, { x: 0, y: 2, pageIndex: 999 })).not.toBeNull();
  });
});
