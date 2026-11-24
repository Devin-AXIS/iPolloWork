import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../../layout/semantic-records.ts';
import { lay, load, read, W } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { buildNumberingIndex } from '../../layout/numbering-index.ts';
import { paintSemanticLayout, type PaintOptions } from '../semantic-paint.ts';
import { sameRecordExcept } from '../semantic-paint-record-equality.ts';

// AutoFit tables: every column is as wide as its longest text, so typing into the longest cell
// of a column widens it and moves every column after it. The fixture measurer advances 6pt
// per character on a 310pt-wide, 170pt-tall body.

const BORDERS = (val: string, sz = 4) =>
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="${val}" w:sz="${sz}" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders>';

interface CellOptions {
  readonly pPr?: string;
  readonly tcPr?: string;
  readonly runs?: string;
  readonly content?: string;
}

const paragraph = (text: string, options: CellOptions = {}) =>
  `<w:p><w:pPr>${options.pPr ?? ''}<w:spacing w:before="0" w:after="0"/></w:pPr>` +
  `${options.runs ?? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`}</w:p>`;

const autoCell = (text: string, options: CellOptions = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${options.tcPr ?? ''}</w:tcPr>` +
  `${options.content ?? paragraph(text, options)}</w:tc>`;

const autoTable = (rows: readonly string[], tblPr = '', columns = 3) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${tblPr}</w:tblPr><w:tblGrid>` +
  '<w:gridCol w:w="600"/>'.repeat(columns) +
  `</w:tblGrid>${rows.map((cells) => `<w:tr>${cells}</w:tr>`).join('')}</w:tbl>`;

const rowsOf = (count: number, cell = (r: number, c: number) => autoCell(`R${r}C${c}`)) =>
  Array.from({ length: count }, (_, r) => Array.from({ length: 3 }, (_, c) => cell(r, c)).join(''));

const childrenOf = (node: OoxmlNode, kind: string): OoxmlNode[] =>
  'children' in node ? (node.children as OoxmlNode[]).filter((n) => n.kind === kind) : [];

/** The first paragraph id in row `r`, cell `c` of the first body table. */
function cellParagraphId(part: OoxmlPart, r: number, c: number): string {
  const body = childrenOf(part.root, 'body')[0]!;
  const row = childrenOf(childrenOf(body, 'table')[0]!, 'tableRow')[r]!;
  return childrenOf(childrenOf(row, 'tableCell')[c]!, 'paragraph')[0]!.id;
}

const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter((block): block is TableFragmentRecord => block.kind === 'table')
  );

interface Session {
  layout: SemanticLayout;
  part: OoxmlPart;
  readonly container: HTMLElement;
  readonly options: PaintOptions;
  readonly relayout: (part: OoxmlPart) => SemanticLayout;
}

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const container of mounted.splice(0)) container.remove();
  document.getSelection()?.removeAllRanges();
});

function open(body: string, options: PaintOptions = { scale: 1 }, numbering?: string): Session {
  const part = load(body);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const numberingIndex = numbering
    ? buildNumberingIndex(
        read(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`, '/word/numbering.xml').root
      )
    : undefined;
  const relayout = (next: OoxmlPart) =>
    lay(next, 15, { session, cache, ...(numberingIndex ? { numberingIndex } : {}) });
  const layout = relayout(part);
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  paintSemanticLayout(container, layout, options);
  return { layout, part, container, options, relayout };
}

function type(state: Session, r: number, c: number, text: string): void {
  const paragraphId = cellParagraphId(state.part, r, c);
  const op = applyTreeOp(state.part, { op: 'insertText', paragraphId, offset: 0, text });
  if (!op.ok) throw Error(op.reason);
  const before = tables(state.layout).map((table) => table.columnEdges);
  state.part = op.part;
  state.layout = state.relayout(op.part);
  // Every scenario here is about a width change; make sure layout produced one.
  expect(tables(state.layout).map((table) => table.columnEdges)).not.toEqual(before);
  paintSemanticLayout(state.container, state.layout, state.options);
}

/** The retained container holds exactly what a cold paint of the same layout builds. */
function expectColdPaint(state: Session): void {
  const cold = document.createElement('div');
  paintSemanticLayout(cold, state.layout, state.options);
  expect(state.container.innerHTML).toBe(cold.innerHTML);
}

/** Painted table-cell paragraphs by `data-paragraph-id`, first fragment of each. */
function cellParagraphs(container: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const element of container.querySelectorAll<HTMLElement>(
    '.docx-table-cell .docx-paragraph-fragment'
  )) {
    const id = element.dataset.paragraphId!;
    if (!found.has(id)) found.set(id, element);
  }
  return found;
}

const cellsById = (container: HTMLElement) =>
  new Map(
    Array.from(container.querySelectorAll<HTMLElement>('.docx-table-cell')).map((cell) => [
      `${cell.closest<HTMLElement>('.docx-page')!.dataset.pageIndex}:${cell.dataset.cellId}`,
      cell,
    ])
  );

/** How many entries of `after` are the same element as in `before`. */
function kept<K>(before: Map<K, HTMLElement>, after: Map<K, HTMLElement>): number {
  let count = 0;
  for (const [key, element] of after) if (before.get(key) === element) count += 1;
  return count;
}

function blockOf(state: Session, paragraphId: string) {
  const visit = (blocks: readonly BlockFragmentRecord[]): BlockFragmentRecord | undefined => {
    for (const block of blocks) {
      if (block.kind === 'paragraph' && block.paragraphId === paragraphId) return block;
      if (block.kind === 'table') {
        for (const row of block.rows)
          for (const cell of row.cells) {
            const found = visit(cell.blocks);
            if (found) return found;
          }
      }
    }
    return undefined;
  };
  for (const page of state.layout.pages) {
    const found = visit(page.fragments);
    if (found) return found;
  }
  return undefined;
}

describe('moving table cells to new column widths', () => {
  test('cells and paragraphs after the widened column keep their elements', () => {
    const state = open(autoTable(rowsOf(12), BORDERS('single')));
    const cells = cellsById(state.container);
    const paragraphs = cellParagraphs(state.container);
    const edited = cellParagraphId(state.part, 3, 0);
    type(state, 3, 0, 'XXXXXXXX');
    expectColdPaint(state);
    const cellsAfter = cellsById(state.container);
    const paragraphsAfter = cellParagraphs(state.container);
    expect(kept(cells, cellsAfter)).toBe(cellsAfter.size);
    // Only the edited paragraph is rebuilt.
    expect(kept(paragraphs, paragraphsAfter)).toBe(paragraphsAfter.size - 1);
    expect(paragraphsAfter.get(edited)).not.toBe(paragraphs.get(edited));
  });

  test('compound strokes, shading and centred text move with their cells', () => {
    const cell = (r: number, c: number) =>
      autoCell(`R${r}C${c}`, {
        tcPr: c === 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/>' : '',
        pPr:
          (c !== 1 ? '<w:jc w:val="center"/>' : '') +
          (r % 2 ? '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>' : ''),
      });
    const state = open(autoTable(rowsOf(8, cell), BORDERS('double', 6)));
    const strokes = Array.from(state.container.querySelectorAll('[data-stroke]'));
    expect(strokes.length).toBeGreaterThan(0);
    const paragraphs = cellParagraphs(state.container);
    type(state, 1, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
    const strokesAfter = Array.from(state.container.querySelectorAll('[data-stroke]'));
    expect(strokesAfter.filter((stroke) => strokes.includes(stroke)).length).toBe(
      strokesAfter.length
    );
    expect(kept(paragraphs, cellParagraphs(state.container))).toBe(paragraphs.size - 1);
  });

  test('numbered paragraphs keep their markers; right-to-left ones are rebuilt', () => {
    const numbering =
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
      '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>';
    const NUMBERED = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    // Column 2 is numbered left to right; rows 4-7 of the widened column 0 right to left.
    const rtl = (r: number, c: number) => c === 0 && r > 3;
    const cell = (r: number, c: number) =>
      autoCell(`R${r}C${c}`, {
        pPr: c === 2 ? NUMBERED : rtl(r, c) ? `${NUMBERED}<w:bidi/>` : '',
      });
    const state = open(autoTable(rowsOf(8, cell), BORDERS('single')), { scale: 1 }, numbering);
    const markerOf = (r: number, c: number) =>
      cellParagraphs(state.container)
        .get(cellParagraphId(state.part, r, c))!
        .querySelector('.docx-list-marker');
    const markers = Array.from({ length: 8 }, (_, r) => markerOf(r, 2));
    expect(markers.every((marker) => marker !== null)).toBe(true);
    const paragraphs = cellParagraphs(state.container);
    const rebuilt = [3, 4, 5, 6, 7].map((r) => cellParagraphId(state.part, r, 0));
    type(state, 3, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
    const after = cellParagraphs(state.container);
    for (const [id, element] of after) {
      expect(element === paragraphs.get(id)).toBe(!rebuilt.includes(id));
    }
    expect(markers.every((marker, r) => markerOf(r, 2) === marker)).toBe(true);
  });

  test('a page count change keeps the sheets and the rows still on them', () => {
    const words = 'word '.repeat(12).trim();
    const rows = rowsOf(14, (r, c) => autoCell(c === 1 ? `${words} ${r}` : `R${r}C${c}`));
    const state = open(autoTable(rows, BORDERS('single')));
    const pageCount = state.layout.pages.length;
    const sheet = state.container.firstElementChild;
    const firstCell = state.container.querySelector('.docx-table-cell');
    type(state, 0, 0, 'X'.repeat(24));
    expect(state.layout.pages.length).not.toBe(pageCount);
    expectColdPaint(state);
    expect(state.container.firstElementChild).toBe(sheet);
    expect(state.container.querySelector('.docx-table-cell')).toBe(firstCell);
  });

  test('a zoomed paint reuses elements and still matches a cold paint', () => {
    const state = open(autoTable(rowsOf(8), BORDERS('single')), { scale: 1.5 });
    const cells = cellsById(state.container);
    type(state, 2, 1, 'XXXXXXXX');
    expectColdPaint(state);
    expect(kept(cells, cellsById(state.container))).toBe(cells.size);
  });

  test('a native selection inside a moved paragraph stays on the same text node', () => {
    const state = open(autoTable(rowsOf(8), BORDERS('single')));
    const id = cellParagraphId(state.part, 5, 2);
    const run = cellParagraphs(state.container)
      .get(id)!
      .querySelector<HTMLElement>('[data-start]')!;
    const text = run.firstChild!;
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(text, 1, text, 3);
    type(state, 0, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
    expect(state.container.contains(text)).toBe(true);
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(1);
    expect(selection.focusOffset).toBe(3);
    const mapped = (selection.anchorNode as Text).parentElement!.closest<HTMLElement>(
      '[data-start]'
    )!;
    expect(mapped.dataset.paragraphId).toBe(id);
    expect(mapped.dataset.start).toBe('0');
  });

  test('the rebuilt paragraph leaves no stale node behind', () => {
    const state = open(autoTable(rowsOf(8), BORDERS('single')));
    const id = cellParagraphId(state.part, 0, 0);
    const before = cellParagraphs(state.container).get(id)!;
    type(state, 0, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
    // A browser moves a selection endpoint out of a removed node; the surface then restores
    // the selection from the model. What paint owes it is that the old node is really gone.
    expect(before.isConnected).toBe(false);
    expect(
      state.container.querySelectorAll(`[data-paragraph-id="${id}"].docx-paragraph-fragment`)
    ).toHaveLength(1);
  });

  test('header repeats, vertical merges and split pages reuse and match a cold paint', () => {
    const header = '<w:trPr><w:tblHeader/></w:trPr>';
    const rows = rowsOf(30, (r, c) =>
      c === 2 && r >= 4 && r <= 6
        ? autoCell(r === 4 ? 'merged' : '', {
            tcPr: r === 4 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>',
          })
        : autoCell(`R${r}C${c}`)
    ).map((cells, r) => (r === 0 ? header + cells : cells));
    const state = open(autoTable(rows, BORDERS('single')));
    expect(state.layout.pages.length).toBeGreaterThan(1);
    const repeats = () =>
      Array.from(state.container.querySelectorAll('[data-header-repeat="true"]'));
    const repeated = repeats();
    expect(repeated.length).toBeGreaterThan(0);
    const cells = cellsById(state.container);
    type(state, 20, 1, 'XXXXXXXXXXXX');
    expectColdPaint(state);
    const repeatedAfter = repeats();
    expect(repeatedAfter).toHaveLength(repeated.length);
    expect(repeatedAfter.every((row, index) => row === repeated[index])).toBe(true);
    expect(kept(cells, cellsById(state.container))).toBe(cells.size);
  });

  test('visible paragraph marks still match a cold paint', () => {
    const state = open(autoTable(rowsOf(8), BORDERS('single')), {
      scale: 1,
      showParagraphMarks: true,
    });
    type(state, 4, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
  });

  test('a nested table moves with its cell', () => {
    const inner = autoTable(
      rowsOf(2, (r, c) => autoCell(`n${r}${c}`)),
      BORDERS('single')
    );
    const rows = rowsOf(6, (r, c) =>
      r === 2 && c === 2
        ? autoCell('', { content: inner + paragraph('after') })
        : autoCell(`R${r}C${c}`)
    );
    const state = open(autoTable(rows, BORDERS('single')));
    const nested = state.container.querySelector('.docx-table-cell .docx-table-fragment');
    expect(nested).not.toBeNull();
    type(state, 1, 0, 'XXXXXXXXXXXX');
    expectColdPaint(state);
    expect(state.container.querySelector('.docx-table-cell .docx-table-fragment')).toBe(nested);
  });
});

describe('replicas that apply the same edits paint the same document', () => {
  type Edit = Parameters<typeof applyTreeOp>[1];

  function apply(state: Session, edit: Edit): void {
    const op = applyTreeOp(state.part, edit);
    if (!op.ok) throw Error(op.reason);
    state.part = op.part;
    state.layout = state.relayout(op.part);
    paintSemanticLayout(state.container, state.layout, state.options);
  }

  test('concurrent edits in either order, a deletion and an undo converge', () => {
    const body = autoTable(rowsOf(10), BORDERS('single'));
    const local = open(body);
    const remote = open(body);
    const original = local.part;
    const id = (r: number, c: number) => cellParagraphId(original, r, c);
    const edits: Edit[] = [
      { op: 'insertText', paragraphId: id(2, 0), offset: 0, text: 'XXXXXXXX' },
      { op: 'deleteText', paragraphId: id(6, 1), start: 0, end: 3 },
      { op: 'insertText', paragraphId: id(7, 2), offset: 2, text: 'YYYYYYYYYY' },
    ];
    const cells = cellsById(remote.container);
    for (const edit of edits) apply(local, edit);
    for (const edit of [...edits].reverse()) apply(remote, edit);
    expectColdPaint(local);
    expect(remote.container.innerHTML).toBe(local.container.innerHTML);
    expect(kept(cells, cellsById(remote.container))).toBe(cells.size);

    // Undo returns the original tree; the retained paint returns to the original picture.
    local.part = original;
    local.layout = local.relayout(original);
    paintSemanticLayout(local.container, local.layout, local.options);
    expectColdPaint(local);
    expect(local.container.innerHTML).toBe(open(body).container.innerHTML);
  });
});

describe('refusing reuse it cannot prove', () => {
  test('a tab leader paragraph is rebuilt when its column moves', () => {
    const leader = autoCell('', {
      pPr: '<w:tabs><w:tab w:val="left" w:leader="dot" w:pos="600"/></w:tabs>',
      runs: '<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r>',
    });
    const rows = rowsOf(6, (r, c) => (r === 3 && c === 2 ? leader : autoCell(`R${r}C${c}`)));
    const state = open(autoTable(rows, BORDERS('single')));
    const id = cellParagraphId(state.part, 3, 2);
    const before = cellParagraphs(state.container).get(id);
    expect(before?.querySelector('[data-docx-tab-leader]')).not.toBeNull();
    type(state, 0, 0, 'XXXXXXXXXX');
    expectColdPaint(state);
    expect(cellParagraphs(state.container).get(id)).not.toBe(before);
  });

  test('a paragraph that rewraps in a narrowed column is rebuilt', () => {
    const words = 'word '.repeat(30).trim();
    const rows = rowsOf(4, (r, c) => autoCell(c === 1 ? `${words} ${r}` : `R${r}C${c}`));
    const state = open(autoTable(rows, BORDERS('single')));
    const id = cellParagraphId(state.part, 2, 1);
    const before = cellParagraphs(state.container).get(id)!;
    const linesBefore = (blockOf(state, id) as { lines: readonly unknown[] }).lines.length;
    type(state, 0, 0, 'X'.repeat(30));
    expectColdPaint(state);
    expect((blockOf(state, id) as { lines: readonly unknown[] }).lines.length).not.toBe(
      linesBefore
    );
    expect(cellParagraphs(state.container).get(id)).not.toBe(before);
  });

  test('a zoom change rebuilds every page', () => {
    const state = open(autoTable(rowsOf(6), BORDERS('single')));
    const cell = state.container.querySelector('.docx-table-cell');
    paintSemanticLayout(state.container, state.layout, { scale: 2 });
    expect(state.container.querySelector('.docx-table-cell')).not.toBe(cell);
  });
});

describe('record equality for paint reuse', () => {
  test('compares plain data and skips the named fields', () => {
    expect(
      sameRecordExcept({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }, new Set())
    ).toBe(true);
    expect(
      sameRecordExcept({ a: 1, box: { x: 1 } }, { a: 1, box: { x: 2 } }, new Set(['box']))
    ).toBe(true);
    expect(sameRecordExcept({ a: 1, b: [1] }, { a: 1, b: [2] }, new Set())).toBe(false);
  });

  test('treats a field on one side only as a difference', () => {
    expect(sameRecordExcept({ a: 1, b: undefined }, { a: 1 }, new Set())).toBe(false);
    expect(sameRecordExcept({ a: 1 }, { a: 1, b: undefined }, new Set())).toBe(false);
  });

  test('requires identity for anything that is not plain data', () => {
    expect(sameRecordExcept({ m: new Map([[1, 1]]) }, { m: new Map([[1, 2]]) }, new Set())).toBe(
      false
    );
    const shared = new Map();
    expect(sameRecordExcept({ m: shared }, { m: shared }, new Set())).toBe(true);
    expect(sameRecordExcept({ n: Number.NaN }, { n: Number.NaN }, new Set())).toBe(false);
  });

  test('refuses records nested past the depth limit', () => {
    const deep = (depth: number): object => (depth === 0 ? { leaf: 1 } : { next: deep(depth - 1) });
    expect(sameRecordExcept(deep(64), deep(64), new Set())).toBe(false);
    expect(sameRecordExcept(deep(8), deep(8), new Set())).toBe(true);
  });
});
