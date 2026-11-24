// A super- or subscript run grows its line to the run's full-size metrics on the baseline.
//
// In anonymous probes, 12pt text with an 18pt superscript, subscript or footnote reference
// takes the 18pt line's ascent above the baseline and its descent below it, on the last line
// and on earlier lines of the paragraph, in body text and in table cells. Under a line grid
// the taller line snaps to whole pitches with the glyphs centred. A script run smaller than
// the text changes nothing.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Size-aware metrics: line height 1.15em, baseline 0.9em, script text at its glyph size. */
const size = (style: ResolvedRunStyle) => style.fontSizePt * glyphSizeFactorOf(style);
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * size(style) * 0.5,
  lineMetrics: (style) => ({ height: size(style) * 1.15, baseline: size(style) * 0.9 }),
};

function body(content: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const styles = (() => {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      '<w:rPr><w:sz w:val="24"/></w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return buildStyleCascadeTable(parsed.part.root);
})();

const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
const paragraph = (content: string) => `<w:p><w:pPr>${SPACING}</w:pPr>${content}</w:p>`;
const run = (text: string) => `<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r>`;
const script = (align: 'superscript' | 'subscript', halfPoints = 36) =>
  `<w:r><w:rPr><w:sz w:val="${halfPoints}"/><w:vertAlign w:val="${align}"/></w:rPr><w:t>1</w:t></w:r>`;
const BREAK = '<w:r><w:br/></w:r>';

function lines(content: string, sectPr = '') {
  return linesOf(
    layoutSemanticDocument(body(content + sectPr), 1, { measurer, styleCascade: styles })
  );
}

// 18pt full size: ascent 16.2 above the baseline, descent 4.5 below it.
const FULL = { baseline: 18 * 0.9, height: 18 * 1.15 };

for (const align of ['superscript', 'subscript'] as const) {
  test(`an 18pt ${align} run takes its full-size ascent and descent on the last line`, () => {
    const [line] = lines(paragraph(run('Text') + script(align)));
    expect(line!.baseline).toBeCloseTo(FULL.baseline, 5);
    expect(line!.box.height).toBeCloseTo(FULL.height, 5);
  });

  test(`an 18pt ${align} run grows an earlier line of its paragraph too`, () => {
    const [first, second] = lines(paragraph(run('Text') + script(align) + BREAK + run('More')));
    expect(first!.baseline).toBeCloseTo(FULL.baseline, 5);
    expect(first!.box.height).toBeCloseTo(FULL.height, 5);
    expect(second!.box.height).toBeCloseTo(12 * 1.15, 5);
  });
}

test('a script run in a table cell grows its line the same way', () => {
  const cell =
    '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
    paragraph(run('Text') + script('superscript')) +
    '</w:tc></w:tr></w:tbl>';
  const [line] = lines(cell);
  expect(line!.baseline).toBeCloseTo(FULL.baseline, 5);
  expect(line!.box.height).toBeCloseTo(FULL.height, 5);
});

test('under a line grid the taller script line snaps with its glyphs centred', () => {
  const grid = '<w:sectPr><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>';
  const [line] = lines(paragraph(run('Text') + script('superscript')), grid);
  expect(line!.box.height).toBeCloseTo(31.2, 5);
  expect(line!.baseline).toBeCloseTo(FULL.baseline + (31.2 - FULL.height) / 2, 5);
});

test('a script run smaller than its text leaves the line alone', () => {
  const [line] = lines(paragraph(run('Text') + script('superscript', 20)));
  expect(line!.baseline).toBeCloseTo(12 * 0.9, 5);
  expect(line!.box.height).toBeCloseTo(12 * 1.15, 5);
});

test('auto multiple spacing scales a raised line without its position offset', () => {
  // 12pt text and a 14pt run raised 4.5pt: the line is 17.1pt above and 3pt below the
  // baseline. 1.5 spacing adds half of the 14pt run's own 16.1pt line, not half of 20.1pt.
  const spacing = '<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>';
  const raised = '<w:r><w:rPr><w:position w:val="9"/><w:sz w:val="28"/></w:rPr><w:t>R</w:t></w:r>';
  const [line] = lines(`<w:p><w:pPr>${spacing}</w:pPr>${run('Text')}${raised}</w:p>`);
  expect(line!.box.height).toBeCloseTo(14 * 0.9 + 4.5 + 12 * 0.25 + (14 * 1.15) / 2, 5);
});
