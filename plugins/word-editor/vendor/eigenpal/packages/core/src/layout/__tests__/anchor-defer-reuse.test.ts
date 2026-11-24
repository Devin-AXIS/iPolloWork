// Overlap resolution can push an anchored drawing onto the NEXT page. Until that debt is paid
// it is flow state, exactly like the cursor and the open page's fragments — and it was the one
// piece of flow state a checkpoint did not carry. A resume started with an empty list, and a
// convergence called a flow that still owed the next page two drawings equal to one that owed
// it nothing, so the drawings left the document.

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
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageGeometry, SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

const GEOMETRY: PageGeometry = {
  width: 300,
  height: 300,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
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

/**
 * Anchors that MUST NOT overlap, all pinned to the same offset down the page.
 *
 * `allowOverlap="0"` (§20.4.2.3) is what makes displacement run: each one is pushed below the
 * last, and the ones that no longer fit are deferred to the next page.
 */
function anchor(index: number): string {
  return (
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ` allowOverlap="0" layoutInCell="1" relativeHeight="${index + 1}">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapNone/>' +
    `<wp:docPr id="${index + 1}" name="pic${index + 1}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    `<pic:cNvPr id="${index + 1}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  );
}

const document = (bodyText: string): string =>
  `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
  Array.from({ length: 6 }, (_, index) => anchor(index)).join('') +
  Array.from(
    { length: 30 },
    (_, index) =>
      `<w:p><w:r><w:t>${index === 12 ? bodyText : 'body'} ${index} ${'word '.repeat(8)}</w:t></w:r></w:p>`
  ).join('') +
  '</w:body></w:document>';

function load(xml: string): OoxmlPart {
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

function lay(part: OoxmlPart, session?: ReturnType<typeof createLayoutSession>): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: context(part),
    ...(session ? { session } : {}),
  });
}

/** Where the drawings ended up, page by page — the thing a deferral moves. */
const anchoredPerPage = (layout: SemanticLayout): number[] =>
  layout.pages.map((page) => page.anchoredDrawings?.length ?? 0);

describe('a deferred anchored drawing survives an incremental pass', () => {
  test('an edit above the deferral gives the same drawings as a full pass', () => {
    const session = createLayoutSession();
    const first = lay(load(document('body')), session);
    // Deferral has to be real, or the test proves nothing: some drawings must have been
    // pushed off the page they were anchored to.
    expect(first.pages.length).toBeGreaterThan(1);
    expect(
      anchoredPerPage(first)
        .slice(1)
        .reduce((sum, count) => sum + count, 0)
    ).toBeGreaterThan(0);

    const edited = load(document('edited'));
    expect(anchoredPerPage(lay(edited, session))).toEqual(anchoredPerPage(lay(edited)));
  });
});
