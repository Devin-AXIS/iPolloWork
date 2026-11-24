import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';

// Each character measures 6 pt at 11 pt. Adjacent full-width punctuation shares one
// half-em in an autofit minimum exactly when line layout compresses the pair: an East Asian
// document default face, a run kern threshold, and both marks in one unbreakable segment.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, size = 22) =>
  `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

function root(xml: string, name: string): OoxmlElement {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}
function cascade(kern: boolean) {
  return buildStyleCascadeTable(
    root(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="MS Mincho"/>' +
        (kern ? '<w:kern w:val="2"/>' : '') +
        '<w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults></w:styles>',
      '/word/styles.xml'
    )
  );
}
function paragraph(content: string): OoxmlElement {
  const body = root(
    `<w:document xmlns:w="${W}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const find = (node: OoxmlElement): OoxmlElement | undefined => {
    if (node.localName === 'p') return node;
    for (const child of node.children)
      if ('localName' in child) {
        const found = find(child);
        if (found) return found;
      }
    return undefined;
  };
  return find(body)!;
}
function widths(content: string, kern = true) {
  return paragraphContentWidthsPt(paragraph(content), {
    context: { measurer: createFixedMeasurer(6, 12) },
    view: {
      styleCascade: cascade(kern),
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
}
const min = (content: string, kern = true): number => widths(content, kern).min;
const max = (content: string, kern = true): number => widths(content, kern).max;

test('a single bracket or period keeps its full advance beside its ideograph', () => {
  expect(min(run('漢「字漢字'))).toBe(12);
  expect(min(run('漢字」漢字'))).toBe(12);
  expect(min(run('漢字。漢字'))).toBe(12);
});
test('adjacent closing marks give up one half-em for each shared seam', () => {
  expect(min(run('漢字。」漢字'))).toBe(15);
  expect(min(run('漢字」』漢字'))).toBe(15);
  expect(min(run('漢字」、漢字'))).toBe(15);
  expect(min(run('漢字。」』漢字'))).toBe(18);
});
test('adjacent opening marks give up one half-em for each shared seam', () => {
  expect(min(run('漢「『字漢字'))).toBe(15);
  expect(min(run('漢（「『字漢字'))).toBe(18);
});
test('a seam split by a legal break keeps both natural advances', () => {
  expect(min(run('漢字」「漢字'))).toBe(12);
  expect(min(run('漢字。」「漢字'))).toBe(15);
});
test('marks outside the bracket classes keep their natural advances', () => {
  expect(min(run('漢字？！漢字'))).toBe(18);
  expect(min(run('漢字……漢字'))).toBe(18);
  expect(min(run('甲（乙）丙'))).toBe(18);
});
test('the earlier closing mark and the later opening mark give up the half-em', () => {
  expect(min(run('漢字') + run('。', 44) + run('」漢字'))).toBe(18);
  expect(min(run('漢字。') + run('」', 44) + run('漢字'))).toBe(21);
  expect(min(run('漢') + run('「', 44) + run('『字漢'))).toBe(21);
  expect(min(run('漢「') + run('『', 44) + run('字漢'))).toBe(18);
});
test('a run seam inside a punctuation pair still shares the half-em', () => {
  expect(min(run('漢字。') + run('」漢字'))).toBe(15);
  expect(min(run('漢「') + run('『字漢'))).toBe(15);
});
test('without a kern threshold the pair keeps both natural advances', () => {
  expect(min(run('漢字。」漢字'), false)).toBe(18);
  expect(min(run('漢「『字漢字'), false)).toBe(18);
});
test('with kinsoku off each mark stands alone at its natural advance', () => {
  const off = '<w:pPr><w:kinsoku w:val="0"/></w:pPr>';
  expect(min(off + run('漢字。」漢字'))).toBe(6);
  expect(min(off + run('漢字。') + run('」', 44) + run('漢字'))).toBe(12);
});
test('Latin text keeps its word minimum', () => {
  expect(min(run('ABC DEFG'))).toBe(24);
});
test('the AutoFit maximum gives up every shared half-em of the unwrapped line', () => {
  // The unwrapped line holds both marks of each pair, legal break or not.
  expect(max(run('漢字」「漢字'))).toBe(33);
  expect(max(run('漢字。」漢字'))).toBe(33);
  expect(max(run('漢字。') + run('」漢字'))).toBe(33);
  expect(max(run('漢字。」漢字。」'))).toBe(42);
  expect(max(run('漢字」「漢字'), false)).toBe(36);
});
