// `w:tblGrid` (17.4.48) seeds a table's columns and `w:tcW` (17.4.71) overrides it: 17.4.16
// calls the grid widths "the initial width of each grid column, which can then be overridden
// by ... the preferred widths of specific cells", and 17.18.87 reconciles rows that disagree
// by MAXIMUM. Anything still unstated shares what the content width has left.
//
// `w:tblW` (17.4.63) then bounds the total, and `w:tblLayout` (17.4.52 — 17.4.53 is the
// `w:tblPrEx` variant) limits unstated autofit widths to the text column. An authored
// positive preferred width can retain a wider grid; the autofit content-growth limit
// does not first shrink that authored width. Fixed tables also retain unstated wider grids.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { readTableStructure } from '../semantic-table.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function tableNode(bodyXml: string): OoxmlElement {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

/** 468pt = 9360 twips, the content width of a portrait Letter page at 1" margins. */
const CONTENT_WIDTH_PT = 468;

function structureOf(bodyXml: string, contentWidthPt: number = CONTENT_WIDTH_PT) {
  return readTableStructure(tableNode(bodyXml), contentWidthPt, 0)!;
}

const cell = (tcPr = '') => `<w:tc>${tcPr}<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
const tcW = (w: string, type = 'dxa') => `<w:tcPr><w:tcW w:w="${w}" w:type="${type}"/></w:tcPr>`;
const grid = (...cols: (number | string)[]) =>
  `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
const total = (widths: readonly number[]) => widths.reduce((sum, width) => sum + width, 0);

describe('w:tcW is read onto the cell', () => {
  test('a dxa preference lands in points', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}<w:tr>${cell(tcW('2340'))}${cell(tcW('2340'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'dxa', value: 117 });
  });

  test('a pct preference is read from fiftieths, the string form, and a decimal percent', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340, 2340)}` +
        `<w:tr>${cell(tcW('2500', 'pct'))}${cell(tcW('50%', 'pct'))}${cell(tcW('33.3%', 'pct'))}</w:tr></w:tbl>`
    );
    const [fiftieths, string, decimal] = structure.rows[0]!.cells;
    expect(fiftieths!.preferredWidth).toEqual({ type: 'pct', value: 50 });
    expect(string!.preferredWidth).toEqual({ type: 'pct', value: 50 });
    // 17.4.71's own example is `w:w="33.3%"`; ST_Percentage admits the decimal.
    expect(decimal!.preferredWidth).toEqual({ type: 'pct', value: 33.3 });
  });

  test('a universal measure is read, since w:w is ST_MeasurementOrPercent not just twips', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('2in'))}${cell(tcW('72pt'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'dxa', value: 144 });
    expect(structure.rows[0]!.cells[1]!.preferredWidth).toEqual({ type: 'dxa', value: 72 });
  });

  test('a measurement that contradicts w:type wins over it, per 17.4.87', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('50%', 'dxa'))}${cell(tcW('1in', 'pct'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'pct', value: 50 });
    expect(structure.rows[0]!.cells[1]!.preferredWidth).toEqual({ type: 'dxa', value: 72 });
  });

  test('an unrecognised w:type is rejected, not silently read as an absolute width', () => {
    // `w:type="Pct" w:w="5000"` read as dxa would be a 250pt hard width instead of 100%.
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('5000', 'Pct'))}${cell(tcW('1440', 'typo'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth.type).toBe('auto');
    expect(structure.rows[0]!.cells[1]!.preferredWidth.type).toBe('auto');
  });

  test('auto, nil, and an absent w:tcW all carry no width', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340, 2340)}` +
        `<w:tr>${cell(tcW('0', 'auto'))}${cell(tcW('0', 'nil'))}${cell()}</w:tr></w:tbl>`
    );
    const [auto, nil, absent] = structure.rows[0]!.cells;
    expect(auto!.preferredWidth.type).toBe('auto');
    expect(nil!.preferredWidth.type).toBe('nil');
    expect(absent!.preferredWidth).toEqual({ type: 'auto', value: 0 });
  });

  test('a hostile w:tcW is rejected the way every sibling geometry read rejects one', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('999999999'))}${cell(tcW('1e3'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth.value).toBeLessThanOrEqual(31_680 / 20);
    // An exponent is not a twips measure: rejected outright.
    expect(structure.rows[0]!.cells[1]!.preferredWidth.type).toBe('auto');
  });

  test('a decimal w:tcW truncates to whole twips', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('1443.74'))}${cell(tcW('9026.0'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells.map((entry) => entry.preferredWidth)).toEqual([
      { type: 'dxa', value: 72.15 },
      { type: 'dxa', value: 451.3 },
    ]);
  });
});

describe('w:tcW overrides the grid it seeds, resolving conflicts by maximum', () => {
  test('a cell asking for more than the grid gets it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}` +
        `<w:tr>${cell(tcW('2880'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([144, 144]);
  });

  test('a cell asking for less than the grid narrows its column', () => {
    // Measured: a stated cell width replaces the grid's width for its column.
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(3000, 1680)}` +
        `<w:tr>${cell(tcW('1000'))}${cell(tcW('1000'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([50, 50]);
  });

  test('rows that disagree resolve to the maximum, not to whichever came first', () => {
    // 17.18.87: "each grid column is adjusted to be the maximum value of the requested widths".
    const structure = structureOf(
      `<w:tbl><w:tblPr/>` +
        `<w:tr>${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr>` +
        `<w:tr>${cell(tcW('2880'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([144, 144]);
  });

  test('the maximum is still bounded by the page for an autofit table', () => {
    // Both rows resolve to 288pt, which overflows the 468pt column, so the fit scales the
    // agreed maximum back down rather than letting w:tcW escape the page clamp.
    const structure = structureOf(
      `<w:tbl><w:tblPr/>` +
        `<w:tr>${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr>` +
        `<w:tr>${cell(tcW('5760'))}${cell(tcW('5760'))}</w:tr></w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
  });

  test('a narrower footprint is authoritative over a span that contains it', () => {
    const spanCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${spanCell}</w:tr>` +
        `<w:tr>${cell(tcW('1440'))}${cell()}</w:tr></w:tbl>`
    );
    // The span states 144pt across both columns; the single-column row settles the first at
    // 72pt, so the span has 72pt left to give the second.
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('a span whose total is already used up by settled columns adds nothing', () => {
    const spanCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${spanCell}</w:tr>` +
        `<w:tr>${cell(tcW('2880'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([144, 144]);
  });

  test('pct cell widths resolve against the table width rather than being discarded', () => {
    // 17.4.71: "any width value of type pct ... shall be calculated relative to the overall
    // width of the table".
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="4680" w:type="dxa"/></w:tblPr>` +
        `<w:tr>${cell(tcW('2500', 'pct'))}${cell(tcW('2500', 'pct'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([117, 117]);
  });
});

describe('w:tblGrid seeds what it can and no more', () => {
  test('a table with no w:tblGrid takes its widths from w:tcW, not an even split', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${cell(tcW('1440'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 144]);
  });

  test('one unreadable w:gridCol costs that column only, not the whole authored grid', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2340"/><w:gridCol/><w:gridCol w:w="2340"/></w:tblGrid>` +
        `<w:tr>${cell()}${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]).toBe(117);
    expect(structure.columnWidthsPt[2]).toBe(117);
    expect(structure.columnWidthsPt[1]!).toBeGreaterThan(0);
  });

  test('a w:gridCol in a universal measure is read, not discarded', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid('2in', 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([144, 72]);
  });

  test('an unstated column cannot swallow the page — it is capped at the stated mean', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${cell(tcW('1440'))}${cell()}</w:tr></w:tbl>`
    );
    // Was 396pt: the whole leftover of the content width for one unstated column.
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('w:wBefore states the skipped band instead of leaving a phantom gutter', () => {
    // 17.18.87: "the width of the skipped grid columns is set using the wBefore property".
    // Another row reaches the skipped column, so it keeps a width.
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>` +
        `<w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="1440" w:type="dxa"/></w:trPr>` +
        `${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr>` +
        `<w:tr>${cell()}${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 72, 72]);
  });

  test('w:wAfter states the trailing skipped band', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>` +
        `<w:trPr><w:gridAfter w:val="1"/><w:wAfter w:w="1440" w:type="dxa"/></w:trPr>` +
        `${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 72, 72]);
  });
});

describe('w:tblLayout decides whether the PAGE bounds the table', () => {
  const wide = `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`;

  test('an autofit table wider than the content box scales down to fit it', () => {
    const structure = structureOf(`<w:tbl><w:tblPr/>${wide}</w:tbl>`);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
    expect(structure.columnWidthsPt[0]).toBeCloseTo(structure.columnWidthsPt[1]!, 6);
  });

  test('a fixed table with no w:tblW is left alone, as Word renders it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.layoutFixed).toBe(true);
    expect(structure.columnWidthsPt).toEqual([360, 360]);
  });

  test('a fixed table IS still held to a stated w:tblW', () => {
    // 17.18.87 puts the proportional reduction against tblW in the fixed algorithm; only the
    // page clamp is autofit-only.
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="2000" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(100, 6);
  });

  test('an autofit table narrower than the content box is not stretched to it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('w:tblLayout w:type="autofit" is autofit, like an absent element', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblLayout w:type="autofit"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.layoutFixed).toBe(false);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
  });
});

describe('w:tblW bounds the total', () => {
  const wide = `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`;
  const narrow = `${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr>`;

  test('a dxa table width narrower than the page is the target', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="4680" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.tableWidth).toEqual({ type: 'dxa', value: 234 });
    expect(total(structure.columnWidthsPt)).toBeCloseTo(234, 6);
  });

  test('a pct table width STRETCHES a narrow table — this is AutoFit to Window', () => {
    // 17.4.63: a pct table width is relative to the page's text extents. 5000 = 100%.
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
    expect(structure.columnWidthsPt[0]).toBeCloseTo(234, 6);
  });

  test('a dxa table width stretches a narrow table too', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr>${narrow}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(468, 6);
  });

  test('a dxa table width past the text column stretches a narrower grid up to it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="20000" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(1000, 6);
  });

  test('a hostile w:tblW cannot crush every column to nothing', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="1" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    for (const width of structure.columnWidthsPt) expect(width).toBeGreaterThanOrEqual(1);
  });
});

describe('a table style states w:tblW and w:tblLayout for every table that names it', () => {
  const STYLES =
    `<w:styles xmlns:w="${W}">` +
    '<w:style w:type="table" w:styleId="Windowed"><w:name w:val="Windowed"/>' +
    '<w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="Fixed"><w:name w:val="Fixed"/>' +
    '<w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr></w:style>' +
    '</w:styles>';
  const cascade = () => buildStyleCascadeTable(part(STYLES, '/word/styles.xml').root);
  const styled = (styleId: string, body: string) =>
    readTableStructure(
      tableNode(`<w:tbl><w:tblPr><w:tblStyle w:val="${styleId}"/></w:tblPr>${body}</w:tbl>`),
      CONTENT_WIDTH_PT,
      0,
      cascade()
    )!;

  test('a style-level w:tblW is honoured', () => {
    const structure = styled('Windowed', `${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr>`);
    expect(structure.tableWidth).toEqual({ type: 'pct', value: 100 });
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
  });

  test('a style-level w:tblLayout is honoured', () => {
    const structure = styled('Fixed', `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`);
    expect(structure.layoutFixed).toBe(true);
    expect(structure.columnWidthsPt).toEqual([360, 360]);
  });

  test('the table’s own w:tblPr wins over the style', () => {
    const structure = readTableStructure(
      tableNode(
        `<w:tbl><w:tblPr><w:tblStyle w:val="Windowed"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
          `${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
      ),
      CONTENT_WIDTH_PT,
      0,
      cascade()
    )!;
    expect(structure.tableWidth.type).toBe('auto');
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });
});

describe('degenerate and hostile geometry stays bounded', () => {
  test('a hostile grid column is dropped, and the columns beside it keep their widths', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(999999999, 1200)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]!).toBeLessThanOrEqual(31_680 / 20);
    expect(structure.columnWidthsPt[1]).toBe(60);
  });

  test('a non-finite content width resolves from the grid instead of poisoning it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`,
      Number.NaN
    );
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('a zero content width never produces a zero or negative column', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`,
      0
    );
    for (const width of structure.columnWidthsPt) expect(width).toBeGreaterThan(0);
  });

  test('no column collapses below a hairline even when the table must shrink hard', () => {
    const cols = Array.from({ length: 20 }, () => 2880);
    const cells = cols.map(() => cell()).join('');
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(...cols)}<w:tr>${cells}</w:tr></w:tbl>`,
      10
    );
    for (const width of structure.columnWidthsPt) expect(width).toBeGreaterThanOrEqual(1);
  });
});

describe('the table fragment box reports the table’s own width', () => {
  function layoutBody(bodyXml: string) {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return layoutSemanticDocument(result.part, 0, { measurer: createFixedMeasurer() });
  }

  function tableFragments(bodyXml: string): TableFragmentRecord[] {
    return layoutBody(bodyXml)
      .pages.flatMap((page) => page.fragments)
      .filter((item): item is TableFragmentRecord => item.kind === 'table');
  }

  const rightEdge = (fragment: TableFragmentRecord) =>
    Math.max(...fragment.rows.flatMap((row) => row.cells.map((c) => c.box.x + c.box.width)));

  test('a table narrower than the page reports its own width, not the page’s', () => {
    const [fragment] = tableFragments(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr></w:tbl>`
    );
    expect(fragment!.box.width).toBeCloseTo(144, 6);
    expect(fragment!.box.width).toBeCloseTo(rightEdge(fragment!), 6);
  });

  test('a fixed table wider than the page reports the width it actually paints', () => {
    const [fragment] = tableFragments(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>` +
        `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(fragment!.box.width).toBeCloseTo(720, 6);
    expect(fragment!.box.x + fragment!.box.width).toBeCloseTo(rightEdge(fragment!), 6);
  });

  test('every fragment of a table that paginates reports the same width', () => {
    const row = `<w:tr>${cell(tcW('1440'))}${cell(tcW('1440'))}</w:tr>`;
    const fragments = tableFragments(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}${row.repeat(300)}</w:tbl>`
    );
    expect(fragments.length).toBeGreaterThan(1);
    for (const fragment of fragments) expect(fragment.box.width).toBeCloseTo(144, 6);
  });

  test('clicking beside a narrow table lands in that row, not in a neighbouring paragraph', () => {
    const layout = layoutBody(
      `<w:p><w:r><w:t>above</w:t></w:r></w:p>` +
        `<w:tbl><w:tblPr/>${grid(1440, 1440)}` +
        `<w:tr>${cell()}${cell()}</w:tr></w:tbl>` +
        `<w:p><w:r><w:t>below</w:t></w:r></w:p>`
    );
    const table = layout.pages[0]!.fragments.find(
      (f): f is TableFragmentRecord => f.kind === 'table'
    )!;
    // Cell block ids carry a `#f<n>` fragment suffix; the hit reports the source paragraph.
    const insideCell = table.rows[0]!.cells[1]!.blocks[0]!.id.replace(/#f\d+$/, '');
    const y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    // 144pt-wide table on a 468pt page: everything past x=144 is blank strip.
    for (const x of [200, 300, 460]) {
      const hit = hitTestPage(layout, 0, { x, y });
      expect(hit?.position.paragraphId).toBe(insideCell);
    }
  });
});

describe('store column resize lands in preferred-width readback', () => {
  test('outer-right resize updates resolved table width in points', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>` +
        `${grid(2400, 3600)}<w:tr>${cell(tcW('2400'))}${cell(tcW('3600'))}</w:tr></w:tbl>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = part.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.kind === 'table') as OoxmlElement;
    const tblGridNode = table.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'tblGrid'
    )!;
    const cols = tblGridNode.children.filter(
      (child) => child.kind !== 'textValue' && child.localName === 'gridCol'
    );
    const result = applyTreeOp(part, {
      op: 'setTableRightEdgeWidth',
      tableId: table.id,
      gridColumnId: cols[1]!.id,
      columnWidthTwips: 4200,
      tableWidthTwips: 6600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const editedTable = result.part.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.id === table.id) as OoxmlElement;
    const structure = readTableStructure(editedTable, CONTENT_WIDTH_PT, 0)!;
    expect(structure.columnWidthsPt).toEqual([120, 210]);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(330, 6);
  });
});

describe('structure memoization over immutable table nodes', () => {
  const TABLE =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4200"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>';

  test('the same table under the same inputs returns the SAME structure object', () => {
    // One layout pass reads a table more than once — document-order indexing, flow
    // layout, row measurement — and the structure is deeply readonly, so the second
    // read must be an identity hit, not a recompute.
    const table = tableNode(TABLE);
    const first = readTableStructure(table, CONTENT_WIDTH_PT, 0);
    const second = readTableStructure(table, CONTENT_WIDTH_PT, 0);
    expect(second).toBe(first);
  });

  test('a changed content width recomputes, and recomputation is value-stable', () => {
    const table = tableNode(TABLE);
    const wide = readTableStructure(table, CONTENT_WIDTH_PT, 0)!;
    const narrow = readTableStructure(table, 200, 0)!;
    expect(narrow).not.toBe(wide);
    const wideAgain = readTableStructure(table, CONTENT_WIDTH_PT, 0)!;
    expect(wideAgain.columnWidthsPt).toEqual(wide.columnWidthsPt);
  });

  test('a changed style cascade recomputes the structure', () => {
    const table = tableNode(TABLE);
    const bare = readTableStructure(table, CONTENT_WIDTH_PT, 0);
    const styles = part(
      `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="TableGrid"><w:tblPr/></w:style></w:styles>`,
      '/word/styles.xml'
    );
    const cascade = buildStyleCascadeTable(styles.root);
    const cascaded = readTableStructure(table, CONTENT_WIDTH_PT, 0, cascade);
    expect(cascaded).not.toBe(bare);
  });
});

describe('a stated cell width replaces the grid width under a stated table width too', () => {
  // `template-with-hf-rule.docx`, the four-column "HISTÓRICO DE REVISÕES" table. Both the
  // grid and the cell preferences total the stated 9026 twips, and they disagree column by
  // column. Measured: the cell widths win (two 1684-twip cells over a 1000/2368 grid under a
  // 3368-twip width lay out equal). In this table AutoFit then widens the first column to
  // hold `{revision_number}` whole, as the reference renders it.
  const REVISION_HISTORY =
    '<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/></w:tblPr>' +
    `${grid(1831, 1770, 3321, 2104)}<w:tr>` +
    `${cell(tcW('1400'))}${cell(tcW('1800'))}${cell(tcW('3626'))}${cell(tcW('2200'))}` +
    '</w:tr></w:tbl>';

  test('a dxa cell preference restates the column the grid seeded', () => {
    const structure = structureOf(REVISION_HISTORY);
    expect(structure.columnWidthsPt).toEqual([70, 90, 181.3, 110]);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(451.3, 6);
  });

  test('the cell widths keep their proportions under the stated total', () => {
    // `footer-page-number.docx`: a seven-column grid totalling 12330 twips in a table that
    // states 9746, whose cells state 9746 between them.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblW w:w="9746" w:type="dxa"/></w:tblPr>' +
        `${grid(2332, 1411, 1521, 1411, 1742, 1671, 2242)}<w:tr>` +
        `${cell(tcW('1500'))}${cell(tcW('1700'))}${cell(tcW('700'))}${cell(tcW('820'))}` +
        `${cell(tcW('900'))}${cell(tcW('1200'))}${cell(tcW('2926'))}` +
        '</w:tr></w:tbl>',
      487.3
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(487.3, 6);
    expect(structure.columnWidthsPt[0]).toBeCloseTo(75, 3);
    expect(structure.columnWidthsPt[6]).toBeCloseTo(146.3, 3);
  });

  test('a column the grid leaves open is settled by the cell preference', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol/></w:tblGrid>' +
        `<w:tr>${cell(tcW('2880'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([108, 108]);
  });

  test('a pct cell preference keeps the older reconciliation, rounding and all', () => {
    // A `pct` preference cannot state an exact twip, so it disagrees with the grid it was
    // computed from by a rounding rather than by intent. 50% of 234pt is 117pt against the
    // grid's 108pt, and the maximum still wins.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblW w:w="4680" w:type="dxa"/></w:tblPr>' +
        `${grid(2160, 2520)}<w:tr>${cell(tcW('2500', 'pct'))}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]!).toBeGreaterThan(108);
  });

  test('without a stated w:tblW the grid is still only a seed', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell(tcW('2880'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([144, 144]);
  });
});
