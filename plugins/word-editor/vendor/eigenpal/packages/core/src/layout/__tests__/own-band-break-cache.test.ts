// A paragraph whose own top-and-bottom band sits at a fixed page position breaks its lines
// around that band by where the paragraph starts. The band is synthesized during the break,
// so it is in no exclusion token, and the break cache must key the paragraph's start Y (and
// the room below it) itself: an edit above the paragraph moves it, and a cached break from
// the old position put its lines on the wrong side of the band.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../pending-line.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const measurer = createFixedMeasurer(6, 14);

/** A 72 pt band, framed by `relativeFrom`, 300 pt below that frame's top. */
function band(relativeFrom: 'page' | 'margin'): string {
  const offset = Math.round((relativeFrom === 'page' ? 300 : 228) * 12_700);
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${relativeFrom}"><wp:posOffset>${offset}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="914400" cy="914400"/><wp:wrapTopAndBottom distT="0" distB="0"/>' +
    '<wp:docPr id="1" name="band"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/** Ten short paragraphs, then one long paragraph that anchors the band and runs across it. */
function documentXml(first: string, relativeFrom: 'page' | 'margin'): string {
  const short = Array.from(
    { length: 9 },
    (_, index) => `<w:p><w:r><w:t>P${index + 1}</w:t></w:r></w:p>`
  );
  const long = Array.from({ length: 300 }, (_, index) => `w${index}`).join(' ');
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t xml:space="preserve">${first}</w:t></w:r></w:p>${short.join('')}` +
    `<w:p>${band(relativeFrom)}<w:r><w:t xml:space="preserve">${long}</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>'
  );
}

function lineShape(
  xml: string,
  revision: number,
  cache?: ReturnType<typeof createParagraphLayoutCache<readonly PendingLine[]>>
) {
  const part = load(xml);
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    // One pass with no published page zones: the paragraph synthesizes its own band during
    // the break, so no exclusion token carries the band into the key.
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map(),
    ...(cache ? { cache } : {}),
  });
  return linesOf(layout).map((line) => ({
    y: line.box.y,
    text: line.spans.map((span) => span.text).join(''),
  }));
}

describe('a page-framed band of the paragraph itself', () => {
  for (const relativeFrom of ['page', 'margin'] as const) {
    test(`${relativeFrom}-framed: an edit above relays out like a cold layout`, () => {
      const cache = createParagraphLayoutCache<readonly PendingLine[]>();
      const before = documentXml('Short', relativeFrom);
      // One more line above moves the anchor paragraph down by one line pitch.
      const after = documentXml('x'.repeat(100), relativeFrom);
      lineShape(before, 1, cache);
      const warm = lineShape(after, 2, cache);
      const cold = lineShape(after, 2);
      expect(warm).toEqual(cold);
    });
  }
});
