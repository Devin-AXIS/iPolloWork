// A wrapping picture grows its cell only where it draws: on the part of a split cell paragraph
// that holds it, and only in a display mode that shows it.

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
import type { RevisionDisplayMode } from '../revision-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf, type PageGeometry, type SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 400,
  height: 400,
  margin: { top: 40, right: 20, bottom: 20, left: 20 },
};
const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 100,
  pixelHeight: 100,
  dpiX: 96,
  dpiY: 96,
});
const EMU = 12700;
const HEIGHT_PT = 60;

const PICTURE =
  '<w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
  ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${100 * EMU}" cy="${HEIGHT_PT * EMU}"/><wp:wrapSquare wrapText="bothSides"/>` +
  '<wp:docPr id="1" name="pic1"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
  '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:ext cx="${100 * EMU}" cy="${HEIGHT_PT * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>';

const cell = (content: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;

function load(paragraph: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
    `<w:tr>${cell(paragraph)}</w:tr>` +
    '</w:tbl><w:p/></w:body></w:document>';
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

function lay(paragraph: string, displayMode?: RevisionDisplayMode): SemanticLayout {
  const part = load(paragraph);
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: context(part),
    ...(displayMode ? { displayMode } : {}),
  });
}

/** Each page's first table row: its height, and the bottom of the lowest line it holds. */
function rows(layout: SemanticLayout) {
  return layout.pages.flatMap((page) => {
    const table = page.fragments.find((fragment) => fragment.kind === 'table') as unknown as
      | {
          rows: {
            box: { y: number; height: number };
            cells: { blocks: { lines?: { box: { y: number; height: number } }[] }[] }[];
          }[];
        }
      | undefined;
    const row = table?.rows[0];
    if (!row) return [];
    let textBottom = row.box.y;
    for (const block of row.cells.flatMap((each) => each.blocks)) {
      for (const line of block.lines ?? []) {
        textBottom = Math.max(textBottom, line.box.y + line.box.height);
      }
    }
    return [
      {
        height: row.box.height,
        growth: row.box.y + row.box.height - textBottom,
        drawings: anchoredDrawingsOf(page).length,
      },
    ];
  });
}

describe('a wrapping picture in a table cell', () => {
  test('grows only the part of a split cell paragraph that holds it', () => {
    // The picture opens the paragraph; the text runs a few lines onto the next page.
    const withLines = (lines: number) =>
      rows(lay(`<w:p><w:r>${PICTURE}<w:t>${'word '.repeat(10 * lines)}</w:t></w:r></w:p>`));
    let lines = 20;
    let split = withLines(lines);
    while (split.length < 2 && lines < 40) split = withLines(++lines);
    expect(split).toHaveLength(2);
    expect(split[0]!.drawings).toBe(1);
    expect(split[1]!.drawings).toBe(0);
    // The continuation holds only its text.
    expect(split[1]!.height).toBeLessThan(HEIGHT_PT);
    expect(split[1]!.growth).toBeLessThan(HEIGHT_PT / 2);
  });

  test('does not grow the cell where the display mode drops its deleted run', () => {
    const paragraph =
      '<w:p><w:r><w:t>A</w:t></w:r>' +
      `<w:del w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r>${PICTURE}</w:r></w:del>` +
      '</w:p>';
    const marked = rows(lay(paragraph, 'all-markup'))[0]!;
    expect(marked.drawings).toBe(1);
    expect(marked.height).toBeGreaterThanOrEqual(HEIGHT_PT);
    const proposed = rows(lay(paragraph, 'proposed'))[0]!;
    expect(proposed.drawings).toBe(0);
    expect(proposed.height).toBeLessThan(HEIGHT_PT);
  });
});
