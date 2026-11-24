// A nested table with `w:tblpPr` (ECMA-376 Part 1, 17.4.57) floats inside its cell: it leaves
// the cell flow, the cell's later paragraphs wrap around it, and the cell grows to hold it.
// `w:horzAnchor` (17.4.58), `w:vertAnchor` (17.4.66), `w:tblpXSpec`/`w:tblpYSpec`
// (17.4.63/17.4.65) and `w:tblOverlap` (17.4.56) resolve against the cell.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${pPr}</w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const words = (tag: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${tag}${index}`).join(' ');
/** `w:tblpPr` with 7.2pt side distances and the given position attributes. */
const at = (position: string) =>
  `<w:tblpPr w:leftFromText="144" w:rightFromText="144" ${position}/>`;
/** A nested table `twips` wide holding `rows` one-line paragraphs labelled `label`0, ... */
const nested = (tblpPr: string, label: string, rows = 2, twips = 2000, extra = '') =>
  `<w:tbl><w:tblPr>${tblpPr}${extra}<w:tblW w:w="${twips}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid><w:tr><w:tc>` +
  Array.from({ length: rows }, (_, index) => p(`${label}${index}`)).join('') +
  '</w:tc></w:tr></w:tbl>';
/** A 300pt-wide outer table; each argument is one row's single cell. */
const outer = (cells: readonly string[], rowProperties = '', cellProperties = '') =>
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
  cells
    .map(
      (cell) =>
        `<w:tr>${rowProperties ? `<w:trPr>${rowProperties}</w:trPr>` : ''}` +
        `<w:tc>${cellProperties ? `<w:tcPr>${cellProperties}</w:tcPr>` : ''}${cell}</w:tc></w:tr>`
    )
    .join('') +
  '</w:tbl>';
const document = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const lay = (body: string) =>
  layoutSemanticDocument(document(body), 0, { measurer: createFixedMeasurer(6, 12) });

const lineText = (line: LineRecord) => line.spans.map((span) => span.text).join('');
const firstText = (paragraph: ParagraphFragmentRecord) => lineText(paragraph.lines[0]!);

/** The outer table fragment on `page`. */
function outerTable(layout: SemanticLayout, page = 0): TableFragmentRecord {
  return layout.pages[page]!.fragments.find(
    (fragment) => fragment.kind === 'table'
  ) as TableFragmentRecord;
}
function outerCell(layout: SemanticLayout, page = 0, row = 0): TableCellFragmentRecord {
  return outerTable(layout, page).rows[row]!.cells[0]!;
}
function floats(blocks: readonly BlockFragmentRecord[]): TableFragmentRecord[] {
  return blocks.filter((block): block is TableFragmentRecord => block.kind === 'table');
}
function cellParagraphs(blocks: readonly BlockFragmentRecord[]): ParagraphFragmentRecord[] {
  return blocks.filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');
}
/** The paragraph of `blocks` whose first line starts with `tag`. */
function paragraph(blocks: readonly BlockFragmentRecord[], tag: string): ParagraphFragmentRecord {
  return cellParagraphs(blocks).find((candidate) => firstText(candidate).startsWith(tag))!;
}
/** Every paragraph text inside a table fragment, in order. */
function tableTexts(table: TableFragmentRecord): string[] {
  return table.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cellParagraphs(cell.blocks).flatMap((q) => q.lines.map(lineText)))
  );
}
/** Whether any span of `line` reaches into [left, right). */
function crosses(line: LineRecord, left: number, right: number): boolean {
  return line.spans.some(
    (span) => span.text.trim() !== '' && span.box.x < right && span.box.x + span.box.width > left
  );
}

test('a nested table with w:tblpPr floats in its cell and the next paragraph wraps around it', () => {
  const layout = lay(
    p('lead') +
      outer([
        p(words('A', 3)) +
          nested(at('w:vertAnchor="text" w:tblpX="1500" w:tblpY="200"'), 'N') +
          p(words('B', 60)),
      ]) +
      p('tail')
  );
  const cell = outerCell(layout);
  const a = paragraph(cell.blocks, 'A0');
  const b = paragraph(cell.blocks, 'B0');
  const [float] = floats(cell.blocks);
  expect(float).toBeDefined();
  expect(float!.floatingWrap?.anchorId).toBe(b.paragraphId);
  // Out of flow: the paragraph after the table starts where the one before it ends.
  expect(b.box.y).toBeCloseTo(a.box.y + a.box.height, 3);
  // `w:tblpX` from the cell's text edge, `w:tblpY` from the top of the following paragraph.
  expect(float!.box.x - a.lines[0]!.box.x).toBeCloseTo(74.95, 2);
  expect(float!.box.y - b.box.y).toBeCloseTo(9.95, 2);
  // Lines beside the table keep clear of it and of its side distances.
  const band = { top: float!.box.y, bottom: float!.box.y + float!.box.height };
  const beside = b.lines.filter(
    (line) => line.box.y < band.bottom && line.box.y + line.box.height > band.top
  );
  expect(beside.length).toBeGreaterThan(0);
  for (const line of beside)
    expect(crosses(line, float!.box.x - 7.2, float!.box.x + float!.box.width + 7.2)).toBe(false);
  // Text continues on both sides of the table.
  expect(
    beside.some((line) => line.spans.some((span) => span.box.x > float!.box.x + float!.box.width))
  ).toBe(true);
});

test('the cell grows to hold a float taller than the text beside it', () => {
  const layout = lay(
    outer([p(words('A', 3)) + nested(at('w:vertAnchor="text" w:tblpY="1"'), 'N', 10) + p('B0')]) +
      p('tail')
  );
  const cell = outerCell(layout);
  const [float] = floats(cell.blocks);
  expect(tableTexts(float!)).toHaveLength(10);
  // The paragraph after the table sits beside it, not below it.
  expect(paragraph(cell.blocks, 'B0').box.y).toBeCloseTo(float!.box.y, 3);
  expect(cell.box.y + cell.box.height).toBeGreaterThanOrEqual(
    float!.box.y + float!.box.height - 0.001
  );
  const tail = layout.pages[0]!.fragments.at(-1) as ParagraphFragmentRecord;
  expect(tail.box.y).toBeGreaterThanOrEqual(float!.box.y + float!.box.height - 0.001);
});

test('page and margin anchors measure from the cell box, and the table stays inside it', () => {
  const layout = lay(
    p('lead') +
      outer([
        p(words('A', 3)) +
          nested(
            at('w:vertAnchor="page" w:horzAnchor="page" w:tblpX="-2000" w:tblpY="1201"'),
            'N'
          ) +
          p(words('B', 3)) +
          nested(at('w:vertAnchor="margin" w:horzAnchor="page" w:tblpX="9000" w:tblpY="1"'), 'M'),
      ]) +
      p('tail')
  );
  const cell = outerCell(layout);
  const [left, right] = floats(cell.blocks);
  // A negative offset clamps to the cell's left edge, one past its right edge to its right.
  expect(left!.box.x).toBeCloseTo(cell.box.x, 3);
  expect(right!.box.x + right!.box.width).toBeCloseTo(cell.box.x + cell.box.width, 3);
  // `page` and `margin` vertical anchors both measure from the top of the cell.
  expect(left!.box.y - cell.box.y).toBeCloseTo(60, 3);
  expect(right!.box.y - cell.box.y).toBeCloseTo(0, 3);
});

test('a right-aligned margin anchor aligns to the cell text edge', () => {
  const layout = lay(
    outer([
      nested(at('w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1"'), 'N') +
        p(words('B', 40)),
    ])
  );
  const cell = outerCell(layout);
  const [float] = floats(cell.blocks);
  const b = paragraph(cell.blocks, 'B0');
  const textRight = b.lines.at(-1)!.box.x + b.lines.at(-1)!.box.width;
  expect(float!.box.x + float!.box.width).toBeCloseTo(textRight, 3);
  expect(crosses(b.lines[0]!, float!.box.x - 7.2, Number.POSITIVE_INFINITY)).toBe(false);
});

test('adjacent floats with one position stack; other floats of the cell never overlap', () => {
  const position = at('w:vertAnchor="text" w:tblpY="1"');
  const stacked = outerCell(
    lay(outer([nested(position, 'N') + nested(position, 'M') + p(words('B', 40))]))
  );
  const [first, second] = floats(stacked.blocks);
  expect(second!.box.x).toBeCloseTo(first!.box.x, 3);
  expect(second!.box.y).toBeCloseTo(first!.box.y + first!.box.height, 3);

  const besideCell = outerCell(
    lay(outer([nested(position, 'N') + p('B0') + nested(position, 'M') + p(words('C', 40))]))
  );
  const [left, beside] = floats(besideCell.blocks);
  // The later one moves right until its band meets the earlier band.
  expect(beside!.box.x).toBeCloseTo(left!.box.x + left!.box.width + 14.4, 3);

  // One too wide to sit beside moves below the earlier one instead.
  const belowCell = outerCell(
    lay(
      outer([nested(position, 'N') + p('B0') + nested(position, 'M', 2, 4000) + p(words('C', 40))])
    )
  );
  const [top, below] = floats(belowCell.blocks);
  expect(below!.box.y).toBeCloseTo(top!.box.y + top!.box.height, 3);
});

test('vertical alignment moves the cell text but not its floats', () => {
  const body = (vAlign: string) =>
    outer(
      [nested(at('w:vertAnchor="text" w:tblpY="1"'), 'N') + p('B0')],
      '<w:trHeight w:hRule="exact" w:val="3000"/>',
      vAlign ? `<w:vAlign w:val="${vAlign}"/>` : ''
    );
  const top = outerCell(lay(body('')));
  const bottom = outerCell(lay(body('bottom')));
  const [topFloat] = floats(top.blocks);
  const [bottomFloat] = floats(bottom.blocks);
  expect(bottomFloat!.box.y).toBeCloseTo(topFloat!.box.y, 3);
  const content = topFloat!.box.y + topFloat!.box.height - top.box.y;
  const moved = paragraph(bottom.blocks, 'B0').box.y - paragraph(top.blocks, 'B0').box.y;
  // The content height the alignment sees is the float's, not the one line beside it.
  expect(moved).toBeCloseTo(150 - content, 3);
});

test('a float that does not fit the page splits in flow and floats again where it continues', () => {
  const lead = Array.from({ length: 50 }, (_, index) => p(`L${index}`)).join('');
  const layout = lay(
    lead +
      outer([
        p(words('A', 3)) +
          nested(at('w:vertAnchor="text" w:tblpX="1500" w:tblpY="1"'), 'N', 8) +
          p(words('B', 60)),
      ]) +
      p('tail')
  );
  const first = floats(outerCell(layout, 0).blocks);
  const second = floats(outerCell(layout, 1).blocks);
  // Every row is laid out once, across the two pages.
  expect([...first.flatMap(tableTexts), ...second.flatMap(tableTexts)]).toEqual(
    Array.from({ length: 8 }, (_, index) => `N${index}`)
  );
  expect(first[0]!.floatingWrap).toBeUndefined();
  // The continued part floats at the top of the cell and the text wraps beside it.
  const continued = second[0]!;
  expect(continued.floatingWrap).toBeDefined();
  const b = paragraph(outerCell(layout, 1).blocks, 'B0');
  expect(b.box.y).toBeCloseTo(continued.box.y, 3);
  expect(
    crosses(b.lines[0]!, continued.box.x - 7.2, continued.box.x + continued.box.width + 7.2)
  ).toBe(false);
});

test('moving a float relays the text beside it on a warm session', () => {
  const body = (x: number) =>
    outer([
      p(words('A', 3)) +
        nested(at(`w:vertAnchor="text" w:tblpX="${x}" w:tblpY="1"`), 'N') +
        p(words('B', 60)),
    ]);
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(6, 12), session };
  const before = layoutSemanticDocument(document(body(1500)), 0, options);
  const warm = layoutSemanticDocument(document(body(3500)), 1, options);
  const cold = lay(body(3500));
  const lines = (layout: SemanticLayout) =>
    cellParagraphs(outerCell(layout).blocks).flatMap((q) =>
      q.lines.map((line) => `${line.box.x.toFixed(2)}@${line.box.y.toFixed(2)}:${lineText(line)}`)
    );
  expect(lines(warm)).toEqual(lines(cold));
  expect(lines(warm)).not.toEqual(lines(before));
  expect(floats(outerCell(warm).blocks)[0]!.box.x).toBeCloseTo(
    floats(outerCell(cold).blocks)[0]!.box.x,
    3
  );
});

test('a vertical alignment the cell does not model keeps the table in flow', () => {
  const cell = outerCell(
    lay(
      outer([
        p(words('A', 3)) +
          nested(at('w:vertAnchor="page" w:tblpYSpec="center" w:tblpY="1"'), 'N') +
          p(words('B', 3)),
      ])
    )
  );
  const [table] = floats(cell.blocks);
  expect(table!.floatingWrap).toBeUndefined();
  expect(paragraph(cell.blocks, 'B0').box.y).toBeCloseTo(table!.box.y + table!.box.height, 3);
});

test('floats nested in floats stay bounded: the deepest ones keep to the flow', () => {
  const position = '<w:tblpPr w:vertAnchor="text" w:tblpY="1"/>';
  let inner = p('core');
  for (let level = 12; level >= 1; level--)
    inner =
      `<w:tbl><w:tblPr>${position}<w:tblW w:w="${1000 + level * 300}" w:type="dxa"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${1000 + level * 300}"/></w:tblGrid><w:tr><w:tc>` +
      `${p(`D${level}`)}${inner}${p(`E${level}`)}</w:tc></w:tr></w:tbl>`;
  const started = performance.now();
  const layout = lay(outer([inner + p('after')]));
  expect(performance.now() - started).toBeLessThan(5000);
  const depths: [number, boolean][] = [];
  const walk = (blocks: readonly BlockFragmentRecord[]) => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      depths.push([block.nestingDepth, block.floatingWrap !== undefined]);
      for (const row of block.rows) for (const cell of row.cells) walk(cell.blocks);
    }
  };
  walk(outerCell(layout).blocks);
  expect(depths.filter(([, floating]) => floating).map(([depth]) => depth)).toEqual([1, 2, 3, 4]);
  expect(depths.length).toBeGreaterThan(4);
});
