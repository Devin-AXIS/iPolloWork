import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  linesOf,
  type BlockFragmentRecord,
  type InlineDrawingRecord,
  type LayoutBox,
} from '../semantic-records.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

// Letter paper with one-inch margins: the text column is 468pt wide, the sheet 612pt.
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"`;
const measurer = createFixedMeasurer(6, 14);
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 800,
  pixelHeight: 100,
  dpiX: 96,
  dpiY: 96,
});

let pictureId = 0;
function picture(width: number, ppr = ''): string {
  pictureId += 1;
  const cx = width * 12700;
  const cy = 30 * 12700;
  return (
    `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pictureId}" name="p"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pictureId}" name="p"/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr>' +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
    '</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

/** A fixed table of two 180pt cells; `margins` are the first cell's left and right in twips. */
function table(first: string, margins?: readonly [number, number]): string {
  const mar = margins
    ? `<w:tcMar><w:left w:w="${margins[0]}" w:type="dxa"/><w:right w:w="${margins[1]}" w:type="dxa"/></w:tcMar>`
    : '';
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/>${mar}</w:tcPr>${first}</w:tc>` +
    '<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'
  );
}

function part(name: string, xml: string): OoxmlPart {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}

function drawingLayout(owner: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(owner);
  return {
    ownerPartName: owner.name,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? null,
    resourceOf: () => resource,
  };
}

const span = (box: LayoutBox) => [box.x, box.x + box.width];

/** Every cell box, outer cells before the cells of the tables nested in them. */
function cellBoxes(blocks: readonly BlockFragmentRecord[]): number[][] {
  return blocks.flatMap((block) =>
    block.kind === 'table'
      ? block.rows.flatMap((row) =>
          row.cells.flatMap((cell) => [span(cell.box), ...cellBoxes(cell.blocks)])
        )
      : []
  );
}

/** Painted x ranges of the body's inline pictures and its cell boxes, in text coordinates. */
function bodyPictures(body: string): { pictures: number[][]; cells: number[][] } {
  const doc = part('/word/document.xml', `<w:document ${NS}><w:body>${body}</w:body></w:document>`);
  const layout = layoutSemanticDocument(doc, 1, {
    measurer,
    geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    inlineDrawingLayout: drawingLayout(doc),
    // Mode 15 puts the cell box, not the text, at the margin.
    compatibilityMode: 15,
  });
  return {
    pictures: linesOf(layout)
      .flatMap((line) => line.drawings ?? [])
      .map((drawing) => span(drawing.paintBounds)),
    cells: cellBoxes(layout.pages[0]!.fragments),
  };
}

/** The painted x range of each inline picture in a header or footer, in story coordinates. */
function storyPictures(kind: 'hdr' | 'ftr', content: string): number[][] {
  const story = part(`/word/${kind}1.xml`, `<w:${kind} ${NS}>${content}</w:${kind}>`);
  const layout = layoutHeaderFooterStory(
    story,
    468,
    measurer,
    'test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    drawingLayout(story),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
      storyDistance: 36,
    }
  );
  const drawings: InlineDrawingRecord[] = [];
  const walk = (blocks: typeof layout.fragments): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks, true)) {
      for (const line of fragment.lines) drawings.push(...(line.drawings ?? []));
    }
  };
  walk(layout.fragments);
  return drawings.map((drawing) => span(drawing.paintBounds));
}

test('a header or footer picture wider than the text paints to the paper edge', () => {
  // 600pt from the left margin: the text ends at 468, the paper at 540.
  expect(storyPictures('hdr', picture(600))).toEqual([[0, 540]]);
  expect(storyPictures('ftr', picture(600))).toEqual([[0, 540]]);
  // Centered and right-aligned pictures wider than the text start at the left margin.
  expect(storyPictures('hdr', picture(600, '<w:jc w:val="center"/>'))).toEqual([[0, 540]]);
  expect(storyPictures('hdr', picture(600, '<w:jc w:val="right"/>'))).toEqual([[0, 540]]);
  // A negative right indent lets a 500pt picture end 32pt into the right margin.
  expect(storyPictures('ftr', picture(500, '<w:ind w:right="-800"/>'))).toEqual([[0, 500]]);
});

test('a header picture with a negative indent paints into the left margin up to the paper', () => {
  expect(storyPictures('hdr', picture(300, '<w:ind w:left="-800"/>'))).toEqual([[-40, 260]]);
  // At -100pt the picture would start 28pt off the sheet; the paper edge crops it.
  expect(storyPictures('hdr', picture(300, '<w:ind w:left="-2000"/>'))).toEqual([[-72, 200]]);
});

test('a picture in a header table cell crops at the cell box, not the paper', () => {
  // The story takes the legacy table origin: an unstyled table with no indent keeps its
  // 180pt cell box on the text column, so the picture starts one cell margin in and ends
  // at the cell box.
  const [cell] = storyPictures('hdr', table(picture(300)));
  expect(cell![0]).toBeCloseTo(5.4, 5);
  expect(cell![1]).toBeCloseTo(180, 5);
});

test('a picture in a fixed cell crops at the cell box, margins included', () => {
  // Default 5.4pt margins: the text column ends 5.4pt before the cell box does.
  const plain = bodyPictures(table(picture(300)));
  const [left, right] = plain.cells[0]!;
  expect([left, right]).toEqual([0, 180]);
  expect(plain.pictures).toEqual([[left! + 5.4, right!]]);
  // 36pt margins: the text ends 36pt before the cell box, the picture paints to the box.
  const wide = bodyPictures(table(picture(300), [720, 720]));
  expect(wide.cells[0]).toEqual([0, 180]);
  expect(wide.pictures).toEqual([[left! + 36, right!]]);
});

test('a picture with a negative indent in a cell crops at the cell left edge', () => {
  const plain = bodyPictures(table(picture(300, '<w:ind w:left="-800"/>')));
  expect(plain.pictures).toEqual([plain.cells[0]!]);
  const wide = bodyPictures(table(picture(300, '<w:ind w:left="-1440"/>'), [720, 720]));
  expect(wide.pictures).toEqual([wide.cells[0]!]);
});

test('a picture in a nested cell crops at the nested cell box', () => {
  const inner =
    '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>' +
    `<w:tcMar><w:left w:w="720" w:type="dxa"/><w:right w:w="720" w:type="dxa"/></w:tcMar></w:tcPr>${picture(300)}` +
    '</w:tc></w:tr></w:tbl><w:p/>';
  const nested = bodyPictures(table(inner));
  // Outer cell, its nested cell, then the second outer cell.
  const [left, right] = nested.cells[1]!;
  expect(right! - left!).toBeCloseTo(100, 5);
  expect(nested.pictures).toEqual([[left! + 36, right!]]);
});
