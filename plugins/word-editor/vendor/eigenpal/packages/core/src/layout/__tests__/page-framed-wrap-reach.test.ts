// How far back a float's wrap band reaches.
//
// A picture pinned to the top of the margin sits where it sits whatever the text does, so
// Word wraps EVERY line it crosses on the page — including the lines of paragraphs that come
// before its anchor, and the lines of its own paragraph that come before the anchor
// character. A picture positioned relative to its paragraph cannot: reaching back would move
// the paragraph that positions it.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { drawingSourceOrderInPart } from '../inline-drawing-source.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { load, layoutContext } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const measurer = createFixedMeasurer(6, 14);

/** A 144x72pt square-wrap picture, pinned to the top-left of the margin unless told otherwise. */
function anchor(verticalFrom: 'margin' | 'paragraph'): string {
  const vertical =
    verticalFrom === 'margin'
      ? '<wp:positionV relativeFrom="margin"><wp:align>top</wp:align></wp:positionV>'
      : '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" ' +
    'locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>' +
    vertical +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch>' +
    '</pic:blipFill><pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function document(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
  );
}

function firstLineXs(xml: string): readonly number[] {
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    drawingSourceOrder: drawingSourceOrderInPart(part, layoutContext(part)),
  });
  const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
  return fragment.lines.map((line) => line.spans[0]?.box.x ?? 0);
}

const TEXT = 'lead '.repeat(80);
const LEAD = `<w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p>`;
/** The picture is 72pt tall at the top of the margin, so it crosses the first six lines. */
const WRAPPED_LINES = 6;

describe('a page-framed wrap band reaches back over the page', () => {
  test('a margin-anchored float wraps the paragraph before its anchor', () => {
    const xs = firstLineXs(
      document(LEAD + `<w:p>${anchor('margin')}<w:r><w:t>body</w:t></w:r></w:p>`)
    );
    expect(xs.length).toBeGreaterThan(WRAPPED_LINES);
    expect(xs.slice(0, WRAPPED_LINES)).toEqual(Array(WRAPPED_LINES).fill(144));
    expect(xs.slice(WRAPPED_LINES).every((x) => x === 0)).toBe(true);
  });

  test('a paragraph-anchored float leaves the paragraph before it at full width', () => {
    const xs = firstLineXs(
      document(LEAD + `<w:p>${anchor('paragraph')}<w:r><w:t>body</w:t></w:r></w:p>`)
    );
    expect(xs.every((x) => x === 0)).toBe(true);
  });

  test('a margin-anchored float wraps its own lines before the anchor character', () => {
    const xs = firstLineXs(document(`<w:p><w:r><w:t>${TEXT}</w:t></w:r>${anchor('margin')}</w:p>`));
    expect(xs.slice(0, WRAPPED_LINES)).toEqual(Array(WRAPPED_LINES).fill(144));
    expect(xs.slice(WRAPPED_LINES).every((x) => x === 0)).toBe(true);
  });
});
