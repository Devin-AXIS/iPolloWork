// Text box members of a drawing group: each member's story lays out in its scaled member box,
// with its own insets and vertical anchor, and every story walk reaches it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  forEachSemanticSpan,
  layoutSemanticDocument,
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
  type SemanticLayout,
} from '../index.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import type { GroupTextboxStoryRecord } from '../group-textbox-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import type { DrawingProjection } from '../../store/package/drawing-projection.ts';
import { wrapFootprintProjection } from '../../store/package/drawing-wrap-footprint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS =
  `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" ` +
  `xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:mc="${MC}"`;

const measurer = createFixedMeasurer(6, 14);
const PT = 12_700;
const MARGIN = 72;
const DEFAULT_BODY =
  '<wps:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720"><a:noAutofit/></wps:bodyPr>';

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const picture = (x: number, y: number, cx: number, cy: number) =>
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="P"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

function textbox(
  x: number,
  y: number,
  cx: number,
  cy: number,
  content: string,
  options: { readonly bodyPr?: string; readonly xfrm?: string; readonly fill?: string } = {}
): string {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="T"/><wps:cNvSpPr txBox="1"/><wps:spPr>' +
    `<a:xfrm${options.xfrm ?? ''}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${options.fill ?? ''}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    `${options.bodyPr ?? DEFAULT_BODY}</wps:wsp>`
  );
}

interface GroupOptions {
  readonly widthPt?: number;
  readonly heightPt?: number;
  /** Child extent in points; defaults to the group extent (no scaling). */
  readonly childWidthPt?: number;
  readonly childHeightPt?: number;
  readonly inline?: boolean;
}

/** A group under `mc:AlternateContent`, anchored at page (100pt, 100pt) unless inline. */
function group(members: string, options: GroupOptions = {}): string {
  const cx = (options.widthPt ?? 200) * PT;
  const cy = (options.heightPt ?? 100) * PT;
  const chx = (options.childWidthPt ?? options.widthPt ?? 200) * PT;
  const chy = (options.childHeightPt ?? options.heightPt ?? 100) * PT;
  const graphic =
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${chx}" cy="${chy}"/></a:xfrm></wpg:grpSpPr>` +
    `${members}</wpg:wgp></a:graphicData></a:graphic>`;
  const drawing = options.inline
    ? '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="1" name="G"/><wp:cNvGraphicFramePr/>${graphic}</wp:inline>`
    : '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1"' +
      ' behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
      `<wp:positionH relativeFrom="page"><wp:posOffset>${100 * PT}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="page"><wp:posOffset>${100 * PT}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
      `<wp:docPr id="1" name="G"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor>`;
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>${drawing}</w:drawing>` +
    '</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function documentPart(run: string): OoxmlPart {
  const doc = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${run}<w:r><w:t>Anchor</w:t></w:r></w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!doc.ok) throw new Error(doc.reason);
  return doc.part;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
}

function layoutBody(run: string, footprint = false): SemanticLayout {
  const part = documentPart(run);
  const context = drawingLayoutFor(part);
  // A group whose picture fails under mc:AlternateContent keeps only its wrap footprint.
  const asFootprint = (projection: DrawingProjection | null) =>
    footprint && projection ? wrapFootprintProjection(projection) : projection;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    inlineDrawingLayout: {
      ...context,
      projectionForAtom: (atomId) => asFootprint(context.projectionForAtom(atomId)),
      project: (node) => asFootprint(context.project(node)),
    },
  });
}

function anchored(run: string): AnchoredDrawingRecord {
  const record = layoutBody(run).pages[0]!.anchoredDrawings?.[0];
  if (!record) throw new Error('no anchored drawing');
  return record;
}

function memberLines(record: InlineDrawingRecord | AnchoredDrawingRecord, index = 0): string[] {
  const story = record.groupTextboxStories?.[index]?.story;
  return paragraphFragmentsOfBlocks(story?.fragments ?? [], true).flatMap((fragment) =>
    fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
  );
}

function memberLinesOf(member: GroupTextboxStoryRecord): string[] {
  return paragraphFragmentsOfBlocks(member.story.fragments, true).flatMap((fragment) =>
    fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
  );
}

// 'aaaa bbbb cccc dddd' is 19 characters: wider than 85.6pt at the fixed advance.
const WORDS = 'aaaa bbbb cccc dddd';

describe('group text box members', () => {
  test('a member next to a picture lays out in its member box with its insets', () => {
    const record = anchored(
      group(
        picture(0, 0, 100 * PT, 100 * PT) + textbox(100 * PT, 0, 100 * PT, 100 * PT, para(WORDS))
      )
    );
    const [member] = record.groupTextboxStories!;
    expect(member!.box).toEqual({ x: 100, y: 0, width: 100, height: 100 });
    expect(member!.story.contentOffset).toEqual({ x: 7.2, y: 3.6 });
    expect(member!.story.contentWidth).toBeCloseTo(100 - 14.4, 6);
    expect(memberLines(record).length).toBeGreaterThan(1);
    expect(memberLines(record).join('')).toBe(WORDS);
  });

  test('a scaled group scales the member box, never the insets or the text', () => {
    const scaled = anchored(
      group(textbox(200 * PT, 0, 200 * PT, 200 * PT, para(WORDS)), {
        childWidthPt: 400,
        childHeightPt: 200,
      })
    );
    const unscaled = anchored(group(textbox(100 * PT, 0, 100 * PT, 100 * PT, para(WORDS))));
    const [member] = scaled.groupTextboxStories!;
    expect(member!.box).toEqual({ x: 100, y: 0, width: 100, height: 100 });
    expect(member!.story.contentOffset).toEqual({ x: 7.2, y: 3.6 });
    expect(memberLines(scaled)).toEqual(memberLines(unscaled));
  });

  test('a member with large insets and a center anchor centers its text', () => {
    const record = anchored(
      group(
        textbox(100 * PT, 0, 100 * PT, 100 * PT, para('ab'), {
          bodyPr:
            '<wps:bodyPr wrap="square" lIns="228600" tIns="228600" rIns="228600" bIns="228600" anchor="ctr"><a:noAutofit/></wps:bodyPr>',
        })
      )
    );
    const story = record.groupTextboxStories![0]!.story;
    expect(story.contentWidth).toBeCloseTo(64, 6);
    expect(story.contentOffset.x).toBeCloseTo(18, 6);
    expect(story.contentOffset.y).toBeCloseTo(18 + (64 - story.flowHeight) / 2, 6);
  });

  test('an unwrapped member keeps each paragraph on one line', () => {
    const record = anchored(
      group(
        textbox(100 * PT, 0, 20 * PT, 100 * PT, para(WORDS), {
          bodyPr: '<wps:bodyPr wrap="none"><a:spAutoFit/></wps:bodyPr>',
        })
      )
    );
    expect(memberLines(record)).toEqual([WORDS]);
    // The member box stays the group's: the group frame is fixed.
    expect(record.groupTextboxStories![0]!.box.width).toBe(20);
  });

  test('an inline group carries its member story on the line', () => {
    const layout = layoutBody(
      group(
        picture(0, 0, 100 * PT, 100 * PT) + textbox(100 * PT, 0, 100 * PT, 100 * PT, para(WORDS)),
        {
          inline: true,
        }
      )
    );
    const drawing = paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true)
      .flatMap((fragment) => fragment.lines)
      .flatMap((line) => line.drawings ?? [])[0]!;
    expect(drawing.width).toBe(200);
    expect(memberLines(drawing).join('')).toBe(WORDS);
  });

  test('a rotated or flipped member lays out upright and records the turn of its text', () => {
    const turnOf = (xfrm: string) =>
      anchored(
        group(
          picture(0, 0, 100 * PT, 100 * PT) +
            textbox(100 * PT, 0, 100 * PT, 100 * PT, para(WORDS), { xfrm })
        )
      ).groupTextboxStories?.[0];
    const upright = turnOf('')!;
    for (const [xfrm, turn] of [
      [' rot="5400000"', 90],
      [' rot="1800000"', 30],
      [' rot="-5400000"', 270],
      // A horizontal flip keeps the reading direction; a vertical one turns the text over.
      [' flipH="1"', 0],
      [' flipV="1"', 180],
      [' rot="5400000" flipV="1"', 270],
    ] as const) {
      const member = turnOf(xfrm)!;
      expect(member.rotationDegrees).toBe(turn);
      expect(member.box).toEqual(upright.box);
      expect(memberLinesOf(member)).toEqual(memberLinesOf(upright));
    }
    expect(turnOf(' rot="ninety"')).toBeUndefined();
  });

  test('paint turns a rotated member about its box center', () => {
    const container = document.createElement('div');
    paintSemanticLayout(
      container,
      layoutBody(
        group(
          picture(0, 0, 100 * PT, 100 * PT) +
            textbox(100 * PT, 0, 100 * PT, 100 * PT, para('ab'), { xfrm: ' rot="5400000"' })
        )
      ),
      { scale: 1 }
    );
    const content = container.querySelector<HTMLElement>(
      '.docx-drawing-group-text .docx-drawing-textbox-content'
    )!;
    expect(content.style.transform).toBe('rotate(90deg)');
    // Center of the 100pt member box, less the 7.2pt and 3.6pt insets.
    expect(content.style.transformOrigin).toBe('42.8px 46.4px');
  });

  test('a group that cannot paint whole lays out no member text', () => {
    // A nested group member is past the one-level cap, so the group refuses to paint.
    const nested = `<wpg:grpSp><wpg:cNvGrpSpPr/><wpg:grpSpPr/></wpg:grpSp>`;
    const record = layoutBody(
      group(
        picture(0, 0, 100 * PT, 100 * PT) +
          nested +
          textbox(100 * PT, 0, 100 * PT, 100 * PT, para(WORDS))
      )
    ).pages[0]!.anchoredDrawings?.[0];
    expect(record?.groupTextboxStories).toBeUndefined();
  });

  test('a wrap footprint of the group carries no member text', () => {
    const layout = layoutBody(
      group(
        picture(0, 0, 100 * PT, 100 * PT) + textbox(100 * PT, 0, 100 * PT, 100 * PT, para('ab'))
      ).replace('<wp:wrapNone/>', '<wp:wrapSquare wrapText="bothSides"/>'),
      true
    );
    const record = layout.pages[0]!.anchoredDrawings![0]!;
    expect(record.accessibility.hidden).toBe(true);
    expect(record.groupTextboxStories).toBeUndefined();
    const texts: string[] = [];
    forEachSemanticSpan(layout, (visit) => texts.push(visit.span.text));
    expect(texts).not.toContain('ab');
  });

  test('span walks reach member text at its painted position', () => {
    const layout = layoutBody(
      group(
        picture(0, 0, 100 * PT, 100 * PT) + textbox(100 * PT, 0, 100 * PT, 100 * PT, para('ab'))
      )
    );
    const visits: { text: string; x: number; y: number; depth: number }[] = [];
    forEachSemanticSpan(layout, (visit) => {
      if (visit.span.text === 'ab')
        visits.push({
          text: visit.span.text,
          x: visit.absoluteBox.x,
          y: visit.absoluteBox.y,
          depth: visit.textboxDepth,
        });
    });
    expect(visits).toHaveLength(1);
    expect(visits[0]!.depth).toBe(1);
    // Page coordinates: group at 100pt, member at 100pt inside it, then the 7.2pt inset.
    expect(visits[0]!.x).toBeCloseTo(100 + 100 + 7.2, 3);
    expect(visits[0]!.y).toBeCloseTo(100 + 3.6, 3);
    expect(layout.pages[0]!.anchoredDrawings![0]!.x + MARGIN).toBeCloseTo(100, 3);
  });

  test('paint draws member text in a read-only layer over the group', () => {
    const container = document.createElement('div');
    paintSemanticLayout(
      container,
      layoutBody(
        group(
          picture(0, 0, 100 * PT, 100 * PT) + textbox(100 * PT, 0, 100 * PT, 100 * PT, para('ab'))
        )
      ),
      { scale: 1 }
    );
    const layer = container.querySelector<HTMLElement>('.docx-drawing-group-text');
    expect(layer?.textContent).toBe('ab');
    expect(layer!.querySelectorAll('[data-paragraph-id]')).toHaveLength(0);
    const content = layer!.querySelector<HTMLElement>('.docx-drawing-textbox-content')!;
    expect(parseFloat(content.style.left)).toBeCloseTo(107.2, 3);
    expect(parseFloat(content.style.top)).toBeCloseTo(3.6, 3);
  });
});
