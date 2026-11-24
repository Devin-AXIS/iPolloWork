import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import { load, lay, row, table } from '../../layout/__tests__/table-row-keep-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paint(tblPr: string, fill = '') {
  const cell = (tcPr: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
  const body =
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>${tblPr}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${cell('')}${cell(fill)}</w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  return container;
}

const SHADED = '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>';
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';

test('the gaps of a spaced table paint its fill under the rows, cut around the cells', () => {
  const container = paint(
    SPACING + SHADED,
    '<w:shd w:val="clear" w:color="auto" w:fill="FFE699"/>'
  );
  const fragment = container.querySelector<HTMLElement>('.docx-table-fragment')!;
  const band = fragment.querySelector<HTMLElement>(':scope > .docx-table-spacing-shading')!;
  expect(band).not.toBeNull();
  // The band is the first child, so every row paints over it.
  expect(fragment.firstElementChild).toBe(band);
  expect(band.getAttribute('aria-hidden')).toBe('true');
  expect(band.getAttribute('contenteditable')).toBe('false');
  expect(band.style.backgroundColor).toMatch(/^(#D9E2F3|rgb\(217, 226, 243\))$/i);
  expect(band.style.pointerEvents).toBe('none');
  // Even-odd: the band outline, then one hole per cell.
  expect(band.style.clipPath).toMatch(/^path\(evenodd, "M0 0H[^Z]*Z(M[^Z]*Z){2}"\)$/);
  const cells = [...container.querySelectorAll<HTMLElement>('.docx-table-cell')];
  expect(cells[0]!.style.backgroundColor).toBe('');
  expect(cells[1]!.style.backgroundColor).toMatch(/^(#FFE699|rgb\(255, 230, 153\))$/i);
});

test('a table without spacing paints no band, and its unshaded cells stay unshaded', () => {
  const container = paint(SHADED);
  expect(container.querySelector('.docx-table-spacing-shading')).toBeNull();
  for (const cell of container.querySelectorAll<HTMLElement>('.docx-table-cell'))
    expect(cell.style.backgroundColor).toBe('');
});

test('typing in a shaded spaced table keeps rows, and the band while it paints the same', () => {
  const part = load(
    table(
      Array.from({ length: 6 }, (_, i) => row(`Row${i}`)),
      // Fixed, so wrapping text grows its own row and leaves the column widths alone.
      SPACING + SHADED + '<w:tblLayout w:type="fixed"/>'
    )
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const container = document.createElement('div');
  paintSemanticLayout(container, lay(part, 15, { session, cache }), { scale: 1 });
  const bandsOf = () => {
    const fragment = container.querySelector('.docx-table-fragment')!;
    const bands = Array.from(fragment.querySelectorAll(':scope > .docx-table-spacing-shading'));
    // The bands stay the leading layer, under every row.
    bands.forEach((band, index) => expect(fragment.children[index] === band).toBe(true));
    return bands;
  };
  // Identity only: a deep comparison of DOM nodes walks the whole document.
  const same = (a: Element[], b: Element[]) => a.map((element, index) => element === b[index]);
  const rowsBefore = Array.from(container.querySelectorAll('.docx-table-row'));
  const bandsBefore = bandsOf();
  // Rows of one fill share one band.
  expect(bandsBefore).toHaveLength(1);
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const id = readTableStructure(node, 310, 0)!.rows[2]!.cells[0]!.blocks[0]!.id;
  const edit = (from: typeof part, text: string) => {
    const op = applyTreeOp(from, { op: 'insertText', paragraphId: id, offset: 0, text });
    if (!op.ok) throw Error(op.reason);
    paintSemanticLayout(container, lay(op.part, 15, { session, cache }), { scale: 1 });
    return op.part;
  };
  // One letter changes no geometry: every row and the band element stay.
  const typed = edit(part, 'X');
  const rowsAfter = Array.from(container.querySelectorAll('.docx-table-row'));
  expect(rowsAfter[0] === rowsBefore[0] && rowsAfter[5] === rowsBefore[5]).toBe(true);
  expect(same(bandsOf(), bandsBefore)).toEqual([true]);
  // Text that wraps grows its row and so the band, which is painted again; rows stay.
  const wrapped = edit(typed, ' and a few more words');
  const bandsWrapped = bandsOf();
  expect(bandsWrapped.filter((band) => !bandsBefore.includes(band))).toHaveLength(1);
  const cold = document.createElement('div');
  paintSemanticLayout(cold, lay(wrapped), { scale: 1 });
  expect(container.innerHTML).toBe(cold.innerHTML);
});

test("a spaced table's outer borders paint one inert frame over the gap fill, under the rows", () => {
  const outer = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:val="single" w:sz="24" w:color="C00000"/>`)
    .join('');
  const container = paint(SPACING + SHADED + `<w:tblBorders>${outer}</w:tblBorders>`);
  const fragment = container.querySelector<HTMLElement>('.docx-table-fragment')!;
  const frame = fragment.querySelector<HTMLElement>(':scope > .docx-table-spacing-frame')!;
  expect(frame).not.toBeNull();
  expect(frame.getAttribute('aria-hidden')).toBe('true');
  expect(frame.getAttribute('contenteditable')).toBe('false');
  expect(frame.style.pointerEvents).toBe('none');
  // Bands first, then the frame, then the rows.
  const children = [...fragment.children];
  const band = children.findIndex((child) => child.matches('.docx-table-spacing-shading'));
  const row = children.findIndex((child) => child.matches('.docx-table-row'));
  expect(band).toBeLessThan(children.indexOf(frame));
  expect(children.indexOf(frame)).toBeLessThan(row);
  expect(frame.style.width).toBe(fragment.style.width);
  expect(frame.style.height).toBe(fragment.style.height);
  expect(frame.children.length).toBeGreaterThan(0);
  // No cell paints a frame rule of its own.
  for (const cell of fragment.querySelectorAll<HTMLElement>('.docx-table-row > *'))
    expect(/192, 0, 0|C00000/i.test(cell.outerHTML)).toBe(false);
});

test('typing in a framed spaced table keeps the frame until the table changes size', () => {
  const outer = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:val="single" w:sz="24" w:color="C00000"/>`)
    .join('');
  const tblPr = SPACING + `<w:tblBorders>${outer}</w:tblBorders><w:tblLayout w:type="fixed"/>`;
  const part = load(table([row('Row0'), row('Row1')], tblPr));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const container = document.createElement('div');
  paintSemanticLayout(container, lay(part, 15, { session, cache }), { scale: 1 });
  const frameOf = () => container.querySelector('.docx-table-fragment > .docx-table-spacing-frame');
  const before = frameOf();
  expect(before).not.toBeNull();
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const id = readTableStructure(node, 310, 0)!.rows[1]!.cells[0]!.blocks[0]!.id;
  const edit = (from: typeof part, text: string) => {
    const op = applyTreeOp(from, { op: 'insertText', paragraphId: id, offset: 0, text });
    if (!op.ok) throw Error(op.reason);
    paintSemanticLayout(container, lay(op.part, 15, { session, cache }), { scale: 1 });
    return op.part;
  };
  const typed = edit(part, 'X');
  expect(frameOf() === before).toBe(true);
  // Wrapping text makes the table taller, so the frame is painted again.
  const wrapped = edit(typed, ' and a few more words that wrap');
  expect(frameOf() === before).toBe(false);
  const cold = document.createElement('div');
  paintSemanticLayout(cold, lay(wrapped), { scale: 1 });
  expect(container.innerHTML).toBe(cold.innerHTML);
});

test('a spaced table without outer borders paints no frame', () => {
  const fragment = paint(SPACING + SHADED).querySelector<HTMLElement>('.docx-table-fragment')!;
  expect(fragment.querySelector('.docx-table-spacing-frame')).toBeNull();
});
