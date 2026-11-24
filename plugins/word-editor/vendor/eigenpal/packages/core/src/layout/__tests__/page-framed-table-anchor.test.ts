// A page- or margin-framed `w:tblpPr` table does not move with the flow. Body lines placed
// before its logical anchor on the same sheet must clear it; when that would push the anchor
// off the sheet, the anchor and its table open the next sheet and the earlier lines stay put.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function documentOf(bodyXml: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const layoutOf = (bodyXml: string): SemanticLayout =>
  layoutSemanticDocument(documentOf(bodyXml), 0, { measurer: createFixedMeasurer() });

/** One paragraph of `count` forced lines. */
const lines = (count: number, label = 'earlier') =>
  `<w:p><w:r><w:t>${label}</w:t>${'<w:br/><w:t>line</w:t>'.repeat(count - 1)}</w:r></w:p>`;

const cell = (twips: number) =>
  `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${twips}"/></w:tcPr><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc>`;

/** A 216pt-tall table; `twips` wide in two equal columns. The default column is 9360 twips. */
function table(tblpPr: string, twips = 9360): string {
  const column = twips / 2;
  return (
    `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="${twips}"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${column}"/><w:gridCol w:w="${column}"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:trHeight w:val="4320" w:hRule="exact"/></w:trPr>${cell(column)}${cell(column)}</w:tr>` +
    '</w:tbl>'
  );
}

const PAGE_TOP = '<w:tblpPr w:vertAnchor="page" w:tblpY="1441"/>';
const anchor = '<w:p><w:r><w:t>anchorline</w:t></w:r></w:p>';

function paragraphNamed(layout: SemanticLayout, text: string) {
  for (const [pageIndex, page] of layout.pages.entries()) {
    const fragment = page.fragments.find(
      (item): item is ParagraphFragmentRecord =>
        item.kind === 'paragraph' &&
        item.lines.some((line) => line.spans.some((span) => span.text.includes(text)))
    );
    if (fragment) return { pageIndex, fragment };
  }
  throw new Error(`no paragraph containing ${text}`);
}

function positionedTable(layout: SemanticLayout) {
  for (const [pageIndex, page] of layout.pages.entries()) {
    const fragment = page.fragments.find(
      (item): item is TableFragmentRecord => item.kind === 'table'
    );
    if (fragment) return { pageIndex, fragment };
  }
  throw new Error('no table fragment');
}

describe('a page-framed table over earlier body lines', () => {
  test('opens the next sheet with its anchor when clearing would push the anchor off', () => {
    const bare = layoutOf(lines(36) + anchor);
    const layout = layoutOf(lines(36) + table(PAGE_TOP) + anchor);
    const placed = positionedTable(layout);
    expect(placed.pageIndex).toBe(1);
    expect(isOutOfFlowTableFragment(placed.fragment)).toBe(true);
    // Authored offsets carry the one-twip storage bias.
    expect(placed.fragment.box.y).toBeCloseTo(0, 3);
    expect(paragraphNamed(layout, 'anchorline').pageIndex).toBe(1);
    // The earlier lines keep their sheet and position; nothing paints over them.
    const earlier = paragraphNamed(layout, 'earlier');
    expect(earlier.pageIndex).toBe(0);
    expect(earlier.fragment.box).toEqual(paragraphNamed(bare, 'earlier').fragment.box);
    expect(layout.pages[0]!.fragments.some((item) => item.kind === 'table')).toBe(false);
  });

  test('a margin anchor moves the same way', () => {
    const layout = layoutOf(
      lines(36) + table('<w:tblpPr w:vertAnchor="margin" w:tblpY="1"/>') + anchor
    );
    expect(positionedTable(layout).pageIndex).toBe(1);
    expect(paragraphNamed(layout, 'anchorline').pageIndex).toBe(1);
  });

  test('an aligned table is priced at its aligned position', () => {
    const top = '<w:tblpPr w:vertAnchor="margin" w:tblpYSpec="top"/>';
    expect(positionedTable(layoutOf(lines(36) + table(top) + anchor)).pageIndex).toBe(1);
    expect(positionedTable(layoutOf(lines(10) + table(top) + anchor)).pageIndex).toBe(0);
  });

  test('stays on the anchor sheet when the cleared anchor still fits', () => {
    const layout = layoutOf(lines(10) + table(PAGE_TOP) + anchor);
    expect(positionedTable(layout).pageIndex).toBe(0);
    expect(paragraphNamed(layout, 'anchorline').pageIndex).toBe(0);
  });

  test('stays on the anchor sheet when it sits below the earlier lines', () => {
    const layout = layoutOf(
      lines(20) + table('<w:tblpPr w:vertAnchor="page" w:tblpY="8641"/>') + anchor
    );
    const placed = positionedTable(layout);
    expect(placed.pageIndex).toBe(0);
    expect(placed.fragment.box.y).toBeCloseTo(360, 3);
  });

  test('a table narrower than its column keeps its anchor sheet', () => {
    const layout = layoutOf(lines(36) + table(PAGE_TOP, 2880) + anchor);
    expect(positionedTable(layout).pageIndex).toBe(0);
    expect(paragraphNamed(layout, 'anchorline').pageIndex).toBe(0);
  });

  test('a table that leaves a passage of a quarter inch or less moves as a spanning one', () => {
    // 9120 twips leaves 12pt beside the table: no text fits there.
    const layout = layoutOf(lines(36) + table(PAGE_TOP, 9120) + anchor);
    expect(positionedTable(layout).pageIndex).toBe(1);
    expect(paragraphNamed(layout, 'anchorline').pageIndex).toBe(1);
  });

  test('an incremental pass places the table like a cold pass', () => {
    const session = createLayoutSession();
    layoutSemanticDocument(documentOf(lines(10) + table(PAGE_TOP) + anchor), 0, {
      measurer: createFixedMeasurer(),
      session,
    });
    const source = documentOf(lines(36) + table(PAGE_TOP) + anchor);
    const warm = layoutSemanticDocument(source, 1, { measurer: createFixedMeasurer(), session });
    const cold = layoutSemanticDocument(source, 1, { measurer: createFixedMeasurer() });
    expect(positionedTable(warm).pageIndex).toBe(1);
    expect(positionedTable(warm).fragment.box).toEqual(positionedTable(cold).fragment.box);
    expect(warm.pages).toHaveLength(cold.pages.length);
  });
});

describe('a page-framed table that fits on its anchor sheet', () => {
  // Lines 22.6pt tall; the table band starts at content y 51.5, inside the third line.
  const LINE = '<w:pPr><w:spacing w:line="452" w:lineRule="exact"/></w:pPr>';
  const para = (text = '') =>
    text ? `<w:p>${LINE}<w:r><w:t>${text}</w:t></w:r></w:p>` : `<w:p>${LINE}</w:p>`;
  const rows = (name: string, twips: number) =>
    Array.from(
      { length: 4 },
      (_, row) =>
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:r><w:t>${name}${row}</w:t></w:r></w:p></w:tc></w:tr>`
    ).join('');
  const floating = (name: string, tblpPr: string, twips: number) =>
    `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:w="${twips}" w:type="dxa"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>${rows(name, twips)}</w:tbl>`;
  // Wider than the column and offset left of it, so the band spans the column.
  const spanning = floating(
    'pagecell',
    '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="page" ' +
      'w:horzAnchor="margin" w:tblpX="-719" w:tblpY="2470"/>',
    10499
  );
  const following = floating(
    'textcell',
    '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
      'w:horzAnchor="margin" w:tblpY="159"/>',
    9321
  );
  const tableNamed = (layout: SemanticLayout, text: string) =>
    layout.pages[0]!.fragments.find(
      (item): item is TableFragmentRecord =>
        item.kind === 'table' &&
        item.rows.some((row) =>
          row.cells.some((cell) =>
            cell.blocks.some(
              (block) =>
                block.kind === 'paragraph' &&
                block.lines.some((line) => line.spans.some((span) => span.text.includes(text)))
            )
          )
        )
    )!;
  const lineTops = (layout: SemanticLayout) =>
    layout.pages[0]!.fragments.flatMap((item) =>
      item.kind === 'paragraph' ? item.lines.map((line) => line.box.y) : []
    );

  test('moves an earlier line that crosses its band below it', () => {
    const layout = layoutOf(
      para('opening') + para() + para() + spanning + para() + para() + para('closing')
    );
    const table = tableNamed(layout, 'pagecell');
    expect(isOutOfFlowTableFragment(table)).toBe(true);
    const bottom = table.box.y + table.box.height;
    const tops = lineTops(layout);
    // The two lines above the band keep their places; the third clears it with the rest.
    expect(tops[0]).toBeCloseTo(0, 3);
    expect(tops[1]).toBeCloseTo(22.6, 3);
    expect(tops[2]).toBeCloseTo(bottom, 3);
    expect(paragraphNamed(layout, 'closing').fragment.lines[0]!.box.y).toBeCloseTo(
      bottom + 3 * 22.6,
      3
    );
  });

  test('a text-anchored table after it follows its moved anchor', () => {
    const layout = layoutOf(
      para('opening') + para() + para() + spanning + following + para() + para() + para('closing')
    );
    const pageTable = tableNamed(layout, 'pagecell');
    const bottom = pageTable.box.y + pageTable.box.height;
    // The anchor of both tables is the first paragraph after them, below the page table.
    const anchorTop = bottom + 22.6;
    // Authored offsets carry the one-twip storage bias.
    expect(tableNamed(layout, 'textcell').box.y).toBeCloseTo(anchorTop + 159 / 20, 1);
  });

  test('a narrower page-framed table leaves the earlier lines in place', () => {
    const narrow = floating('pagecell', '<w:tblpPr w:vertAnchor="page" w:tblpY="2470"/>', 2880);
    const layout = layoutOf(para('opening') + para() + para() + narrow + para('closing'));
    expect(lineTops(layout).slice(0, 3)).toEqual([0, 22.6, 45.2].map((y) => expect.closeTo(y, 3)));
  });
});
