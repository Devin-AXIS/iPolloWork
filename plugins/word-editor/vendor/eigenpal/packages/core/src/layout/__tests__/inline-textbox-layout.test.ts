// Inline text boxes: a `wps:txbx` shape inside `wp:inline` takes its extent on the line and
// paints its story inside that extent, the same story layout an anchored text box uses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  forEachSemanticDrawing,
  forEachSemanticSpan,
  layoutSemanticDocument,
  type InlineDrawingRecord,
  geometryOfSection,
  type BlockFragmentRecord,
  type LineRecord,
  type SemanticLayout,
} from '../index.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import {
  readOoxmlPackage,
  readOoxmlPart,
  resolveHeaderFooterPartsBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { collectPageChangeBars } from '../../output/semantic-paint-change-bars.ts';
import { authorSlotsOf } from '../../output/revision-presentation.ts';
import { projectReviewArtifacts } from '../../export/review-artifact-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" xmlns:mc="${MC}"`;

/** 6 pt per character, 14 pt lines. */
const measurer = createFixedMeasurer(6, 14);
const EMU_PER_PT = 12_700;

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

/** An inline text box in an `mc:AlternateContent` run, as Word writes one. */
function inlineTextbox(
  content: string,
  options: {
    readonly widthPt?: number;
    readonly heightPt?: number;
    readonly bodyPr?: string;
    readonly fill?: string;
    /** Outline width in points, drawn in black. */
    readonly outlinePt?: number;
    /** Marks the drawing `wp:docPr hidden="1"`. */
    readonly hidden?: boolean;
  } = {}
): string {
  const cx = (options.widthPt ?? 120) * EMU_PER_PT;
  const cy = (options.heightPt ?? 40) * EMU_PER_PT;
  const bodyPr =
    options.bodyPr ?? '<wps:bodyPr lIns="76200" tIns="38100" rIns="76200" bIns="38100"/>';
  const fill =
    (options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : '') +
    (options.outlinePt
      ? `<a:ln w="${options.outlinePt * EMU_PER_PT}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`
      : '');
  return (
    '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Text Box 1"${options.hidden ? ' hidden="1"' : ''}/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>${bodyPr}` +
    '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>' +
    '<mc:Fallback><w:t>fallback</w:t></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function documentPart(bodyXml: string): OoxmlPart {
  const doc = readOoxmlPart(`<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
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

function layoutBody(part: OoxmlPart, withDrawings = true): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    ...(withDrawings ? { inlineDrawingLayout: drawingLayoutFor(part) } : {}),
  });
}

function allLines(layout: SemanticLayout): LineRecord[] {
  return paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true).flatMap((fragment) => [
    ...fragment.lines,
  ]);
}

function boxLine(layout: SemanticLayout): { line: LineRecord; drawing: InlineDrawingRecord } {
  for (const line of allLines(layout)) {
    const drawing = line.drawings?.[0];
    if (drawing) return { line, drawing };
  }
  throw new Error('no inline drawing laid out');
}

function storyTexts(drawing: InlineDrawingRecord): string[] {
  return paragraphFragmentsOfBlocks(drawing.textboxStory?.fragments ?? [], true).map((fragment) =>
    fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
  );
}

describe('inline text box layout', () => {
  const BODY =
    `<w:p>${run('Before ')}${inlineTextbox(paragraph('Line one') + paragraph('Line two'))}` +
    `${run(' after')}</w:p>` +
    paragraph('Next');

  test('the box takes its extent on the line and keeps one model offset', () => {
    const { line, drawing } = boxLine(layoutBody(documentPart(BODY)));
    expect(drawing.width).toBe(120);
    expect(drawing.height).toBe(40);
    // The box starts where the text before it ends.
    const before = line.spans.filter((span) => span.range.start < drawing.start);
    const textEnd = Math.max(...before.map((span) => span.box.x + span.box.width));
    expect(drawing.advanceStart).toBeCloseTo(textEnd, 6);
    expect(drawing.advanceEnd).toBeCloseTo(textEnd + 120, 6);
    const after = line.spans.filter((span) => span.range.start > drawing.start);
    expect(Math.min(...after.map((span) => span.box.x))).toBeCloseTo(drawing.advanceEnd, 6);
    expect(Math.min(...after.map((span) => span.range.start))).toBe(drawing.start + 1);
    // The extent stands on the baseline, and the line grows to hold it.
    expect(drawing.y + drawing.height).toBeCloseTo(line.box.y + line.baseline, 6);
    expect(line.box.height).toBeGreaterThan(40);
  });

  test('the story lays out inside the extent with its insets', () => {
    const { drawing } = boxLine(layoutBody(documentPart(BODY)));
    const story = drawing.textboxStory;
    if (!story) throw new Error('inline text box has no story');
    expect(storyTexts(drawing)).toEqual(['Line one', 'Line two']);
    expect(story.contentOffset).toEqual({ x: 6, y: 3 });
    expect(story.contentWidth).toBe(108);
    expect(story.contentHeight).toBe(34);
    expect(story.fallbackReason).toBeUndefined();
  });

  test('content taller than the extent clips and never grows the box', () => {
    const many = ['One', 'Two', 'Three', 'Four'].map(paragraph).join('');
    const part = documentPart(`<w:p>${run('Clip ')}${inlineTextbox(many, { heightPt: 24 })}</w:p>`);
    const { drawing } = boxLine(layoutBody(part));
    expect(drawing.height).toBe(24);
    expect(drawing.textboxStory?.fallbackReason).toBe('textbox-height-clip');
    expect(storyTexts(drawing)).toEqual(['One', 'Two']);
  });

  test('vertical anchoring centers a short story in the box', () => {
    const part = documentPart(
      `<w:p>${inlineTextbox(paragraph('Mid'), {
        heightPt: 40,
        bodyPr: '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>',
      })}</w:p>`
    );
    const story = boxLine(layoutBody(part)).drawing.textboxStory;
    if (!story) throw new Error('inline text box has no story');
    expect(story.contentOffset.x).toBe(0);
    expect(story.contentOffset.y).toBeCloseTo((40 - story.flowHeight) / 2, 6);
    expect(story.contentOffset.y).toBeGreaterThan(0);
  });

  test('a box in a table cell lays out its story', () => {
    const part = documentPart(
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:p>${run('Cell ')}${inlineTextbox(paragraph('In cell'))}</w:p></w:tc></w:tr></w:tbl>`
    );
    const { drawing } = boxLine(layoutBody(part));
    expect(storyTexts(drawing)).toEqual(['In cell']);
  });

  test('without a drawing context the box keeps no story', () => {
    const layout = layoutBody(documentPart(BODY), false);
    for (const line of allLines(layout)) {
      for (const drawing of line.drawings ?? []) expect(drawing.textboxStory).toBeUndefined();
    }
  });

  test('a box inside a text-box story stops at one level', () => {
    const inner = `<w:p>${inlineTextbox(paragraph('Inner'))}</w:p>`;
    const part = documentPart(`<w:p>${inlineTextbox(inner, { heightPt: 60, widthPt: 200 })}</w:p>`);
    const { drawing } = boxLine(layoutBody(part));
    const nested = paragraphFragmentsOfBlocks(drawing.textboxStory?.fragments ?? [], true)
      .flatMap((fragment) => fragment.lines)
      .flatMap((line) => line.drawings ?? []);
    expect(nested).toHaveLength(1);
    expect(nested[0]!.textboxStory).toBeUndefined();
  });

  test('record walks descend into the inline story at the drawing position', () => {
    const layout = layoutBody(documentPart(BODY));
    const { drawing } = boxLine(layout);
    const spans: { text: string; depth: number; x: number; owner: string | undefined }[] = [];
    forEachSemanticSpan(layout, (visit) => {
      spans.push({
        text: visit.span.text,
        depth: visit.textboxDepth,
        x: visit.storyOrigin.x,
        owner: visit.textboxOwner?.drawingNodeId,
      });
    });
    const inside = spans.filter((span) => span.text.startsWith('Line'));
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((span) => span.depth === 1)).toBe(true);
    expect(inside[0]!.owner).toBe(drawing.drawingNodeId);
    const page = layout.pages[0]!;
    expect(inside[0]!.x).toBeCloseTo(page.contentBox.x + drawing.x + 6, 6);
    const kinds: string[] = [];
    forEachSemanticDrawing(layout, (visit) => kinds.push(visit.paintLayer));
    expect(kinds).toEqual(['inline']);
  });
});

describe('text box outline inset', () => {
  test('half the outline width insets the story on every side', () => {
    const part = documentPart(`<w:p>${inlineTextbox(paragraph('Edge'), { outlinePt: 6 })}</w:p>`);
    const story = boxLine(layoutBody(part)).drawing.textboxStory;
    if (!story) throw new Error('inline text box has no story');
    expect(story.contentOffset).toEqual({ x: 9, y: 6 });
    expect(story.contentWidth).toBe(102);
    expect(story.contentHeight).toBe(28);
    expect(story.strokeWidthPt).toBe(6);
  });
});

describe('inline text box paint', () => {
  test('the story paints inside the extent instead of a placeholder', () => {
    const part = documentPart(
      `<w:p>${run('Before ')}${inlineTextbox(paragraph('Painted &lt;b&gt;text&lt;/b&gt;'), {
        fill: 'FFF2CC',
      })}${run(' after')}</w:p>`
    );
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutBody(part), { scale: 1 });
    expect(container.querySelector('.docx-drawing-placeholder')).toBeNull();
    const box = container.querySelector<HTMLElement>('.docx-drawing-textbox');
    expect(box).not.toBeNull();
    expect(box!.getAttribute('contenteditable')).toBe('false');
    expect(box!.style.width).toBe('120px');
    expect(box!.style.height).toBe('40px');
    expect(box!.textContent).toContain('Painted <b>text</b>');
    expect(box!.querySelector('b')).toBeNull();
    const fill = box!.querySelector<HTMLElement>('.docx-drawing-textbox-box');
    expect(fill?.style.backgroundColor).not.toBe('');
    // Story text is not bound to the host paragraph's selection mapping.
    expect(box!.querySelector('[data-paragraph-id]')).toBeNull();
    expect(box!.closest('[data-line-id]')).not.toBeNull();
  });
});

describe('inline text box in a header', () => {
  function headerDoc(): OoxmlPackage {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr ${NS}><w:p>${run('Head ')}${inlineTextbox(paragraph('Header box'))}</w:p></w:hdr>`
      ),
      'word/document.xml': strToU8(
        `<w:document ${NS}><w:body>${paragraph('Body')}` +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>' +
          '<w:pgSz w:w="12240" w:h="15840"/>' +
          '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
          '</w:sectPr></w:body></w:document>'
      ),
    });
    const result = readOoxmlPackage(bytes);
    if (!result.ok) throw new Error(result.reason);
    return result.package;
  }

  test('the header story lays out the inline box story', () => {
    const pkg = headerDoc();
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const geometry = geometryOfSection(enumerateDocumentSections(part)[0]!.properties);
    const headerPart = resolveHeaderFooterPartsBySection(pkg)[0]!.headers.get('default')!;
    const header = layoutHeaderFooterStory(
      headerPart,
      geometry.width - geometry.margin.left - geometry.margin.right,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      drawingLayoutFor(headerPart)
    );
    const drawing = paragraphFragmentsOfBlocks(header.fragments, true)
      .flatMap((fragment) => fragment.lines)
      .flatMap((line) => line.drawings ?? [])[0];
    expect(drawing?.textboxStory).toBeDefined();
    expect(storyTexts(drawing!)).toEqual(['Header box']);
  });
});

describe('hidden inline text box', () => {
  const tracked =
    '<w:p><w:ins w:id="1" w:author="Reviewer" w:date="2026-03-26T11:00:00Z">' +
    '<w:r><w:t>Tracked</w:t></w:r></w:ins></w:p>';

  function trackedBoxPackage(hidden: boolean): OoxmlPackage {
    const body = `<w:p>${run('Host ')}${inlineTextbox(tracked, { hidden })}</w:p>`;
    const result = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
      })
    );
    if (!result.ok) throw new Error(result.reason);
    return result.package;
  }

  function reviewData(hidden: boolean) {
    const pkg = trackedBoxPackage(hidden);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const layout = layoutBody(part);
    const bars = collectPageChangeBars(layout.pages[0]!, 1, 'all-markup').runs;
    const occurrences = projectReviewArtifacts(layout, pkg).flatMap((item) => [
      ...item.occurrences,
    ]);
    return { layout, bars, occurrences, authors: [...authorSlotsOf(layout).keys()] };
  }

  test('a visible box reports its tracked text to change bars and author slots', () => {
    const { bars, authors } = reviewData(false);
    expect(bars.length).toBeGreaterThan(0);
    expect(authors).toEqual(['Reviewer']);
  });

  test('a docPr-hidden box publishes no drawing and feeds no review data', () => {
    const { layout, bars, occurrences, authors } = reviewData(true);
    expect(allLines(layout).flatMap((line) => line.drawings ?? [])).toEqual([]);
    expect(bars).toEqual([]);
    expect(occurrences).toEqual([]);
    expect(authors).toEqual([]);
  });

  test('a hidden owner record keeps its story out of change bars and author slots', () => {
    const { layout } = reviewData(false);
    const page = layout.pages[0]!;
    const hide = (block: BlockFragmentRecord): BlockFragmentRecord =>
      block.kind !== 'paragraph'
        ? block
        : {
            ...block,
            lines: block.lines.map((line) => ({
              ...line,
              drawings: line.drawings?.map((drawing) => ({
                ...drawing,
                accessibility: { ...drawing.accessibility, hidden: true },
              })),
            })),
          };
    const hiddenPage = { ...page, fragments: page.fragments.map(hide) };
    expect(collectPageChangeBars(hiddenPage, 1, 'all-markup').runs).toEqual([]);
    expect([...authorSlotsOf({ ...layout, pages: [hiddenPage] }).keys()]).toEqual([]);
  });
});
