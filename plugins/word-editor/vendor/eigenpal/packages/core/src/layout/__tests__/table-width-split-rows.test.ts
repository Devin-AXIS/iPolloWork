import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import {
  admissibleSplitChain,
  markTableWithoutSplitRows,
  createSplitRowPlacements,
  splitRowWidthTestRecorder,
  type SplitRowOccurrence,
} from '../table-width-split-rows.ts';
import { bodyLineId } from '../body-line-id.ts';
import type {
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall. Exact 14pt lines; columns start at 100pt, no cell margins.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
/** Twenty lines in its first cell: taller than a page, so it splits over three pages. */
const tall = (line: (index: number) => string = (i) => `n${i}`, firstPPr = '', trPr = '') =>
  tr(
    [
      tc(Array.from({ length: 20 }, (_, i) => p(line(i), i === 0 ? firstPPr : '')).join('')),
      tc(p('x')),
      tc(p('y')),
    ],
    trPr
  );
const HEADER = tr([tc(p('Head A')), tc(p('Head B')), tc(p('Head C'))], '<w:tblHeader/>');
const MERGED_HEADERS = [
  tr(
    [tc(p('Group') + p('Two'), '<w:vMerge w:val="restart"/>'), tc(p('Top B')), tc(p('C'))],
    '<w:tblHeader/>'
  ),
  tr([tc(p(''), '<w:vMerge/>'), tc(p('Low B')), tc(p('Low C'))], '<w:tblHeader/>'),
];
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
/**
 * Headers, `before` body rows (six by default), the split row (row `headers.length + before`),
 * then `after` body rows (ten by default). `fixed` keeps the grid's 100pt columns.
 */
const table = (
  headers: readonly string[],
  split = tall(),
  shape: { readonly before?: number; readonly after?: number; readonly fixed?: boolean } = {}
) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}` +
  `${shape.fixed ? '<w:tblLayout w:type="fixed"/>' : ''}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  [
    ...headers,
    ...Array.from({ length: shape.before ?? 6 }, (_, i) => body(i)),
    split,
    ...Array.from({ length: shape.after ?? 10 }, (_, i) => body(10 + i)),
  ].join('') +
  '</w:tbl>';

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const deps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;
/** The body band of each page; these pages carry no note reserve. */
const band = (layout: SemanticLayout) => (index: number) => layout.pages[index]!.contentBox.height;
const rowsOf = (layout: SemanticLayout): TableRowFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((fragment) => fragment.rows);
const occurrences = (layout: SemanticLayout, id: string) =>
  rowsOf(layout).filter((row) => row.id === id);
const lineIds = (row: TableRowFragmentRecord): string[] =>
  row.cells.flatMap((cell) =>
    cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).map((l) => l.id)
  );
const lineCount = (rows: readonly TableRowFragmentRecord[]): number =>
  rows.reduce((sum, row) => sum + lineIds(row).length, 0);

/** One edit through the direct update and the retained session, both against a cold layout. */
function widthEdit(
  xml: string,
  row: number,
  cell: number,
  text: string,
  splitRow: number,
  bandOf: (layout: SemanticLayout) => (index: number) => number = band
) {
  const part = load(xml);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const previous = lay(part, 15, { session, cache });
  const splitId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[splitRow]!.id;
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraphAt(part, row, cell),
    offset: 0,
    text,
  });
  if (!edit.ok) throw Error(edit.reason);
  const recorder = splitRowWidthTestRecorder();
  const direct = updateTableText(
    tableNode(part),
    tableNode(edit.part),
    previous.pages,
    310,
    { ...deps, cache } as never,
    bandOf(previous)
  );
  recorder.dispose();
  const cold = lay(reparsed(edit.part));
  expect(lay(edit.part, 15, { session, cache }).pages).toEqual(cold.pages);
  return {
    previous,
    direct,
    cold,
    splitId,
    placed: recorder.placed,
    refused: recorder.refused,
  };
}

/** The split row spans three pages, and the edit changed the widths. */
function expectSplitWidthChange(run: ReturnType<typeof widthEdit>): void {
  const before = occurrences(run.previous, run.splitId);
  expect(before.length).toBeGreaterThanOrEqual(3);
  expect(before[0]!.hasContinuation).toBe(true);
  expect(before.at(-1)!.isContinuation).toBe(true);
  const edges = (layout: SemanticLayout) =>
    JSON.stringify(
      layout.pages
        .flatMap((page) => page.fragments)
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .map((fragment) => fragment.columnEdges)
    );
  expect(edges(run.cold)).not.toBe(edges(run.previous));
}

/** Accepted, exact, and every occurrence keeps its own stable line ids. */
function expectAccepted(run: ReturnType<typeof widthEdit>): void {
  expectSplitWidthChange(run);
  expect(run.direct).not.toBeNull();
  expect(run.direct!.pages).toEqual(run.cold.pages);
  expect(run.direct!.lineDelta).toBe(0);
  expect([run.placed, run.refused]).toEqual([1, 0]);
  const split = occurrences(run.cold, run.splitId).flatMap(lineIds);
  expect(new Set(split).size).toBe(split.length);
  for (const id of split) expect(id.includes(':occ:')).toBe(false);
}

test('a width edit after a row splits over three pages stays in the width lane', () => {
  const run = widthEdit(table([HEADER]), 3, 1, 'wider ', 7);
  expectAccepted(run);
  // Each continuation opens below its page's repeated header, which has its own stamp.
  const repeats = rowsOf(run.cold).filter((row) => row.isHeaderRepeat);
  expect(repeats.length).toBeGreaterThanOrEqual(2);
  const stamps = repeats.map((row) => lineIds(row)[0]!.split(':occ:')[1]);
  expect(new Set(stamps).size).toBe(repeats.length);
});

test('a width edit inside the split row itself stays in the width lane', () => {
  expectAccepted(widthEdit(table([HEADER]), 7, 2, 'wider ', 7));
});

test('a split row below repeated merged headers stays in the width lane', () => {
  expectAccepted(widthEdit(table(MERGED_HEADERS), 4, 1, 'wider ', 8));
});

test('a split row in a table without header rows stays in the width lane', () => {
  expectAccepted(widthEdit(table([]), 2, 1, 'wider ', 6));
});

test('a width change that rewraps the split row falls back to full pagination', () => {
  const run = widthEdit(
    table(
      [HEADER],
      tall(() => 'aaaa bbbb cccc')
    ),
    3,
    1,
    // Wider than the columns can share: the split row's first column narrows and wraps.
    `${'W'.repeat(40)} `,
    7
  );
  expectSplitWidthChange(run);
  expect(lineCount(occurrences(run.cold, run.splitId))).not.toBe(
    lineCount(occurrences(run.previous, run.splitId))
  );
  expect(run.direct).toBeNull();
});

test('split rows whose page decisions read the unsplit row are refused', () => {
  for (const split of [tall(undefined, '', '<w:cantSplit/>'), tall(undefined, '<w:keepNext/>')]) {
    const run = widthEdit(table([HEADER], split), 3, 1, 'wider ', 7);
    expect(occurrences(run.previous, run.splitId).length).toBeGreaterThanOrEqual(2);
    expect(run.direct).toBeNull();
    expect([run.placed, run.refused]).toEqual([0, 1]);
  }
});

// Review hardening. Each fixture states what it assumes about the layout; a failed assumption
// fails before the property it guards is checked.

/** The lane's answer, when it gave one, is the cold layout. */
function expectExactIfAccepted(run: ReturnType<typeof widthEdit>): void {
  if (run.direct) expect(run.direct.pages).toEqual(run.cold.pages);
}

/** A paragraph with widow control on and two lines split by a manual break. */
const twoLines = (first: string, second: string) =>
  '<w:p><w:pPr><w:widowControl/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t>${first}</w:t><w:br/><w:t>${second}</w:t></w:r></w:p>`;
/** Twenty two-line paragraphs: widow control keeps each paragraph's lines on one page. */
const tallWidow = tr([
  tc(Array.from({ length: 20 }, (_, i) => twoLines(`n${i}`, `m${i}`)).join('')),
  tc(p('x')),
  tc(p('y')),
]);

test('widow control: a split row of two-line paragraphs is exact in the width lane', () => {
  const run = widthEdit(table([HEADER], tallWidow), 3, 1, 'wider ', 7);
  expectSplitWidthChange(run);
  // Assumption: widow control keeps both lines of every paragraph in one occurrence.
  for (const row of occurrences(run.previous, run.splitId))
    for (const block of row.cells[0]!.blocks)
      if (block.kind === 'paragraph') expect(block.lines).toHaveLength(2);
  // Assumption: the edit moves the rows above, so the update reaches the split row.
  expect(run.placed + run.refused).toBe(1);
  expectExactIfAccepted(run);
});

/** Every occurrence of the one row that splits in `layout`, found from its split head. */
const splitOccurrences = (layout: SemanticLayout): TableRowFragmentRecord[] =>
  occurrences(layout, rowsOf(layout).find((row) => row.hasContinuation && !row.isContinuation)!.id);

test('a band reduced only below the last occurrence keeps the lane exact', () => {
  const reduced = (layout: SemanticLayout) => {
    const last = splitOccurrences(layout).at(-1)!;
    const page = layout.pages.findIndex((candidate) =>
      candidate.fragments.some(
        (fragment) => fragment.kind === 'table' && fragment.rows.includes(last)
      )
    );
    // A band that ends 1pt below the row. Rows after it on that page move without the band.
    return (index: number) =>
      index === page ? last.box.y + last.box.height + 1 : band(layout)(index);
  };
  expectAccepted(widthEdit(table([HEADER]), 3, 1, 'wider ', 7, reduced));
});

test('a band that no longer holds the split head refuses the row', () => {
  const reduced = (layout: SemanticLayout) => {
    const head = splitOccurrences(layout)[0]!;
    const page = layout.pages.findIndex((candidate) =>
      candidate.fragments.some(
        (fragment) => fragment.kind === 'table' && fragment.rows.includes(head)
      )
    );
    // One 14pt line less than the page the head filled.
    return (index: number) => band(layout)(index) - (index === page ? 14 : 0);
  };
  const run = widthEdit(table([HEADER]), 3, 1, 'wider ', 7, reduced);
  expectSplitWidthChange(run);
  expect(run.direct).toBeNull();
  expect([run.placed, run.refused]).toEqual([0, 1]);
});

test('a split row that ends the table is exact in the width lane', () => {
  const run = widthEdit(table([HEADER], tall(), { after: 0 }), 3, 1, 'wider ', 7);
  expectSplitWidthChange(run);
  const last = occurrences(run.previous, run.splitId).at(-1)!;
  // Assumption: the split row's last occurrence is the table's last row.
  expect(rowsOf(run.previous).at(-1)).toBe(last);
  expect(run.placed + run.refused).toBe(1);
  expectExactIfAccepted(run);
});

test('a split row that starts a page is refused', () => {
  const run = widthEdit(
    table([HEADER], tall(undefined, '<w:pageBreakBefore/>')),
    3,
    1,
    'wider ',
    7
  );
  expect(occurrences(run.previous, run.splitId).length).toBeGreaterThanOrEqual(2);
  expect(run.direct).toBeNull();
  // Explicit page breaks leave the ordinary-paragraph lane before chain placement.
  expect([run.placed, run.refused]).toEqual([0, 0]);
});

/** The fragment and row index of `row`'s first occurrence. */
function firstOccurrence(layout: SemanticLayout, id: string) {
  for (const page of layout.pages)
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      const index = fragment.rows.findIndex((row) => row.id === id);
      if (index >= 0) return { fragment, index };
    }
  throw new Error(`no occurrence of ${id}`);
}

test('a split row first placed below repeated headers is refused', () => {
  // Search for the body-row count that fills a page exactly, so the next page opens with the
  // repeated header and then the split row; no row height is assumed.
  let found: number | undefined;
  for (let before = 6; before <= 16 && found === undefined; before += 1) {
    const xml = table([HEADER], tall(), { before });
    const part = load(xml);
    const id = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[1 + before]!.id;
    const { fragment, index } = firstOccurrence(lay(part), id);
    if (index > 0 && fragment.rows.slice(0, index).every((row) => row.isHeaderRepeat))
      found = before;
  }
  expect(found).toBeDefined();
  const run = widthEdit(table([HEADER], tall(), { before: found! }), 3, 1, 'wider ', 1 + found!);
  expect(occurrences(run.previous, run.splitId).length).toBeGreaterThanOrEqual(2);
  expect(run.direct).toBeNull();
  expect([run.placed, run.refused]).toEqual([0, 1]);
});

/** The split row's chain in `layout`, as the width update collects it. */
function chainOf(layout: SemanticLayout, id: string) {
  const fragments = layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
  const pageIndexOf = new Map<TableFragmentRecord, number>();
  layout.pages.forEach((page, index) => {
    for (const fragment of page.fragments)
      if (fragment.kind === 'table') pageIndexOf.set(fragment, index);
  });
  const chain: SplitRowOccurrence[] = [];
  fragments.forEach((fragment, listPosition) =>
    fragment.rows.forEach((old, index) => {
      if (old.id === id && (old.isContinuation || old.hasContinuation))
        chain.push({ listPosition, fragment, index, old });
    })
  );
  return { fragments, pageIndexOf, chain };
}

test('a first occurrence opening a fragment without the header group is refused', () => {
  for (const headers of [[HEADER], []]) {
    const part = load(table(headers));
    const layout = lay(part);
    const id = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[headers.length + 6]!
      .id;
    const { pageIndexOf, chain } = chainOf(layout, id);
    const input = {
      pageIndexOf,
      pages: layout.pages,
      pageBand: band(layout),
      headerCount: headers.length,
    };
    // Control: the chain as laid out is admitted.
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(admissibleSplitChain(input, chain)).toBe(true);
    // The same chain with its first fragment opening at the split row, no headers above it.
    const [first, ...rest] = chain;
    const opened = { ...first!.fragment, rows: first!.fragment.rows.slice(first!.index) };
    const openedPages = new Map(pageIndexOf).set(opened, pageIndexOf.get(first!.fragment)!);
    const reshaped: SplitRowOccurrence[] = [{ ...first!, fragment: opened, index: 0 }, ...rest];
    // Refused only where the table has a header group the fragment did not repeat.
    expect(admissibleSplitChain({ ...input, pageIndexOf: openedPages }, reshaped)).toBe(
      headers.length === 0
    );
  }
});

test('an exact-height source is refused before any placement', () => {
  // Fixed columns: the structure's widths are the laid-out ones, so the control can place.
  const part = load(table([HEADER], tall(), { fixed: true }));
  const layout = lay(part);
  const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
  const source = structure.rows[7]!;
  const { fragments, pageIndexOf, chain } = chainOf(layout, source.id);
  expect(chain.length).toBeGreaterThanOrEqual(3);
  const sources = new Map(structure.rows.map((row) => [row.id, row]));
  const input = {
    fragments,
    pageIndexOf,
    pages: layout.pages,
    pageBand: band(layout),
    structure,
    sources,
    ordinals: new Map(structure.rows.map((row, index) => [row.id, index])),
    headerCount: 1,
    left: fragments[0]!.box.x,
    base: { ...deps, nextLineId: bodyLineId } as never,
  };
  // Control (assumption: the base deps place the row as the paginator did at these widths).
  const control = splitRowWidthTestRecorder();
  const complete = fragments.filter((fragment) =>
    fragment.rows.every((row) => !row.isContinuation && !row.hasContinuation)
  );
  expect(complete.length).toBeGreaterThan(0);
  const descriptors = complete.map((fragment) =>
    Object.getOwnPropertyDescriptor(fragment, 'rows')!
  );
  for (const fragment of complete) {
    markTableWithoutSplitRows(fragment);
    Object.defineProperty(fragment, 'rows', {
      configurable: true,
      enumerable: true,
      get() {
        throw Error('Complete fragment geometry must not be read by split planning');
      },
    });
  }
  let placed;
  try {
    placed = createSplitRowPlacements(input)(chain[0]!.old);
  } finally {
    complete.forEach((fragment, index) =>
      Object.defineProperty(fragment, 'rows', descriptors[index]!)
    );
    control.dispose();
  }
  expect(placed).not.toBeNull();
  expect([control.placed, control.refused]).toEqual([1, 0]);
  // The same chain with an exact row height: such a row never splits, so it is refused.
  const exact = new Map(sources).set(source.id, {
    ...source,
    height: { rule: 'exact', valuePt: 500 },
  });
  const refused = splitRowWidthTestRecorder();
  expect(createSplitRowPlacements({ ...input, sources: exact })(chain[0]!.old)).toBeNull();
  refused.dispose();
  expect([refused.placed, refused.refused]).toEqual([0, 1]);
});
