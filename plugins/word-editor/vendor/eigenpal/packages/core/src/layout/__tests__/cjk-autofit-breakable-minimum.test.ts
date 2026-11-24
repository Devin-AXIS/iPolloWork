import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
function read(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function element(node: OoxmlElement, name: string): OoxmlElement {
  if (node.localName === name) return node;
  for (const child of node.children) {
    if ('localName' in child) {
      if (child.localName === name) return child;
      try {
        return element(child, name);
      } catch {}
    }
  }
  throw new Error('Missing authored element ' + name);
}
function widths(content: string) {
  const paragraph = element(read(`<w:p>${content}</w:p>`).root, 'p');
  return paragraphContentWidthsPt(paragraph, {
    context: { measurer: createFixedMeasurer(6, 12) },
    view: {
      styleCascade: elevenPointDefaults(),
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
}

test('breakable ideographs reduce the minimum while preserving the unwrapped maximum', () => {
  expect(widths(run('甲乙丙丁戊己'))).toEqual({ min: 6, max: 36 });
});
test('run seams obey whole-paragraph kinsoku instead of opening forbidden cuts', () => {
  const whole = widths(run('甲（乙）丙'));
  const split = widths(run('甲（') + run('乙）丙'));
  expect(whole).toEqual({ min: 18, max: 30 });
  expect(split).toEqual(whole);
});
test('a combining cluster stays whole beside ideographs across a run seam', () => {
  expect(widths(run('甲e') + run('\u0301乙')).min).toBe(12);
});
test('fullwidth decimal groups remain units across formatting runs', () => {
  expect(widths(run('甲１２') + run('．３乙')).min).toBe(24);
});
test('Latin words and nonbreaking glue retain their previous minimums', () => {
  expect(widths(run('ABCDEFGHIJ'))).toEqual({ min: 60, max: 60 });
  expect(widths(run('ABC\u00a0DEF'))).toEqual({ min: 42, max: 42 });
});
test('authored kinsoku off permits the same boundaries that paragraph layout permits', () => {
  expect(widths('<w:pPr><w:kinsoku w:val="0"/></w:pPr>' + run('甲（乙）丙')).min).toBe(6);
});
test('layout-owned field results remain atomic instead of gaining source-text cuts', () => {
  expect(
    widths('<w:fldSimple w:instr=" AUTHOR ">' + run('甲乙丙丁戊己') + '</w:fldSimple>').min
  ).toBe(36);
});
test('a long breakable remark keeps the five authored percentage columns', () => {
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/>' +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid>' +
    '<w:gridCol w:w="1200"/>'.repeat(5) +
    '</w:tblGrid><w:tr>' +
    ['甲', '乙', '丙', '丁', '甲乙丙丁戊己'.repeat(5)]
      .map(
        (text) =>
          '<w:tc><w:tcPr><w:tcW w:w="1000" w:type="pct"/></w:tcPr><w:p>' +
          run(text) +
          '</w:p></w:tc>'
      )
      .join('') +
    '</w:tr></w:tbl>';
  const result = layoutSemanticDocument(read(table), 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 300, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  const fragment = result.pages[0]!.fragments.find(
    (x): x is TableFragmentRecord => x.kind === 'table'
  )!;
  expect(fragment.rows[0]!.cells.map((cell) => cell.box.width)).toEqual([60, 60, 60, 60, 60]);
  const remark = fragment.rows[0]!.cells[4]!;
  const lines = remark.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
  expect(lines.length).toBeGreaterThan(1);
  expect(
    lines
      .flatMap((line) => line.spans)
      .map((span) => span.text)
      .join('')
  ).toBe('甲乙丙丁戊己'.repeat(5));
  for (const line of lines)
    for (const span of line.spans)
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(
        remark.box.x + remark.box.width + 0.001
      );
});
