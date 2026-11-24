// A point over a leading inline picture's advance, but outside the picture itself.
//
// A line taller than its picture leaves a band above it that the picture does not cover. A
// point there, over the picture's half nearer its end, means the position after the picture.
// The hit test used to treat everything left of the first text as the line start, so the
// caret went before the picture while its x was drawn after it.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { caretBoxOnLine, hitTestPage } from '../semantic-hit-test.ts';
import { rangeBandsWithinLine } from '../line-geometry.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 100pt wide and 4pt tall: shorter than the 14pt text beside it. */
const drawing =
  '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="1270000" cy="50800"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="50800"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

/**
 * A 100pt square-wrapped float whose left edge is 120pt into the column. Its 20pt left wrap
 * distance leaves a strip before it that text skips but the float does not cover.
 */
const floatAt120 =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="254000" distR="0" simplePos="0" ' +
  'behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>1524000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1270000" cy="1270000"/>' +
  '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="254000" distR="0"/>' +
  '<wp:docPr id="2" name="float"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function pictureLine(content = `<w:r>${drawing}<w:t>abcd</w:t></w:r>`) {
  const part = load(
    `<w:document ${NAMESPACES}><w:body><w:p>${content}</w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const line = linesOf(layout)[0]!;
  const picture = line.drawings![0]!;
  // A band above the picture, still inside the line.
  const y = line.box.y + 0.5;
  expect(y).toBeLessThan(picture.hitBounds.y);
  return { layout, line, picture, y };
}

describe('a point over a leading picture but outside it', () => {
  test('nearer the picture end, it is the position after the picture', () => {
    const { layout, line, picture, y } = pictureLine();
    const hit = hitTestPage(layout, 0, { x: picture.advanceEnd - 10, y });
    expect(hit?.position).toEqual({ paragraphId: line.range.paragraphId, offset: 1 });
  });

  test('nearer the picture start, it is the line start', () => {
    const { layout, line, picture, y } = pictureLine();
    const hit = hitTestPage(layout, 0, { x: picture.advanceStart + 10, y });
    expect(hit?.position).toEqual({ paragraphId: line.range.paragraphId, offset: 0 });
  });
});

describe('a point over a trailing picture but outside it', () => {
  // The same rule at the other end of the line: the text no longer ends the line there.
  test('takes the side of the picture it is nearer', () => {
    const { layout, line, picture, y } = pictureLine(`<w:r><w:t>abcd</w:t>${drawing}</w:r>`);
    const at = (x: number) => hitTestPage(layout, 0, { x, y })?.position.offset;
    expect(at(picture.advanceStart + 10)).toBe(4);
    expect(at(picture.advanceEnd - 10)).toBe(5);
    expect(line.range.end).toBe(5);
  });
});

describe('a point in the float jump after a leading picture', () => {
  // The jump sits between two pieces of content, so a point in it is the boundary between
  // them. That caret draws on the far side of the jump, at the content that starts there,
  // with that content's height.
  test('is the boundary after the picture, drawn at the text after the jump', () => {
    const { layout, line, picture } = pictureLine(
      `${floatAt120}<w:r>${drawing}<w:t>abcd</w:t></w:r>`
    );
    expect(line.spans[0]!.box.x).toBeCloseTo(220, 5);
    const hit = hitTestPage(layout, 0, { x: 110, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
    expect(hit?.caret.x).toBeCloseTo(line.spans[0]!.box.x, 5);
    expect(hit?.caret.height).toBeLessThan(picture.height + 14);
    expect(hit?.caret.height).not.toBeCloseTo(picture.height, 5);
  });

  test('between two pictures, is the boundary between them, drawn at the second', () => {
    const { layout, line, picture } = pictureLine(
      `${floatAt120}<w:r>${drawing}${drawing}<w:t>abcd</w:t></w:r>`
    );
    const second = line.drawings![1]!;
    expect(second.advanceStart).toBeCloseTo(220, 5);
    const hit = hitTestPage(layout, 0, { x: 110, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
    expect(hit?.caret.x).toBeCloseTo(second.advanceStart, 5);
  });

  test('is not claimed by a later picture on the same line', () => {
    // A picture after the text used to win any point left of it once the loop reached it.
    const { layout, line, picture } = pictureLine(
      `${floatAt120}<w:r>${drawing}<w:t>ab</w:t>${drawing}</w:r>`
    );
    expect(line.drawings).toHaveLength(2);
    const hit = hitTestPage(layout, 0, { x: 110, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
  });
});

describe('a picture that does not fit before a float', () => {
  // A float flush at 120pt leaves 20pt after a 100pt picture: too little for a second one.
  // Like a word, the second picture resumes past the float on the same line, at its top.
  const flushFloat = floatAt120.replaceAll('254000', '0');

  test('resumes past the float on the same line', () => {
    const { layout, line } = pictureLine(
      `${flushFloat}<w:r>${drawing}${drawing}<w:t>abcd</w:t></w:r>`
    );
    expect(linesOf(layout)).toHaveLength(1);
    expect(line.box.y).toBeCloseTo(0, 5);
    expect(line.drawings!.map((picture) => picture.advanceStart)).toEqual([0, 220]);
    expect(line.spans[0]!.box.x).toBeCloseTo(320, 5);
  });

  test('keeps the text before a wide picture beside the float when the picture jumps it', () => {
    // 90pt of text and a 200pt picture fit no one passage together, but each fits its own.
    const wide = drawing.replaceAll('1270000', '2540000');
    const { layout, line } = pictureLine(
      `${flushFloat}<w:r><w:t>abcdefghijklmno</w:t>${wide}</w:r>`
    );
    expect(linesOf(layout)).toHaveLength(1);
    expect(line.box.y).toBeCloseTo(0, 5);
    expect(line.spans[0]!.box.x).toBeCloseTo(0, 5);
    expect(line.drawings![0]!.advanceStart).toBeCloseTo(220, 5);
  });

  test('a point before a later picture that jumped the float is the boundary before it', () => {
    const { layout, line } = pictureLine(
      `${flushFloat}<w:r><w:t>abcdefghijk</w:t>${drawing}</w:r>`
    );
    const picture = line.drawings![0]!;
    expect(picture.advanceStart).toBeCloseTo(220, 5);
    const hit = hitTestPage(layout, 0, { x: 90, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start);
    expect(hit?.caret.x).toBeCloseTo(picture.advanceStart, 5);
  });

  test('a point in the gap before the float is the boundary between the pictures', () => {
    const { layout, line, picture } = pictureLine(
      `${flushFloat}<w:r>${drawing}${drawing}<w:t>abcd</w:t></w:r>`
    );
    const hit = hitTestPage(layout, 0, { x: 111, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
    expect(hit?.caret.x).toBeCloseTo(line.drawings![1]!.advanceStart, 5);
  });
});

test('a selection of a picture before a float jump stops at the picture', () => {
  // The caret just after the picture draws past the jump, with the text there, but the end of
  // a selected range belongs to the picture that ends at it.
  const { line, picture } = pictureLine(`${floatAt120}<w:r>${drawing}<w:t>abcd</w:t></w:r>`);
  expect(line.spans[0]!.box.x).toBeCloseTo(220, 5);
  const [band] = rangeBandsWithinLine(line, picture.start, picture.start + 1);
  expect(band!.x).toBeCloseTo(picture.advanceStart, 5);
  expect(band!.x + band!.width).toBeCloseTo(picture.advanceEnd, 5);
});

describe('a picture beside a float that fits nowhere on the line', () => {
  const flushFloat = floatAt120.replaceAll('254000', '0');

  test('leaves the text beside the float and opens the next line', () => {
    // 66pt of text fits before the float. A 300pt picture fits in neither passage, so it
    // opens the next line; the text line stays at the top beside the float.
    const wide = drawing.replaceAll('1270000', '3810000');
    const part = load(
      `<w:document ${NAMESPACES}><w:body><w:p>${flushFloat}<w:r><w:t>abcdefghijk</w:t>${wide}</w:r></w:p></w:body></w:document>`
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(part),
    });
    const [text, pictureLine] = linesOf(layout);
    expect(text!.box.y).toBeCloseTo(0, 5);
    expect(text!.spans[0]!.box.x).toBeCloseTo(0, 5);
    expect(text!.drawings ?? []).toHaveLength(0);
    expect(pictureLine!.drawings).toHaveLength(1);
  });

  test('a point in the gap between pictures on a line of pictures only is their boundary', () => {
    const { layout, line } = pictureLine(`${flushFloat}<w:r>${drawing}${drawing}${drawing}</w:r>`);
    const [first, second] = line.drawings!;
    expect(second!.advanceStart).toBeCloseTo(220, 5);
    const hit = hitTestPage(layout, 0, { x: 110, y: first!.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(first!.start + 1);
  });
});

test('a selection of the text before a picture stops at the text', () => {
  const { line, picture } = pictureLine(`<w:r><w:t>abc</w:t>${drawing}<w:t>def</w:t></w:r>`);
  const [band] = rangeBandsWithinLine(line, 0, picture.start);
  expect(band!.x + band!.width).toBeCloseTo(picture.advanceStart, 5);
});

test('a point before the start of a line of pictures only is the line start', () => {
  // A hidden run before the picture paints nothing, but the line still starts before it.
  const { layout, line, picture, y } = pictureLine(
    '<w:pPr><w:jc w:val="center"/></w:pPr>' +
      `<w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r><w:r>${drawing}</w:r>`
  );
  expect(line.spans).toHaveLength(0);
  expect(picture.start).toBe(1);
  const hit = hitTestPage(layout, 0, { x: picture.advanceStart - 20, y });
  expect(hit?.position.offset).toBe(line.range.start);
});

test('the caret after a picture between two words is drawn after the picture', () => {
  // The text after the picture starts at the picture's end, so it owns that caret; the word
  // before the picture ends one offset earlier and must not answer for it.
  const { line, picture } = pictureLine(`<w:r><w:t>ab</w:t>${drawing}<w:t>cd</w:t></w:r>`);
  const measurer = createFixedMeasurer(6, 14);
  expect(caretBoxOnLine(line, picture.start, measurer).x).toBeCloseTo(picture.advanceStart, 5);
  expect(caretBoxOnLine(line, picture.start + 1, measurer).x).toBeCloseTo(picture.advanceEnd, 5);
});
