import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>
<w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>
<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
function document(
  extra = '',
  cell = '',
  indent = 108,
  width = 'auto',
  text = 'abcdefghij klmnopqrst',
  lastCell = cell
) {
  const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4"/>`)
    .join('');
  return part(`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
<w:tblW w:w="${width === 'auto' ? 0 : 2000}" w:type="${width}"/><w:tblInd w:w="${indent}" w:type="dxa"/>
<w:tblBorders>${edges}</w:tblBorders><w:tblLayout w:type="fixed"/>${extra}</w:tblPr>
<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${[0, 1]
    .map(
      (index) =>
        `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/>${index === 0 ? cell : lastCell}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
    )
    .join('')}</w:tr></w:tbl><w:p/></w:body></w:document>`);
}
function structure(doc = document(), mode: number | null = 14, depth = 0, cascade = styles) {
  const body = doc.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const table = body.children.find((node) => node.kind === 'table') as OoxmlElement;
  return readTableStructure(table, 300, depth, cascade, 'proposed', undefined, mode ?? undefined)!;
}
function layout(
  doc: ReturnType<typeof document>,
  session = createLayoutSession(),
  revision = 0,
  cascade = styles,
  compatibilityMode: number | undefined = 14
) {
  return layoutSemanticDocument(doc, revision, {
    compatibilityMode,
    styleCascade: cascade,
    measurer: createFixedMeasurer(3.9, 12),
    session,
    geometry: { width: 444, height: 400, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
  });
}

describe('legacy fixed table content edges', () => {
  test('the indent owns the first content edge without changing the grid', () => {
    for (const width of ['auto', 'dxa']) {
      const s = structure(document('', '', 108, width));
      expect(s.columnWidthsPt).toEqual([50, 50]);
      expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
      expect(cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBe(5.4);
      expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(5.4);
    }
  });
  test('zero and signed indents retain the complete authored displacement', () => {
    for (const indent of [-200, 0, 987]) {
      const s = structure(document('', '', indent));
      expect(tableOriginX(s, 300) + cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBeCloseTo(
        indent / 20,
        8
      );
    }
  });
  test('cell margins override inherited margins at the leading edge', () => {
    const s = structure(
      document(
        '',
        '<w:tcMar><w:left w:w="240" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tcMar>'
      )
    );
    expect(tableOriginX(s, 300)).toBeCloseTo(5.4 - 12, 8);
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBe(12);
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(9);
  });
  test('a narrow margin clears half the rule without a second charge', () => {
    const s = structure(document('<w:tblCellMar><w:right w:w="6" w:type="dxa"/></w:tblCellMar>'));
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(0.3);
  });
  test('reclaimed side clearance keeps a complete word on its line', () => {
    // Ten 3.9pt glyphs fit in 39.2pt. Charging an extra 0.5pt splits that word.
    const result = layout(document());
    const table = result.pages[0]!.fragments.find((item) => item.kind === 'table')!;
    if (table.kind !== 'table') throw new Error('table');
    const p = table.rows[0]!.cells[0]!.blocks[0]!;
    if (p.kind !== 'paragraph') throw new Error('paragraph');
    expect(p.lines).toHaveLength(2);
    expect(
      p.lines[0]!.spans.map((span) => span.text)
        .join('')
        .trim()
    ).toBe('abcdefghij');
  });
  test('every legacy mode aligns the first content edge; newer modes keep the prior origin', () => {
    // Word places the first cell's text at the same position with no mode and with modes 11,
    // 12 and 14, and about 5.7pt further in with modes 15, 16 and above.
    for (const mode of [null, 11, 12, 14]) {
      expect(tableOriginX(structure(document(), mode), 300)).toBeCloseTo(0, 8);
      for (const width of ['auto', 'dxa']) {
        const doc = document('', '', 108, width);
        const table = layout(doc, createLayoutSession(), 0, styles, mode ?? undefined).pages[0]!
          .fragments[0]!;
        if (table.kind !== 'table') throw new Error('table');
        const p = table.rows[0]!.cells[0]!.blocks[0]!;
        if (p.kind !== 'paragraph') throw new Error('paragraph');
        expect(p.lines[0]!.box.x).toBeCloseTo(5.4, 8);
      }
    }
    for (const mode of [15, 16, 17]) {
      // The prior origin plus half the 0.5pt outer rule (`modernGridLineSideRules`).
      expect(tableOriginX(structure(document(), mode), 300)).toBeCloseTo(5.65, 8);
      const table = layout(document(), createLayoutSession(), 0, styles, mode).pages[0]!
        .fragments[0]!;
      if (table.kind !== 'table') throw new Error('table');
      const p = table.rows[0]!.cells[0]!.blocks[0]!;
      if (p.kind !== 'paragraph') throw new Error('paragraph');
      expect(p.lines[0]!.box.x).toBeCloseTo(11.05, 8);
    }
  });
  test('a right-to-left table aligns the content edge of its aligned outer cell', () => {
    // Leading-aligned (`left`) puts the visual right cell's text edge on the right text edge;
    // trailing-aligned (`right`) puts the visual left cell's text edge on the left text edge.
    expect(structure(document('<w:bidiVisual/>')).outerRuleOffsetPt).toBe(5.4);
    expect(structure(document('<w:bidiVisual/><w:jc w:val="right"/>')).outerRuleOffsetPt).toBe(
      -5.4
    );
  });
  test('a right-to-left table reads the margin of its visual outer cell', () => {
    const wide = (side: string) => `<w:tcMar><w:${side} w:w="200" w:type="dxa"/></w:tcMar>`;
    // The first cell in document order is the visually rightmost one, and a right-to-left
    // table puts w:left on the physical right side.
    const leading = document('<w:bidiVisual/>', wide('left'), 108, 'auto', undefined, '');
    expect(structure(leading).outerRuleOffsetPt).toBe(10);
    const trailing = document(
      '<w:bidiVisual/><w:jc w:val="right"/>',
      '',
      108,
      'auto',
      undefined,
      wide('right')
    );
    expect(structure(trailing).outerRuleOffsetPt).toBe(-10);
  });

  test('a text-box table aligns the content of a leading alignment only', () => {
    const s = (extra: string) =>
      readTableStructure(
        (
          document(extra).root.children.find((node) => node.kind === 'body') as OoxmlElement
        ).children.find((node) => node.kind === 'table') as OoxmlElement,
        300,
        0,
        styles,
        'proposed',
        undefined,
        14,
        undefined,
        true
      )!;
    expect(s('').outerRuleOffsetPt).toBe(-5.4);
    expect(s('<w:jc w:val="right"/>').outerRuleOffsetPt).toBeUndefined();
    // A right-to-left table leads from its visual right, so its content moves right there.
    expect(s('<w:bidiVisual/>').outerRuleOffsetPt).toBe(5.4);
    expect(s('<w:bidiVisual/><w:jc w:val="right"/>').outerRuleOffsetPt).toBeUndefined();
  });

  test('a right-aligned table aligns the content edge of its last cell', () => {
    expect(structure(document('<w:jc w:val="right"/>')).outerRuleOffsetPt).toBe(5.4);
  });
  test('table boundaries retain their prior origin', () => {
    expect(structure(document('<w:jc w:val="center"/>')).outerRuleOffsetPt).toBeUndefined();
    expect(structure(document('', '', 108, 'pct')).outerRuleOffsetPt).toBeUndefined();
    // A nested table shares its grid lines instead: half its 0.5pt rule in from the cell edge.
    expect(structure(document(), 14, 1).outerRuleOffsetPt).toBe(0.25);
  });
  test('a leading margin narrower than half the rule starts the text at the half', () => {
    const cell = '<w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar>';
    expect(structure(document('', cell)).outerRuleOffsetPt).toBe(-0.25);
  });
  test('invalid margins and unsupported border clearances keep the original geometry', () => {
    for (const cell of [
      '<w:tcMar><w:left w:w="20" w:type="pct"/></w:tcMar>',
      '<w:tcBorders><w:left w:val="double" w:sz="4"/></w:tcBorders>',
      '<w:tcBorders><w:left w:val="single" w:sz="8"/></w:tcBorders>',
    ])
      expect(structure(document('', cell)).outerRuleOffsetPt).toBeUndefined();
  });
  test('a later row with another leading margin keeps the first row origin', () => {
    // 17.4.43 `w:tcMar`: leading-aligned rows share the origin of the first of them.
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    const changed = row.replace(
      '</w:tcPr>',
      '<w:tcMar><w:left w:w="240" w:type="dxa"/></w:tcMar></w:tcPr>'
    );
    const base = structure();
    const s = structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>')));
    expect(s.outerRuleOffsetPt).toBe(base.outerRuleOffsetPt);
    expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
    expect(s.rows.map((r) => r.xShiftPt)).toEqual([undefined, undefined]);
  });
  test('unresolved row cell spacing retains the original table origin', () => {
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    const exception = '<w:tblCellSpacing w:w="240" w:type="dxa"/>';
    const changed = row.replace('<w:tr>', `<w:tr><w:tblPrEx>${exception}</w:tblPrEx>`);
    const s = structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>')));
    expect(s.outerRuleOffsetPt).toBeUndefined();
    expect(tableOriginX(s, 300)).toBe(5.4);
  });
  test('row width, indent, layout and margin exceptions keep the legacy origin', () => {
    // 17.4.61 `w:tblPrEx`: these exceptions leave a leading-aligned row on the shared origin.
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    for (const exception of [
      '<w:tblCellMar><w:left w:w="360" w:type="dxa"/></w:tblCellMar>',
      '<w:tblInd w:w="240" w:type="dxa"/>',
      '<w:tblW w:w="4000" w:type="dxa"/>',
      '<w:tblLayout w:type="autofit"/>',
    ]) {
      const changed = row.replace('<w:tr>', `<w:tr><w:tblPrEx>${exception}</w:tblPrEx>`);
      const s = structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>')));
      expect(s.outerRuleOffsetPt).toBe(-5.4);
      expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
    }
  });
  test('a row margin exception on top and bottom only keeps the legacy origin', () => {
    // 17.4.60 `w:tblPrEx`, 17.4.42 `w:tblCellMar`: no leading margin changes, so the
    // content edge stays where the table's own margin places it.
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    const exception =
      '<w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>';
    const changed = row.replace('<w:tr>', `<w:tr>${exception}`);
    const base = structure();
    const s = structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>')));
    expect(base.outerRuleOffsetPt).toBeDefined();
    expect(s.outerRuleOffsetPt).toBe(base.outerRuleOffsetPt);
    expect(tableOriginX(s, 300)).toBe(tableOriginX(base, 300));
  });
  test('vertical merge continuation keeps the same leading content edge', () => {
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    const restart = row.replace('</w:tcPr>', '<w:vMerge w:val="restart"/></w:tcPr>');
    const continuation = row.replace('</w:tcPr>', '<w:vMerge/></w:tcPr>');
    const s = structure(part(xml.replace(row, restart + continuation)));
    expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
    expect(s.rows[1]!.cells[0]!.vMergeContinue).toBe(true);
  });
  test('invalid inherited indentation does not authorize a new origin', () => {
    for (const attrs of ['w:w="300" w:type="pct"', 'w:w="bad" w:type="dxa"']) {
      const cascade = buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="table" w:default="1" w:styleId="Default"><w:name w:val="Default"/><w:tblPr><w:tblInd ${attrs}/></w:tblPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      );
      expect(structure(document(), 14, 0, cascade).outerRuleOffsetPt).toBeUndefined();
    }
  });
  test('style margin edits use fresh content geometry in a retained session', () => {
    const doc = part(
      serializeOoxmlPart(document()).replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="Named"/>')
    );
    const session = createLayoutSession();
    for (const [revision, margin] of [108, 240, 108].entries()) {
      const cascade = buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="table" w:styleId="Named"><w:name w:val="Named"/><w:tblPr><w:tblCellMar><w:left w:w="${margin}" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      );
      expect(structure(doc, 14, 0, cascade).rows[0]!.cells[0]!.margins.left).toBe(margin / 20);
      const warm = layout(doc, session, revision, cascade);
      expect(warm.pages).toEqual(layout(doc, createLayoutSession(), revision, cascade).pages);
      expect(layout(doc, session, revision, cascade).pages[0]).toBe(warm.pages[0]);
    }
  });
  test('geometry edits preserve warm/cold results and canonical content', () => {
    const session = createLayoutSession();
    for (const [revision, indent] of [108, 300, 0].entries()) {
      const doc = document('', '', indent);
      const before = serializeOoxmlPart(doc);
      const warm = layout(doc, session, revision);
      const cold = layout(doc, createLayoutSession(), revision);
      expect(warm.pages).toEqual(cold.pages);
      expect(layout(doc, session, revision).pages[0]).toBe(warm.pages[0]);
      expect(serializeOoxmlPart(doc)).toBe(before);
    }
  });
});
