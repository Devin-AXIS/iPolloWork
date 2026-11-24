// A paragraph with a page break before opens its page without its space before in compatibility
// mode 15, so its first line sits at the page top, above its own floats that start lower. Keeping
// the space moved that line into a nearly full-width float placed from the paragraph top, which
// pushed it below the float and could carry the paragraph to a later page.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf, linesOf, type SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (pt: number) => Math.round(pt * 12_700);
/** 12 pt lines at the default 10 pt size. */
const measurer = createFixedMeasurer(6.6, 13.2);

/** A square-wrapped picture `width` wide, 100 pt tall, 20 pt below its paragraph's top. */
function float(width: number): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(20)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(width)}" cy="${emu(100)}"/><wp:wrapSquare wrapText="bothSides"/>` +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(width)}" cy="${emu(100)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const br = '<w:r><w:br/></w:r>';

function layout(anchorPPr: string, content: string, compatibilityMode: number | undefined) {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
      `<w:p>${run('Lead')}</w:p><w:p><w:pPr>${anchorPPr}</w:pPr>${content}</w:p><w:p>${run('Next')}</w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>'
  );
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(compatibilityMode !== undefined ? { compatibilityMode } : {}),
  });
}

function lineAt(result: SemanticLayout, prefix: string) {
  for (const [pageIndex, page] of result.pages.entries()) {
    for (const line of linesOf({ ...result, pages: [page] })) {
      if (
        line.spans
          .map((span) => span.text)
          .join('')
          .startsWith(prefix)
      )
        return { pageIndex, y: Math.round(line.box.y * 1000) / 1000, x: Math.round(line.contentX) };
    }
  }
  throw new Error(`no line starts with ${prefix}`);
}

const OPENS_PAGE = '<w:pageBreakBefore/><w:spacing w:before="240"/>';

describe('a paragraph opening a page above its own lower float', () => {
  test('a full-width float 20 pt down leaves the first line at the page top', () => {
    const result = layout(OPENS_PAGE, float(468) + run('Line'), 15);
    expect(lineAt(result, 'Line')).toEqual({ pageIndex: 1, y: 0, x: 0 });
    expect(anchoredDrawingsOf(result.pages[1]!)[0]!.y).toBe(20);
    expect(lineAt(result, 'Next')).toMatchObject({ pageIndex: 1, y: 120 });
  });

  test('later lines that meet a narrower float wrap beside it', () => {
    const result = layout(OPENS_PAGE, float(300) + run('First') + br + run('Second'), 15);
    expect(lineAt(result, 'First')).toEqual({ pageIndex: 1, y: 0, x: 0 });
    expect(lineAt(result, 'Second')).toEqual({ pageIndex: 1, y: 12, x: 300 });
  });

  test('a legacy mode keeps the space before, so the first line meets the float', () => {
    const result = layout(OPENS_PAGE, float(468) + run('Line'), undefined);
    expect(lineAt(result, 'Line')).toMatchObject({ pageIndex: 1, y: 132 });
  });
});
