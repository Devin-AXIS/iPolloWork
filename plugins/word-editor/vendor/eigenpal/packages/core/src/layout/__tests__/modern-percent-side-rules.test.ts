import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';

// Reference renderings of mode-15 tables whose cells all have one simple rule width (0.5, 1.5
// and 3pt rules, cell margins of 0 to 5.4pt, 50 to 150%, fixed and AutoFit, both
// directions) centre every rule on a grid line and measure each margin from that line. A
// percentage is then a share of the container less the rule, and the grid moves in by half
// a rule from a left or right alignment.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ROOM = 300;
interface Shape {
  readonly width?: string;
  readonly type?: string;
  readonly jc?: string;
  readonly sz?: number;
  readonly innerSz?: number;
  readonly margin?: number;
  readonly fixed?: boolean;
  readonly bidi?: boolean;
  readonly text?: string;
  /** Both grid columns, in twips. */
  readonly col?: number;
}
function source(shape: Shape = {}) {
  const { sz = 24, margin = 5.4, type = 'pct' } = shape;
  const inner = shape.innerSz ?? sz;
  const rule = (side: string, size: number) => `<w:${side} w:val="single" w:sz="${size}"/>`;
  const sides = ['top', 'left', 'bottom', 'right'].map((side) => rule(side, sz)).join('');
  // `sz` 0 stands for a table without rules.
  const borders =
    sz === 0
      ? ''
      : `<w:tblBorders>${sides}${rule('insideH', inner)}${rule('insideV', inner)}</w:tblBorders>`;
  const col = shape.col ?? 1440;
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const xml =
    `<w:tbl><w:tblPr>${shape.bidi ? '<w:bidiVisual/>' : ''}` +
    `<w:tblW w:w="${shape.width ?? '5000'}" w:type="${type}"/>` +
    `${shape.jc ? `<w:jc w:val="${shape.jc}"/>` : ''}${shape.fixed ? '<w:tblLayout w:type="fixed"/>' : ''}` +
    `${borders}<w:tblCellMar><w:left w:w="${margin * 20}" w:type="dxa"/>` +
    `<w:right w:w="${margin * 20}" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${col}"/><w:gridCol w:w="${col}"/></w:tblGrid>` +
    `<w:tr>${cell(shape.text ?? 'A')}${cell('B')}</w:tr></w:tbl>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${xml}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body')! as OoxmlElement;
  return { part: parsed.part, table: body.children[0]! as OoxmlElement };
}
function read(shape: Shape, mode = 15) {
  return readTableStructure(source(shape).table, ROOM, 0, undefined, 'proposed', undefined, mode)!;
}
const grid = (structure: ReturnType<typeof read>) =>
  structure.columnWidthsPt.reduce((sum, width) => sum + width, 0);

test('a mode-15 percentage table takes its share of the container less the rule', () => {
  for (const fixed of [false, true]) {
    for (const percent of [50, 100, 150]) {
      const structure = read({ width: String(percent * 50), fixed });
      expect(grid(structure)).toBeCloseTo((percent / 100) * (ROOM - 3), 6);
      for (const cell of structure.rows[0]!.cells) expect(cell.centeredSideRules).toBe(true);
    }
  }
});

test('its grid moves in by half a rule from a left or right alignment', () => {
  expect(read({ jc: 'left' }).outerRuleOffsetPt).toBe(1.5);
  expect(read({ jc: 'right' }).outerRuleOffsetPt).toBe(-1.5);
  // A percentage states its own width, so a table past its container keeps the offset.
  expect(read({ width: '7500', jc: 'left' }).outerRuleOffsetPt).toBe(1.5);
  const centred = read({ jc: 'center', width: '2500' });
  expect(centred.outerRuleOffsetPt).toBeUndefined();
  expect(tableOriginX(centred, ROOM)).toBeCloseTo((ROOM - grid(centred)) / 2, 6);
});

test('the text starts a margin from the rule centre, or at its inner half', () => {
  const run = (margin: number) => {
    const { part } = source({ margin, jc: 'left' });
    const result = layoutSemanticDocument(part, 0, {
      compatibilityMode: 15,
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: ROOM, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    });
    const fragment = result.pages[0]!.fragments[0]!;
    if (fragment.kind !== 'table') throw new Error('Expected table');
    const paragraph = fragment.rows[0]!.cells[0]!.blocks[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
    return { grid: fragment.box.x, text: paragraph.lines[0]!.box.x };
  };
  expect(run(0)).toEqual({ grid: 1.5, text: 3 });
  expect(run(5.4)).toEqual({ grid: 1.5, text: 6.9 });
});

test('mixed and absent rules keep the previous percentage geometry', () => {
  for (const shape of [{ innerSz: 4 }, { sz: 0 }] satisfies Shape[]) {
    const structure = read(shape);
    expect(structure.outerRuleOffsetPt).toBeUndefined();
    expect(structure.rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  }
  // The legacy modes keep their own reference box.
  expect(read({}, 14).outerRuleOffsetPt).toBeUndefined();
});

test('a widened percentage column keeps the shared insets', () => {
  // An unbreakable word widens its column by its margins only: the shared line adds no rule.
  const { part } = source({ width: '2500', text: 'a'.repeat(20) });
  const before = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, {
    compatibilityMode: 15,
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: ROOM, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const fragment = result.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'table') throw new Error('Expected table');
  const cell = fragment.rows[0]!.cells[0]!;
  const paragraph = cell.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
  expect(paragraph.lines).toHaveLength(1);
  expect(cell.box.width).toBeCloseTo(paragraph.lines[0]!.box.width + 10.8, 6);
  expect(serializeOoxmlPart(part)).toBe(before);
});

// Right-to-left references mirror the left-to-right grid, then move half a rule toward the
// visual left: a leading grid ends one rule short of the right edge, a centred one sits half
// a rule left of centre, and a trailing one starts on the left edge. Percentage, automatic
// and absolute widths agree.
test('a mode-15 right-to-left table mirrors the shared grid lines', () => {
  const offsets = (type: string, width: string) =>
    ['left', 'center', 'right'].map(
      (jc) => read({ type, width, jc, bidi: true }).outerRuleOffsetPt
    );
  expect(offsets('pct', '2500')).toEqual([-3, -1.5, 0]);
  expect(offsets('dxa', '2880')).toEqual([-3, -1.5, 0]);
  expect(offsets('auto', '0')).toEqual([-3, -1.5, 0]);
  expect(grid(read({ width: '5000', bidi: true }))).toBeCloseTo(ROOM - 3, 6);
});

// Legacy right-to-left references with zero margins and 1.5 or 3pt rules put the leading
// content edge, the rule's inner half, on the right text edge. The trailing side places by
// its margin alone, and the reference box holds both rule halves.
test('a legacy right-to-left table leads with its content edge', () => {
  const leading = read({ margin: 0, bidi: true }, 14);
  expect(grid(leading)).toBeCloseTo(ROOM + 3, 6);
  expect(tableOriginX(leading, ROOM) + grid(leading)).toBeCloseTo(ROOM + 1.5, 6);
  const trailing = read({ margin: 0, bidi: true, jc: 'right' }, 14);
  expect(tableOriginX(trailing, ROOM)).toBeCloseTo(0, 6);
});

test('a mode-15 fixed table without a width keeps the offset past its container', () => {
  // Right-aligned fixed references with grids of 100 to 130% of the container.
  for (const col of [3000, 3900]) {
    const structure = read({ type: 'auto', width: '0', jc: 'right', fixed: true, col });
    expect(grid(structure)).toBeGreaterThanOrEqual(ROOM);
    expect(structure.outerRuleOffsetPt).toBe(-1.5);
  }
});
