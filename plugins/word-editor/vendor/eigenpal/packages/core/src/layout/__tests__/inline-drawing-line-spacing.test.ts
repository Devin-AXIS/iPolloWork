import { squareWrapZone } from './float-over-table-harness.ts';
// `w:lineRule="auto"` on a line carrying an inline drawing (17.3.1.33).
//
// The multiple scales the TEXT band, never the image's own extent. A picture line keeps the
// picture's box and adds the multiple's extra text band below it, so a content-width picture
// under a 279/240 multiple gains a fraction of one text line, not a fraction of itself.

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
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const measurer = createFixedMeasurer(6, 14);
/** The measurer's 6pt/14pt base describes an 11pt run, so fixtures author `w:sz="22"`. */
const TEXT_LINE_PT = 14;
/** US-Letter content column: 468pt, which is what a full-width picture is authored at. */
const CONTENT_WIDTH_EMU = 5_943_600;
const PICTURE_HEIGHT_EMU = 4_457_700;
const PICTURE_HEIGHT_PT = 351;
/** A common `docDefaults` multiple: 1.1625. */
const DEFAULT_LINE = 279;
/** The extra a multiple adds to one text band. */
const extraFor = (line: number) => (TEXT_LINE_PT * (line - 240)) / 240;

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 504,
  pixelHeight: 378,
  dpiX: 96,
  dpiY: 96,
});

function pictureRun(id: number, cx: number, cy: number): string {
  return (
    '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="picture"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  );
}

function documentWith(options: {
  readonly spacing?: string;
  readonly cx?: number;
  readonly cy?: number;
  readonly caption?: string;
  readonly captionRunProperties?: string;
  readonly leadingText?: string;
  readonly pictures?: number;
  readonly leadParagraph?: boolean;
}): OoxmlPart {
  const cx = options.cx ?? CONTENT_WIDTH_EMU;
  const cy = options.cy ?? PICTURE_HEIGHT_EMU;
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body>' +
    (options.leadParagraph
      ? '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Lead</w:t></w:r></w:p>'
      : '') +
    '<w:p>' +
    (options.spacing ? `<w:pPr><w:spacing ${options.spacing}/></w:pPr>` : '') +
    (options.leadingText
      ? `<w:r><w:t xml:space="preserve">${options.leadingText}</w:t></w:r>`
      : '') +
    Array.from({ length: options.pictures ?? 1 }, (_, index) => pictureRun(index + 1, cx, cy)).join(
      ''
    ) +
    `<w:r><w:rPr><w:sz w:val="22"/>${options.captionRunProperties ?? ''}</w:rPr><w:t xml:space="preserve">${options.caption ?? 'This is a caption'}</w:t></w:r>` +
    '</w:p></w:body></w:document>';
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const atoms = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function linesOfFirstParagraph(part: OoxmlPart) {
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
}

describe('auto line spacing on a line carrying an inline drawing', () => {
  test('a content-width picture gains the extra text band, not a scaled extent', () => {
    const lines = linesOfFirstParagraph(
      documentWith({ spacing: `w:line="${DEFAULT_LINE}" w:lineRule="auto"` })
    );
    // The picture fills the column, so the caption wraps to its own line.
    expect(lines).toHaveLength(2);
    expect(lines[0]!.drawings ?? []).toHaveLength(1);
    expect(lines[0]!.drawings![0]!.y).toBeCloseTo(0, 4);
    expect(lines[0]!.box.height).toBeCloseTo(PICTURE_HEIGHT_PT + extraFor(DEFAULT_LINE), 4);
    // The extra sits below the picture, where the page bottom may absorb it.
    expect(lines[0]!.trailingSpacing).toBeCloseTo(extraFor(DEFAULT_LINE), 4);
    expect(lines[1]!.box.y).toBeCloseTo(PICTURE_HEIGHT_PT + extraFor(DEFAULT_LINE), 4);
    expect(lines[1]!.box.height).toBeCloseTo((TEXT_LINE_PT * DEFAULT_LINE) / 240, 4);
  });

  test('single spacing leaves the picture line at the picture height', () => {
    const [line] = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="240" w:lineRule="auto"' })
    );
    expect(line!.box.height).toBeCloseTo(PICTURE_HEIGHT_PT, 4);
    expect(line!.trailingSpacing ?? 0).toBe(0);
  });

  test('a multiple below single spacing takes its missing text band off the picture line', () => {
    const [line] = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="192" w:lineRule="auto"' })
    );
    // 0.8 of a text band: the line is the picture less a fifth of one band.
    const height = PICTURE_HEIGHT_PT - TEXT_LINE_PT * 0.2;
    expect(line!.box.height).toBeCloseTo(height, 4);
    expect(line!.trailingSpacing ?? 0).toBe(0);
    // The picture keeps its place against the line bottom and paints from the line top down.
    const picture = line!.drawings![0]!;
    expect(picture.y + picture.height).toBeCloseTo(height, 4);
    expect(picture.paintBounds.y).toBeCloseTo(0, 4);
    expect(picture.paintBounds.height).toBeCloseTo(height, 4);
  });

  test('a small multiple leaves a thin picture line the scaled text band', () => {
    // 28/240 of a band, with a 1.45 pt rule: the line is the scaled band, not a text line.
    const part = documentWith({
      spacing: 'w:line="28" w:lineRule="auto"',
      cy: 18_415,
      caption: '',
      leadParagraph: true,
    });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const [lead, rule] = paragraphFragmentsOf(layout.pages[0]!);
    expect(rule!.lines[0]!.box.height).toBeCloseTo((TEXT_LINE_PT * 28) / 240, 4);
    expect(rule!.lines[0]!.box.y).toBeCloseTo(lead!.lines[0]!.box.height, 4);
  });

  for (const line of [360, 720]) {
    test(`a picture between one and ${line / 240} text bands adds the extra to its own height`, () => {
      // 18pt is taller than one 14pt band but shorter than the scaled text line at 1.5.
      const [only] = linesOfFirstParagraph(
        documentWith({
          spacing: `w:line="${line}" w:lineRule="auto"`,
          cx: 127_000,
          cy: 228_600,
          caption: '',
        })
      );
      expect(only!.box.height).toBeCloseTo(18 + extraFor(line), 4);
    });
  }

  test('two pictures on one line add the extra once', () => {
    const one = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="360" w:lineRule="auto"', cx: 914_400, caption: '' })
    )[0]!;
    const two = linesOfFirstParagraph(
      documentWith({
        spacing: 'w:line="360" w:lineRule="auto"',
        cx: 914_400,
        caption: '',
        pictures: 2,
      })
    )[0]!;
    expect(two.drawings ?? []).toHaveLength(2);
    expect(two.box.height).toBeCloseTo(one.box.height, 4);
    expect(one.box.height).toBeCloseTo(PICTURE_HEIGHT_PT + extraFor(360), 4);
  });

  test('a multiple taller than the picture still wins', () => {
    // A picture shorter than the text line: the multiple governs, exactly as it does on a
    // line of plain text. The drawing only ever raises the floor.
    const lines = linesOfFirstParagraph(
      documentWith({
        spacing: 'w:line="480" w:lineRule="auto"',
        cx: 152_400,
        cy: 76_200,
        caption: 'x',
      })
    );
    expect(lines[0]!.drawings ?? []).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(TEXT_LINE_PT * 2, 4);
  });

  test('atLeast and exact are untouched by the text-band rule', () => {
    const atLeast = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="7200" w:lineRule="atLeast"' })
    );
    // atLeast is a floor in twips: 360pt beats the 351pt picture.
    expect(atLeast[0]!.box.height).toBeCloseTo(360, 4);

    const exact = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="1440" w:lineRule="exact"' })
    );
    // exact overrides the box outright; the picture overflows per the content-clip policy.
    expect(exact[0]!.box.height).toBeCloseTo(72, 4);
  });

  test('a picture narrower than the column shares its line with the caption', () => {
    const lines = linesOfFirstParagraph(
      documentWith({
        spacing: `w:line="${DEFAULT_LINE}" w:lineRule="auto"`,
        cx: 914_400,
        cy: 914_400,
        caption: 'x',
      })
    );
    expect(lines).toHaveLength(1);
    // The 72pt image sits above the shared baseline; the caption also needs the
    // fixed measurer's 2.8pt descent below it. Only the text band's extra is added.
    expect(lines[0]!.baseline).toBeCloseTo(72, 4);
    expect(lines[0]!.drawings![0]!.height).toBeCloseTo(72, 4);
    expect(lines[0]!.box.height).toBeCloseTo(74.8 + extraFor(DEFAULT_LINE), 4);
  });
});

for (const width of [468, 540]) {
  test(`an inline picture ${width} pt wide clears a float crossing its lower edge`, () => {
    const part = documentWith({ cx: width * 12700, cy: 72 * 12700, caption: '' });
    const paragraph = part.root.children
      .flatMap((node) => node.children)
      .find((node) => node.kind === 'paragraph')!;
    const layout = layoutSemanticDocument(part, 0, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      drawingExclusionPass: 0,
      drawingExclusionZonesByPage: new Map([
        [
          0,
          [
            squareWrapZone({
              anchorParagraphId: paragraph.id,
              top: 60,
              height: 80,
              left: 0,
              width: 468,
              contentWidth: 468,
            }),
          ],
        ],
      ]),
    });
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    expect(line.box.y).toBe(140);
    expect(line.drawings![0]!.width).toBe(width);
    expect(line.drawings![0]!.y).toBeGreaterThanOrEqual(140);
  });
}

test('a tall inline picture clears its entire shared line, including preceding text', () => {
  const part = documentWith({
    cx: 120 * 12700,
    cy: 72 * 12700,
    caption: '',
    leadingText: 'Caption ',
  });
  const paragraph = part.root.children
    .flatMap((node) => node.children)
    .find((node) => node.kind === 'paragraph')!;
  const layout = layoutSemanticDocument(part, 0, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map([
      [
        0,
        [
          squareWrapZone({
            anchorParagraphId: paragraph.id,
            top: 60,
            height: 80,
            left: 0,
            width: 468,
            contentWidth: 468,
          }),
        ],
      ],
    ]),
  });
  const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(140);
  expect(lines[0]!.spans[0]!.text).toBe('Caption ');
  expect(lines[0]!.drawings![0]!.y).toBeGreaterThanOrEqual(140);
});

test('automatic spacing includes caption borders when an inline image shares the line', () => {
  const [line] = linesOfFirstParagraph(
    documentWith({
      spacing: 'w:line="480" w:lineRule="auto"',
      cx: 127000,
      cy: 25400,
      captionRunProperties: '<w:bdr w:val="single" w:sz="4" w:space="0"/>',
    })
  );
  expect(line!.box.height).toBe(30);
  expect(line!.baseline).toBeCloseTo(14 * 0.8 + 0.5, 6);
});

test('the extra below a picture may cross the bottom margin like a text line extra', () => {
  // US-Letter body: 648pt. A 14pt lead line and the 631pt picture fit; its 7pt extra does
  // not, and need not.
  const part = documentWith({
    spacing: 'w:line="360" w:lineRule="auto"',
    cy: 631 * 12700,
    caption: '',
    leadParagraph: true,
  });
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  const first = paragraphFragmentsOf(layout.pages[0]!)[1]!;
  expect(first.lines[0]!.drawings ?? []).toHaveLength(1);
  expect(first.lines[0]!.box.height).toBeCloseTo(631 + extraFor(360), 4);
  expect(layout.pages).toHaveLength(1);
});
