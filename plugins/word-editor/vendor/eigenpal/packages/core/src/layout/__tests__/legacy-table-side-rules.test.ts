import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source(
  margin = 0,
  extra = '',
  rightWidth = 4,
  style = 'single',
  widthType = 'dxa',
  rightStyle = style
) {
  const xml = `<w:tbl><w:tblPr><w:tblW w:w="2880" w:type="${widthType}"/>${extra}<w:tblBorders><w:left w:val="${style}" w:sz="4"/><w:right w:val="${rightStyle}" w:sz="${rightWidth}"/></w:tblBorders><w:tblCellMar><w:left w:type="dxa" w:w="${margin * 20}"/><w:right w:type="dxa" w:w="${margin * 20}"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body')! as OoxmlElement;
  return { part: parsed.part, table: body.children[0]! as OoxmlElement };
}
function read(table: OoxmlElement, mode?: number, depth = 0) {
  return readTableStructure(table, 300, depth, undefined, 'proposed', undefined, mode)!;
}
function layout(
  part: ReturnType<typeof source>['part'],
  mode?: number,
  session = createLayoutSession()
) {
  return layoutSemanticDocument(part, 0, {
    compatibilityMode: mode,
    measurer: createFixedMeasurer(6, 12),
    session,
    geometry: { width: 300, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
}
const CENTRED = '<w:jc w:val="center"/>';
for (const mode of [undefined, 11, 12, 14]) {
  for (const margin of [0, 0.5, 5.4]) {
    test(`mode ${mode} centers equal side rules and shares clearance with margin ${margin}`, () => {
      const { part, table } = source(margin);
      const before = serializeOoxmlPart(part);
      expect(read(table, mode).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
      const options = {
        compatibilityMode: mode,
        measurer: createFixedMeasurer(6, 12),
        session: createLayoutSession(),
        geometry: { width: 300, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      };
      const layout = layoutSemanticDocument(part, 0, options);
      expect(layoutSemanticDocument(part, 0, options).pages).toEqual(layout.pages);
      const fragment = layout.pages[0]!.fragments[0]!;
      if (fragment.kind !== 'table') throw new Error('Expected table');
      const cell = fragment.rows[0]!.cells[0]!;
      expect(fragment.box.x).toBe(0);
      expect(fragment.box.width).toBe(144);
      const paragraph = cell.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
      const content = paragraph.lines[0]!.box;
      expect(content.x - cell.box.x).toBe(Math.max(margin, 0.25));
      expect(cell.box.width - content.width).toBeCloseTo(2 * Math.max(margin, 0.25), 8);
      const strokes = cell.borders!.strokes!;
      expect(strokes.find((edge) => edge.side === 'left')!.x).toBe(-0.25);
      expect(strokes.find((edge) => edge.side === 'right')!.x).toBe(143.75);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }
}

test('mode changes do not reuse the legacy side-rule projection', () => {
  const { table } = source(0.5);
  const legacy = read(table, 14);
  expect(read(table, 15)).not.toEqual(legacy);
  expect(read(table, 14)).toEqual(legacy);
});

test('compound, unequal, separated, positioned and percentage tables retain their geometry policy', () => {
  for (const table of [
    source(0.5, '', 8).table,
    source(0.5, '', 4, 'double').table,
    source(0.5, '<w:tblCellSpacing w:w="20" w:type="dxa"/>').table,
    source(0.5, '<w:tblpPr w:horzAnchor="text" w:vertAnchor="text" w:tblpX="1" w:tblpY="1"/>')
      .table,
    source(0.5, '', 4, 'single', 'pct').table,
  ])
    expect(read(table, 12).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
});

// Nested reference renderings with 0.5pt rules put each rule centre on a grid line that sits
// half a rule in from the cell edge, and the text a margin from that line, in every mode.
test('a nested table with one rule width shares its grid lines in every mode', () => {
  for (const mode of [12, 14, 15]) {
    const nested = read(source().table, mode, 1);
    expect(nested.rows[0]!.cells[0]!.centeredSideRules).toBe(true);
    expect(nested.outerRuleOffsetPt).toBe(0.25);
  }
  // Unequal side rules are not that shape.
  expect(read(source(0, '', 8).table, 12, 1).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
});

// A right-to-left legacy table shares its grid lines the same way.
test('a bidiVisual legacy table shares the grid line', () => {
  expect(read(source(0.5, '<w:bidiVisual/>').table, 12).rows[0]!.cells[0]!.centeredSideRules).toBe(
    true
  );
});

// Mode 16 is above 15, the newest documented mode, and lays out as mode 15. This bordered
// one-cell table starts its text 0.48pt further in at modes 15 and 16 than at modes 12 and
// 14, and at the same place in both pairs.
test('mode 16 takes the mode 15 side-rule geometry', () => {
  const { part, table } = source(0);
  expect(read(table, 16)).toEqual(read(table, 15));
  expect(layout(part, 16).pages).toEqual(layout(part, 15).pages);
  expect(read(table, 14).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
});

// Mode 15 shares the grid line for a centred `dxa` table. Captured controls at 0.5-6pt strokes
// and 0 or 5.4pt margins put text and strokes at the mode-14 positions, fixed or autofit.
for (const fixed of [false, true]) {
  for (const margin of [0, 5.4]) {
    test(`mode 15 centred dxa ${fixed ? 'fixed' : 'autofit'} table shares the grid line at margin ${margin}`, () => {
      const extra = `${CENTRED}${fixed ? '<w:tblLayout w:type="fixed"/>' : ''}`;
      const { part, table } = source(margin, extra);
      const before = serializeOoxmlPart(part);
      const cell = read(table, 15).rows[0]!.cells[0]!;
      expect(cell.centeredSideRules).toBe(true);
      expect(cell.centeredSidePaint).toBe(true);
      const modern = layout(part, 15);
      expect(modern.pages).toEqual(layout(part, 14).pages);
      const fragment = modern.pages[0]!.fragments[0]!;
      if (fragment.kind !== 'table') throw new Error('Expected table');
      expect(fragment.box.x).toBe(78);
      const painted = fragment.rows[0]!.cells[0]!;
      const paragraph = painted.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
      expect(paragraph.lines[0]!.box.x - painted.box.x).toBeCloseTo(Math.max(margin, 0.25), 8);
      const strokes = painted.borders!.strokes!;
      expect(strokes.find((edge) => edge.side === 'left')!.x).toBe(-0.25);
      expect(strokes.find((edge) => edge.side === 'right')!.x).toBe(143.75);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }
}

test('mode 15 keeps the full-stroke inset for shapes its controls do not cover', () => {
  // Left- and right-aligned `dxa` tables are covered in `modern-edge-aligned-side-rules.test.ts`,
  // percentage and right-to-left tables in `modern-percent-side-rules.test.ts`.
  for (const table of [
    source(0.5, CENTRED, 8).table,
    source(0.5, CENTRED, 4, 'double').table,
    source(0.5, `${CENTRED}<w:tblCellSpacing w:w="20" w:type="dxa"/>`).table,
    source(
      0.5,
      `${CENTRED}<w:tblpPr w:horzAnchor="text" w:vertAnchor="text" w:tblpX="1" w:tblpY="1"/>`
    ).table,
  ]) {
    const cell = read(table, 15).rows[0]!.cells[0]!;
    expect(cell.centeredSideRules).toBeUndefined();
    expect(cell.centeredSidePaint).toBeUndefined();
  }
  expect(read(source(0.5, CENTRED).table, 16).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
});

// Captured centred controls drawn with `w:tblW w:type="auto"` put text and strokes where the
// matching `dxa` controls do, fixed or autofit.
test('mode 15 centred auto-width table takes the centred dxa geometry', () => {
  for (const extra of [CENTRED, `${CENTRED}<w:tblLayout w:type="fixed"/>`]) {
    const auto = source(0, extra, 4, 'single', 'auto');
    const cell = read(auto.table, 15).rows[0]!.cells[0]!;
    expect(cell.centeredSideRules).toBe(true);
    expect(cell.centeredSidePaint).toBe(true);
    const geometry = (part: typeof auto.part) => {
      const fragment = layout(part, 15).pages[0]!.fragments[0]!;
      if (fragment.kind !== 'table') throw new Error('Expected table');
      const painted = fragment.rows[0]!.cells[0]!;
      const paragraph = painted.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
      return { table: fragment.box, cell: painted.box, line: paragraph.lines[0]!.box };
    };
    const shape = geometry(auto.part);
    expect(shape).toEqual(geometry(source(0, extra).part));
    expect(shape.line.x - shape.cell.x).toBe(0.25);
  }
});

test('mode 15 admits a directly disabled bidiVisual flag', () => {
  const { table } = source(0.5, `${CENTRED}<w:bidiVisual w:val="0"/>`);
  expect(read(table, 15).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
});

test('a retained session relays a side-ruled table when the mode changes', () => {
  for (const { part } of [source(0, CENTRED), source(0)]) {
    const session = createLayoutSession();
    for (const mode of [14, 15, 16, 14, 15])
      expect(layout(part, mode, session).pages).toEqual(layout(part, mode).pages);
  }
  expect(layout(source(0).part, 15).pages).not.toEqual(layout(source(0).part, 14).pages);
});

// A compound opposite edge stays outside the modern simple-side-rule subset.
test('mode 15 mixed compound side rules preserve full-stroke layout and paint', () => {
  for (const widthType of ['dxa', 'auto']) {
    for (const styles of [
      ['single', 'double'],
      ['double', 'single'],
    ]) {
      const original = source(0, CENTRED, 24, styles[0], widthType, styles[1]);
      const xml = serializeOoxmlPart(original.part)
        .replace('Left', 'AAAAA AAAAA AAAAA AAAAA AAAAA')
        .replace('w:sz="4"', 'w:sz="24"');
      const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
      if (!parsed.ok) throw new Error(parsed.reason);
      const cell = read(original.table, 15).rows[0]!.cells[0]!;
      expect(cell.centeredSideRules).toBeUndefined();
      expect(cell.centeredSidePaint).toBeUndefined();
      const session = createLayoutSession();
      if (widthType === 'dxa') {
        const placed = layout(parsed.part, 15).pages[0]!.fragments[0]!;
        if (placed.kind !== 'table') throw new Error('Expected table');
        const paragraph = placed.rows[0]!.cells[0]!.blocks[0]!;
        if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
        expect(paragraph.lines).toHaveLength(2);
      }
      expect(layout(parsed.part, 15, session).pages).toEqual(layout(parsed.part, 16).pages);
      expect(layout(parsed.part, 15, session).pages).toEqual(layout(parsed.part, 15).pages);
      // Keep the earlier compatibility policy outside this modern admission correction.
      for (const mode of [undefined, 11, 12, 14])
        expect(read(original.table, mode).rows[0]!.cells[0]!.centeredSideRules).toBe(
          widthType === 'dxa' ? true : undefined
        );
    }
  }
});
