// The frames an object laid out in a table cell is positioned against (ECMA-376 Part 1
// §20.4.2.3 anchor `layoutInCell`, §20.4.2.10 positionH, §20.4.2.11 positionV, §20.4.3.4
// ST_RelFromH, §20.4.3.5 ST_RelFromV). The cell stands in for the page, as the reference
// rendering shows in every compatibility mode:
//
// - horizontally, `page` is the whole cell, `margin` and `column` are its text area inside the
//   cell margins, `leftMargin` starts at the cell's left edge and `rightMargin` at the right
//   edge of its text area;
// - vertically, `page`, `margin`, `topMargin` and `bottomMargin` start at the top of the text
//   area, below the top cell margin, whichever paragraph of the cell holds the object;
// - a vertical `center` or `bottom` alignment on those frames, or on `paragraph`, places the
//   object at the top of the frame.
//
// In legacy modes a `left` or `right` alignment in the column frame keeps the left or right
// indent of the anchor paragraph, in a cell and in the body (`columnAlignmentFollowsIndents`).

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  anchoredDrawingsOf,
  type LayoutBox,
  type PageGeometry,
  type SemanticLayout,
} from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 612,
  height: 792,
  margin: { top: 72, right: 72, bottom: 72, left: 72 },
};
const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 20,
  pixelHeight: 20,
  dpiX: 96,
  dpiY: 96,
});
const EMU = 12700;
const SIZE_PT = 20;
/** Cell margins of the anchor cell, in points: top 72, left 56.7, right 5.4 (twips / 20). */
const TOP_MARGIN = 72;
const LEFT_MARGIN = 56.7;
const RIGHT_MARGIN = 5.4;
/** Left and right indents of the anchor paragraph. */
const INDENT = 28.35;

type Position = string | number;

function position(axis: 'H' | 'V', frame: string, value: Position): string {
  const inner =
    typeof value === 'string'
      ? `<wp:align>${value}</wp:align>`
      : `<wp:posOffset>${Math.round(value * EMU)}</wp:posOffset>`;
  return `<wp:position${axis} relativeFrom="${frame}">${inner}</wp:position${axis}>`;
}

function picture(h: string, hValue: Position, v: string, vValue: Position): string {
  const extent = SIZE_PT * EMU;
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    `<wp:simplePos x="0" y="0"/>${position('H', h, hValue)}${position('V', v, vValue)}` +
    `<wp:extent cx="${extent}" cy="${extent}"/><wp:wrapNone/><wp:docPr id="1" name="pic1"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${extent}" cy="${extent}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** The anchor paragraph: space before and indents, so its text area differs from the cell's. */
const anchorParagraph = (object: string): string =>
  '<w:p><w:pPr><w:spacing w:before="340"/><w:ind w:left="567" w:right="567"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">XXXX </w:t></w:r>${object}<w:r><w:t>Anchor</w:t></w:r></w:p>`;

interface Fixture {
  readonly h: string;
  readonly hValue: Position;
  readonly v: string;
  readonly vValue: Position;
  readonly firstParagraph?: boolean;
  readonly inBody?: boolean;
}

function load(fixture: Fixture): OoxmlPart {
  const object = picture(fixture.h, fixture.hValue, fixture.v, fixture.vValue);
  const first = fixture.firstParagraph ? '<w:p><w:r><w:t>First</w:t></w:r></w:p>' : '';
  const anchorCell =
    '<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/><w:tcMar><w:top w:w="1440" w:type="dxa"/>' +
    '<w:left w:w="1134" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tcMar></w:tcPr>' +
    `${first}${anchorParagraph(object)}</w:tc>`;
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="7000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="3600"/></w:trPr>' +
    '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc>' +
    `${anchorCell}</w:tr></w:tbl>`;
  const before =
    '<w:p><w:pPr><w:spacing w:before="1440"/></w:pPr><w:r><w:t>Before</w:t></w:r></w:p>';
  const content = fixture.inBody ? anchorParagraph(object) : table;
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    `${before}${content}<w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`;
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function context(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function lay(fixture: Fixture, compatibilityMode = 15): SemanticLayout {
  const part = load(fixture);
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: context(part),
    compatibilityMode,
  });
}

/** The picture's box, the anchor cell's box and the anchor paragraph's box on page one. */
function placed(layout: SemanticLayout) {
  const page = layout.pages[0]!;
  const drawing = anchoredDrawingsOf(page)[0]!;
  const table = page.fragments.find((fragment) => fragment.kind === 'table') as unknown as
    | { rows: { cells: { box: LayoutBox; blocks: { kind: string; box: LayoutBox }[] }[] }[] }
    | undefined;
  const cell = table?.rows[0]!.cells[1];
  const paragraphs = cell
    ? cell.blocks.filter((block) => block.kind === 'paragraph')
    : (page.fragments as unknown as { kind: string; box: LayoutBox }[]).filter(
        (fragment) => fragment.kind === 'paragraph'
      );
  const paragraph = cell ? paragraphs.at(-1)! : paragraphs[1]!;
  return { picture: drawing.hitBounds, cell: cell?.box, paragraph: paragraph.box };
}

describe('an object laid out in a table cell', () => {
  for (const mode of [15, 14]) {
    test(`margin frames the cell text area, below the top cell margin (mode ${mode})`, () => {
      const { picture: box, cell } = placed(
        lay({ h: 'margin', hValue: 0, v: 'margin', vValue: 0 }, mode)
      );
      expect(box.x).toBeCloseTo(cell!.x + LEFT_MARGIN, 1);
      expect(box.y).toBeCloseTo(cell!.y + TOP_MARGIN, 1);
    });

    test(`page frames the whole cell across and the text area down (mode ${mode})`, () => {
      const { picture: box, cell } = placed(
        lay({ h: 'page', hValue: 10, v: 'page', vValue: -20 }, mode)
      );
      expect(box.x).toBeCloseTo(cell!.x + 10, 1);
      expect(box.y).toBeCloseTo(cell!.y + TOP_MARGIN - 20, 1);
    });
  }

  test('a margin alignment uses the text area edges', () => {
    const right = placed(lay({ h: 'margin', hValue: 'right', v: 'margin', vValue: 0 }));
    expect(right.picture.x + SIZE_PT).toBeCloseTo(
      right.cell!.x + right.cell!.width - RIGHT_MARGIN,
      1
    );
    const center = placed(lay({ h: 'margin', hValue: 'center', v: 'margin', vValue: 0 }));
    const textLeft = center.cell!.x + LEFT_MARGIN;
    const textRight = center.cell!.x + center.cell!.width - RIGHT_MARGIN;
    expect(center.picture.x + SIZE_PT / 2).toBeCloseTo((textLeft + textRight) / 2, 1);
  });

  test('the side margin bands start at the cell edge and at the text area right edge', () => {
    const left = placed(lay({ h: 'leftMargin', hValue: 0, v: 'topMargin', vValue: 0 }));
    expect(left.picture.x).toBeCloseTo(left.cell!.x, 1);
    expect(left.picture.y).toBeCloseTo(left.cell!.y + TOP_MARGIN, 1);
    const right = placed(lay({ h: 'rightMargin', hValue: 0, v: 'bottomMargin', vValue: 0 }));
    expect(right.picture.x).toBeCloseTo(right.cell!.x + right.cell!.width - RIGHT_MARGIN, 1);
    expect(right.picture.y).toBeCloseTo(right.cell!.y + TOP_MARGIN, 1);
  });

  test('the page and margin frames start at the cell top, not at a later paragraph', () => {
    for (const v of ['page', 'margin']) {
      const { picture: box, cell } = placed(
        lay({ h: 'column', hValue: 0, v, vValue: 0, firstParagraph: true })
      );
      expect(box.y).toBeCloseTo(cell!.y + TOP_MARGIN, 1);
    }
  });

  test('a center or bottom alignment places the object at the frame top', () => {
    for (const v of ['page', 'margin']) {
      for (const vValue of ['center', 'bottom']) {
        const { picture: box, cell } = placed(lay({ h: 'column', hValue: 0, v, vValue }));
        expect(box.y).toBeCloseTo(cell!.y + TOP_MARGIN, 1);
      }
    }
    const top = placed(lay({ h: 'column', hValue: 0, v: 'paragraph', vValue: 'top' }));
    const bottom = placed(lay({ h: 'column', hValue: 0, v: 'paragraph', vValue: 'bottom' }));
    expect(bottom.picture.y).toBeCloseTo(top.picture.y, 3);
  });
});

describe('a left or right alignment in the column frame', () => {
  test('keeps the paragraph indents in a cell in legacy modes only', () => {
    const legacyLeft = placed(lay({ h: 'column', hValue: 'left', v: 'paragraph', vValue: 0 }, 14));
    expect(legacyLeft.picture.x).toBeCloseTo(legacyLeft.cell!.x + LEFT_MARGIN + INDENT, 1);
    const legacyRight = placed(
      lay({ h: 'column', hValue: 'right', v: 'paragraph', vValue: 0 }, 14)
    );
    const textRight = legacyRight.cell!.x + legacyRight.cell!.width - RIGHT_MARGIN;
    expect(legacyRight.picture.x + SIZE_PT).toBeCloseTo(textRight - INDENT, 1);
    const modernLeft = placed(lay({ h: 'column', hValue: 'left', v: 'paragraph', vValue: 0 }, 15));
    expect(modernLeft.picture.x).toBeCloseTo(modernLeft.cell!.x + LEFT_MARGIN, 1);
    const offset = placed(lay({ h: 'column', hValue: 0, v: 'paragraph', vValue: 0 }, 14));
    expect(offset.picture.x).toBeCloseTo(offset.cell!.x + LEFT_MARGIN, 1);
  });

  test('keeps the paragraph indents in the body in legacy modes only', () => {
    const legacy = placed(
      lay({ h: 'column', hValue: 'left', v: 'paragraph', vValue: 0, inBody: true }, 14)
    );
    expect(legacy.picture.x).toBeCloseTo(INDENT, 1);
    const right = placed(
      lay({ h: 'column', hValue: 'right', v: 'paragraph', vValue: 0, inBody: true }, 12)
    );
    expect(right.picture.x + SIZE_PT).toBeCloseTo(GEOMETRY.width - 144 - INDENT, 1);
    const modern = placed(
      lay({ h: 'column', hValue: 'left', v: 'paragraph', vValue: 0, inBody: true }, 15)
    );
    expect(modern.picture.x).toBeCloseTo(0, 1);
    const margin = placed(
      lay({ h: 'margin', hValue: 'left', v: 'paragraph', vValue: 0, inBody: true }, 14)
    );
    expect(margin.picture.x).toBeCloseTo(0, 1);
  });
});
