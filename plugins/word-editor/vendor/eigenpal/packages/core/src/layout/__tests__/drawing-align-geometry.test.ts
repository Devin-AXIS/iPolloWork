// Paragraph alignment and cell vAlign must move a drawing's geometry with its boxes.
// Paint derives the image frame from `geometry.contentBounds - paintBounds` and the CSS
// clip-path from `geometry.clipPolygon` normalized against `paintBounds`; a record whose
// geometry stays at the pre-shift position clips its own image out of view entirely.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import { linesOf } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext, InlineDrawingRecord } from '../drawing-layout.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k-ready',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

function inlinePictureRun(): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="381000" cy="381000"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

const TEXT_AND_SPACE = '<w:r><w:t>x</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
const TERMINAL_FILL = `<w:r><w:t xml:space="preserve">${'\u3000'.repeat(80)}</w:t></w:r>`;

function documentXml(body: string): string {
  return `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;
}

function layoutOf(xml: string) {
  const parsed = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason);
  const atomProjections = indexInlineDrawingProjectionsInPart(parsed.part);
  const inlineDrawingLayout: InlineDrawingLayoutContext = Object.freeze({
    ownerPartName: OWNER,
    projectionForAtom: (atomId: string) => atomProjections.get(atomId) ?? null,
    project: (node: import('../../store/package/ooxml-tree.ts').OoxmlDrawingNode) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  });
  return layoutSemanticDocument(parsed.part, 1, { measurer, inlineDrawingLayout });
}

function firstDrawing(layout: ReturnType<typeof layoutOf>): InlineDrawingRecord {
  for (const line of linesOf(layout)) {
    if (line.drawings && line.drawings.length > 0) return line.drawings[0]!;
  }
  throw new Error('no inline drawing laid out');
}

function expectGeometryTracksBounds(drawing: InlineDrawingRecord): void {
  expect(drawing.geometry.paintBounds.x).toBeCloseTo(drawing.paintBounds.x, 3);
  expect(drawing.geometry.paintBounds.y).toBeCloseTo(drawing.paintBounds.y, 3);
  expect(drawing.geometry.contentBounds.x).toBeCloseTo(drawing.x, 3);
  expect(drawing.geometry.contentBounds.y).toBeCloseTo(drawing.y, 3);
}

describe('inline drawing geometry tracks alignment shifts', () => {
  test('a drawing moved into the second body column keeps non-empty paint bounds', () => {
    const preceding = Array.from(
      { length: 60 },
      (_, index) => `<w:p><w:r><w:t>line ${index}</w:t></w:r></w:p>`
    ).join('');
    const layout = layoutOf(
      documentXml(
        preceding +
          `<w:p>${inlinePictureRun()}</w:p>` +
          '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>'
      )
    );
    const drawing = firstDrawing(layout);
    expect(drawing.x).toBeGreaterThan(200);
    expect(drawing.paintBounds.width).toBeCloseTo(drawing.width, 3);
    expect(drawing.paintBounds.height).toBeCloseTo(drawing.height, 3);
    expectGeometryTracksBounds(drawing);
  });

  test('a drawing in a later table cell keeps geometry translated with its record', () => {
    const layout = layoutOf(
      documentXml(
        '<w:tbl><w:tblGrid><w:gridCol w:w="2340"/><w:gridCol w:w="2340"/></w:tblGrid>' +
          '<w:tr><w:tc><w:tcPr><w:tcW w:w="2340" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>left</w:t></w:r></w:p></w:tc>' +
          `<w:tc><w:tcPr><w:tcW w:w="2340" w:type="dxa"/></w:tcPr><w:p>${inlinePictureRun()}</w:p></w:tc></w:tr></w:tbl>`
      )
    );
    const drawing = firstDrawing(layout);
    expect(drawing.x).toBeGreaterThan(100);
    expect(drawing.paintBounds.width).toBeCloseTo(drawing.width, 3);
    expectGeometryTracksBounds(drawing);
  });

  test('centered body paragraph keeps geometry in the aligned space', () => {
    const layout = layoutOf(
      documentXml(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${inlinePictureRun()}</w:p>`)
    );
    const drawing = firstDrawing(layout);
    // Centering must actually move the drawing off the left edge for this test to bite.
    expect(drawing.paintBounds.x).toBeGreaterThan(50);
    expectGeometryTracksBounds(drawing);
  });

  test('right-aligned body paragraph keeps geometry in the aligned space', () => {
    const layout = layoutOf(
      documentXml(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${inlinePictureRun()}</w:p>`)
    );
    const drawing = firstDrawing(layout);
    expect(drawing.paintBounds.x).toBeGreaterThan(50);
    expectGeometryTracksBounds(drawing);
  });

  for (const alignment of ['center', 'right'] as const) {
    test(`${alignment} alignment counts a drawing after a pure whitespace run`, () => {
      const body = layoutOf(
        documentXml(
          `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
            `${TEXT_AND_SPACE}${inlinePictureRun()}</w:p>`
        )
      );
      const table = layoutOf(
        documentXml(
          '<w:tbl><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc>' +
            `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
            `${TEXT_AND_SPACE}${inlinePictureRun()}</w:p>` +
            '</w:tc></w:tr></w:tbl><w:p/>'
        )
      );

      for (const layout of [body, table]) {
        const line = linesOf(layout).find((candidate) => candidate.drawings?.length)!;
        const drawing = line.drawings![0]!;
        const rightEdge = line.box.x + line.box.width;
        if (alignment === 'right') expect(drawing.advanceEnd).toBeCloseTo(rightEdge, 5);
        else {
          const leading = line.spans[0]!.box.x - line.box.x;
          expect(leading).toBeCloseTo(rightEdge - drawing.advanceEnd, 5);
        }
        expectGeometryTracksBounds(drawing);
      }
    });

    test(`${alignment} alignment keeps an interleaved drawing before the terminal fill`, () => {
      const paragraph =
        `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
        `${TEXT_AND_SPACE}${inlinePictureRun()}${TERMINAL_FILL}</w:p>`;
      const body = layoutOf(documentXml(paragraph));
      const table = layoutOf(
        documentXml(
          '<w:tbl><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc>' +
            paragraph +
            '</w:tc></w:tr></w:tbl><w:p/>'
        )
      );

      for (const layout of [body, table]) {
        const line = linesOf(layout).find((candidate) => candidate.drawings?.length)!;
        const drawing = line.drawings![0]!;
        const fill = line.spans.find((span) => span.lineEndWhitespace)!;
        const rightEdge = line.box.x + line.box.width;
        const visibleWidth = drawing.advanceEnd - line.spans[0]!.box.x;
        const expectedLeading =
          alignment === 'center'
            ? (line.box.width - visibleWidth) / 2
            : line.box.width - visibleWidth;

        expect(line.spans[0]!.box.x - line.box.x).toBeCloseTo(expectedLeading, 5);
        expect(fill.box.x).toBeGreaterThanOrEqual(drawing.advanceEnd - 0.001);
        expect(fill.box.x + fill.box.width).toBeCloseTo(rightEdge, 5);
        expectGeometryTracksBounds(drawing);
      }
    });
  }

  test('centered paragraph inside a table cell keeps geometry in the aligned space', () => {
    const layout = layoutOf(
      documentXml(
        '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="4680"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>' +
          '<w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4680"/></w:tcPr>' +
          `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${inlinePictureRun()}</w:p>` +
          '</w:tc></w:tr></w:tbl><w:p/>'
      )
    );
    const drawing = firstDrawing(layout);
    expect(drawing.paintBounds.x).toBeGreaterThan(50);
    expectGeometryTracksBounds(drawing);
  });

  test('vAlign=center cell keeps geometry in the shifted space', () => {
    const layout = layoutOf(
      documentXml(
        '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="4680"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>' +
          '<w:tr><w:trPr><w:trHeight w:val="4000" w:hRule="atLeast"/></w:trPr>' +
          '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4680"/><w:vAlign w:val="center"/></w:tcPr>' +
          `<w:p>${inlinePictureRun()}</w:p>` +
          '</w:tc></w:tr></w:tbl><w:p/>'
      )
    );
    const drawing = firstDrawing(layout);
    // The vAlign shift must actually move the paragraph down for this test to bite.
    expect(drawing.paintBounds.y).toBeGreaterThan(20);
    expectGeometryTracksBounds(drawing);
  });
});
