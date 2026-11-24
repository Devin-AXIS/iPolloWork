// A wrapTopAndBottom drawing anchored on a later line of its paragraph, with a `paragraph`
// vertical frame, starts its band from the paragraph's top. The band then reaches lines laid out
// before the anchor line, and those lines move below it as well. A `line` frame starts the band
// from the anchor line, so only the lines after it move.
//
// The paragraph has five lines split by `w:br`; the anchor sits on the third. The band is 28 pt
// below its frame and 28 pt tall. Expected tops are reference line tops in points.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** 16 pt lines at 8 pt, 17 pt lines at 8.5 pt. */
const measurer = createFixedMeasurer(6, 22);

function anchor(
  frame: string,
  options: { behindDoc?: string; wrap?: string; offset?: number; height?: number; id?: number } = {}
): string {
  const extent = Math.round((options.height ?? 28) * 12_700);
  const id = options.id ?? 1;
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${Math.round((options.offset ?? 28) * 12_700)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="914400" cy="${extent}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    (options.wrap ?? '<wp:wrapTopAndBottom/>') +
    `<wp:docPr id="${id}" name="band${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="914400" cy="${extent}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function documentXml(
  frame: string,
  options: {
    behindDoc?: string;
    wrap?: string;
    /** The band's offset below its frame, in points. */
    offset?: number;
    lead?: number;
    /** One lead paragraph with this space after, in twips. */
    leadAfter?: number;
    inCell?: boolean;
  } = {}
): string {
  const small = '<w:rPr><w:sz w:val="16"/></w:rPr>';
  const large = '<w:rPr><w:sz w:val="17"/></w:rPr>';
  const spacing =
    '<w:pPr><w:spacing w:before="0" w:after="160" w:line="240" w:lineRule="auto"/></w:pPr>';
  let lead = '';
  for (let index = 0; index < (options.lead ?? 0); index += 1)
    lead += `<w:p>${spacing}<w:r>${large}<w:t>Lead ${index}</w:t></w:r></w:p>`;
  if (options.leadAfter !== undefined)
    lead += `<w:p><w:pPr><w:spacing w:before="0" w:after="${options.leadAfter}" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${large}<w:t>Lead</w:t></w:r></w:p>`;
  const paragraph =
    `<w:p>${spacing}` +
    `<w:r>${small}<w:t>Alpha</w:t><w:br/><w:t>Beta</w:t><w:br/><w:t>Gamma</w:t></w:r>` +
    anchor(frame, options) +
    `<w:r>${large}<w:t xml:space="preserve"> delta</w:t><w:br/><w:t>Epsilon</w:t><w:br/><w:t>Zeta</w:t></w:r>` +
    '</w:p>';
  const body = options.inCell
    ? '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    lead +
    body +
    `<w:p>${spacing}<w:r>${large}<w:t>Following</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

function layoutOf(
  xml: string,
  cache?: ReturnType<typeof createParagraphLayoutCache>
): SemanticLayout {
  const part = load(xml);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(cache ? { cache, producer: 'earlier-lines' } : {}),
  });
}

function lineTops(result: SemanticLayout): readonly number[] {
  return result.pages.flatMap((page) =>
    paragraphFragmentsOf(page).flatMap((fragment) => fragment.lines.map((line) => line.box.y))
  );
}

function pagedLineTops(result: SemanticLayout): readonly (readonly [number, number])[] {
  return result.pages.flatMap((page, pageIndex) =>
    paragraphFragmentsOf(page).flatMap((fragment) =>
      fragment.lines.map((line) => [pageIndex, Math.round(line.box.y * 100) / 100] as const)
    )
  );
}

function expectTops(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((top, index) => expect(Math.abs(actual[index]! - top)).toBeLessThan(0.5));
}

// Five lines of the anchor paragraph, then the following paragraph.
const PARAGRAPH_FRAME_TOPS = [0, 55.92, 72, 89.04, 105.84, 130.8];
const LINE_FRAME_TOPS = [0, 16.08, 31.92, 87.84, 104.88, 129.84];

describe('a paragraph-framed topAndBottom band anchored on a later line', () => {
  test('moves the earlier lines that cross it below the band', () => {
    const result = layoutOf(documentXml('paragraph'));
    expect(result.pages[0]!.anchoredDrawings![0]!.y).toBeCloseTo(28, 3);
    expectTops(lineTops(result), PARAGRAPH_FRAME_TOPS);
  });

  test('a line frame keeps the lines before the anchor in place', () => {
    const result = layoutOf(documentXml('line'));
    expect(result.pages[0]!.anchoredDrawings![0]!.y).toBeCloseTo(60, 3);
    expectTops(lineTops(result), LINE_FRAME_TOPS);
  });

  test('a band behind the text moves the same lines', () => {
    expectTops(
      lineTops(layoutOf(documentXml('paragraph', { behindDoc: '1' }))),
      PARAGRAPH_FRAME_TOPS
    );
  });

  test('a drawing without wrapping moves no line', () => {
    const tops = lineTops(layoutOf(documentXml('paragraph', { wrap: '<wp:wrapNone/>' })));
    expectTops(tops, [0, 16, 32, 49, 66, 91]);
  });

  test('the band moves with a paragraph that starts lower on the page', () => {
    // Two lead paragraphs of 17 pt lines and 8 pt after put the paragraph at 50 pt.
    const result = layoutOf(documentXml('paragraph', { lead: 2 }));
    expect(result.pages[0]!.anchoredDrawings![0]!.y).toBeCloseTo(78, 3);
    expectTops(
      lineTops(result).slice(2),
      PARAGRAPH_FRAME_TOPS.map((top) => top + 50)
    );
  });

  test('the cached relayout places every line where the cold one did', () => {
    const xml = documentXml('paragraph', { lead: 1 });
    const cold = lineTops(layoutOf(xml));
    const cache = createParagraphLayoutCache();
    layoutOf(xml, cache);
    expect(lineTops(layoutOf(xml, cache))).toEqual(cold);
  });

  test('a band from the paragraph top moves the first line too', () => {
    const tops = lineTops(layoutOf(documentXml('paragraph', { offset: 0 })));
    expectTops(tops, [28, 44, 60, 77, 94, 119]);
  });

  test('the earlier lines move when the anchor line still fits the page', () => {
    // The paragraph starts at 537 pt; its anchor line ends at 626 pt, inside the 648 pt page.
    const tops = pagedLineTops(layoutOf(documentXml('paragraph', { leadAfter: 10_400 })));
    expect(tops.slice(1, 4)).toEqual([
      [0, 537],
      [0, 593],
      [0, 609],
    ]);
  });

  test('a paragraph in a table cell moves the same lines', () => {
    expectTops(
      lineTops(layoutOf(documentXml('paragraph', { inCell: true }))),
      PARAGRAPH_FRAME_TOPS
    );
    expectTops(lineTops(layoutOf(documentXml('line', { inCell: true }))), LINE_FRAME_TOPS);
  });
});

/** Exact 16 pt lines, so line tops do not depend on font metrics. */
function exactXml(options: {
  readonly line3?: string;
  readonly line5?: string;
  readonly lead?: boolean;
  readonly before?: number;
}): string {
  const spacing = (before: number) =>
    `<w:pPr><w:spacing w:before="${before}" w:after="160" w:line="320" w:lineRule="exact"/></w:pPr>`;
  const lead = options.lead
    ? '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="320" w:lineRule="exact"/></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p>'
    : '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    lead +
    `<w:p>${spacing(options.before ?? 0)}` +
    '<w:r><w:t>Alpha</w:t><w:br/><w:t>Beta</w:t><w:br/><w:t>Gamma</w:t></w:r>' +
    (options.line3 ?? '') +
    '<w:r><w:t xml:space="preserve"> delta</w:t><w:br/><w:t>Epsilon</w:t><w:br/><w:t>Zeta</w:t></w:r>' +
    (options.line5 ?? '') +
    '<w:r><w:t xml:space="preserve"> eta</w:t></w:r></w:p>' +
    `<w:p>${spacing(0)}<w:r><w:t>Following</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

describe('paragraph-framed bands on exact 16 pt lines', () => {
  test('a band of an anchor four lines down moves every line it crosses', () => {
    // Band 10 to 20 pt below the paragraph top, anchored on the fifth line.
    const xml = exactXml({ line5: anchor('paragraph', { offset: 10, height: 10 }) });
    expectTops(lineTops(layoutOf(xml)), [20, 36, 52, 68, 84, 108]);
  });

  test('two bands of one paragraph each move the lines they cross', () => {
    const xml = exactXml({
      line3: anchor('paragraph'),
      line5: anchor('paragraph', { offset: 80, height: 10, id: 2 }),
    });
    expectTops(lineTops(layoutOf(xml)), [0, 56, 90, 106, 122, 146]);
  });

  test('the band measures from above the space before', () => {
    // The paragraph top is 16 pt and its first line 28 pt, so the band is 44 to 72 pt.
    const xml = exactXml({ line3: anchor('paragraph'), lead: true, before: 240 });
    expectTops(lineTops(layoutOf(xml)), [0, 28, 72, 88, 104, 120, 144]);
  });

  test('a drawing behind the text without wrapping moves no line', () => {
    const xml = exactXml({
      line3: anchor('paragraph', { behindDoc: '1', wrap: '<wp:wrapNone/>' }),
    });
    expectTops(lineTops(layoutOf(xml)), [0, 16, 32, 48, 64, 88]);
  });
});
