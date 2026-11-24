// Legacy table placement for tables with cell spacing and rows that skip grid columns.
//
// Measured on reference renderings in modes 11, 12 and 14 and without a mode: a left-aligned
// table that states an indent or takes a table style puts the text of its first cell on the
// text edge plus the indent, also with `w:tblCellSpacing`, whose frame then reaches into the
// margin, whatever the spacing, the border widths and the cell margins. A right-aligned table
// puts its last cell's text on the right text edge. Rows with `w:gridBefore` or `w:gridAfter`
// follow the grid and do not change that. Mode 15 keeps the outer edge on the text edge.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure } from '../semantic-table.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const cascade = (tableStyle: boolean) =>
  buildStyleCascadeTable(
    part(
      `<w:styles xmlns:w="${W}">${DEFAULTS}` +
        (tableStyle
          ? '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
            '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
            '<w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
            '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
          : '') +
        '</w:styles>',
      '/word/styles.xml'
    ).root
  );
const STYLED = cascade(true);
const UNSTYLED = cascade(false);

const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const GRID_BEFORE =
  '<w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="2000" w:type="dxa"/></w:trPr>';
const GRID_AFTER = '<w:trPr><w:gridAfter w:val="1"/><w:wAfter w:w="2000" w:type="dxa"/></w:trPr>';
const FULL = `<w:tr>${cell('a')}${cell('b')}</w:tr>`;

function table(properties: string, rows = FULL, sz = 4): string {
  const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="${sz}" w:color="000000"/>`)
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>${properties}` +
    `<w:tblBorders>${edges}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`
  );
}

function documentOf(tableXml: string) {
  return part(`<w:document xmlns:w="${W}"><w:body>${tableXml}<w:p/></w:body></w:document>`);
}

function structure(tableXml: string, mode: number | undefined, styles = STYLED) {
  const body = documentOf(tableXml).root.children.find(
    (node) => node.kind === 'body'
  ) as OoxmlElement;
  const node = body.children.find((child) => child.kind === 'table') as OoxmlElement;
  return readTableStructure(node, 468, 0, styles, 'proposed', undefined, mode)!;
}

/** The left edge of the first text line of every cell, row by row, from the text edge. */
function cellTextX(tableXml: string, mode: number | undefined, styles = STYLED): number[][] {
  const layout = layoutSemanticDocument(documentOf(tableXml), 0, {
    compatibilityMode: mode,
    styleCascade: styles,
    measurer: createFixedMeasurer(5, 12),
    geometry: { width: 612, height: 792, margin: { top: 36, right: 72, bottom: 36, left: 72 } },
  });
  const fragment = layout.pages[0]!.fragments.find(
    (record): record is TableFragmentRecord => record.kind === 'table'
  )!;
  return fragment.rows.map((row) =>
    row.cells.map((item) => {
      const paragraph = item.blocks[0] as ParagraphFragmentRecord;
      return paragraph.lines[0]!.box.x;
    })
  );
}

const LEGACY = [undefined, 11, 12, 14];
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';

describe('legacy placement of a table with cell spacing', () => {
  test('the first cell text sits on the text edge plus the indent', () => {
    for (const mode of LEGACY) {
      expect(cellTextX(table(SPACING), mode)[0]![0]).toBeCloseTo(0, 6);
      const indented = table(`${SPACING}<w:tblInd w:w="300" w:type="dxa"/>`);
      expect(cellTextX(indented, mode)[0]![0]).toBeCloseTo(15, 6);
      const outdented = table(`${SPACING}<w:tblInd w:w="-300" w:type="dxa"/>`);
      expect(cellTextX(outdented, mode)[0]![0]).toBeCloseTo(-15, 6);
    }
  });

  test('spacing, border widths, cell margins and a fixed layout do not move it', () => {
    const margins =
      '<w:tblCellMar><w:left w:w="300" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
    for (const [properties, sz] of [
      ['<w:tblCellSpacing w:w="20" w:type="dxa"/>', 4],
      ['<w:tblCellSpacing w:w="200" w:type="dxa"/>', 4],
      [SPACING, 24],
      [SPACING + margins, 4],
      [SPACING + '<w:tblLayout w:type="fixed"/>', 4],
    ] as const)
      expect(cellTextX(table(properties, FULL, sz), 14)[0]![0]).toBeCloseTo(0, 6);
  });

  test('the frame moves whole: the cells keep their distance', () => {
    const legacy = cellTextX(table(SPACING), 14)[0]!;
    const modern = cellTextX(table(SPACING), 15)[0]!;
    expect(modern[0]).toBeGreaterThan(10);
    expect(legacy[1]! - legacy[0]!).toBeCloseTo(modern[1]! - modern[0]!, 6);
  });

  test('a right-aligned table puts its last cell content on the right text edge', () => {
    const right = table(`${SPACING}<w:jc w:val="right"/>`);
    const legacy = structure(right, 14);
    const modern = structure(right, 15);
    expect(modern.outerRuleOffsetPt ?? 0).toBeLessThan(1);
    // The reference moved the table 16.08pt right of its mode-15 place.
    expect(legacy.outerRuleOffsetPt! - (modern.outerRuleOffsetPt ?? 0)).toBeCloseTo(16.08, 0);
  });

  test('a centred table, mode 15, and an unstyled table without an indent keep the outer edge', () => {
    // A centred table aligns no content; it centres its outer rules' centres, a quarter of
    // each 0.5pt rule toward the left (`legacySpacedFrameRuleCenters`).
    const centred = structure(table(`${SPACING}<w:jc w:val="center"/>`), 14);
    expect(centred.legacyContentOffsetPt).toBeUndefined();
    expect(centred.outerRuleOffsetPt).toBeCloseTo(-0.25, 6);
    expect(structure(table(SPACING), 15).legacyContentOffsetPt).toBeUndefined();
    // Less half the leading frame rule: 0.25pt for a 0.5pt rule (measured from 0.25 to 6pt).
    expect(structure(table(SPACING), 14, UNSTYLED).legacyContentOffsetPt).toBe(-0.25);
    const indented = table(`${SPACING}<w:tblInd w:w="300" w:type="dxa"/>`);
    expect(cellTextX(indented, 14, UNSTYLED)[0]![0]).toBeCloseTo(15, 6);
  });
  test('edge cells with different border widths keep the outer edge', () => {
    const wide = (text: string) =>
      cell(text).replace(
        '</w:tcPr>',
        '<w:tcBorders><w:left w:val="single" w:sz="24"/><w:right w:val="single" w:sz="24"/></w:tcBorders></w:tcPr>'
      );
    const rows = FULL + `<w:tr>${wide('c')}${cell('d')}</w:tr>`;
    expect(structure(table(SPACING, rows), 14).legacyContentOffsetPt).toBeUndefined();
  });
});

describe('legacy placement of a table whose rows skip grid columns', () => {
  const second = (cellsOfRow: string, trPr: string) => `<w:tr>${trPr}${cellsOfRow}</w:tr>`;

  test('the first cell on the left grid edge sits on the text edge', () => {
    for (const mode of LEGACY) {
      const before = cellTextX(table('', FULL + second(cell('c'), GRID_BEFORE)), mode);
      expect(before[0]![0]).toBeCloseTo(0, 6);
      // The skipped column keeps its width: the second row's cell starts under `b`.
      expect(before[1]![0]).toBeCloseTo(before[0]![1]!, 6);
      const leading = cellTextX(table('', second(cell('c'), GRID_BEFORE) + FULL), mode);
      expect(leading[1]![0]).toBeCloseTo(0, 6);
      const after = cellTextX(table('', FULL + second(cell('d'), GRID_AFTER)), mode);
      expect(after[0]![0]).toBeCloseTo(0, 6);
      expect(after[1]![0]).toBeCloseTo(0, 6);
      const indented = table(
        '<w:tblInd w:w="300" w:type="dxa"/>',
        FULL + second(cell('c'), GRID_BEFORE)
      );
      expect(cellTextX(indented, mode)[0]![0]).toBeCloseTo(15, 6);
    }
  });

  test('a right-aligned table aligns the last cell on the right grid edge', () => {
    const rows = FULL + second(cell('d'), GRID_AFTER);
    expect(structure(table('<w:jc w:val="right"/>', rows), 14).outerRuleOffsetPt).toBeCloseTo(
      5.4,
      6
    );
  });

  test('mode 15 keeps the outer edge', () => {
    const rows = FULL + second(cell('c'), GRID_BEFORE);
    expect(structure(table('', rows), 15).legacyContentOffsetPt).toBeUndefined();
    expect(cellTextX(table('', rows), 15)[0]![0]).toBeGreaterThan(5);
  });
});
