// Content-control geometry skips the rows of a table fragment that holds nothing a control
// needs, and counts its lines from facts a width-only update carries. These tests require the
// boundary records of the full row walk, with and without carried facts.

import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { attachContentControlBoundaries } from '../semantic-layout.ts';
import {
  shareTableFragmentFacts,
  tableFragmentFacts,
  tableFragmentFactsTestRecorder,
} from '../table-fragment-facts.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { W, lay, load, read, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const blockControl = (alias: string, content: string) =>
  `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const inlineControl = (alias: string, text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">a </w:t></w:r>` +
  `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/></w:sdtPr><w:sdtContent>` +
  `<w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
const tc = (content: string) => `<w:tc><w:tcPr/>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const ROWS = Array.from({ length: 30 }, (_, i) => body(i));

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

/** The facts restated: the rows the control-geometry walk reads, written out separately. */
function mirror(fragment: TableFragmentRecord) {
  const paragraphIds = new Set<string>();
  const nestedTableIds = new Set<string>();
  let lineCount = 0;
  const rows = (table: TableFragmentRecord): void => {
    for (const row of table.rows)
      if (!row.isHeaderRepeat) for (const cell of row.cells) blocks(cell.blocks);
  };
  const blocks = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list)
      if (block.kind === 'paragraph') {
        paragraphIds.add(block.paragraphId);
        lineCount += block.lines.length;
      } else {
        nestedTableIds.add(block.tableId);
        rows(block);
      }
  };
  rows(fragment);
  return { paragraphIds, nestedTableIds, lineCount };
}

// One block control in the footer, outside every table.
const footerPart = read(
  `<w:document xmlns:w="${W}"><w:body>${blockControl('Footer', p('Page footer'))}</w:body></w:document>`,
  '/word/footer1.xml'
);
const footerFragments = lay(footerPart).pages[0]!.fragments;

/** `layout` with fresh page objects, no published controls, and optionally the footer. */
function fresh(layout: SemanticLayout, footer: boolean): SemanticLayout {
  return {
    ...layout,
    contentControls: undefined,
    controlContextToken: undefined,
    pages: layout.pages.map(({ contentControls: _controls, ...page }) => ({
      ...page,
      ...(footer
        ? {
            footer: {
              kind: 'footer',
              variant: 'default',
              partName: '/word/footer1.xml',
              part: footerPart,
              box: {
                x: page.contentBox.x,
                y: page.box.y + page.box.height - 18,
                width: page.contentBox.width,
                height: 14,
              },
              fragments: footerFragments,
            },
          }
        : {}),
    })),
  } as unknown as SemanticLayout;
}

/** Published boundary records of `layout`, with the table skip on or off. */
function controlsOf(layout: SemanticLayout, part: OoxmlPart, footer: boolean, skipOff = false) {
  const recorder = tableFragmentFactsTestRecorder({ skipOff });
  try {
    const result = attachContentControlBoundaries(fresh(layout, footer), part);
    return {
      json: JSON.stringify({
        all: result.contentControls,
        pages: result.pages.map((page) => page.contentControls ?? []),
      }),
      computed: recorder.computed,
      skipped: recorder.skipped,
      perPage: result.pages.map((page) => page.contentControls?.length ?? 0),
    };
  } finally {
    recorder.dispose();
  }
}

let disposeAfter: (() => void) | null = null;
afterEach(() => {
  disposeAfter?.();
  disposeAfter = null;
});

/** Type `text` into row `row`, column 1, through a retained session; calls `check` per edit. */
function typeThrough(
  start: OoxmlPart,
  row: number,
  text: string,
  check: (layout: SemanticLayout, part: OoxmlPart, widthChanged: boolean) => void
): SemanticLayout {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const paragraphId = readTableStructure(tableNode(start), 310, 0, styleCascade)!.rows[row]!
    .cells[1]!.blocks[0]!.id;
  let part = start;
  let previous = lay(part, 15, { session, cache });
  check(previous, part, false);
  for (const [offset, character] of [...text].entries()) {
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset, text: character });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const updated = lay(part, 15, { session, cache });
    expect(updated.pages).toEqual(lay(reparsed(part)).pages);
    check(updated, part, edges(updated) !== edges(previous));
    previous = updated;
  }
  return previous;
}

test('a footer control skips every table fragment, and width edits carry the facts', () => {
  let widthEdits = 0;
  typeThrough(load(autofit(ROWS)), 13, 'wider ', (layout, part, widthChanged) => {
    const fragments = tables(layout);
    expect(fragments.length).toBeGreaterThan(2);
    const skipping = controlsOf(layout, part, true);
    const walking = controlsOf(layout, part, true, true);
    expect(skipping.json).toBe(walking.json);
    // The footer control publishes on every page; no table fragment is walked.
    expect(skipping.perPage.every((count) => count === 1)).toBe(true);
    expect(skipping.skipped).toBe(fragments.length);
    expect(walking.skipped).toBe(0);
    // Every replacement of a width edit carries the facts of the fragment it replaced.
    if (widthChanged) {
      widthEdits += 1;
      expect(skipping.computed).toBe(0);
    }
    for (const fragment of fragments)
      expect(tableFragmentFacts(fragment)).toEqual(mirror(fragment));
    // The same records as a cold layout of the same tree.
    expect(controlsOf(lay(reparsed(part)), part, true).json).toBe(skipping.json);
  });
  expect(widthEdits).toBeGreaterThan(1);
});

test('a width edit that changes line counts recomputes facts instead of sharing them', () => {
  let linesBefore = 0;
  const final = typeThrough(
    load(autofit(ROWS)),
    13,
    ' aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq',
    (layout, part) => {
      const skipping = controlsOf(layout, part, true);
      expect(skipping.json).toBe(controlsOf(layout, part, true, true).json);
      for (const fragment of tables(layout))
        expect(tableFragmentFacts(fragment)).toEqual(mirror(fragment));
      if (linesBefore === 0)
        linesBefore = tables(layout).reduce((sum, fragment) => sum + mirror(fragment).lineCount, 0);
    }
  );
  const linesAfter = tables(final).reduce((sum, fragment) => sum + mirror(fragment).lineCount, 0);
  // The typed paragraph wrapped: some fragment's line count changed.
  expect(linesAfter).toBeGreaterThan(linesBefore);
});

/** Paragraph ids a control covers: its block content, or the paragraph that holds it. */
function controlParagraphIds(part: OoxmlPart): Set<string> {
  const found = new Set<string>();
  const visit = (node: OoxmlNode, inControl: boolean, paragraph: string | null): void => {
    if (node.kind === 'textValue') return;
    const control = (node as { localName?: string }).localName === 'sdt';
    if (control && paragraph) found.add(paragraph);
    const here = node.kind === 'paragraph' ? node.id : paragraph;
    if (node.kind === 'paragraph' && inControl) found.add(node.id);
    for (const child of node.children) visit(child, inControl || control, here);
  };
  visit(part.root, false, null);
  return found;
}

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  [...a].some((id) => b.has(id));

test('controls inside table cells walk only the fragments that hold them', () => {
  const rows = ROWS.map((row, i) =>
    i === 5
      ? tr([tc(p('r5c0')), tc(p('r5c1')), tc(inlineControl('Inline', 'r5c2'))])
      : i === 20
        ? tr([tc(blockControl('Block', p('r20c0'))), tc(p('r20c1')), tc(p('r20c2'))])
        : row
  );
  typeThrough(load(autofit(rows)), 13, 'wider ', (layout, part) => {
    const needed = controlParagraphIds(part);
    expect(needed.size).toBeGreaterThanOrEqual(2);
    const skipping = controlsOf(layout, part, false);
    expect(skipping.json).toBe(controlsOf(layout, part, false, true).json);
    // The pass itself publishes the same records.
    expect(
      JSON.stringify({
        all: layout.contentControls,
        pages: layout.pages.map((page) => page.contentControls ?? []),
      })
    ).toBe(skipping.json);
    const holding = tables(layout).filter((fragment) =>
      intersects(mirror(fragment).paragraphIds, needed)
    ).length;
    expect(holding).toBeGreaterThan(0);
    expect(skipping.skipped).toBe(tables(layout).length - holding);
  });
});

test('a control in a repeated header row is walked on its first fragment only', () => {
  const header = tr(
    [tc(blockControl('Header', p('h0'))), tc(p('h1')), tc(p('h2'))],
    '<w:tblHeader/>'
  );
  const part = load(autofit([header, ...ROWS]));
  const layout = lay(part);
  const fragments = tables(layout);
  expect(fragments.length).toBeGreaterThan(2);
  // Continuation pages repeat the header row.
  expect(fragments.slice(1).every((fragment) => fragment.rows[0]!.isHeaderRepeat)).toBe(true);
  const skipping = controlsOf(layout, part, false);
  expect(skipping.json).toBe(controlsOf(layout, part, false, true).json);
  expect(skipping.skipped).toBe(fragments.length - 1);
  // Its geometry is on the first page alone, as the full walk places it.
  expect(skipping.perPage[0]).toBe(1);
  expect(skipping.perPage.slice(1).every((count) => count === 0)).toBe(true);
  const needed = controlParagraphIds(part);
  for (const fragment of fragments.slice(1))
    expect(intersects(tableFragmentFacts(fragment).paragraphIds, needed)).toBe(false);
});

test('nested tables: a needed nested paragraph or nested table walks the outer fragment', () => {
  const nested = (cell: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="1500" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>' +
    `${tr([tc(cell)])}</w:tbl>`;
  const outer = (inner: string, after = '') =>
    autofit([tr([tc(`${inner}${p('below')}`), tc(p('o1')), tc(p('o2'))]), body(1)]) + after;
  const cases = [
    // A block control around a paragraph of the nested table.
    { xml: outer(nested(blockControl('Nested', p('n0')))), skipped: 0 },
    // A block control around the nested table itself: the nested rows are not needed.
    { xml: outer(blockControl('Table', nested(p('n0')))), skipped: 1 },
    // A control after the table: nothing inside is needed.
    { xml: outer(nested(p('n0')), blockControl('After', p('after'))), skipped: 1 },
  ];
  for (const { xml, skipped } of cases) {
    const part = load(xml);
    const layout = lay(part);
    const skipping = controlsOf(layout, part, false);
    expect(skipping.json).toBe(controlsOf(layout, part, false, true).json);
    expect(skipping.skipped).toBe(skipped);
    for (const fragment of tables(layout))
      expect(tableFragmentFacts(fragment)).toEqual(mirror(fragment));
    expect(mirror(tables(layout)[0]!).nestedTableIds.size).toBe(1);
  }
});

test('facts are shared only when already known, and never computed by sharing', () => {
  const part = load(autofit(ROWS));
  const [first, second] = tables(lay(part));
  const copy = { ...first! };
  const recorder = tableFragmentFactsTestRecorder();
  disposeAfter = () => recorder.dispose();
  // Nothing known yet for `first`: sharing records nothing and walks nothing.
  shareTableFragmentFacts(first!, copy);
  expect(recorder.shared).toBe(0);
  expect(recorder.computed).toBe(0);
  const facts = tableFragmentFacts(first!);
  expect(recorder.computed).toBe(1);
  shareTableFragmentFacts(first!, copy);
  expect(recorder.shared).toBe(1);
  expect(tableFragmentFacts(copy)).toBe(facts);
  expect(recorder.computed).toBe(1);
  // A different fragment keeps its own facts.
  expect(tableFragmentFacts(second!)).toEqual(mirror(second!));
});

test('one clamp over a table equals one clamp per line, up to the page cap', () => {
  const SPAN = 1 << 20;
  for (const pageIndex of [0, 381]) {
    const start = pageIndex * SPAN;
    const cap = pageIndex * SPAN + SPAN - 1;
    for (const before of [start, start + 7, cap - 3, cap])
      for (const lines of before === start ? [0, 1, 5, SPAN, SPAN * 2] : [0, 1, 2, 5, 9]) {
        let stepped = before;
        for (let line = 0; line < Math.min(lines, SPAN + 2); line += 1)
          stepped = Math.min(stepped + 1, cap);
        expect(Math.min(before + lines, cap)).toBe(stepped);
      }
  }
});
