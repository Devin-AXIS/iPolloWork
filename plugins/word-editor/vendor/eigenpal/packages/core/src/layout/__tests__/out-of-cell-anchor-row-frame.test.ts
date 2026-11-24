// An object a table cell anchors but lays out against the page (§20.4.2.3 `layoutInCell="0"`,
// read before compatibility mode 15).
//
// Its paragraph-relative vertical offset (§20.4.3.5 `wp:positionV relativeFrom="paragraph"`)
// is measured from the top of its row: the cell's top margin, its border and the earlier
// paragraphs of the cell do not move it. In a header or footer story it wraps none of the
// story's own text, neither the other cells of its table nor the paragraphs after it.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { load, layoutContext } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (pt: number) => Math.round(pt * 12_700);
const measurer = createFixedMeasurer(6, 14);

/** A 112pt x 60pt square-wrapped picture, 102pt into the column and 2pt below its frame. */
function picture(layoutInCell: '0' | '1'): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ` allowOverlap="1" layoutInCell="${layoutInCell}" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(102)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(2)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(112)}" cy="${emu(60)}"/>` +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(112)}" cy="${emu(60)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const paragraph = (text: string, inner = '') =>
  `<w:p>${inner}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/**
 * Two 153pt cells with 15pt top and bottom cell margins and 3pt borders. Cell A1 anchors the
 * picture, in its first paragraph or after a paragraph of its own; B1 holds a long text.
 */
function table(options: {
  readonly layoutInCell: '0' | '1';
  readonly secondParagraph?: boolean;
}): string {
  const border = (edge: string) => `<w:${edge} w:val="single" w:sz="24" w:color="000000"/>`;
  const anchored = paragraph('Aone Atwo', picture(options.layoutInCell));
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="6123" w:type="dxa"/>' +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="300" w:type="dxa"/>' +
    '<w:left w:w="55" w:type="dxa"/><w:bottom w:w="300" w:type="dxa"/>' +
    '<w:right w:w="55" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3061"/><w:gridCol w:w="3062"/></w:tblGrid><w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="3061" w:type="dxa"/></w:tcPr>' +
    (options.secondParagraph ? paragraph('Afirst') : '') +
    anchored +
    '</w:tc><w:tc><w:tcPr><w:tcW w:w="3062" w:type="dxa"/></w:tcPr>' +
    paragraph('Bone Btwo Bthree Bfour Bfive Bsix Bseven Beight') +
    '</w:tc></w:tr></w:tbl>'
  );
}

const ROOT_ATTRIBUTES = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"`;

function headerStory(content: string, compatibilityMode: number) {
  const part = load(`<w:hdr ${ROOT_ATTRIBUTES}>${content}</w:hdr>`, '/word/header1.xml');
  return layoutHeaderFooterStory(
    part,
    306,
    measurer,
    'test',
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, '/word/header1.xml'),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 419.5,
      pageHeight: 297.6,
      marginLeft: 56.7,
      marginRight: 56.7,
      marginTop: 72,
      marginBottom: 50,
    },
    undefined,
    { compatibilityMode }
  );
}

type Lines = readonly { readonly contentX: number }[];
const cellLines = (fragment: unknown, cell: number, block = 0): Lines =>
  (fragment as TableFragmentRecord).rows[0]!.cells[cell]!.blocks[block]!.kind === 'paragraph'
    ? ((fragment as TableFragmentRecord).rows[0]!.cells[cell]!.blocks[block] as { lines: Lines })
        .lines
    : [];

describe('§20.4.2.3 layoutInCell="0" in a header table before mode 15', () => {
  for (const mode of [12, 14]) {
    test(`a paragraph offset counts from the row top, not the paragraph (mode ${mode})`, () => {
      const story = headerStory(table({ layoutInCell: '0' }) + paragraph(''), mode);
      const drawing = story.anchoredDrawings?.[0];
      expect(drawing?.layoutInCell).toBe(false);
      const row = (story.fragments[0] as TableFragmentRecord).rows[0]!;
      // The 15pt cell margin and the 3pt border lie between the row top and the paragraph.
      expect(drawing!.y).toBeCloseTo(row.box.y + 2, 3);
    });

    test(`an earlier paragraph of the cell does not move it (mode ${mode})`, () => {
      const story = headerStory(
        table({ layoutInCell: '0', secondParagraph: true }) + paragraph(''),
        mode
      );
      const row = (story.fragments[0] as TableFragmentRecord).rows[0]!;
      expect(story.anchoredDrawings?.[0]?.y).toBeCloseTo(row.box.y + 2, 3);
    });

    test(`the other cell runs its text under the picture (mode ${mode})`, () => {
      const story = headerStory(table({ layoutInCell: '0' }) + paragraph(''), mode);
      const lines = cellLines(story.fragments[0], 1);
      expect(lines.length).toBeGreaterThan(1);
      // Every line of B1 starts at the cell's own content edge, none beside the picture,
      // whose right edge lies 214pt into the column.
      for (const line of lines) expect(line.contentX).toBeCloseTo(lines[0]!.contentX, 3);
      expect(lines[0]!.contentX).toBeLessThan(160);
    });
  }

  test('the paragraph after the table runs under the picture too', () => {
    const story = headerStory(
      table({ layoutInCell: '0' }) + paragraph('Hone Htwo Hthree Hfour Hfive Hsix Hseven'),
      12
    );
    const after = story.fragments[1] as { lines: Lines };
    expect(after.lines.length).toBeGreaterThan(0);
    for (const line of after.lines) expect(line.contentX).toBeLessThan(1);
  });

  test('an object the cell lays out keeps its paragraph frame', () => {
    const story = headerStory(table({ layoutInCell: '1' }) + paragraph(''), 12);
    const drawing = story.anchoredDrawings?.[0];
    expect(drawing?.layoutInCell).toBe(true);
    const row = (story.fragments[0] as TableFragmentRecord).rows[0]!;
    expect(drawing!.y).toBeGreaterThan(row.box.y + 15);
  });
});

describe('§20.4.2.3 layoutInCell="0" in a body table before mode 15', () => {
  test('a paragraph offset counts from the row top', () => {
    const xml =
      `<w:document ${ROOT_ATTRIBUTES}><w:body>` +
      paragraph('Before') +
      table({ layoutInCell: '0', secondParagraph: true }) +
      paragraph('After') +
      '</w:body></w:document>';
    const part = load(xml);
    const page = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      compatibilityMode: 14,
    }).pages[0]!;
    const before = page.fragments[0]!;
    const drawing = page.anchoredDrawings?.[0];
    expect(drawing?.layoutInCell).toBe(false);
    // The row starts right under "Before"; the rows then clear the picture, which stays put.
    expect(drawing!.y).toBeCloseTo(before.box.y + before.box.height + 2, 3);
    const tableFragment = page.fragments.find((fragment) => fragment.kind === 'table');
    expect(tableFragment!.box.y).toBeCloseTo(drawing!.y + 60, 3);
  });
});
