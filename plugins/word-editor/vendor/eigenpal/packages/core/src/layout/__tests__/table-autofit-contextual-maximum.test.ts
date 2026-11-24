import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/index.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, bold = false) =>
  `<w:r><w:rPr><w:kern w:val="0"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function paragraph(content: string): OoxmlElement {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const find = (node: OoxmlElement): OoxmlElement | null => {
    if (node.localName === 'p') return node;
    for (const child of node.children)
      if ('localName' in child) {
        const result = find(child);
        if (result) return result;
      }
    return null;
  };
  const found = find(result.part.root);
  if (!found) throw new Error('Synthetic paragraph required');
  return found;
}
// A legal deterministic font model: contextual pair positioning need not be additive.
// These are metric fixtures, not evidence about a physical CJK font or Native rendering.
function contextualMeasurer(pairAdjustment = -2): TextMeasurer {
  return {
    ...createFixedMeasurer(6, 12),
    measure(text, style) {
      let width = [...text].reduce((sum, char) => sum + (char === ' ' ? 3 : style.bold ? 7 : 6), 0);
      width += [...text.matchAll(/甲乙/g)].length * pairAdjustment;
      width -= [...text.matchAll(/AV/g)].length * 2;
      return width;
    },
  };
}
function widths(content: string, measurer = contextualMeasurer()) {
  return paragraphContentWidthsPt(paragraph(content), {
    // Compatibility mode 15, where a first-line indent counts toward the minimum.
    context: { measurer, defaultTabStopPt: 24, compatibilityMode: 15 },
    view: {
      styleCascade: elevenPointDefaults(),
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
}

test('a breakable CJK pair keeps its smaller contextual unwrapped advance', () => {
  const measurer = contextualMeasurer();
  expect(widths(run('甲乙'), measurer)).toEqual({ min: 6, max: 10 });
});

test('a breakable CJK pair keeps its larger contextual unwrapped advance', () => {
  expect(widths(run('甲乙'), contextualMeasurer(2))).toEqual({ min: 6, max: 14 });
});

test('contextual maximums retain first-line indents and hanging trailing spaces', () => {
  expect(widths('<w:pPr><w:ind w:left="240" w:firstLine="120"/></w:pPr>' + run('甲乙  '))).toEqual({
    min: 24,
    max: 28,
  });
});

test('CJK minimum cuts do not change unwrapped tab stops or hard-break lines', () => {
  const properties = '<w:pPr><w:tabs><w:tab w:val="left" w:pos="600"/></w:tabs></w:pPr>';
  const body =
    properties +
    run('甲乙') +
    '<w:r><w:tab/></w:r>' +
    run('丙丁') +
    '<w:r><w:br/></w:r>' +
    run('戊己  ');
  expect(widths(body)).toEqual({ min: 6, max: 42 });
});

test('unwrapped maximums retain the original separate source-face measurements', () => {
  expect(widths(run('甲') + run('乙', true))).toEqual({ min: 7, max: 13 });
});

test('layout-owned display results keep their whole contextual measurement', () => {
  expect(widths('<w:fldSimple w:instr=" AUTHOR ">' + run('甲乙') + '</w:fldSimple>')).toEqual({
    min: 10,
    max: 10,
  });
});

test('non-CJK words retain their existing contextual minimum and maximum', () => {
  expect(widths(run('AV'))).toEqual({ min: 10, max: 10 });
});
