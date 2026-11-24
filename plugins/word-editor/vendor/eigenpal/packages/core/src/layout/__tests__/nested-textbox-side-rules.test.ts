import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';

// Reference renderings of nested tables (0.5 to 3pt rules, 50 to 150%, every alignment and
// direction, modes 11 to 15) and of tables in text boxes (both directions, every width type).
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ROOM = 300;
interface Shape {
  readonly width?: string;
  readonly type?: string;
  readonly jc?: string;
  readonly fixed?: boolean;
  readonly bidi?: boolean;
  readonly margin?: number;
  /** Both grid columns, in twips; 0 drops the grid and the cell widths. */
  readonly col?: number;
  readonly text?: string;
}
function tableXml(shape: Shape = {}) {
  const { margin = 5.4, type = 'pct' } = shape;
  const rule = (side: string) => `<w:${side} w:val="single" w:sz="24"/>`;
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(rule)
    .join('')}</w:tblBorders>`;
  const col = shape.col ?? 1440;
  const cell = (text: string) =>
    `<w:tc>${col ? `<w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr>` : ''}` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  return (
    `<w:tbl><w:tblPr>${shape.bidi ? '<w:bidiVisual/>' : ''}` +
    `<w:tblW w:w="${shape.width ?? '5000'}" w:type="${type}"/>` +
    `${shape.jc ? `<w:jc w:val="${shape.jc}"/>` : ''}${shape.fixed ? '<w:tblLayout w:type="fixed"/>' : ''}` +
    `${borders}<w:tblCellMar><w:left w:w="${margin * 20}" w:type="dxa"/>` +
    `<w:right w:w="${margin * 20}" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `${col ? `<w:tblGrid><w:gridCol w:w="${col}"/><w:gridCol w:w="${col}"/></w:tblGrid>` : ''}` +
    `<w:tr>${cell(shape.text ?? 'A')}${cell('B')}</w:tr></w:tbl>`
  );
}
function parse(xml: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${xml}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body')! as OoxmlElement;
  return { part: parsed.part, table: body.children[0]! as OoxmlElement };
}
function read(
  shape: Shape,
  mode: number,
  where: { depth?: number; textBox?: boolean; autofit?: boolean }
) {
  const { table } = parse(tableXml(shape));
  const { depth = 0, textBox = false } = where;
  const autofit = where.autofit ? { measurer: createFixedMeasurer(6, 12) } : undefined;
  return readTableStructure(
    table,
    ROOM,
    depth,
    undefined,
    'proposed',
    undefined,
    mode,
    autofit,
    textBox
  )!;
}
const grid = (structure: ReturnType<typeof read>) =>
  structure.columnWidthsPt.reduce((sum, width) => sum + width, 0);

test('a nested table with one rule width shares its grid lines in every mode', () => {
  for (const mode of [11, 14, 15]) {
    const nested = (shape: Shape) => read(shape, mode, { depth: 1 });
    expect(grid(nested({ width: '2500' }))).toBeCloseTo(0.5 * (ROOM - 3), 6);
    // A leading grid moves inward by half a rule; a centred one stays centred.
    expect(nested({ width: '2500', jc: 'left' }).outerRuleOffsetPt).toBe(1.5);
    expect(nested({ width: '2500', jc: 'center' }).outerRuleOffsetPt).toBeUndefined();
    // A trailing grid moves inward too in mode 15 and keeps its edge in the older modes.
    expect(nested({ width: '2500', jc: 'right' }).outerRuleOffsetPt ?? 0).toBe(
      mode === 15 ? -1.5 : 0
    );
    expect(nested({ width: '2500', jc: 'left', bidi: true }).outerRuleOffsetPt).toBe(-1.5);
  }
});

function nestedCells(inner: Shape, { fixed = true } = {}) {
  const layout = fixed ? '<w:tblLayout w:type="fixed"/>' : '';
  const outer =
    `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${layout}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>` +
    `<w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${tableXml(inner)}<w:p/></w:tc></w:tr></w:tbl>`;
  const result = layoutSemanticDocument(parse(outer).part, 0, {
    compatibilityMode: 15,
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const fragment = result.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'table') throw new Error('Expected table');
  const nested = fragment.rows[0]!.cells[0]!.blocks[0]!;
  if (nested.kind !== 'table') throw new Error('Expected nested table');
  return { cells: nested.rows[0]!.cells, outer: fragment.rows[0]!.cells[0]!.box.width };
}

test('a nested AutoFit table keeps its resolved widths', () => {
  // The word needs more than its 72pt column inside a 300pt outer cell.
  const { cells } = nestedCells({ type: 'dxa', width: '2880', text: 'a'.repeat(20) });
  const [first, second] = cells;
  expect(first!.box.width).toBeCloseTo(second!.box.width, 6);
  const paragraph = first!.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
  // The word breaks inside its column.
  expect(paragraph.lines.length).toBeGreaterThan(1);
});

test('a nested absolute width wider than its grid stretches the grid', () => {
  const [first, second] = nestedCells({ type: 'dxa', width: '4320', col: 1440 }).cells;
  expect(first!.box.width).toBeCloseTo(second!.box.width, 6);
  expect(first!.box.width + second!.box.width).toBeCloseTo(216, 1);
  // Measured: a stated width past the 300pt outer cell stretches the grid past it too.
  const past = nestedCells({ type: 'dxa', width: '7000', col: 1440 }).cells;
  expect(past[0]!.box.width + past[1]!.box.width).toBeCloseTo(350, 1);
});

// References of nested AutoFit tables in an AutoFit outer table, in modes 14 and 15: the
// nested table widens for its long word, and the outer column with it.
test('in an AutoFit parent a nested AutoFit table widens for its words', () => {
  const short = nestedCells({ type: 'dxa', width: '2880' }, { fixed: false });
  const long = nestedCells({ type: 'dxa', width: '2880', text: 'a'.repeat(55) }, { fixed: false });
  expect(long.outer).toBeGreaterThan(short.outer + 1);
  const paragraph = long.cells[0]!.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
  expect(paragraph.lines).toHaveLength(1);
});

// Right-to-left text box references mirror the left-to-right text box geometry, then move
// 0.75pt toward the visual right, for every width type and mode.
test('a right-to-left table in a text box moves 0.75pt to the right', () => {
  for (const mode of [14, 15]) {
    for (const type of ['pct', 'dxa', 'auto']) {
      const width = type === 'pct' ? '2500' : type === 'dxa' ? '2880' : '0';
      const structure = read({ type, width, bidi: true }, mode, { textBox: true });
      expect(structure.textBoxBidiShiftPt).toBe(0.75);
      const plain = read({ type, width }, mode, { textBox: true });
      expect(plain.textBoxBidiShiftPt).toBeUndefined();
    }
  }
  // A nested table in a text box takes no shift.
  expect(read({ bidi: true }, 15, { depth: 1, textBox: true }).textBoxBidiShiftPt).toBeUndefined();
});

test('a mode-15 percentage table in a text box keeps its trailing grid line on the edge', () => {
  const structure = read({ width: '2500', jc: 'right' }, 15, { textBox: true });
  expect(structure.outerRuleOffsetPt ?? 0).toBe(0);
  expect(tableOriginX(structure, ROOM) + grid(structure)).toBeCloseTo(ROOM, 6);
});

test('a text-box table widened for its content keeps its text-box geometry', () => {
  // A 30-character word widens the first column past its share of the box.
  const long = { width: '2500', text: 'a'.repeat(30) };
  const trailing = read({ ...long, jc: 'right' }, 15, { textBox: true, autofit: true });
  expect(trailing.columnWidthsPt[0]!).toBeGreaterThan(0.25 * ROOM);
  expect(trailing.outerRuleOffsetPt ?? 0).toBe(0);
  const bidi = read({ ...long, bidi: true }, 15, { textBox: true, autofit: true });
  expect(bidi.outerRuleOffsetPt ?? 0).toBe(
    read({ ...long, bidi: true }, 15, { textBox: true }).outerRuleOffsetPt ?? 0
  );
  expect(bidi.textBoxBidiShiftPt).toBe(0.75);
});
