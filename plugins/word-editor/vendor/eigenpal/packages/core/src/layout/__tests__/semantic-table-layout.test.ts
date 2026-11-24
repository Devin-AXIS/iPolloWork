// Semantic table conformance: crash-free layout, row-sized cell boxes, nested-table
// geometry, `w:tblHeader` repetition across pages, vMerge deduplication, grid-driven
// column widths, bounded hostile-input handling, and incremental-layout invariants.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { caretStops, documentOrder, paragraphTextFromLayout } from '../semantic-interaction.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { MAX_TABLE_COLUMNS } from '../semantic-table.ts';
import {
  paragraphFragmentsOf,
  type PageGeometry,
  type PageRecord,
  type SemanticLayout,
  type TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function fixturePart(name: string): OoxmlPart {
  const bytes = readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/${name}`);
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  return result.package.parts.get(result.package.mainDocumentPart)!;
}

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

function loadStyles(stylesXml: string): StyleCascadeTable {
  const xml = `<w:styles xmlns:w="${W}">${stylesXml}</w:styles>`;
  const result = readOoxmlPart(xml, { name: '/word/styles.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`styles read failed: ${result.reason}`);
  return buildStyleCascadeTable(result.part.root);
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr}${cells}</w:tr>`;

function layout(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
}

function tableFragments(page: PageRecord): TableFragmentRecord[] {
  return page.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

function allTableFragments(result: SemanticLayout): TableFragmentRecord[] {
  return result.pages.flatMap(tableFragments);
}

describe('semantic table layout', () => {
  test('a real table document lays out with typed rows, cells and reachable text', () => {
    const part = fixturePart('with-tables.docx');
    const result = layout(part);
    const tables = allTableFragments(result);
    expect(tables.length).toBeGreaterThan(0);
    const rows = tables.flatMap((fragment) => fragment.rows);
    expect(rows).toHaveLength(3);
    const cells = rows.flatMap((row) => row.cells);
    expect(cells).toHaveLength(9);
    // Cell text is reachable through the records, in reading order.
    const texts = cells.map((cell) =>
      cell.blocks
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    );
    expect(texts).toEqual(['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3']);
  });

  test('cells in a row share the row height and sit inside the row box', () => {
    const part = loadPart(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${tr(tc(p('short')) + tc(p('a much longer cell text that wraps across several lines of the narrow column')))}</w:tbl>`
    );
    const result = layout(part);
    const [table] = allTableFragments(result);
    const row = table!.rows[0]!;
    for (const cell of row.cells) {
      expect(cell.box.height).toBe(row.box.height);
      expect(cell.box.y).toBe(row.box.y);
    }
    // The taller cell decided the height: it exceeds one default line plus padding.
    expect(row.box.height).toBeGreaterThan(14 + 6);
  });

  test('a nested table lays out with its own geometry inside the cell box', () => {
    const part = loadPart(
      `<w:tbl>${tr(tc(`<w:tbl>${tr(tc(p('inner')))}</w:tbl>${p('after')}`) + tc(p('right')))}</w:tbl>`
    );
    const result = layout(part);
    const [outer] = allTableFragments(result);
    const hostCell = outer!.rows[0]!.cells[0]!;
    const nested = hostCell.blocks.find((block) => block.kind === 'table');
    expect(nested).toBeDefined();
    if (!nested || nested.kind !== 'table') throw new Error('unreachable');
    // Nested geometry sits inside the hosting cell box.
    expect(nested.box.x).toBeGreaterThanOrEqual(hostCell.box.x);
    expect(nested.box.x + nested.box.width).toBeLessThanOrEqual(
      hostCell.box.x + hostCell.box.width + 0.001
    );
    expect(nested.rows[0]!.cells[0]!.blocks[0]!.kind).toBe('paragraph');
  });

  test('many nested wide tables finalize under a shared ownership budget without dense blow-up', () => {
    // Each nested table declares a hostile-wide tblGrid but only one cell — sparse
    // ownership must not allocate nestCount × columnCount dense slots, and the
    // shared layout budget must cover every nested finalize in one pass.
    const nestCount = 32;
    const gridCols = Array.from({ length: 64 }, () => '<w:gridCol w:w="144"/>').join('');
    const nested = Array.from(
      { length: nestCount },
      (_, i) => `<w:tbl><w:tblGrid>${gridCols}</w:tblGrid>${tr(tc(p(`n${i}`)))}</w:tbl>`
    ).join('');
    const part = loadPart(`<w:tbl>${tr(tc(nested))}</w:tbl>`);
    const result = layout(part);
    const [outer] = allTableFragments(result);
    const host = outer!.rows[0]!.cells[0]!;
    const nestedTables = host.blocks.filter((block) => block.kind === 'table');
    expect(nestedTables.length).toBeGreaterThanOrEqual(16);
    expect(nestedTables.length).toBeLessThanOrEqual(nestCount);
    for (const table of nestedTables) {
      if (table.kind !== 'table') throw new Error('unreachable');
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]!.cells).toHaveLength(1);
      // Borders resolved (finalize ran) without throwing / truncating mid-nest fatally.
      expect(table.rows[0]!.cells[0]!.blocks[0]!.kind).toBe('paragraph');
    }
  });

  test('a tblHeader row repeats atop each page and stays out of interaction walks', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 60 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const part = loadPart(`<w:tbl>${header}${body}</w:tbl>`);
    const result = layout(part);
    expect(result.pages.length).toBeGreaterThan(1);
    const lineIds = allTableFragments(result).flatMap((fragment) =>
      fragment.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.blocks.flatMap((block) =>
            block.kind === 'paragraph' ? block.lines.map((line) => line.id) : []
          )
        )
      )
    );
    expect(new Set(lineIds).size).toBe(lineIds.length);
    const cleanLineIds = allTableFragments(layout(part)).flatMap((fragment) =>
      fragment.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.blocks.flatMap((block) =>
            block.kind === 'paragraph' ? block.lines.map((line) => line.id) : []
          )
        )
      )
    );
    expect(cleanLineIds).toEqual(lineIds);

    // Every continuation page's table fragment leads with the repeated header row.
    for (const page of result.pages.slice(1)) {
      const fragments = tableFragments(page);
      if (fragments.length === 0) continue;
      const first = fragments[0]!.rows[0]!;
      expect(first.isHeaderRepeat).toBe(true);
      const text = first.cells[0]!.blocks.flatMap((block) =>
        block.kind === 'paragraph' ? block.lines : []
      )
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('');
      expect(text).toBe('HEAD');
    }

    // Interaction sees each cell paragraph exactly once despite the repeats.
    const order = documentOrder(result);
    expect(new Set(order).size).toBe(order.length);
    const headParagraphs = order.filter((id) => paragraphTextFromLayout(result, id) === 'HEAD');
    expect(headParagraphs).toHaveLength(1);
    const stops = caretStops(result);
    const seen = new Set<string>();
    for (const stop of stops) {
      const key = `${stop.position.paragraphId}:${stop.position.offset}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // Header repeats are still painted: flattening WITH repeats sees the copy.
    const withRepeats = result.pages
      .slice(1)
      .flatMap((page) => paragraphFragmentsOf(page, true))
      .filter((fragment) => fragment.paragraphId === headParagraphs[0]);
    expect(withRepeats.length).toBeGreaterThan(0);
  });

  test('vMerge continue cells emit a box but no content', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(tc(p('merged'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('b1'))) +
        tr(tc(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('b2'))) +
        '</w:tbl>'
    );
    const result = layout(part);
    const [table] = allTableFragments(result);
    const restart = table!.rows[0]!.cells[0]!;
    const continueCell = table!.rows[1]!.cells[0]!;
    expect(continueCell.vMergeContinue).toBe(true);
    expect(continueCell.paintInert).toBe(true);
    expect(continueCell.blocks).toHaveLength(0);
    expect(continueCell.box.height).toBe(table!.rows[1]!.box.height);
    // Restart spans both row heights; no interior seam border on the restart bottom.
    expect(restart.rowSpan).toBe(2);
    expect(restart.box.height).toBe(table!.rows[0]!.box.height + table!.rows[1]!.box.height);
    // Continue is paint-inert (no seam fill/borders); restart owns the outer bottom only.
    expect(continueCell.borders).toEqual({});
    // The continuation's text never reaches the records.
    const order = documentOrder(result);
    const texts = order.map((id) => paragraphTextFromLayout(result, id));
    expect(texts).not.toContain('ghost');
  });

  test('nested tables with vMerge finalize spans across sibling nests', () => {
    // Sibling nests share the layout-wide vMerge budget; each nest must still expand
    // its restart. Heavy row×column linearity is covered by table-vmerge unit counters.
    const nestCount = 16;
    const chainRows = 4;
    const makeChain = (tag: string) =>
      Array.from({ length: chainRows }, (_, r) =>
        tr(
          tc(
            p(`${tag}-${r}`),
            r === 0
              ? '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>'
              : '<w:tcPr><w:vMerge/></w:tcPr>'
          ) + tc(p(`${tag}-s${r}`))
        )
      ).join('');
    const nested = Array.from(
      { length: nestCount },
      (_, i) =>
        `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${makeChain(`t${i}`)}</w:tbl>`
    ).join('');
    const part = loadPart(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${tr(tc(nested))}</w:tbl>`
    );
    const result = layout(part);
    const [outer] = allTableFragments(result);
    const host = outer!.rows[0]!.cells[0]!;
    const nestedTables = host.blocks.filter((block) => block.kind === 'table');
    expect(nestedTables.length).toBeGreaterThanOrEqual(8);
    for (const table of nestedTables) {
      if (table.kind !== 'table') throw new Error('unreachable');
      const rowsHere = table === nestedTables.at(-1) ? table.rows.length : chainRows; // can split
      const restart = table.rows[0]!.cells[0]!;
      expect([table.rows.length, restart.rowSpan]).toEqual([rowsHere, rowsHere]);
      expect(table.rows[1]!.cells[0]!.vMergeContinue).toBe(true);
      expect(table.rows[1]!.cells[0]!.paintInert).toBe(true);
      expect(restart.box.height).toBeCloseTo(
        table.rows.reduce((sum, row) => sum + row.box.height, 0),
        5
      );
    }
  });

  test('malformed mid-chain vMerge restart splits spans like the historical scan', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(tc(p('r1'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('a'))) +
        tr(tc(p('g1'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('b'))) +
        tr(tc(p('r2'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('c'))) +
        tr(tc(p('g2'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('d'))) +
        '</w:tbl>'
    );
    const [table] = allTableFragments(layout(part));
    expect(table!.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(table!.rows[2]!.cells[0]!.rowSpan).toBe(2);
    expect(table!.rows[0]!.cells[0]!.box.height).toBe(
      table!.rows[0]!.box.height + table!.rows[1]!.box.height
    );
  });

  test('authored tcMar insets the content on every side it states', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(
            p('x'),
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="80" w:type="dxa"/>' +
              '<w:left w:w="120" w:type="dxa"/>' +
              '<w:bottom w:w="80" w:type="dxa"/>' +
              '<w:right w:w="120" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          )
        ) +
        '</w:tbl>'
    );
    const result = layout(part);
    const cell = allTableFragments(result)[0]!.rows[0]!.cells[0]!;
    const para = cell.blocks[0]!;
    // left 6pt, top 4pt from tcMar (120/80 twips).
    expect(para.box.x).toBe(cell.box.x + 6);
    expect(para.box.y).toBe(cell.box.y + 4);
  });

  test('asymmetric tcMar and final-paragraph spaceAfter size the row without a pad floor', () => {
    // Top 100 twips (5pt), bottom 20 twips (1pt). Final para after=40 twips (2pt).
    // Measured line is 14pt → natural height 5+14+2+1 = 22 when after applies; a tighter
    // companion cell below also proves the old defaultLineHeight+2*pad (20) seed is gone.
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(
            '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:t>end</w:t></w:r></w:p>',
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="100" w:type="dxa"/>' +
              '<w:left w:w="40" w:type="dxa"/>' +
              '<w:bottom w:w="20" w:type="dxa"/>' +
              '<w:right w:w="40" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          )
        ) +
        tr(
          tc(
            p('short'),
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="40" w:type="dxa"/>' +
              '<w:left w:w="40" w:type="dxa"/>' +
              '<w:bottom w:w="20" w:type="dxa"/>' +
              '<w:right w:w="40" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          )
        ) +
        '</w:tbl>'
    );
    const [row0, row1] = allTableFragments(layout(part))[0]!.rows;
    const tall = row0!.cells[0]!;
    const tight = row1!.cells[0]!;
    const tallPara = tall.blocks[0]!;
    if (tallPara.kind !== 'paragraph') throw new Error('expected paragraph');
    const tallLine = tallPara.lines[tallPara.lines.length - 1]!;
    expect(tallPara.box.y - tall.box.y).toBeCloseTo(5, 5);
    expect(tallPara.spacing.after).toBeCloseTo(2, 5);
    // Bottom margin stays 1pt; spaceAfter sits above it inside the paragraph box.
    expect(tall.box.y + tall.box.height - (tallLine.box.y + tallLine.box.height)).toBeCloseTo(
      1 + 2,
      5
    );
    expect(tall.box.height).toBeCloseTo(5 + tallLine.box.height + 2 + 1, 5);

    const tightPara = tight.blocks[0]!;
    if (tightPara.kind !== 'paragraph') throw new Error('expected paragraph');
    const tightLine = tightPara.lines[0]!;
    expect(tightPara.box.y - tight.box.y).toBeCloseTo(2, 5);
    expect(tight.box.y + tight.box.height - (tightLine.box.y + tightLine.box.height)).toBeCloseTo(
      1,
      5
    );
    // No fixed row floor: the box is exactly top margin + resolved line + bottom margin.
    expect(tight.box.height).toBeCloseTo(2 + tightLine.box.height + 1, 5);
    expect(tight.box.height).toBeLessThan(19);
  });

  test('nested table trailing paragraph keeps distinct host bottom margin', () => {
    const nested = `<w:tbl>${tr(tc(p('in')))}</w:tbl>`;
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(
            p('before') +
              nested +
              '<w:p><w:pPr><w:spacing w:before="80"/></w:pPr><w:r><w:t>after nested</w:t></w:r></w:p>',
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="80" w:type="dxa"/>' +
              '<w:bottom w:w="40" w:type="dxa"/>' +
              '<w:left w:w="40" w:type="dxa"/>' +
              '<w:right w:w="40" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          )
        ) +
        '</w:tbl>'
    );
    const host = allTableFragments(layout(part))[0]!.rows[0]!.cells[0]!;
    const after = host.blocks[host.blocks.length - 1]!;
    if (after.kind !== 'paragraph') throw new Error('expected trailing paragraph');
    const lastLine = after.lines[after.lines.length - 1]!;
    const padTop = host.blocks[0]!.box.y - host.box.y;
    const padBottom = host.box.y + host.box.height - (lastLine.box.y + lastLine.box.height);
    expect(padTop).toBeCloseTo(4, 5);
    expect(padBottom).toBeCloseTo(2, 5);
    expect(after.spacing.before).toBeCloseTo(4, 5);
  });

  test('vAlign center shifts cell content within the row', () => {
    const part = loadPart(
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
        tr(
          tc(p('short'), '<w:tcPr><w:vAlign w:val="center"/></w:tcPr>') +
            tc(p('a much longer cell text that wraps across several lines of the narrow column'))
        ) +
        '</w:tbl>'
    );
    const row = allTableFragments(layout(part))[0]!.rows[0]!;
    const short = row.cells[0]!;
    const tall = row.cells[1]!;
    expect(row.box.height).toBe(tall.box.height);
    const shortTop = short.blocks[0]!.box.y;
    // Centered content sits below the top pad of a top-aligned cell.
    expect(shortTop).toBeGreaterThan(short.box.y + 3);
  });

  test('column widths come from the grid when present', () => {
    const part = loadPart(
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid>' +
        tr(tc(p('a')) + tc(p('b'))) +
        '</w:tbl>'
    );
    const result = layout(part);
    const row = allTableFragments(result)[0]!.rows[0]!;
    // 2400 and 4800 twips, less the half outer side rule a fixed table keeps inside its grid.
    expect(Math.abs(row.cells[0]!.box.width - 120)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.cells[1]!.box.width - 240)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.cells[1]!.box.x - row.cells[0]!.box.x - 120)).toBeLessThanOrEqual(0.5);
  });

  test('an autofit table whose cells state no width sizes its columns by their content', () => {
    const part = loadPart(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid>' +
        tr(tc(p('a')) + tc(p('bbbb'))) +
        '</w:tbl>'
    );
    const row = allTableFragments(layout(part))[0]!.rows[0]!;
    // No width of its own: each column takes its content, whatever the grid says.
    expect(row.cells[0]!.box.width).toBeLessThan(row.cells[1]!.box.width);
    expect(row.cells[1]!.box.width).toBeLessThan(120);
  });

  test('cell shading is read validated and vetted values only', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(p('shaded'), '<w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>') +
            tc(p('auto'), '<w:tcPr><w:shd w:val="clear" w:fill="auto"/></w:tcPr>') +
            tc(p('evil'), '<w:tcPr><w:shd w:val="clear" w:fill="url(x)"/></w:tcPr>')
        ) +
        '</w:tbl>'
    );
    const row = allTableFragments(layout(part))[0]!.rows[0]!;
    expect(row.cells[0]!.shading).toBe('D9E2F3');
    expect(row.cells[1]!.shading).toBeUndefined();
    expect(row.cells[2]!.shading).toBeUndefined();
  });

  test('a file-supplied gridSpan cannot drive allocation (bounded columns, bounded time)', () => {
    const part = loadPart(
      `<w:tbl>${tr(tc(p('x'), '<w:tcPr><w:gridSpan w:val="500000000"/></w:tcPr>'))}</w:tbl>`
    );
    const started = performance.now();
    const result = layout(part);
    expect(performance.now() - started).toBeLessThan(2000);
    const [table] = allTableFragments(result);
    const cell = table!.rows[0]!.cells[0]!;
    expect(cell.gridSpan).toBeLessThanOrEqual(MAX_TABLE_COLUMNS);
    expect(cell.box.width).toBeGreaterThan(0);
  });

  test('nesting beyond the ceiling renders an empty cell instead of recursing', () => {
    let inner = p('deepest');
    for (let depth = 0; depth < 24; depth += 1) {
      inner = `<w:tbl>${tr(tc(inner))}</w:tbl>`;
    }
    const part = loadPart(inner);
    // Completes without a stack failure; the deepest tables are simply absent.
    const result = layout(part);
    expect(result.pages.length).toBeGreaterThan(0);
    const texts = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(texts).not.toContain('deepest');
  });
});

describe('incremental layout with tables', () => {
  const tableDoc = () =>
    loadPart(
      p('before') +
        `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>` +
        p('after')
    );

  function editCellParagraph(part: OoxmlPart, needle: string, text: string): OoxmlPart {
    const findParagraph = (
      node: import('../../store/package/ooxml-tree.ts').OoxmlNode
    ): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'paragraph' && JSON.stringify(node).includes(`"${needle}"`)) return node.id;
      for (const child of node.children) {
        const found = findParagraph(child);
        if (found) return found;
      }
      return null;
    };
    const paragraphId = findParagraph(part.root);
    if (!paragraphId) throw new Error(`no paragraph containing ${needle}`);
    const result = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text });
    if (!result.ok) throw new Error(`edit rejected: ${result.reason}`);
    return result.part;
  }

  test('an incremental pass after a cell edit equals a clean full pass', () => {
    const measurer = createFixedMeasurer();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const before = tableDoc();
    layoutSemanticDocument(before, 0, { measurer, cache, session });

    const after = editCellParagraph(before, 'B2', 'Z');
    const incremental = layoutSemanticDocument(after, 1, { measurer, cache, session });
    const clean = layoutSemanticDocument(after, 1, { measurer: createFixedMeasurer() });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
  });

  test('a no-change pass returns the previous pages by identity', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    const part = tableDoc();
    const first = layoutSemanticDocument(part, 0, { measurer, session });
    const second = layoutSemanticDocument(part, 1, { measurer, session });
    expect(second.pages).toBe(first.pages);
  });

  test('an edit below the table reuses the pages above it by identity', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    // Push the trailing paragraph onto its own page so the table's page can be reused.
    const filler = Array.from({ length: 50 }, (_, i) => p(`filler ${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(p('A1')))}</w:tbl>` + filler + p('tail'));
    const first = layoutSemanticDocument(part, 0, { measurer, session });
    expect(first.pages.length).toBeGreaterThan(1);

    const after = editCellParagraph(part, 'tail', 'Z');
    const second = layoutSemanticDocument(after, 1, { measurer, session });
    // The first page (the table's) is carried over by reference.
    expect(second.pages[0]).toBe(first.pages[0]);
  });

  test('the table cache key changes on a cell edit and holds otherwise', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    const part = tableDoc();
    layoutSemanticDocument(part, 0, { measurer, session });
    const keysBefore = [...session.keys];

    const after = editCellParagraph(part, 'A1', 'Z');
    layoutSemanticDocument(after, 1, { measurer, session });
    const keysAfter = [...session.keys];
    expect(keysAfter).toHaveLength(keysBefore.length);
    expect(keysAfter[0]).toBe(keysBefore[0]!); // 'before' paragraph untouched
    expect(keysAfter[1]).not.toBe(keysBefore[1]!); // the table re-keys
    expect(keysAfter[2]).toBe(keysBefore[2]!); // 'after' paragraph untouched
  });
});

/** Tiny page: 100pt tall, 10pt margins → 80pt content box. */
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function layoutTiny(part: OoxmlPart, styleCascade?: StyleCascadeTable, compatibilityMode?: number) {
  return layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(),
    geometry: TINY,
    styleCascade,
    compatibilityMode,
  });
}

function assertNoContentOverflow(result: SemanticLayout): void {
  for (const page of result.pages) {
    const limit = page.contentBox.height;
    for (const fragment of page.fragments) {
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(limit + 0.001);
      if (fragment.kind === 'table') {
        for (const row of fragment.rows) {
          expect(row.box.y + row.box.height).toBeLessThanOrEqual(limit + 0.001);
        }
      }
    }
  }
}

describe('table row pagination (tiny page)', () => {
  test('a tall multi-paragraph cell fragments across pages without overflowing', () => {
    const paras = Array.from({ length: 30 }, (_, i) => p(`P${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(paras))}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);
    const texts = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(texts).toEqual([...Array.from({ length: 30 }, (_, i) => `P${i}`), '']);
    // Continuation row records share the authored row id.
    const bodyRows = allTableFragments(result).flatMap((fragment) =>
      fragment.rows.filter((row) => !row.isHeaderRepeat)
    );
    expect(bodyRows.length).toBeGreaterThan(1);
    expect(new Set(bodyRows.map((row) => row.id)).size).toBe(1);
    expect(bodyRows.some((row) => row.isContinuation)).toBe(true);
  });

  test('a wrapped single paragraph splits at line boundaries', () => {
    // Fixed measurer: 6pt/char, content width 180 → ~30 chars/line; long text wraps.
    const long = 'word '.repeat(40).trim();
    const part = loadPart(`<w:tbl>${tr(tc(p(long)))}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);
    const frags = allTableFragments(result).flatMap((fragment) =>
      fragment.rows.flatMap((row) =>
        row.cells.flatMap((cell) => cell.blocks.filter((block) => block.kind === 'paragraph'))
      )
    );
    expect(frags.length).toBeGreaterThan(1);
    // Ranges abut without overlap.
    for (let index = 1; index < frags.length; index += 1) {
      const prev = frags[index - 1]!;
      const next = frags[index]!;
      if (prev.kind !== 'paragraph' || next.kind !== 'paragraph') continue;
      expect(next.range.start).toBe(prev.range.end);
    }
  });

  test('w:cantSplit taller than a page splits instead of overflowing', () => {
    const paras = Array.from({ length: 30 }, (_, i) => p(`X${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(paras), '<w:trPr><w:cantSplit/></w:trPr>')}</w:tbl>`);
    // Mode 15 splits it. Earlier modes keep it whole past the margin (`tallRowStaysWhole`).
    const result = layoutTiny(part, undefined, 15);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);
    const bodyRows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(new Set(bodyRows.map((row) => row.id)).size).toBe(1);
    expect(bodyRows.slice(1).every((row) => row.isContinuation)).toBe(true);
  });

  test('w:cantSplit that fits a fresh page moves whole rather than splitting', () => {
    // One short row fills most of the first page; cantSplit row fits alone on page 2.
    const filler = tr(tc(Array.from({ length: 4 }, (_, i) => p(`F${i}`)).join('')));
    const body = tr(tc(p('keep-together') + p('second')), '<w:trPr><w:cantSplit/></w:trPr>');
    const part = loadPart(`<w:tbl>${filler}${body}</w:tbl>`);
    const result = layoutTiny(part);
    assertNoContentOverflow(result);
    // The narrow cell wraps "keep-together" at its own hyphen, so the word spans lines;
    // match the row's joined text rather than any single span.
    const keep = allTableFragments(result).flatMap((fragment) =>
      fragment.rows.filter((row) => rowCellText(row).includes('keep-together'))
    );
    expect(keep).toHaveLength(1);
    expect(keep[0]!.isContinuation).toBeUndefined();
  });

  test('tblHeader repeats on continuation pages of a split body row', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const paras = Array.from({ length: 20 }, (_, i) => p(`B${i}`)).join('');
    const part = loadPart(`<w:tbl>${header}${tr(tc(paras))}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);
    for (const page of result.pages.slice(1)) {
      const tables = tableFragments(page);
      if (tables.length === 0) continue;
      expect(tables[0]!.rows[0]!.isHeaderRepeat).toBe(true);
    }
  });

  function rowCellText(row: { cells: TableFragmentRecord['rows'][number]['cells'] }): string {
    return row.cells
      .flatMap((cell) =>
        cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
      )
      .flatMap((line) => line.spans)
      .map((span) => span.text)
      .join('');
  }

  test('two+ tblHeader rows stay together as one atomic group', () => {
    const h1 = tr(tc(p('H1')), '<w:trPr><w:tblHeader/></w:trPr>');
    const h2 = tr(tc(p('H2')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = tr(tc(p('body')));
    const part = loadPart(`<w:tbl>${h1}${h2}${body}</w:tbl>`);
    const result = layoutTiny(part);
    assertNoContentOverflow(result);
    const [table] = allTableFragments(result);
    expect(table!.rows.map(rowCellText)).toEqual(['H1', 'H2', 'body']);
    // No fragment leads with a partial header group (H1 without H2 or vice versa).
    for (const page of result.pages) {
      for (const fragment of tableFragments(page)) {
        const texts = fragment.rows.map(rowCellText);
        const h1i = texts.indexOf('H1');
        const h2i = texts.indexOf('H2');
        if (h1i >= 0 || h2i >= 0) {
          expect(h1i).toBeGreaterThanOrEqual(0);
          expect(h2i).toBe(h1i + 1);
        }
      }
    }
  });

  test('header group moves whole when the remainder fits one header but not the group', () => {
    // TINY content = 80pt; one para row is 12.73pt. Five filler paras leave 16.4pt — enough
    // for H1 alone, not H1+H2. In mode 15 the group must move intact rather than split.
    const filler = Array.from({ length: 5 }, (_, i) => p(`F${i}`)).join('');
    const h1 = tr(tc(p('H1')), '<w:trPr><w:tblHeader/></w:trPr>');
    const h2 = tr(tc(p('H2')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = tr(tc(p('body')));
    const part = loadPart(`${filler}<w:tbl>${h1}${h2}${body}</w:tbl>`);
    const result = layoutTiny(part, undefined, 15);
    assertNoContentOverflow(result);
    expect(result.pages.length).toBeGreaterThan(1);
    // The whole group moved: page 1 keeps the filler and NO table row, even though H1
    // alone would have fitted the remainder.
    expect(tableFragments(result.pages[0]!)).toHaveLength(0);

    let sawPartialHeaderPage = false;
    for (const page of result.pages) {
      const tables = tableFragments(page);
      for (const fragment of tables) {
        const texts = fragment.rows.map(rowCellText);
        const h1i = texts.indexOf('H1');
        const h2i = texts.indexOf('H2');
        if (h1i >= 0 && h2i < 0) sawPartialHeaderPage = true;
        if (h2i >= 0 && h1i < 0) sawPartialHeaderPage = true;
        if (h1i >= 0 && h2i >= 0) {
          expect(h2i).toBe(h1i + 1);
        }
      }
    }
    expect(sawPartialHeaderPage).toBe(false);
    // Header group lands with body on a later page, not stranded alone mid-split.
    const withHeaders = result.pages.filter((page) =>
      tableFragments(page).some((fragment) =>
        fragment.rows.some((row) => rowCellText(row) === 'H1')
      )
    );
    expect(withHeaders.length).toBeGreaterThanOrEqual(1);
    for (const page of withHeaders) {
      const fragment = tableFragments(page)[0]!;
      const texts = fragment.rows.map(rowCellText);
      expect(texts.slice(0, 2)).toEqual(['H1', 'H2']);
    }
  });

  test('continuation pages repeat the complete multi-row header group', () => {
    const h1 = tr(tc(p('H1')), '<w:trPr><w:tblHeader/></w:trPr>');
    const h2 = tr(tc(p('H2')), '<w:trPr><w:tblHeader/></w:trPr>');
    const paras = Array.from({ length: 20 }, (_, i) => p(`B${i}`)).join('');
    const part = loadPart(`<w:tbl>${h1}${h2}${tr(tc(paras))}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);

    for (const page of result.pages.slice(1)) {
      const tables = tableFragments(page);
      if (tables.length === 0) continue;
      const lead = tables[0]!.rows.slice(0, 2);
      expect(lead).toHaveLength(2);
      expect(lead.every((row) => row.isHeaderRepeat)).toBe(true);
      expect(lead.map(rowCellText)).toEqual(['H1', 'H2']);
    }
    // Authored header paragraphs appear once in interaction order.
    const order = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(order.filter((text) => text === 'H1')).toHaveLength(1);
    expect(order.filter((text) => text === 'H2')).toHaveLength(1);
  });

  test('overheight header group degrades to ordinary rows instead of refusing the document', () => {
    // Seven one-line header rows = 89.1pt > 80pt content box.
    const headers = Array.from({ length: 7 }, (_, i) =>
      tr(tc(p(`H${i}`)), '<w:trPr><w:tblHeader/></w:trPr>')
    ).join('');
    const part = loadPart(`<w:tbl>${headers}${tr(tc(p('body')))}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    const rows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(rows.some((row) => row.isHeaderRepeat)).toBe(false);
    expect(rows.map(rowCellText)).toEqual(['H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'body']);
  });

  test('near-full header suppresses its repeat when the next row cannot make progress', () => {
    // TINY content = 80pt. The 67.5pt exact header leaves 12.5pt, just less than the
    // fixed measurer's 12.73pt one-line row. Repeating it would reproduce the same unusable
    // page forever; the authored header stays on page 1 and the body advances on page 2.
    const header = tr(
      tc(p('HEAD')),
      '<w:trPr><w:tblHeader/><w:trHeight w:val="1350" w:hRule="exact"/></w:trPr>'
    );
    const part = loadPart(`<w:tbl>${header}${tr(tc(p('body')))}</w:tbl>`);
    // Mode 15: before it the repeat stays (`table-repeat-splittable-row.test.ts`).
    const result = layoutTiny(part, undefined, 15);
    assertNoContentOverflow(result);
    expect(result.pages).toHaveLength(3); // The last holds the body's final empty paragraph.
    const rows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(rows.map(rowCellText)).toEqual(['HEAD', 'body']);
    expect(rows.some((row) => row.isHeaderRepeat)).toBe(false);
  });

  test('full-page header remains authored once and does not block the body', () => {
    const header = tr(
      tc(p('HEAD')),
      '<w:trPr><w:tblHeader/><w:trHeight w:val="1600" w:hRule="exact"/></w:trPr>'
    );
    const part = loadPart(`<w:tbl>${header}${tr(tc(p('body')))}</w:tbl>`);
    const result = layoutTiny(part);
    assertNoContentOverflow(result);
    expect(result.pages).toHaveLength(2);
    const rows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(rows.map(rowCellText)).toEqual(['HEAD', 'body']);
    expect(rows.some((row) => row.isHeaderRepeat)).toBe(false);
  });

  const atomicAfterRepeat = () =>
    loadPart(
      `<w:tbl>${tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>')}` +
        `${tr(tc(p('first')))}${tr(tc(p('atomic')), '<w:trPr><w:trHeight w:val="1300" w:hRule="exact"/></w:trPr>')}</w:tbl>`
    );
  test('a later atomic row suppresses a repeat that would leave it no usable page', () => {
    const result = layoutTiny(atomicAfterRepeat(), undefined, 15);
    assertNoContentOverflow(result);
    expect(result.pages).toHaveLength(3); // The last holds the body's final empty paragraph.
    const rows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(rows.map(rowCellText)).toEqual(['HEAD', 'first', 'atomic']);
    expect(rows.some((row) => row.isHeaderRepeat)).toBe(false);
  });
  test('before mode 15, a later atomic row keeps the repeat and runs past the margin', () => {
    const result = layoutTiny(atomicAfterRepeat(), undefined, 14);
    const second = allTableFragments(result)[1]!;
    expect([result.pages.length, ...second.rows.map(rowCellText)]).toEqual([3, 'HEAD', 'atomic']);
    expect(second.rows[0]!.isHeaderRepeat).toBe(true);
    // The 20pt repeat and the whole 65pt exact row end at 85, past the 80pt content box.
    expect(second.rows[1]!.box.y + second.rows[1]!.box.height).toBeCloseTo(85, 6);
  });

  test('a nested block can suppress one repeat without disabling later useful repeats', () => {
    const header = tr(
      tc(p('HEAD')),
      '<w:trPr><w:tblHeader/><w:trHeight w:val="1300" w:hRule="exact"/></w:trPr>'
    );
    const nested = `<w:tbl>${tr(tc(p('nested-0') + p('nested-1')), '<w:trPr><w:cantSplit/></w:trPr>')}</w:tbl>`;
    const tail = Array.from({ length: 8 }, (_, index) => p(`tail-${index}`)).join('');
    const part = loadPart(`<w:tbl>${header}${tr(tc(nested + tail))}</w:tbl>`);
    const result = layoutTiny(part, undefined, 15);
    assertNoContentOverflow(result);
    expect(result.pages.length).toBeGreaterThan(2);
    const rows = allTableFragments(result).flatMap((fragment) => fragment.rows);
    // In mode 15 page 2 omits the header: its 15pt remainder cannot hold the atomic nested row
    // (earlier modes keep it). Later paragraph continuations can then use that remainder.
    expect(tableFragments(result.pages[1]!)[0]!.rows[0]!.isHeaderRepeat).not.toBe(true);
    expect(rows.some((row) => row.isHeaderRepeat)).toBe(true);
    expect(documentOrder(result).map((id) => paragraphTextFromLayout(result, id))).toEqual([
      'HEAD',
      'nested-0',
      'nested-1',
      ...Array.from({ length: 8 }, (_, index) => `tail-${index}`).concat(''),
    ]);
  });

  test('base table-style tblHeader cannot turn a multi-page table into a fatal repeat group', () => {
    const styleCascade = loadStyles(
      '<w:style w:type="table" w:styleId="AllHeader"><w:trPr><w:tblHeader/></w:trPr></w:style>'
    );
    const rows = Array.from({ length: 8 }, (_, index) => tr(tc(p(`S${index}`)))).join('');
    const part = loadPart(
      `<w:tbl><w:tblPr><w:tblStyle w:val="AllHeader"/></w:tblPr>${rows}</w:tbl>`
    );
    const result = layoutTiny(part, styleCascade);
    expect(result.pages.length).toBeGreaterThan(1);
    const placed = allTableFragments(result).flatMap((fragment) => fragment.rows);
    expect(placed.some((row) => row.isHeaderRepeat)).toBe(false);
    expect(placed.map(rowCellText)).toEqual(Array.from({ length: 8 }, (_, index) => `S${index}`));
  });

  test('multi-row header group repeats ahead of tall body / vMerge continuation', () => {
    const h1 = tr(
      tc(p('H1'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('H1b')),
      '<w:trPr><w:tblHeader/></w:trPr>'
    );
    const h2 = tr(
      tc(p('ghost-h'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('H2b')),
      '<w:trPr><w:tblHeader/></w:trPr>'
    );
    const tall = Array.from({ length: 16 }, (_, i) => p(`T${i}`)).join('');
    const body = tr(tc(tall, '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('side')));
    const cont = tr(tc(p('ghost-b'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('side2')));
    const part = loadPart(`<w:tbl>${h1}${h2}${body}${cont}</w:tbl>`);
    const result = layoutTiny(part);
    expect(result.pages.length).toBeGreaterThan(1);
    assertNoContentOverflow(result);

    for (const page of result.pages.slice(1)) {
      const tables = tableFragments(page);
      if (tables.length === 0) continue;
      const lead = tables[0]!.rows.slice(0, 2);
      expect(lead.every((row) => row.isHeaderRepeat)).toBe(true);
      expect(lead.map(rowCellText)).toEqual(['H1H1b', 'H2b']);
    }
    const order = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(order).not.toContain('ghost-h');
    expect(order).not.toContain('ghost-b');
    expect(order.filter((text) => text.startsWith('T'))).toHaveLength(16);
  });

  test('vMerge near a page break keeps restart/continue records valid', () => {
    // Tall first row forces a break before the continue row.
    const tall = Array.from({ length: 8 }, (_, i) => p(`T${i}`)).join('');
    const part = loadPart(
      '<w:tbl>' +
        tr(tc(tall, '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('side'))) +
        tr(tc(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('side2'))) +
        '</w:tbl>'
    );
    const result = layoutTiny(part);
    assertNoContentOverflow(result);
    const order = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(order).not.toContain('ghost');
    expect(order.filter((text) => text.startsWith('T'))).toHaveLength(8);
  });

  test('nested table inside a tall cell lays out without content overflow when row fits pages', () => {
    const nested = `<w:tbl>${tr(tc(p('inner')))}</w:tbl>`;
    const paras = Array.from({ length: 12 }, (_, i) => p(`N${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(paras + nested + p('after')))}</w:tbl>`);
    const result = layoutTiny(part);
    assertNoContentOverflow(result);
    const texts = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(texts).toContain('inner');
    expect(texts).toContain('after');
  });

  test('incremental reuse still matches a clean pass after a tall-cell edit', () => {
    const paras = Array.from({ length: 12 }, (_, i) => p(`E${i}`)).join('');
    const part = loadPart(p('before') + `<w:tbl>${tr(tc(paras))}</w:tbl>` + p('after'));
    const measurer = createFixedMeasurer();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    layoutSemanticDocument(part, 0, { measurer, cache, session, geometry: TINY });

    const findParagraph = (
      node: import('../../store/package/ooxml-tree.ts').OoxmlNode,
      needle: string
    ): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'paragraph' && JSON.stringify(node).includes(`"${needle}"`)) return node.id;
      for (const child of node.children) {
        const found = findParagraph(child, needle);
        if (found) return found;
      }
      return null;
    };
    const paragraphId = findParagraph(part.root, 'E0');
    if (!paragraphId) throw new Error('missing E0');
    const edited = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'Z' });
    if (!edited.ok) throw new Error(edited.reason);
    const incremental = layoutSemanticDocument(edited.part, 1, {
      measurer,
      cache,
      session,
      geometry: TINY,
    });
    const clean = layoutSemanticDocument(edited.part, 1, {
      measurer: createFixedMeasurer(),
      geometry: TINY,
    });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
    assertNoContentOverflow(incremental);
  });
});

describe('comprehensive fixture table pagination regression', () => {
  test('comprehensive-word-element-test lays out without content-box overflow', () => {
    const part = fixturePart('comprehensive-word-element-test.docx');
    const result = layout(part);
    expect(result.pages.length).toBeGreaterThan(0);
    assertNoContentOverflow(result);
    // Tables still produce reachable cell text.
    expect(allTableFragments(result).length).toBeGreaterThan(0);
  });
});
