// A wrapTopAndBottom anchor clears its band for every line on the page it crosses, behind the
// text or not, and the band sits where the drawing does.

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
import { collectExclusionZonesByPage } from '../drawing-exclusion.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type PageRecord } from '../semantic-records.ts';
import { topAndBottomBandAnchorY } from '../top-and-bottom-clearance.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
const CONTENT_WIDTH_PT = 468;
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

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function context(part: OoxmlPart): InlineDrawingLayoutContext {
  const atoms = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (id) => atoms.get(id) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}
/**
 * A box 28.8pt below its paragraph's top, behind a title in three runs, then `following` short
 * paragraphs.
 */
function doc(options: {
  readonly behindDoc: string;
  readonly following: number;
  readonly wrap?: string;
  readonly lead?: string;
}): string {
  let tail = '';
  for (let i = 0; i < options.following; i += 1)
    tail += `<w:p><w:r><w:t>after ${i}</w:t></w:r></w:p>`;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    '<w:p>' +
    (options.lead ? `<w:r><w:t xml:space="preserve">${options.lead}</w:t></w:r>` : '') +
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>365760</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="542925"/><wp:effectExtent l="0" t="12700" r="0" b="15875"/>' +
    (options.wrap ?? '<wp:wrapTopAndBottom/>') +
    '<wp:docPr id="1" name="band"/>' +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="542925"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r><w:r><w:t>ALPHAS</w:t></w:r><w:r><w:t xml:space="preserve"> 1234: </w:t></w:r><w:r><w:t>SPECIMEN PLACEHOLDERS</w:t></w:r></w:p>' +
    tail +
    '</w:body></w:document>'
  );
}

function lineTops(page: PageRecord): readonly number[] {
  return paragraphFragmentsOf(page).flatMap((fragment) => fragment.lines.map((line) => line.box.y));
}

function layoutOf(xml: string, cache?: ReturnType<typeof createParagraphLayoutCache>) {
  const part = load(xml);
  const inlineDrawingLayout = context(part);
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout,
    ...(cache ? { cache, producer: 'top-and-bottom' } : {}),
  });
  return { part, inlineDrawingLayout, layout };
}

describe('a topAndBottom band clears the lines of the paragraphs after its anchor', () => {
  // Band: 28.8pt below the paragraph, 42.75pt tall, 1pt and 1.25pt of effect extent.
  const BAND_TOP = 28.8 - 1;
  const BAND_BOTTOM = 28.8 + 42.75 + 1.25;

  for (const behindDoc of ['0', '1']) {
    test(`no line crosses the band (behindDoc=${behindDoc})`, () => {
      const { layout } = layoutOf(doc({ behindDoc, following: 6 }));
      const page = layout.pages[0]!;
      const drawing = page.anchoredDrawings![0]!;
      expect(drawing.y).toBeCloseTo(28.8, 3);
      for (const fragment of paragraphFragmentsOf(page)) {
        for (const line of fragment.lines) {
          const crosses =
            line.box.y < BAND_BOTTOM - 0.001 && line.box.y + line.box.height > BAND_TOP + 0.001;
          expect(crosses).toBe(false);
        }
      }
      const tops = lineTops(page);
      // The anchor's own line and the next paragraph fit above the band and stay where they are;
      // the paragraph that would cross it starts at its bottom edge.
      expect(tops[0]).toBeCloseTo(0, 3);
      expect(tops[1]).toBeCloseTo(paragraphFragmentsOf(page)[0]!.lines[0]!.box.height, 3);
      expect(tops[2]).toBeCloseTo(BAND_BOTTOM, 3);
    });
  }

  test('the text after the anchor stays on its line when the band starts below it', () => {
    const page = layoutOf(doc({ behindDoc: '1', following: 2 })).layout.pages[0]!;
    const anchorParagraph = paragraphFragmentsOf(page)[0]!;
    expect(anchorParagraph.lines).toHaveLength(1);
    expect(anchorParagraph.lines[0]!.spans.map((span) => span.text).join('')).toBe(
      'ALPHAS 1234: SPECIMEN PLACEHOLDERS'
    );
  });

  test('behindDoc changes the paint layer, not the lines', () => {
    const front = layoutOf(doc({ behindDoc: '0', following: 6 })).layout.pages[0]!;
    const behind = layoutOf(doc({ behindDoc: '1', following: 6 })).layout.pages[0]!;
    expect(lineTops(behind)).toEqual(lineTops(front));
    expect(behind.anchoredDrawings![0]!.behindDocument).toBe(true);
  });

  test('a band behind the text publishes its exclusion zone', () => {
    const { layout, inlineDrawingLayout } = layoutOf(doc({ behindDoc: '1', following: 2 }));
    const zones = collectExclusionZonesByPage(layout.pages, inlineDrawingLayout, CONTENT_WIDTH_PT);
    const zone = zones.get(0)![0]!;
    expect(zone.input.mode).toBe('topAndBottom');
    expect(zone.paintLayer).toBe('behind');
    expect(zone.verticalBand.y).toBeCloseTo(BAND_TOP, 3);
    expect(zone.verticalBand.y + zone.verticalBand.height).toBeCloseTo(BAND_BOTTOM, 3);
  });

  test('an anchor on a later line keeps a paragraph-framed band where the drawing is', () => {
    // Two lines of text before the anchor: the band still measures from the paragraph's top.
    for (const behindDoc of ['0', '1']) {
      const page = layoutOf(doc({ behindDoc, following: 2, lead: 'word '.repeat(30) })).layout
        .pages[0]!;
      expect(page.anchoredDrawings![0]!.y).toBeCloseTo(28.8, 3);
      const lines = paragraphFragmentsOf(page).flatMap((fragment) => fragment.lines);
      for (const line of lines) {
        const crosses =
          line.box.y < BAND_BOTTOM - 0.001 && line.box.y + line.box.height > BAND_TOP + 0.001;
        expect(crosses).toBe(false);
      }
      // The anchor's own paragraph wraps its last line below the band.
      expect(lines[2]!.spans.map((span) => span.text).join('')).toBe('SPECIMEN PLACEHOLDERS');
      expect(lines[2]!.box.y).toBeCloseTo(BAND_BOTTOM, 3);
    }
  });

  test('a paragraph frame measures from the paragraph, a line frame from the line', () => {
    const vertical = (relativeFrom: string) =>
      Object.freeze({ relativeFrom, align: null, offsetEmu: 127000 });
    expect(topAndBottomBandAnchorY(30, vertical('paragraph'), 5)).toBeCloseTo(15, 6);
    expect(topAndBottomBandAnchorY(30, vertical('line'), 5)).toBeCloseTo(40, 6);
    expect(topAndBottomBandAnchorY(30, vertical('page'), 5)).toBe(30);
  });

  test('the cached relayout places every line where the cold one did', () => {
    const xml = doc({ behindDoc: '1', following: 40 });
    const cold = layoutOf(xml).layout.pages.map(lineTops);
    const cache = createParagraphLayoutCache();
    layoutOf(xml, cache);
    const warm = layoutOf(xml, cache).layout.pages.map(lineTops);
    expect(warm).toEqual(cold);
  });
});
