// A wrapping drawing that `wp:positionV relativeFrom="paragraph"` lifts above its anchor with a
// negative `wp:posOffset`.
//
// - In modern modes the drawing never starts above the content box top; a `wrapNone` drawing
//   and every drawing in legacy modes keep the authored offset.
// - A top-and-bottom band that crosses lines before its anchor moves those lines below it. The
//   drawing keeps the position its paragraph had before the push; lines above the band stay.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../pending-line.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/** The picture is 72pt tall and sits right of the text. */
const measurer = createFixedMeasurer(6, 14);
const EMU = 12_700;

type Wrap = 'square' | 'topAndBottom' | 'none';

function anchorRun(offsetPt: number, wrap: Wrap): string {
  const wrapXml =
    wrap === 'square'
      ? '<wp:wrapSquare wrapText="bothSides"/>'
      : wrap === 'topAndBottom'
        ? '<wp:wrapTopAndBottom/>'
        : '<wp:wrapNone/>';
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${300 * EMU}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(offsetPt * EMU)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${72 * EMU}" cy="${72 * EMU}"/>` +
    wrapXml +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${72 * EMU}" cy="${72 * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/** Every line is exactly 14pt, so line tops are multiples of 14. */
const PPR = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
const plain = (text: string) => `<w:p>${PPR}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function documentXml(options: {
  readonly offsetPt: number;
  readonly wrap: Wrap;
  readonly before: readonly string[];
}): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body>' +
    options.before.map(plain).join('') +
    `<w:p>${PPR}${anchorRun(options.offsetPt, options.wrap)}<w:r><w:t>Anchor</w:t></w:r></w:p>` +
    plain('After') +
    '</w:body></w:document>'
  );
}

function lay(
  xml: string,
  compatibilityMode: number,
  extra: Partial<Parameters<typeof layoutSemanticDocument>[2]> = {}
): SemanticLayout {
  const part = load(xml);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    compatibilityMode,
    ...extra,
  });
}

function placed(layout: SemanticLayout) {
  const page = layout.pages[0]!;
  const lineTop = (text: string) => {
    for (const fragment of paragraphFragmentsOf(page))
      for (const line of fragment.lines)
        if (line.spans.some((span) => span.text.includes(text))) return line.box.y;
    throw new Error(`no line with ${text}`);
  };
  return { drawing: page.anchoredDrawings![0]!, lineTop };
}

describe('a wrapping drawing lifted above its paragraph', () => {
  test('stops at the content box top in a modern mode', () => {
    for (const wrap of ['square', 'topAndBottom'] as const) {
      const { drawing, lineTop } = placed(
        lay(documentXml({ offsetPt: -30, wrap, before: [] }), 15)
      );
      expect(drawing.y).toBeCloseTo(0, 3);
      expect(lineTop('Anchor')).toBeCloseTo(wrap === 'square' ? 0 : 72, 3);
    }
  });

  test('stops at the content box top when its anchor follows other paragraphs', () => {
    const { drawing, lineTop } = placed(
      lay(documentXml({ offsetPt: -40, wrap: 'square', before: ['One', 'Two'] }), 15)
    );
    expect(drawing.y).toBeCloseTo(0, 3);
    expect(lineTop('One')).toBeCloseTo(0, 3);
    expect(lineTop('Anchor')).toBeCloseTo(28, 3);
  });

  test('keeps the authored offset in a legacy mode', () => {
    for (const mode of [12, 14]) {
      const { drawing, lineTop } = placed(
        lay(documentXml({ offsetPt: -30, wrap: 'topAndBottom', before: [] }), mode)
      );
      expect(drawing.y).toBeCloseTo(-30, 3);
      expect(lineTop('Anchor')).toBeCloseTo(42, 3);
    }
  });

  test('keeps the authored offset without wrapping', () => {
    const { drawing, lineTop } = placed(
      lay(documentXml({ offsetPt: -30, wrap: 'none', before: [] }), 15)
    );
    expect(drawing.y).toBeCloseTo(-30, 3);
    expect(lineTop('Anchor')).toBeCloseTo(0, 3);
  });
});

describe('a top-and-bottom band over lines before its anchor', () => {
  test('moves the lines it crosses below it and keeps the lines above it', () => {
    // The anchor starts at 28, so the band covers 18..90: "Two" (14..28) moves, "One" stays.
    for (const mode of [12, 15]) {
      const { drawing, lineTop } = placed(
        lay(documentXml({ offsetPt: -10, wrap: 'topAndBottom', before: ['One', 'Two'] }), mode)
      );
      expect(drawing.y).toBeCloseTo(18, 3);
      expect(lineTop('One')).toBeCloseTo(0, 3);
      expect(lineTop('Two')).toBeCloseTo(90, 3);
      expect(lineTop('Anchor')).toBeCloseTo(104, 3);
      expect(lineTop('After')).toBeCloseTo(118, 3);
    }
  });

  test('keeps its place when every earlier line moves', () => {
    // A band at 4..76 crosses "One" and "Two"; both move below it, the drawing stays at 4.
    const { drawing, lineTop } = placed(
      lay(documentXml({ offsetPt: -24, wrap: 'topAndBottom', before: ['One', 'Two'] }), 12)
    );
    expect(drawing.y).toBeCloseTo(4, 3);
    expect(lineTop('One')).toBeCloseTo(76, 3);
    expect(lineTop('Two')).toBeCloseTo(90, 3);
    expect(lineTop('Anchor')).toBeCloseTo(104, 3);
  });

  test('a modern mode places the stopped band first, then moves the lines', () => {
    // -40 from 28 would start at -12; the band starts at the content box top instead.
    const { drawing, lineTop } = placed(
      lay(documentXml({ offsetPt: -40, wrap: 'topAndBottom', before: ['One', 'Two'] }), 15)
    );
    expect(drawing.y).toBeCloseTo(0, 3);
    expect(lineTop('One')).toBeCloseTo(72, 3);
    expect(lineTop('Anchor')).toBeCloseTo(100, 3);
  });

  test('a square band leaves the earlier lines in place', () => {
    const { drawing, lineTop } = placed(
      lay(documentXml({ offsetPt: -10, wrap: 'square', before: ['One', 'Two'] }), 12)
    );
    expect(drawing.y).toBeCloseTo(18, 3);
    expect(lineTop('Two')).toBeCloseTo(14, 3);
    expect(lineTop('Anchor')).toBeCloseTo(28, 3);
  });

  test('incremental layout repeats the cold result', () => {
    const xml = documentXml({ offsetPt: -24, wrap: 'topAndBottom', before: ['One', 'Two'] });
    const cold = lay(xml, 12);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    for (let pass = 0; pass < 2; pass += 1)
      expect(lay(xml, 12, { cache, session }).pages).toEqual(cold.pages);
  });
});
