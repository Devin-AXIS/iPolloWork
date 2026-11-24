// A clicked line edge keeps its caret on the clicked line.
//
// One model offset can end one line and start the next. Without a line preference, `caretAt`
// picks one occurrence by rule. A pointer hit names the line it landed on, and the painted
// caret must stay there, because that is also where typed text lands.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt } from '../semantic-interaction.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const measurer = createFixedMeasurer(6, 14);

function picture(id: number, cx: number): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="254000"/><wp:docPr id="${id}" name="p${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="254000"/></a:xfrm><a:prstGeom prst="rect"/>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

function layoutOf(paragraph: string) {
  const part = load(`<w:document ${NAMESPACES}><w:body>${paragraph}</w:body></w:document>`);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    geometry: { width: 120, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

/** Click at `x` on line `index`; answer the painted caret with and without the preference. */
function click(layout: ReturnType<typeof layoutOf>, index: number, x: number) {
  const lines = linesOf(layout);
  const line = lines[index]!;
  const hit = hitTestPage(layout, 0, { x, y: line.box.y + line.box.height / 2 }, { measurer })!;
  const preferred = caretAt(layout, hit.position, {
    measurer,
    preferredPageIndex: hit.pageIndex,
    preferredLineId: hit.caret.lineId,
  });
  const canonical = caretAt(layout, hit.position, { measurer, preferredPageIndex: hit.pageIndex });
  const lineIndex = (id: string | undefined) => lines.findIndex((entry) => entry.id === id);
  return {
    hit,
    hitLine: lineIndex(hit.caret.lineId),
    preferredLine: lineIndex(preferred?.lineId),
    canonicalLine: lineIndex(canonical?.lineId),
    preferred,
    canonical,
  };
}

describe('a click on a wrapped line edge keeps the clicked line', () => {
  test('left of a soft-wrapped line is that line start, not the previous line end', () => {
    for (const body of [
      text('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk'),
      text('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    ]) {
      const layout = layoutOf(`<w:p>${body}</w:p>`);
      const result = click(layout, 1, -2);
      expect(result.hitLine).toBe(1);
      // The offset ends line 0 too. Without a preference it shows at line 1's start, the
      // line the click chose, so both answers agree here.
      expect(result.canonicalLine).toBe(1);
      expect(result.preferredLine).toBe(1);
      expect(result.preferred!.x).toBeCloseTo(result.hit.caret.x);
    }
  });

  test('past the end of the first line stays on the first line', () => {
    const layout = layoutOf(`<w:p>${text('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii')}</w:p>`);
    const result = click(layout, 0, 125);
    expect(result.hitLine).toBe(0);
    // The click lands after the wrap space, an offset that shows on line 1 by default; the
    // preference is what keeps it on the clicked line.
    expect(result.canonicalLine).toBe(1);
    expect(result.preferredLine).toBe(0);
    expect(result.preferred!.x).toBeCloseTo(result.hit.caret.x);
  });

  test('the start edge of a right-to-left wrapped line is that line', () => {
    const layout = layoutOf(
      '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">' +
        'אבגד הוזח טיכל מנסע פצקר שתאב גדהו זחטי כלמנ</w:t></w:r></w:p>'
    );
    const result = click(layout, 1, 122);
    expect(result.hitLine).toBe(1);
    // The default for the shared offset is the line that starts there, as clicked.
    expect(result.canonicalLine).toBe(1);
    expect(result.preferredLine).toBe(1);
    expect(result.preferred!.x).toBeCloseTo(result.hit.caret.x);
  });
});

describe('a click beside an inline picture keeps the clicked line', () => {
  test('past the text before a picture that wrapped stays on the text line', () => {
    const layout = layoutOf(`<w:p>${text('aaaa bbbb cccc ')}${picture(1, 508000)}</w:p>`);
    const result = click(layout, 0, 81);
    expect(result.hitLine).toBe(0);
    expect(result.canonicalLine).toBe(1);
    expect(result.preferredLine).toBe(0);
    expect(result.preferred!.x).toBeCloseTo(result.hit.caret.x);
  });

  test('right of a picture that fills its own line stays after that picture', () => {
    const layout = layoutOf(
      `<w:p>${picture(1, 1300000)}${picture(2, 1300000)}${text('abc')}</w:p>`
    );
    const result = click(layout, 0, 110);
    expect(result.hitLine).toBe(0);
    expect(result.canonicalLine).toBe(1);
    expect(result.preferredLine).toBe(0);
    expect(result.preferred!.x).toBeCloseTo(result.hit.caret.x);
  });
});

describe('the preference changes nothing where one line owns the position', () => {
  test('hard breaks keep the canonical line for every click', () => {
    const layout = layoutOf('<w:p><w:r><w:t>aaa</w:t><w:br/><w:t>bbb</w:t></w:r></w:p>');
    for (const index of [0, 1])
      for (const x of [-2, 2, 17, 125]) {
        const result = click(layout, index, x);
        expect(result.preferred).toEqual(result.canonical);
      }
  });

  test('a line that does not hold the offset falls back to the canonical caret', () => {
    const layout = layoutOf(`<w:p>${text('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii')}</w:p>`);
    const lines = linesOf(layout);
    const position = { paragraphId: lines[0]!.range.paragraphId, offset: 2 };
    expect(caretAt(layout, position, { measurer, preferredLineId: lines[1]!.id })).toEqual(
      caretAt(layout, position, measurer)
    );
  });
});
