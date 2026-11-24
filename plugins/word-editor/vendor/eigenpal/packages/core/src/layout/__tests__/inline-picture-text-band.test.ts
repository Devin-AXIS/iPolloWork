// The text band of a line that holds a small inline picture, under `auto` line spacing.
//
// In anonymous probes with a 12pt Normal style, a 10pt-wide, 1pt-tall picture in a 10pt run
// takes the line of 10pt text under a 10pt mark, a 14pt mark and no direct mark, for a
// DrawingML picture and a VML rule alike. The same picture in an 8pt run under a 14pt mark
// takes the 8pt line, and in a 12pt run under an 8pt mark the 12pt line. The run that holds
// the picture sets the band: neither the paragraph's run cascade nor its mark does.

import { describe, expect, test } from 'bun:test';
import {
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NAMESPACES =
  `xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml" ` +
  'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Size-aware metrics: line height 1.15em, baseline 0.9em; the `Deep` face descends 0.4em. */
const measurer: TextMeasurer = {
  measure: (text, style: ResolvedRunStyle) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({
    height: style.fontSizePt * (style.fontFamily === 'Deep' ? 1.3 : 1.15),
    baseline: style.fontSizePt * 0.9,
  }),
};
const line = (sizePt: number) => sizePt * 1.15;

/** 12pt Normal: the paragraph's run cascade. */
function styles() {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      '<w:rPr><w:sz w:val="24"/></w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return buildStyleCascadeTable(parsed.part.root);
}

const size = (halfPoints: number) => `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr>`;
const spacing = (line = 240) =>
  `<w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/>`;
const paragraph = (content: string, mark = '', line = 240) =>
  `<w:p><w:pPr>${spacing(line)}${mark}</w:pPr>${content}</w:p>`;
const text = (value: string, halfPoints = 24) =>
  `<w:r>${size(halfPoints)}<w:t>${value}</w:t></w:r>`;

let pictureId = 0;
/** An inline DrawingML picture, `heightPt` tall and 10pt wide. */
const drawing = (heightPt = 1) => {
  pictureId += 1;
  const cy = heightPt * 12700;
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="127000" cy="${cy}"/><wp:docPr id="${pictureId}" name="p${pictureId}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="127000" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
};
/** A VML horizontal rule, 144pt wide and 1pt tall. */
const rule =
  '<w:pict><v:rect id="Rule" style="width:144pt;height:1pt" o:hr="t" fillcolor="black" ' +
  'stroked="f"/></w:pict>';
const pictureRun = (halfPoints: number, content = drawing()) =>
  `<w:r>${size(halfPoints)}${content}</w:r>`;

/** Line heights of `paragraphs` between an Alpha and a Beta line of 12pt text. */
function lay(paragraphs: string) {
  const document = load(
    `<w:document ${NAMESPACES}><w:body>${paragraph(text('Alpha'))}${paragraphs}` +
      `${paragraph(text('Beta'))}</w:body></w:document>`
  );
  const layout = layoutSemanticDocument(document, 1, {
    measurer,
    styleCascade: styles(),
    inlineDrawingLayout: layoutContext(document),
  });
  const lines = linesOf(layout);
  expect(lines.length).toBeGreaterThan(2);
  const tops = lines.map((record) => record.box.y);
  return {
    heights: lines.slice(1, -1).map((record) => record.box.height),
    alphaToBeta: tops.at(-1)! - tops[0]!,
  };
}

describe('a line with only a small inline picture', () => {
  test('takes the line of the run that holds the picture, whatever the mark', () => {
    for (const [runSize, mark, expected] of [
      [20, size(20), line(10)],
      [20, size(28), line(10)],
      [20, '', line(10)],
      [16, size(28), line(8)],
      [24, size(16), line(12)],
    ] as const) {
      const { heights, alphaToBeta } = lay(paragraph(pictureRun(runSize), mark));
      expect(heights[0]).toBeCloseTo(expected, 5);
      expect(alphaToBeta).toBeCloseTo(line(12) + expected, 5);
    }
  });

  test('a VML rule takes the line of its run in the same way', () => {
    for (const mark of [size(20), size(28)]) {
      const { heights, alphaToBeta } = lay(paragraph(pictureRun(20, rule), mark));
      expect(heights[0]).toBeCloseTo(line(10), 5);
      expect(alphaToBeta).toBeCloseTo(line(12) + line(10), 5);
    }
  });

  test('a line of 10pt text under a 14pt mark takes the line of 10pt text', () => {
    expect(lay(paragraph(text('Gamma', 20), size(28))).heights[0]).toBeCloseTo(line(10), 5);
  });

  test('pictures in runs of different sizes take the line of the largest run, in any order', () => {
    for (const [lineValue, expected] of [
      [240, line(14)],
      [480, 2 * line(14)],
    ] as const) {
      for (const content of [pictureRun(16) + pictureRun(28), pictureRun(28) + pictureRun(16)]) {
        const { heights } = lay(paragraph(content, size(20), lineValue));
        expect(heights[0]).toBeCloseTo(expected, 5);
      }
    }
  });

  test('text beside a picture keeps the band of its text', () => {
    // A face with a deeper descent in the picture's run adds nothing to a line with text.
    const deep = '<w:rFonts w:ascii="Deep" w:hAnsi="Deep"/><w:sz w:val="20"/>';
    const picture = `<w:r><w:rPr>${deep}</w:rPr>${drawing()}</w:r>`;
    expect(lay(paragraph(text('Gamma') + picture)).heights[0]).toBeCloseTo(line(12), 5);
    // Alone, the picture takes the line of its own run.
    expect(lay(paragraph(picture)).heights[0]).toBeCloseTo(10 * 1.3, 5);
  });

  test('each line of a paragraph reads only its own pictures', () => {
    const { heights } = lay(
      paragraph(`<w:r>${size(28)}${drawing()}<w:br/></w:r>` + pictureRun(16), size(20))
    );
    expect(heights[0]).toBeCloseTo(line(14), 5);
    expect(heights[1]).toBeCloseTo(line(8), 5);
  });

  test('double spacing scales the run line, and never a tall picture', () => {
    expect(lay(paragraph(pictureRun(20), size(28), 480)).heights[0]).toBeCloseTo(2 * line(10), 5);
    // The picture stands on the baseline and is the line; spacing does not multiply it. The
    // multiple's extra run band goes below the picture instead.
    const single = lay(paragraph(pictureRun(20, drawing(40)), size(28), 240)).heights[0];
    expect(single).toBeCloseTo(40, 5);
    const double = lay(paragraph(pictureRun(20, drawing(40)), size(28), 480)).heights[0];
    expect(double).toBeCloseTo(40 + line(10), 5);
  });
});
