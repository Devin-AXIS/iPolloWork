// A legacy FORMCHECKBOX is a drawn box of its `w:size`, not a glyph. Its line band comes from
// the run's own face at that size; a fallback face that covers the ballot-box placeholder must
// not size the line, in body text, in a table cell, or after a word is carried to a new line.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  layoutSemanticDocument,
  linesOf,
  type SemanticLayout,
  type TextMeasurer,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The run face is 1.15 em; the only face holding ☐/☒ is 1.7 em, as a CJK or symbol face is. */
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style, text) =>
    text !== undefined && /[☐☒]/u.test(text)
      ? { height: style.fontSizePt * 1.7, baseline: style.fontSizePt * 1.2 }
      : { height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 },
};

const rpr = (sz: number) => `<w:rPr><w:sz w:val="${sz}"/></w:rPr>`;
const text = (value: string, sz = 20) =>
  `<w:r>${rpr(sz)}<w:t xml:space="preserve">${value}</w:t></w:r>`;

/** FORMCHECKBOX as Word writes it; `size` is half-points, null for `w:sizeAuto`. */
function checkbox(size: number | null, sz = 20, checked = false): string {
  const sizing = size === null ? '<w:sizeAuto/>' : `<w:size w:val="${size}"/>`;
  return (
    `<w:r>${rpr(sz)}<w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val=""/><w:enabled/>` +
    `<w:checkBox>${sizing}<w:default w:val="${checked ? 1 : 0}"/></w:checkBox></w:ffData>` +
    `</w:fldChar></w:r><w:r>${rpr(sz)}<w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r>${rpr(sz)}<w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r>${rpr(sz)}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

const para = (runs: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${runs}</w:p>`;

function layout(body: string, widthPt = 400): SemanticLayout {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}` +
      `<w:sectPr><w:pgSz w:w="${widthPt * 20}" w:h="16000"/>` +
      '<w:pgMar w:top="0" w:bottom="0" w:left="0" w:right="0"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return layoutSemanticDocument(parsed.part, 1, { measurer });
}

const boxLine = (result: SemanticLayout) =>
  linesOf(result).find((line) => line.spans.some((span) => /[☐☒]/u.test(span.text)))!;

test('an explicit size sets the band from the run face at that size', () => {
  const line = boxLine(layout(para(checkbox(48))));
  expect(line.box.height).toBeCloseTo(24 * 1.15, 6);
  expect(line.baseline).toBeCloseTo(24 * 0.9, 6);
});

test('an automatic size, a checked box and a box beside text keep the run face band', () => {
  expect(boxLine(layout(para(checkbox(null, 48)))).box.height).toBeCloseTo(24 * 1.15, 6);
  expect(boxLine(layout(para(checkbox(48, 20, true)))).box.height).toBeCloseTo(24 * 1.15, 6);
  const mixed = boxLine(layout(para(checkbox(24) + text(' Label'))));
  expect(mixed.box.height).toBeCloseTo(12 * 1.15, 6);
  expect(mixed.baseline).toBeCloseTo(12 * 0.9, 6);
});

test('a box carried with its word to the next line keeps the run face band', () => {
  // 'xx' + box + 'yyyyyy' is one word: the box is placed on the first line, then the overflow
  // at 'yyyyyy' carries the whole word, box included, to the second line.
  const lines = linesOf(layout(para(text('aa ') + text('xx') + checkbox(20) + text('yyyyyy')), 60));
  const carried = lines.find((line) => line.spans.some((span) => span.text === '☐'))!;
  expect(lines.indexOf(carried)).toBe(1);
  expect(carried.box.height).toBeCloseTo(10 * 1.15, 6);
});

test('a table row holding a box grows to the run face band, not the fallback band', () => {
  const cell = (runs: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(runs)}</w:tc>`;
  const result = layout(
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      `<w:tr>${cell(text('A'))}${cell(checkbox(24))}</w:tr>` +
      `<w:tr>${cell(text('B'))}${cell(text('C'))}</w:tr></w:tbl>` +
      para(text('After'))
  );
  const lines = linesOf(result);
  const top = (label: string) =>
    lines.find((line) => line.spans.some((span) => span.text === label))!;
  expect(boxLine(result).box.height).toBeCloseTo(12 * 1.15, 6);
  const rowPitch = top('B').box.y - top('A').box.y;
  expect(rowPitch).toBeCloseTo(12 * 1.15, 1);
});

test('a bordered box reserves its border around the run face band', () => {
  const bordered = checkbox(24).replaceAll(
    '<w:sz w:val="20"/>',
    '<w:sz w:val="20"/><w:bdr w:val="single" w:sz="8" w:space="0"/>'
  );
  const line = boxLine(layout(para(bordered)));
  expect(line.box.height).toBeCloseTo(12 * 1.15 + 2, 6);
});
