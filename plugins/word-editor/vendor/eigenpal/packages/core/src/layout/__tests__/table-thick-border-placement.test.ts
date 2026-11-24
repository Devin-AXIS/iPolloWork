// Where a wide table rule sits against the table indent and the cell content: `w:tblBorders`
// (ECMA-376 §17.4.38), `w:tcBorders` (§17.4.66), `w:tblCellMar` (§17.4.41) and `w:tcMar`
// (§17.4.43), before and in compatibility mode 15.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableBlockFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function layoutTable(xml: string, mode: number): TableBlockFragmentRecord {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 0, {
    compatibilityMode: mode,
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 500, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const fragment = result.pages[0]!.fragments.find((item) => item.kind === 'table');
  if (fragment?.kind !== 'table') throw new Error('Expected a table');
  return fragment;
}

const rule = (side: string, sz: number) =>
  `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A two-column frame of `sz` eighths with no inside rules, indented `ind` twips. */
function frame(ind: number, leftMargin: number, sz: number): string {
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblInd w:w="${ind}" w:type="dxa"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right'].map((side) => rule(side, sz)).join('')}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${leftMargin}" w:type="dxa"/>` +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="55" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr>${cell('a')}${cell('b')}</w:tr></w:tbl>`
  );
}

/** Left edge of the left rule and of the first cell's text, from the text column edge. */
function leftEdges(fragment: TableBlockFragmentRecord): { rule: number; text: number } {
  const cell = fragment.rows[0]!.cells[0]!;
  const strokes = (cell.borders?.strokes ?? []).filter((stroke) => stroke.side === 'left');
  const rule = strokes.length
    ? cell.box.x + Math.min(...strokes.map((stroke) => stroke.x))
    : cell.box.x;
  const paragraph = cell.blocks[0];
  if (paragraph?.kind !== 'paragraph') throw new Error('Expected a paragraph');
  return { rule, text: paragraph.lines[0]!.box.x };
}

describe('wide table rule placement', () => {
  test('before mode 15 a negative left cell margin pads like 0 and aligns the content', () => {
    for (const margin of [-9, -200, 0]) {
      // The text starts at the indent and the 6pt rule sits wholly outside it.
      const edges = leftEdges(layoutTable(frame(-71, margin, 48), 14));
      expect(edges.text).toBeCloseTo(-3.55, 6);
      expect(edges.rule).toBeCloseTo(-3.55 - 6, 6);
    }
    // A positive margin wider than half the rule measures from the centred rule.
    const padded = leftEdges(layoutTable(frame(-71, 108, 48), 14));
    expect(padded.text).toBeCloseTo(-3.55, 6);
    expect(padded.rule).toBeCloseTo(-3.55 - 5.4 - 3, 6);
  });

  test('in mode 15 a frame without inside rules puts its outer edge on the indent', () => {
    for (const [margin, inset] of [
      [-9, 6],
      [0, 6],
      [108, 3 + 5.4],
    ] as const) {
      const edges = leftEdges(layoutTable(frame(720, margin, 48), 15));
      expect(edges.rule).toBeCloseTo(36, 6);
      expect(edges.text).toBeCloseTo(36 + inset, 6);
    }
  });

  test.each([14, 15])(
    'a row with no top rule of its own shares its top margin with the band above (mode %i)',
    (mode) => {
      const row = (borders: string, text: string) =>
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:tcBorders>${borders}</w:tcBorders></w:tcPr>${p(text)}</w:tc></w:tr>`;
      const table = (topOfLower: boolean, margin: number) =>
        '<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
        `<w:tblCellMar><w:top w:w="${margin}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/></w:tblCellMar>` +
        '</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
        row(rule('top', 48) + rule('bottom', 48), 'a') +
        row((topOfLower ? rule('top', 48) : '') + rule('bottom', 48), 'b') +
        '</w:tbl>';
      const pitch = (fragment: TableBlockFragmentRecord) => {
        const top = (index: number) => {
          const block = fragment.rows[index]!.cells[0]!.blocks[0];
          if (block?.kind !== 'paragraph') throw new Error('Expected a paragraph');
          return block.lines[0]!.box.y;
        };
        return top(1) - top(0);
      };
      for (const [margin, saved] of [
        [85, 4.25],
        [200, 6],
        [0, 0],
      ] as const) {
        const own = pitch(layoutTable(table(true, margin), mode));
        const inherited = pitch(layoutTable(table(false, margin), mode));
        // Stated: the rule and the top margin add up. Inherited: the wider of the 6pt rule and
        // the top margin, so the row is the narrower of the two shorter.
        expect(own - inherited).toBeCloseTo(saved, 6);
      }
    }
  );
});
