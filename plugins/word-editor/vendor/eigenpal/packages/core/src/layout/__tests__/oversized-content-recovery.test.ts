// Authored content that no band can hold whole still lays out: a floating table in a
// balanced column section, a long chain of text-relative floats, and an inline picture taller
// than the page inside a table cell.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NAMESPACES =
  `xmlns:w="${W}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string, widthTwips = 2000) =>
  `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
/** A text-relative floating table of one row, `heightPt` tall. */
const floatingTable = (
  text: string,
  heightPt: number,
  offsetTwips: number,
  extra = '',
  widthTwips = 2000
) =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:tblpY="${offsetTwips}"/>` +
  `${extra}<w:tblW w:w="${widthTwips}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="${widthTwips}"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:trHeight w:val="${heightPt * 20}"/></w:trPr>${cell(p(text), widthTwips)}</w:tr></w:tbl>`;
const texts = (layout: SemanticLayout) =>
  linesOf(layout).map((line) => line.spans.map((span) => span.text).join(''));
const options = {
  measurer: createFixedMeasurer(6, 12),
  geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
};

describe('a floating table in a balanced column section', () => {
  test('keeps the unbalanced layout when no balanced height can hold the table', () => {
    // A page-anchored table wider than its column, laid out as the first block of a two-column
    // section that ends in a continuous break.
    const wide =
      '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="page" w:tblpX="1800" w:tblpY="-126"/>' +
      '<w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>' +
      `<w:tr><w:trPr><w:trHeight w:val="1140"/></w:trPr>${cell(p('float'), 9000)}</w:tr>` +
      `<w:tr><w:trPr><w:trHeight w:val="1140"/></w:trPr>${cell(p('second'), 9000)}</w:tr></w:tbl>`;
    const section =
      '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="820" w:bottom="1440" w:left="540"/>' +
      '<w:cols w:num="2" w:space="720" w:equalWidth="0">' +
      '<w:col w:w="4623" w:space="40"/><w:col w:w="6217"/></w:cols></w:sectPr>';
    const part = load(
      `<w:document ${NAMESPACES}><w:body>${wide}${p('short', section)}${p('next section')}` +
        '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="820" w:bottom="1440" w:left="540"/></w:sectPr>' +
        '</w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 0, options);
    expect(layout.pages).toHaveLength(1);
    expect(texts(layout).join(' ').split(/\s+/)).toEqual([
      'float',
      'second',
      'short',
      'next',
      'section',
    ]);
  });
});

describe('a chain of text-relative floats', () => {
  test('settles when each float is placed against text that wraps the float before it', () => {
    const body = Array.from(
      { length: 30 },
      (_, index) =>
        floatingTable(`t${index}`, 40, 1, '<w:tblOverlap w:val="never"/>', 9000) +
        p('') +
        p('') +
        p(`after ${index}`)
    ).join('');
    const part = load(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`);
    const layout = layoutSemanticDocument(part, 0, options);
    expect(layout.pages.length).toBeGreaterThan(2);
    const lines = texts(layout);
    for (let index = 0; index < 30; index += 1) {
      expect(lines).toContain(`t${index}`);
      expect(lines).toContain(`after ${index}`);
    }
  });
});

describe('an inline picture taller than the page in a table cell', () => {
  test('is placed once on a fresh page and clipped to the cell', () => {
    const heightEmu = 900 * 12700;
    const picture =
      '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="1270000" cy="${heightEmu}"/><wp:docPr id="1" name="p1"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:ext cx="1270000" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"/>` +
      '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const part = load(
      `<w:document ${NAMESPACES}><w:body>` +
        '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
        `<w:tr>${cell(picture)}${cell(p('beside'))}</w:tr></w:tbl>${p('after')}` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        '</w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 0, {
      ...options,
      inlineDrawingLayout: layoutContext(part),
    });
    expect(texts(layout)).toContain('beside');
    expect(texts(layout)).toContain('after');
    const contentHeight = layout.pages[0]!.contentBox.height;
    for (const page of layout.pages)
      for (const fragment of page.fragments.filter(
        (block): block is TableFragmentRecord => block.kind === 'table'
      ))
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(contentHeight + 0.001);
  });
});
