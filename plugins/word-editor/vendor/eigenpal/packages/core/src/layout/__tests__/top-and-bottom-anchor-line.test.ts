// A top-and-bottom anchor does not end the line that holds it. When a paragraph opens with
// several anchors, one of them a band the margin positions far down the page, its tab-led text
// stays on the first line, above its own nearly full-width float that starts lower. Ending the
// line at the band anchor sent the text to a second line, into that float, and below it.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (pt: number) => Math.round(pt * 12_700);
/** 12 pt lines at the default 10 pt size. */
const measurer = createFixedMeasurer(6.6, 13.2);
const LINE = 12;

let nextId = 1;
function anchor(options: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly vertical: 'paragraph' | 'margin';
  readonly wrap: string;
}): string {
  const id = nextId++;
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="margin"><wp:posOffset>${emu(options.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${options.vertical}"><wp:posOffset>${emu(options.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(options.width)}" cy="${emu(options.height)}"/>${options.wrap}` +
    `<wp:docPr id="${id}" name="pic${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(options.width)}" cy="${emu(options.height)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const SQUARE = '<wp:wrapSquare wrapText="bothSides"/>';
const BAND = '<wp:wrapTopAndBottom/>';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const tab = '<w:r><w:tab/></w:r>';
const TABS =
  '<w:tabs><w:tab w:val="left" w:pos="3960"/><w:tab w:val="left" w:pos="7380"/></w:tabs>';

function layout(content: string, lead = '<w:r><w:t>Lead</w:t></w:r>'): SemanticLayout {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
      `<w:p>${lead}</w:p>` +
      `<w:p><w:pPr>${TABS}</w:pPr>${content}</w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>'
  );
  return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: layoutContext(part) });
}

function lineAt(result: SemanticLayout, prefix: string) {
  return lineRecordAt(result, prefix).summary;
}

function lineRecordAt(result: SemanticLayout, prefix: string) {
  for (const [pageIndex, page] of result.pages.entries()) {
    for (const line of linesOf({ ...result, pages: [page] })) {
      const text = line.spans.map((span) => span.text).join('');
      if (text.replace(/^\t/, '').startsWith(prefix))
        return { line, summary: { pageIndex, y: Math.round(line.box.y * 1000) / 1000, text } };
    }
  }
  throw new Error(`no line starts with ${prefix}`);
}

describe('a top-and-bottom anchor in the middle of a line', () => {
  test('tab-led text after three anchors stays on the first line', () => {
    const result = layout(
      anchor({ x: 250, y: 452, width: 150, height: 60, vertical: 'paragraph', wrap: SQUARE }) +
        anchor({ x: 60, y: 500, width: 117, height: 70, vertical: 'margin', wrap: BAND }) +
        anchor({
          x: -3.75,
          y: 20.35,
          width: 468,
          height: 300,
          vertical: 'paragraph',
          wrap: SQUARE,
        }) +
        tab +
        run('One') +
        tab +
        run('Two')
    );
    expect(lineAt(result, 'One')).toEqual({ pageIndex: 0, y: LINE, text: '\tOne\tTwo' });
    expect(lineAt(result, 'Next').y).toBeCloseTo(LINE + 20.35 + 300, 3);
  });

  test('text before a band anchor shares its line', () => {
    const band = anchor({ x: 60, y: 500, width: 117, height: 70, vertical: 'margin', wrap: BAND });
    const result = layout(run('Before ') + band + run('after'));
    expect(lineAt(result, 'Before')).toEqual({ pageIndex: 0, y: LINE, text: 'Before after' });
  });

  test('a line the band moves wraps beside a float at its new height', () => {
    // An earlier paragraph's float covers the left 150 pt from 60 pt to 160 pt below the
    // margin. The band, anchored on the first line, moves that line to 82 pt, beside it.
    const float = anchor({
      x: 0,
      y: 60,
      width: 150,
      height: 100,
      vertical: 'margin',
      wrap: SQUARE,
    });
    const band = anchor({
      x: 200,
      y: 0,
      width: 100,
      height: 70,
      vertical: 'paragraph',
      wrap: BAND,
    });
    const { line, summary } = lineRecordAt(
      layout(run('Before ') + band + run('after'), `<w:r><w:t>Lead</w:t></w:r>${float}`),
      'Before'
    );
    expect(summary.y).toBeCloseTo(LINE + 70, 3);
    for (const span of line.spans) expect(span.box.x).toBeGreaterThanOrEqual(150 - 0.001);
  });
});
