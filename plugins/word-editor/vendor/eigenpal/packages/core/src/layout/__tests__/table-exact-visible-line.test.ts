import { expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, selectionRects, documentOrder } from '../semantic-interaction.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { cell, exactRow, fixture, load, noMargins, p } from './table-exact-visible-fixtures.ts';

const measurer = createFixedMeasurer(6, 11);
const geometry = { width: 220, height: 100, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const layout = (part: ReturnType<typeof fixture>) =>
  layoutSemanticDocument(part, 0, { measurer, geometry });
function table(result: ReturnType<typeof layout>): TableFragmentRecord {
  const found = result.pages.flatMap((page) => page.fragments).find((f) => f.kind === 'table');
  if (!found || found.kind !== 'table') throw new Error('Expected table');
  return found;
}
function paragraph(result: ReturnType<typeof layout>): ParagraphFragmentRecord {
  const found = table(result).rows[0]!.cells[0]!.blocks[0];
  if (!found || found.kind !== 'paragraph') throw new Error('Expected cell paragraph');
  return found;
}
test('a 19pt line remains visible inside the authored 17pt exact row', () => {
  const result = layout(fixture()),
    row = table(result).rows[0]!,
    block = paragraph(result);
  expect(row.box.height).toBe(17);
  expect(block.lines[0]!.box.height).toBe(19);
  expect(block.lines[0]!.spans.map((s) => s.text).join('')).toBe('甲');
  expect(block.box.height).toBe(17);
  expect(block.clipToBox).toBe(true);
  expect(block.lines[0]!.baseline).toBe(paragraph(layout(fixture('atLeast'))).lines[0]!.baseline);
});
test('short lines, auto rows and minimum-height rows retain their own height rules', () => {
  expect(table(layout(fixture('exact', p('A', 280)))).rows[0]!.box.height).toBe(17);
  expect(paragraph(layout(fixture('exact', p('A', 280)))).clipToBox).not.toBe(true);
  for (const rule of ['auto', 'atLeast']) {
    const result = layout(fixture(rule));
    expect(table(result).rows[0]!.box.height).toBeGreaterThanOrEqual(19);
    expect(paragraph(result).clipToBox).not.toBe(true);
  }
});
test('clipping keeps model offsets while caret and selection stay inside the cell band', () => {
  const result = layout(fixture()),
    block = paragraph(result);
  expect(block.range.start).toBe(0);
  expect(block.range.end).toBe(1);
  const caret = caretAt(result, { paragraphId: block.paragraphId, offset: 1 }, measurer);
  expect(caret).not.toBeNull();
  expect(caret!.y).toBeGreaterThanOrEqual(block.box.y);
  expect(caret!.y + caret!.height).toBeLessThanOrEqual(block.box.y + block.box.height);
  const rects = selectionRects(
    result,
    {
      anchor: { paragraphId: block.paragraphId, offset: 0 },
      head: { paragraphId: block.paragraphId, offset: 1 },
    },
    documentOrder(result),
    measurer
  );
  expect(rects.length).toBeGreaterThan(0);
  for (const rect of rects) expect(rect.y + rect.height).toBeLessThanOrEqual(block.box.y + 17);
});
test('a later paragraph outside the row stays in the canonical source', () => {
  const part = fixture('exact', p('甲') + p('乙')),
    before = serializeOoxmlPart(part);
  const result = layout(part);
  expect(table(result).rows[0]!.cells[0]!.blocks).toHaveLength(1);
  expect(serializeOoxmlPart(part)).toBe(before);
  expect(before).toContain('乙');
});
test('hanging text keeps its original position inside the full cell clip frame', () => {
  const result = layout(fixture('exact', p('A', 380, '<w:ind w:left="240" w:hanging="120"/>')));
  const block = paragraph(result),
    frame = table(result).rows[0]!.cells[0]!.box;
  expect(block.box.x).toBe(frame.x);
  expect(block.lines[0]!.spans[0]!.box.x).toBe(frame.x + 6);
});
test('a too-tall exact row uses fresh-page recovery without rewriting its authored height', () => {
  const part = fixture(),
    before = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, {
    measurer,
    geometry: { ...geometry, height: 36 },
  });
  const page = result.pages[0]!,
    fragment = table(result),
    row = fragment.rows[0]!,
    frame = row.cells[0]!,
    block = paragraph(result),
    line = block.lines[0]!;
  // The empty paragraph the body reads after the table starts the next page.
  expect(result.pages).toHaveLength(2);
  expect(page.fragments).toEqual([fragment]);
  expect(page.contentBox.height).toBe(16);
  expect(fragment.fragmentIndex).toBe(0);
  expect(fragment.rows).toHaveLength(1);
  expect(row.placesWhole).toBe(true);
  expect(row.box.height).toBe(16);
  expect(frame.box.height).toBe(16);
  expect(frame.box.y + frame.box.height).toBeLessThanOrEqual(page.contentBox.height);
  expect(block.lines).toHaveLength(1);
  expect(line.box.height).toBe(19);
  expect(line.box.y).toBeGreaterThanOrEqual(frame.box.y);
  expect(line.box.y).toBeLessThan(frame.box.y + frame.box.height);
  expect(line.spans.map((span) => span.text).join('')).toBe('甲');
  expect(block.range).toMatchObject({ start: 0, end: 1 });
  expect(before).toContain('w:val="340"');
  expect(before).toContain('w:line="380"');
  expect(serializeOoxmlPart(part)).toBe(before);
});
test('a merged cell flows through both exact rows instead of clipping at the head row', () => {
  const part = load(
    `<w:tbl>${noMargins}<w:tblGrid><w:gridCol w:w="2000"/>` +
      `<w:gridCol w:w="2000"/></w:tblGrid><w:tr>${exactRow}` +
      cell(p('M0', 280) + p('M1', 280), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') +
      cell(p('side', 280)) +
      `</w:tr><w:tr>${exactRow}` +
      cell(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>') +
      cell(p('side2', 280)) +
      '</w:tr></w:tbl>'
  );
  const rows = table(layout(part)).rows,
    head = rows[0]!.cells[0]!;
  expect(rows.map((r) => r.box.height)).toEqual([17, 17]);
  expect(head.rowSpan).toBe(2);
  expect(head.box.height).toBe(34);
  expect(head.blocks).toHaveLength(2);
  for (const block of head.blocks)
    if (block.kind === 'paragraph') expect(block.clipToBox).not.toBe(true);
});

test('indented paragraph borders and shading keep their authored geometry inside the clip frame', () => {
  const props =
    '<w:ind w:left="240" w:right="120" w:hanging="120"/>' +
    '<w:pBdr><w:left w:val="single" w:sz="8" w:space="0"/></w:pBdr>' +
    '<w:shd w:val="clear" w:fill="FFFF00"/>';
  const clipped = paragraph(layout(fixture('exact', p('A', 380, props))));
  const natural = paragraph(layout(fixture('atLeast', p('A', 380, props))));
  expect(clipped.clipToBox).toBe(true);
  expect(clipped.indent).toEqual(natural.indent);
  expect(clipped.lines[0]!.spans[0]!.box.x).toBe(natural.lines[0]!.spans[0]!.box.x);
  expect(clipped.borders).toEqual(natural.borders);
  expect(clipped.shadingBox).toEqual(natural.shadingBox);
  expect(clipped.shadingBox!.width).toBeLessThan(clipped.box.width);
});

test('fixed column widths and spanning-cell placement remain unchanged by partial-line admission', () => {
  const part = (rule: string) =>
    load(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>` +
        `<w:tblW w:w="3600" w:type="dxa"/>${noMargins.replace(/<\/?w:tblPr>/g, '')}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1200"/><w:gridCol w:w="1800"/></w:tblGrid>' +
        `<w:tr><w:trPr><w:trHeight w:val="340" w:hRule="${rule}"/></w:trPr>` +
        cell(
          p('span'),
          '<w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>'
        ) +
        cell(p('right'), '<w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>') +
        '</w:tr>' +
        `<w:tr><w:trPr><w:trHeight w:val="340" w:hRule="${rule}"/></w:trPr>` +
        [600, 1200, 1800]
          .map((width, index) =>
            cell(p(String(index)), `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>`)
          )
          .join('') +
        '</w:tr></w:tbl>'
    );
  const clipped = table(layout(part('exact'))),
    natural = table(layout(part('atLeast')));
  const boxes = (record: TableFragmentRecord) =>
    record.rows.map((row) => row.cells.map((c) => ({ x: c.box.x, width: c.box.width })));
  expect(boxes(clipped)).toEqual(boxes(natural));
  expect(clipped.box.width).toBe(natural.box.width);
  const upper = clipped.rows[0]!.cells,
    lower = clipped.rows[1]!.cells;
  expect(lower).toHaveLength(3);
  expect(upper[0]!.box.width).toBeCloseTo(lower[0]!.box.width + lower[1]!.box.width, 6);
  expect(upper[1]!.box.x).toBeCloseTo(lower[2]!.box.x, 6);
  expect(lower[1]!.box.width).toBeCloseTo(lower[0]!.box.width * 2, 6);
  expect(lower[2]!.box.width).toBeCloseTo(lower[0]!.box.width * 3, 6);
  for (const row of clipped.rows)
    for (const c of row.cells) {
      expect(c.blocks).toHaveLength(1);
      const block = c.blocks[0]!;
      if (block.kind !== 'paragraph') throw new Error('Expected visible paragraph');
      expect(block.clipToBox).toBe(true);
      expect(block.box.x).toBe(c.box.x);
      expect(block.box.width).toBe(c.box.width);
    }
});

test('a merge head too tall for its exact span flows through every row and clips at the last', () => {
  const row = '<w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>';
  const continued = cell(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>');
  const part = load(
    `<w:tbl>${noMargins}<w:tblGrid><w:gridCol w:w="2000"/>` +
      `<w:gridCol w:w="2000"/></w:tblGrid><w:tr>${row}` +
      cell(
        ['H0', 'H1', 'H2', 'H3', 'H4'].map((text) => p(text, 280)).join(''),
        '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>'
      ) +
      cell(p('S0', 280) + p('S1', 280)) +
      `</w:tr><w:tr>${row}${continued}${cell(p('a', 280))}</w:tr>` +
      `<w:tr>${row}${continued}${cell(p('b', 280))}</w:tr></w:tbl>`
  );
  const rows = table(layout(part)).rows;
  expect(rows.map((r) => r.box.height)).toEqual([20, 20, 20]);
  const text = (blocks: TableFragmentRecord['rows'][number]['cells'][number]['blocks']) =>
    blocks.map((block) =>
      block.kind === 'paragraph'
        ? block.lines.map((line) => line.spans.map((s) => s.text).join(''))
        : []
    );
  // Five 14pt lines in a 60pt span: four whole lines and the top of the fifth.
  const head = rows[0]!.cells[0]!;
  expect(head.rowSpan).toBe(3);
  expect(head.box.height).toBe(60);
  expect(text(head.blocks)).toEqual([['H0'], ['H1'], ['H2'], ['H3'], ['H4']]);
  const cut = head.blocks.at(-1)!;
  if (cut.kind !== 'paragraph') throw new Error('Expected cell paragraph');
  expect(cut.clipToBox).toBe(true);
  expect(cut.box.y + cut.box.height).toBe(head.box.y + 60);
  for (const block of head.blocks.slice(0, -1))
    if (block.kind === 'paragraph') expect(block.clipToBox).not.toBe(true);
  const side = rows[0]!.cells[1]!;
  expect(text(side.blocks)).toEqual([['S0'], ['S1']]);
  const clipped = side.blocks[1]!;
  if (clipped.kind !== 'paragraph') throw new Error('Expected cell paragraph');
  expect(clipped.clipToBox).toBe(true);
});

test('merge heads over the same exact rows detach together whether or not they fit', () => {
  const row = '<w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>';
  const continued = cell(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>');
  const restart = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
  const part = load(
    `<w:tbl>${noMargins}<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
      `<w:tr>${row}${cell(p('A0', 280) + p('A1', 280), restart)}` +
      `${cell(['B0', 'B1', 'B2', 'B3', 'B4'].map((t) => p(t, 280)).join(''), restart)}</w:tr>` +
      `<w:tr>${row}${continued}${continued}</w:tr><w:tr>${row}${continued}${continued}</w:tr></w:tbl>`
  );
  const rows = table(layout(part)).rows;
  expect(rows.map((r) => r.box.height)).toEqual([20, 20, 20]);
  const [fits, tall] = rows[0]!.cells;
  const clipped = (blocks: TableFragmentRecord['rows'][number]['cells'][number]['blocks']) =>
    blocks.map((block) => block.kind === 'paragraph' && block.clipToBox === true);
  expect(fits!.box.height).toBe(60);
  expect(clipped(fits!.blocks)).toEqual([false, false]);
  expect(tall!.box.height).toBe(60);
  expect(clipped(tall!.blocks)).toEqual([false, false, false, false, true]);
});
