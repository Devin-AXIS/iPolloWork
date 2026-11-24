// Unwrapped text boxes (`wps:bodyPr wrap="none"`): each paragraph stays on one line, the box
// takes the width of its widest line plus the insets, and placement resolves at that width.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type AnchoredDrawingRecord,
  type SemanticLayout,
} from '../index.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;

const measurer = createFixedMeasurer(6, 14);
// The fixed measurer's 6pt advance, scaled from 11pt to the 10pt default run size.
const CHAR = 60 / 11;
const EMU_PER_PT = 12_700;
const PAGE_WIDTH = 612;
const MARGIN = 72;
const NO_WRAP = '<wps:bodyPr wrap="none"><a:spAutoFit/></wps:bodyPr>';
const OFFSET_H = `<wp:positionH relativeFrom="page"><wp:posOffset>${250 * EMU_PER_PT}</wp:posOffset></wp:positionH>`;

const para = (text: string, jc?: string) =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** An anchored, wrap-none text box 10pt wide unless `widthPt` says otherwise. */
function textbox(
  content: string,
  options: {
    readonly bodyPr?: string;
    readonly widthPt?: number;
    readonly positionH?: string;
    readonly fill?: string;
    readonly wrap?: string;
    readonly rotDegrees?: number;
  } = {}
): string {
  const cx = (options.widthPt ?? 10) * EMU_PER_PT;
  const cy = 50 * EMU_PER_PT;
  const fill = options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : '';
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    (options.positionH ?? OFFSET_H) +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${100 * EMU_PER_PT}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${options.wrap ?? '<wp:wrapNone/>'}` +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    `<wps:spPr><a:xfrm rot="${(options.rotDegrees ?? 0) * 60_000}">` +
    `<a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    (options.bodyPr ?? NO_WRAP) +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function documentPart(drawing: string): OoxmlPart {
  const doc = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${drawing}<w:r><w:t>Anchor</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH * 20}" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
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

function layoutBody(drawing: string): SemanticLayout {
  const part = documentPart(drawing);
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    inlineDrawingLayout: drawingLayoutFor(part),
  });
}

function boxRecord(drawing: string): AnchoredDrawingRecord {
  const record = layoutBody(drawing).pages[0]!.anchoredDrawings?.[0];
  if (!record?.textboxStory) throw new Error('no textbox story on record');
  return record;
}

function storyLines(record: AnchoredDrawingRecord) {
  return paragraphFragmentsOfBlocks(record.textboxStory!.fragments, true).flatMap(
    (fragment) => fragment.lines
  );
}

const lineText = (line: ReturnType<typeof storyLines>[number]) =>
  line.spans.map((span) => span.text).join('');

describe('unwrapped text box text', () => {
  test('a line longer than the column wraps at the column, and the box takes its width', () => {
    // 120 characters of 5.45pt run past the 468pt column.
    const words = Array.from({ length: 30 }, () => 'word').join(' ');
    const record = boxRecord(textbox(para(words)));
    const story = record.textboxStory!;
    expect(storyLines(record).length).toBeGreaterThan(1);
    expect(story.extentWidth).toBeLessThanOrEqual(PAGE_WIDTH - 2 * MARGIN + 0.01);
    expect(story.contentWidth).toBeCloseTo(PAGE_WIDTH - 2 * MARGIN - 14.4, 1);
  });

  test('each paragraph stays on one line and the box takes the widest line', () => {
    const record = boxRecord(textbox(para('label text') + para('second label line')));
    const story = record.textboxStory!;
    expect(storyLines(record).map(lineText)).toEqual(['label text', 'second label line']);
    // 17 characters; default 7.2pt insets on both sides.
    expect(story.contentWidth).toBeCloseTo(17 * CHAR, 1);
    expect(story.contentOffset.x).toBeCloseTo(7.2, 3);
    expect(story.extentWidth).toBeCloseTo(17 * CHAR + 14.4, 1);
    expect(record.width).toBeCloseTo(17 * CHAR + 14.4, 1);
    // An offset position keeps the left edge where the extent put it.
    expect(record.x + MARGIN).toBeCloseTo(250, 3);
    expect(story.fallbackReason).toBeUndefined();
  });

  test('paragraph alignment places shorter lines inside the widest line', () => {
    const record = boxRecord(
      textbox(para('abcdefghij', 'center') + para('abcd', 'center') + para('ab', 'right'))
    );
    const [wide, centered, right] = storyLines(record);
    expect(wide!.contentX).toBeCloseTo(0, 1);
    expect(centered!.contentX).toBeCloseTo((6 * CHAR) / 2, 1);
    expect(right!.contentX).toBeCloseTo(8 * CHAR, 1);
  });

  test('a box wider than its text shrinks to the text', () => {
    const record = boxRecord(
      textbox(para('ab', 'center'), {
        widthPt: 144,
        bodyPr: '<wps:bodyPr wrap="none" lIns="0" rIns="0"><a:noAutofit/></wps:bodyPr>',
      })
    );
    expect(record.textboxStory!.contentWidth).toBeCloseTo(2 * CHAR, 1);
    expect(record.width).toBeCloseTo(2 * CHAR, 1);
    expect(storyLines(record)[0]!.contentX).toBeCloseTo(0, 1);
    // The extent height stays authoritative.
    expect(record.height).toBe(50);
  });

  test('a centered position centers the sized box', () => {
    const record = boxRecord(
      textbox(para('centered label'), {
        positionH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
      })
    );
    expect(record.width).toBeCloseTo(14 * CHAR + 14.4, 1);
    expect(record.x + MARGIN + record.width / 2).toBeCloseTo(PAGE_WIDTH / 2, 1);
  });

  test('a right position keeps the sized box on the right edge', () => {
    const record = boxRecord(
      textbox(para('right label'), {
        positionH: '<wp:positionH relativeFrom="page"><wp:align>right</wp:align></wp:positionH>',
      })
    );
    expect(record.x + MARGIN + record.width).toBeCloseTo(PAGE_WIDTH, 1);
  });

  const indented = (pPr: string, text: string) =>
    `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const ZERO_INSETS = '<wps:bodyPr wrap="none" lIns="0" rIns="0"><a:spAutoFit/></wps:bodyPr>';

  test('a first-line indent widens the box by the indent', () => {
    const record = boxRecord(
      textbox(indented('<w:ind w:firstLine="720"/>', 'abcdefghij'), { bodyPr: ZERO_INSETS })
    );
    expect(storyLines(record).map(lineText)).toEqual(['abcdefghij']);
    expect(record.width).toBeCloseTo(36 + 10 * CHAR, 1);
  });

  test('a hanging indent pulls the first line back to the column edge', () => {
    const record = boxRecord(
      textbox(indented('<w:ind w:left="720" w:hanging="720"/>', 'abcdefghij'), {
        bodyPr: ZERO_INSETS,
      })
    );
    expect(storyLines(record).map(lineText)).toEqual(['abcdefghij']);
    expect(record.width).toBeCloseTo(10 * CHAR, 1);
  });

  test('a list marker in the hanging slot keeps the numbered line whole', () => {
    const numbering = readOoxmlPart(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="7">` +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
        '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
        '<w:num w:numId="7"><w:abstractNumId w:val="7"/></w:num></w:numbering>',
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!numbering.ok) throw new Error(numbering.reason);
    const part = documentPart(
      textbox(
        indented('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>', 'abcdefghij'),
        { bodyPr: ZERO_INSETS }
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(part),
      numberingIndex: buildNumberingIndex(numbering.part.root),
    });
    const record = layout.pages[0]!.anchoredDrawings![0]!;
    expect(storyLines(record).map(lineText)).toEqual(['abcdefghij']);
    // The marker opens the line at 18pt; the text starts at the 36pt indent.
    expect(record.width).toBeCloseTo(36 + 10 * CHAR, 1);
  });

  test('indents of a right-to-left paragraph size the box the same way', () => {
    const record = boxRecord(
      textbox(
        indented('<w:bidi/><w:ind w:left="360" w:right="720" w:firstLine="720"/>', 'abcdefghij'),
        {
          bodyPr: ZERO_INSETS,
        }
      )
    );
    expect(storyLines(record).map(lineText)).toEqual(['abcdefghij']);
    expect(record.width).toBeCloseTo(18 + 36 + 36 + 10 * CHAR, 1);
  });

  test('an inline box keeps its extent and wraps inside it', () => {
    const cx = 10 * EMU_PER_PT;
    const cy = 50 * EMU_PER_PT;
    const inline =
      '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="2" name="IB"/><a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
      `<wps:txbx><w:txbxContent>${para('inline label')}</w:txbxContent></wps:txbx>` +
      ZERO_INSETS +
      '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const layout = layoutBody(inline);
    const drawing = paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true)
      .flatMap((fragment) => fragment.lines)
      .flatMap((line) => line.drawings ?? [])[0]!;
    expect(drawing.width).toBeCloseTo(10, 3);
    expect(drawing.textboxStory!.extentWidth).toBeUndefined();
    expect(drawing.textboxStory!.contentWidth).toBeCloseTo(10, 3);
  });

  test('wrapped text keeps breaking at the extent', () => {
    const record = boxRecord(
      textbox(para('label text'), {
        bodyPr: '<wps:bodyPr wrap="square"><a:spAutoFit/></wps:bodyPr>',
      })
    );
    expect(storyLines(record).length).toBeGreaterThan(1);
    expect(record.textboxStory!.extentWidth).toBeUndefined();
    expect(record.width).toBeCloseTo(10, 3);
  });

  test('the painted fill and content follow the sized box', () => {
    const container = document.createElement('div');
    paintSemanticLayout(
      container,
      layoutBody(
        textbox(para('painted label'), {
          fill: 'FFEE00',
          bodyPr:
            '<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></wps:bodyPr>',
        })
      ),
      { scale: 1 }
    );
    const fill = container.querySelector<HTMLElement>('.docx-drawing-textbox-box');
    const content = container.querySelector<HTMLElement>('.docx-drawing-textbox-content');
    expect(parseFloat(fill!.style.width)).toBeCloseTo(13 * CHAR, 1);
    expect(parseFloat(content!.style.width)).toBeCloseTo(13 * CHAR, 1);
    expect(content!.textContent).toBe('painted label');
  });
  test('a table cell wraps its text around the sized box', () => {
    // No `a:spAutoFit`: the box keeps its authored 50pt height beside the first lines.
    const drawing = textbox(para('Hello world'), {
      bodyPr: '<wps:bodyPr wrap="none"/>',
      wrap: '<wp:wrapSquare wrapText="bothSides"/>',
      positionH:
        '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>',
    });
    const cell = `<w:p>${drawing}<w:r><w:t>${'word '.repeat(60)}</w:t></w:r></w:p>`;
    const doc = readOoxmlPart(
      `<w:document ${NS}><w:body><w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
        `<w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl><w:p/>` +
        `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH * 20}" w:h="15840"/>` +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        '</w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!doc.ok) throw new Error(doc.reason);
    const layout = layoutSemanticDocument(doc.part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(doc.part),
    });
    const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no table fragment');
    const cellParagraph = paragraphFragmentsOfBlocks(table.rows[0]!.cells[0]!.blocks, true)[0]!;
    const record = layout.pages[0]!.anchoredDrawings!.find((entry) => entry.textboxStory)!;
    expect(record.width).toBeGreaterThan(20);
    // Every line beside the box starts past its sized right edge, not its authored 10pt.
    for (const line of cellParagraph.lines.slice(0, 3)) {
      expect(line.contentX).toBeGreaterThanOrEqual(record.width - 0.01);
    }
  });

  test('a:spAutoFit fits the box height to its text, and the wrap follows the fitted box', () => {
    const layoutWith = (bodyPr: string) => {
      const drawing = textbox(para('Hello world'), {
        bodyPr,
        widthPt: 100,
        wrap: '<wp:wrapSquare wrapText="bothSides"/>',
        positionH:
          '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>',
      });
      const doc = readOoxmlPart(
        `<w:document ${NS}><w:body><w:p>${drawing}<w:r><w:t>${'word '.repeat(80)}</w:t></w:r></w:p>` +
          `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH * 20}" w:h="15840"/>` +
          '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
          '</w:body></w:document>',
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!doc.ok) throw new Error(doc.reason);
      const layout = layoutSemanticDocument(doc.part, 1, {
        measurer,
        producer: 'test',
        inlineDrawingLayout: drawingLayoutFor(doc.part),
      });
      const record = layout.pages[0]!.anchoredDrawings!.find((entry) => entry.textboxStory)!;
      const lines = paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true)[0]!.lines;
      return { record, beside: lines.filter((line) => line.contentX > 1).length };
    };
    const fixed = layoutWith('<wps:bodyPr/>');
    const fitted = layoutWith('<wps:bodyPr><a:spAutoFit/></wps:bodyPr>');
    expect(fixed.record.height).toBe(50);
    // One line (the 14pt fixed line scaled to the 10pt run) plus the 3.6pt top and bottom insets.
    expect(fitted.record.height).toBeCloseTo((14 * 10) / 11 + 7.2, 3);
    expect(fitted.beside).toBeLessThan(fixed.beside);
  });

  const FITTED_HEIGHT = (14 * 10) / 11 + 7.2;

  test('a turned DrawingML box fits its text too', () => {
    const record = boxRecord(
      textbox(para('Hello'), {
        bodyPr: '<wps:bodyPr><a:spAutoFit/></wps:bodyPr>',
        widthPt: 100,
        rotDegrees: 30,
      })
    );
    expect(record.height).toBeCloseTo(FITTED_HEIGHT, 3);
  });

  test('an inline DrawingML box fits its text, and its line holds the fitted box', () => {
    const lineHeight = (bodyPr: string) => {
      const cx = 100 * EMU_PER_PT;
      const cy = 50 * EMU_PER_PT;
      const drawing =
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
        '<wp:docPr id="1" name="TB"/>' +
        `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
        `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
        `<wps:txbx><w:txbxContent>${para('Hello')}</w:txbxContent></wps:txbx>${bodyPr}` +
        '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
      const layout = layoutBody(drawing);
      return paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true)[0]!.lines[0]!.box.height;
    };
    expect(lineHeight('<wps:bodyPr/>')).toBeGreaterThan(50);
    const fitted = lineHeight('<wps:bodyPr><a:spAutoFit/></wps:bodyPr>');
    expect(fitted).toBeGreaterThanOrEqual(FITTED_HEIGHT);
    expect(fitted).toBeLessThan(FITTED_HEIGHT + 5);
  });
});
