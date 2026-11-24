import { afterEach, expect, test } from 'bun:test';
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
import { caretAt } from '../semantic-interaction.ts';
import {
  bottomToTopCaretInLayout,
  bottomToTopScanTestRecorder,
  isBottomToTopCaret,
} from '../table-cell-text-direction.ts';
import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// Caret geometry rotates into a `btLr` cell found by a scan of every table on a page,
// repeated header rows and nested tables included. A fragment proven to hold no `btLr` cell
// is skipped: the width update marks every fragment it returns, and a walk that finds none
// marks the fragment it walked. Each case compares the skipping scan with the full scan.

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
const BTLR = '<w:textDirection w:val="btLr"/>';
const TALL = '<w:trHeight w:val="1200" w:hRule="exact"/>';
const HEADER = '<w:tblHeader/>';
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const table = (rows: readonly string[], columns = 3) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${2000 * columns}" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}` +
  `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>` +
  `${rows.join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');
const edges = (layout: SemanticLayout): string =>
  JSON.stringify(tables(layout).map((fragment) => [fragment.box.x, fragment.columnEdges]));

/** Every paragraph fragment at any depth of `blocks`, repeated header rows included. */
function paragraphsIn(blocks: readonly BlockFragmentRecord[]): ParagraphFragmentRecord[] {
  return blocks.flatMap((block) =>
    block.kind === 'paragraph'
      ? [block]
      : block.rows.flatMap((row) => row.cells.flatMap((cell) => paragraphsIn(cell.blocks)))
  );
}
/** Each paragraph's first offset on each page it is placed on. */
function positionsOf(layout: SemanticLayout) {
  return layout.pages.flatMap((page) =>
    [...new Set(paragraphsIn(page.fragments).map((block) => block.paragraphId))].map(
      (paragraphId) => ({ pageIndex: page.index, paragraphId })
    )
  );
}
/** Whether `fragment` has a `btLr` cell in any row, at any depth. */
const holds = (fragment: TableFragmentRecord): boolean =>
  fragment.rows.some((row) =>
    row.cells.some(
      (cell) =>
        cell.textDirection === 'btLr' ||
        cell.blocks.some((block) => block.kind === 'table' && holds(block))
    )
  );
/**
 * What a rescan reads once every fragment without a `btLr` cell is marked: it walks each
 * fragment that holds one, and inside it each nested table in a horizontal cell; it skips the
 * rest without reading their rows.
 */
function expectedRescan(layout: SemanticLayout) {
  let walked = 0;
  let skipped = 0;
  const visit = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      if (!holds(block)) {
        skipped += 1;
        continue;
      }
      walked += 1;
      for (const row of block.rows)
        for (const cell of row.cells) if (cell.textDirection !== 'btLr') visit(cell.blocks);
    }
  };
  for (const page of layout.pages) visit(page.fragments);
  return { walked, skipped };
}
/** Table fragments at any depth that hold a `btLr` cell. */
const holdingAnywhere = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord[] =>
  blocks.flatMap((block) =>
    block.kind !== 'table'
      ? []
      : [
          ...(holds(block) ? [block] : []),
          ...block.rows.flatMap((row) => row.cells.flatMap((cell) => holdingAnywhere(cell.blocks))),
        ]
  );

/** The same records under new page objects: the per-page and per-layout memos start empty. */
const repaged = (layout: SemanticLayout): SemanticLayout => ({
  ...layout,
  pages: layout.pages.map((page) => ({ ...page })),
});
function caretsOf(layout: SemanticLayout) {
  return positionsOf(layout).map(({ pageIndex, paragraphId }) => {
    const caret = caretAt(layout, { paragraphId, offset: 0 }, { preferredPageIndex: pageIndex });
    return { caret, rotated: !!caret && isBottomToTopCaret(caret) };
  });
}
/** Carets from a full scan of fresh pages, then from the skipping scan of fresh pages. */
function compareWithFullScan(layout: SemanticLayout) {
  const full = bottomToTopScanTestRecorder({ skipOff: true });
  const expected = caretsOf(repaged(layout));
  full.dispose();
  const counts = bottomToTopScanTestRecorder();
  const actual = caretsOf(repaged(layout));
  counts.dispose();
  expect(actual).toEqual(expected);
  return { expected, walked: counts.walked, skipped: counts.skipped };
}

let open: { dispose(): void }[] = [];
afterEach(() => {
  for (const recorder of open) recorder.dispose();
  open = [];
});
const record = () => {
  const recorder = bottomToTopScanTestRecorder();
  open.push(recorder);
  return recorder;
};

test('width updates mark their fragments, so the next scan reads no table row', () => {
  const rows = [
    tr(
      [0, 1, 2].map((c) => tc(p(`h${c}`))),
      HEADER
    ),
    ...Array.from({ length: 30 }, (_, i) => body(i)),
  ];
  let part = load(table(rows));
  const paragraphId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[14]!.cells[1]!
    .blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let previous = lay(part, 15, { session, cache });
  expect(tables(previous).length).toBeGreaterThan(2);
  // The first scan of a full layout walks every fragment once.
  const first = record();
  caretsOf(previous);
  expect(first.walked).toBe(tables(previous).length);
  first.dispose();
  let widthEdits = 0;
  for (const [index, character] of [...'wider '].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const updated = lay(part, 15, { session, cache });
    expect(updated.pages).toEqual(lay(reparsed(part)).pages);
    if (edges(updated) !== edges(previous)) {
      widthEdits += 1;
      // Every table fragment is a width-update replacement: none is walked.
      const scan = record();
      const carets = caretsOf(updated);
      expect(scan.walked).toBe(0);
      expect(scan.skipped).toBe(tables(updated).length);
      scan.dispose();
      expect(carets.some(({ rotated }) => rotated)).toBe(false);
      expect(compareWithFullScan(updated).walked).toBe(0);
    }
    previous = updated;
  }
  expect(widthEdits).toBeGreaterThan(1);
});

test('a btLr cell keeps its fragment walked; horizontal fragments are skipped', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 17 ? tr([tc(p('turned'), BTLR), tc(p('b')), tc(p('c'))], TALL) : body(i)
  );
  const layout = lay(load(table(rows)));
  const fragments = tables(layout);
  expect(fragments.length).toBeGreaterThan(2);
  const holding = fragments.filter((fragment) =>
    fragment.rows.some((row) => row.cells.some((cell) => cell.textDirection === 'btLr'))
  );
  expect(holding).toHaveLength(1);
  caretsOf(layout);
  const { expected, walked, skipped } = compareWithFullScan(layout);
  expect(expected.filter(({ rotated }) => rotated).length).toBeGreaterThan(0);
  expect({ walked, skipped }).toEqual(expectedRescan(layout));
  expect([walked, skipped]).toEqual([1, fragments.length - 1]);
});

test('a btLr cell in a repeated header row is found on every page', () => {
  const rows = [
    tr([tc(p('heading'), BTLR), tc(p('h1')), tc(p('h2'))], `${HEADER}${TALL}`),
    ...Array.from({ length: 30 }, (_, i) => body(i)),
  ];
  const layout = lay(load(table(rows)));
  const fragments = tables(layout);
  expect(fragments.length).toBeGreaterThan(2);
  expect(fragments.slice(1).every((fragment) => fragment.rows[0]!.isHeaderRepeat)).toBe(true);
  caretsOf(layout);
  // Every fragment holds the header or a repeat of it: none may be skipped.
  const { expected, walked, skipped } = compareWithFullScan(layout);
  expect({ walked, skipped }).toEqual(expectedRescan(layout));
  expect([walked, skipped]).toEqual([fragments.length, 0]);
  expect(expected.filter(({ rotated }) => rotated).length).toBeGreaterThan(0);
  // A repeated header row with its own cells, and none other, reads bottom to top.
  const heading = paragraphsIn(fragments[0]!.rows[0]!.cells[0]!.blocks)[0]!.paragraphId;
  const turned = fragments.slice(1).map((fragment) => {
    const cell = fragment.rows[0]!.cells[0]!;
    return { cell, pageIndex: layout.pages.findIndex((page) => page.fragments.includes(fragment)) };
  });
  for (const { cell, pageIndex } of turned) {
    const caret = caretAt(
      layout,
      { paragraphId: heading, offset: 0 },
      { preferredPageIndex: pageIndex }
    );
    expect(caret && isBottomToTopCaret(caret)).toBe(true);
    expect(cell.textDirection).toBe('btLr');
  }
});

const nested = (direction: string) =>
  table(
    [
      ...Array.from({ length: 6 }, (_, i) => body(i)),
      tr([
        tc(
          table([tr([tc(p('inner'), direction), tc(p('beside'))], direction ? TALL : '')], 2) +
            p('after inner')
        ),
        tc(p('b')),
        tc(p('c')),
      ]),
      ...Array.from({ length: 6 }, (_, i) => body(i + 6)),
    ],
    3
  );

test('a nested btLr cell keeps its outer and nested fragments walked', () => {
  const layout = lay(load(nested(BTLR)));
  const holding = layout.pages.flatMap((page) => holdingAnywhere(page.fragments));
  // At least one outer fragment and the nested table inside it.
  expect(holding.some((fragment) => fragment.nestingDepth > 0)).toBe(true);
  expect(holding.some((fragment) => fragment.nestingDepth === 0)).toBe(true);
  caretsOf(layout);
  const { expected, walked, skipped } = compareWithFullScan(layout);
  expect({ walked, skipped }).toEqual(expectedRescan(layout));
  expect(walked).toBe(holding.length);
  expect(expected.filter(({ rotated }) => rotated).length).toBeGreaterThan(0);
});

test('a nested horizontal table is skipped with its outer fragment', () => {
  const layout = lay(load(nested('')));
  const inner = tables(layout).flatMap((fragment) =>
    fragment.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
  );
  expect(inner.some((block) => block.kind === 'table')).toBe(true);
  caretsOf(layout);
  const { expected, walked, skipped } = compareWithFullScan(layout);
  expect({ walked, skipped }).toEqual(expectedRescan(layout));
  expect(walked).toBe(0);
  expect(skipped).toBe(tables(layout).length);
  expect(expected.some(({ rotated }) => rotated)).toBe(false);
});

test('a mark belongs to its record: a copy that turns a cell is walked and rotates', () => {
  const layout = lay(load(table(Array.from({ length: 8 }, (_, i) => body(i)))));
  caretsOf(layout);
  const fragment = tables(layout)[0]!;
  const [row, ...rest] = fragment.rows;
  const [cell, ...others] = row!.cells;
  const turned: TableFragmentRecord = {
    ...fragment,
    rows: [{ ...row!, cells: [{ ...cell!, textDirection: 'btLr' }, ...others] }, ...rest],
  };
  const page = layout.pages[0]!;
  const changed: SemanticLayout = {
    ...layout,
    pages: [
      { ...page, fragments: page.fragments.map((f) => (f === fragment ? turned : f)) },
      ...layout.pages.slice(1),
    ],
  };
  const paragraphId = paragraphsIn(cell!.blocks)[0]!.paragraphId;
  const caret = caretAt(layout, { paragraphId, offset: 0 })!;
  expect(bottomToTopCaretInLayout(layout, caret)).toBe(caret);
  const scan = record();
  const rotated = bottomToTopCaretInLayout(changed, caret);
  expect(scan.walked).toBe(1);
  expect(rotated).not.toBe(caret);
  expect(isBottomToTopCaret(rotated)).toBe(true);
});

test('a document laid out again with a turned cell is scanned again', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const rows = (turn: boolean) =>
    Array.from({ length: 30 }, (_, i) =>
      i === 4 && turn ? tr([tc(p('r4c0'), BTLR), tc(p('r4c1')), tc(p('r4c2'))], TALL) : body(i)
    );
  const plain = lay(load(table(rows(false))), 15, { session, cache });
  caretsOf(plain);
  const turned = lay(load(table(rows(true))), 15, { session, cache });
  const { expected, walked } = compareWithFullScan(turned);
  expect(walked).toBeGreaterThan(0);
  expect(expected.filter(({ rotated }) => rotated).length).toBeGreaterThan(0);
});
