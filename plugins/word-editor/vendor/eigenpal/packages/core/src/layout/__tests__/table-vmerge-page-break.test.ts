// A vertical merge that crosses a page break (17.4.85 `w:vMerge`).
//
// Word keeps drawing a vertically merged cell on every page the merge runs onto: the same
// left/right rules, the bottom rule where the merge ends, and the same fill. Only the text
// stays behind on the page that holds the restart. Each table fragment finalizes on its own,
// so the continuation page sees a `w:vMerge` continue with no restart in its rows — and a
// reader that files that under "orphan" leaves a HOLE in the continuation page's grid.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { documentOrder, paragraphTextFromLayout } from '../semantic-interaction.ts';
import { resolveVMergeSpans } from '../table-vmerge.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

function layoutTiny(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(), geometry: TINY });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;

/**
 * The continue row asks for 75pt of the 80pt content box (`w:trHeight` 1500 twips), so the
 * two rows of the merge cannot share one page whatever the merged content measures. That is
 * what makes the break a REAL one: a merge that fits a page is kept on it, and only a merge
 * too tall for any page runs on. Drop this and the table fits page 1, taking the whole
 * continuation-page contract this file exists to pin with it.
 */
const TALL_ROW = '<w:trPr><w:trHeight w:val="1500"/></w:trPr>';

/** A full grid stated on the table itself, so the test needs no styles part. */
const GRID =
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr>';

function tableFragments(result: SemanticLayout): TableFragmentRecord[][] {
  return result.pages.map((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

function sidesOf(cell: TableCellFragmentRecord): string[] {
  return [...new Set((cell.borders?.edgeSegments ?? []).map((segment) => segment.side))].sort();
}

function cellText(cell: TableCellFragmentRecord): string {
  return cell.blocks
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

/**
 * The restart row fills what is left of page 1, so the break falls on the ROW boundary and
 * page 2 opens with the continue row alone — the fragment Word draws the merged cell into.
 */
function splitMergeLayout(): SemanticLayout {
  const filler = Array.from({ length: 3 }, (_, index) => p(`F${index}`)).join('');
  const tall = Array.from({ length: 3 }, (_, index) => p(`T${index}`)).join('');
  const part = loadPart(
    `${filler}<w:tbl>${GRID}` +
      tr(tc(tall, '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('side'))) +
      `<w:tr>${TALL_ROW}` +
      tc(p('ghost'), '<w:tcPr><w:vMerge/><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>') +
      tc(p('side2')) +
      '</w:tr>' +
      '</w:tbl>'
  );
  return layoutTiny(part);
}

function continuationRow(result: SemanticLayout): TableRowFragmentRecord {
  const later = tableFragments(result).slice(1).flat();
  expect(later.length).toBeGreaterThan(0);
  const row = later[0]!.rows[0]!;
  // The continue row is the one whose second cell carries the second row's text.
  expect(cellText(row.cells[1]!)).toBe('side2');
  return row;
}

describe('a vertical merge that crosses a page break', () => {
  test('keeps the merged cell painted on the continuation page', () => {
    const result = splitMergeLayout();
    expect(result.pages.length).toBeGreaterThan(1);
    const merged = continuationRow(result).cells[0]!;
    expect(merged.paintInert ?? false).toBe(false);
    expect(merged.vMergeContinue).toBe(false);
    expect(merged.rowSpan).toBe(1);
  });

  test('keeps its rules: no hole in the continuation grid', () => {
    const result = splitMergeLayout();
    const row = continuationRow(result);
    const merged = row.cells[0]!;
    // The outer left rule, the interior rule it owns against its neighbour, and the bottom
    // that closes the table — the same box the ordinary cell beside it gets.
    expect(sidesOf(merged)).toEqual(['bottom', 'left', 'right', 'top']);
    expect(sidesOf(row.cells[1]!)).toEqual(['bottom', 'right', 'top']);
  });

  test('keeps its shading and does not repeat the restart text', () => {
    const result = splitMergeLayout();
    const merged = continuationRow(result).cells[0]!;
    expect(merged.shading).toBe('D9E2F3');
    expect(merged.blocks).toHaveLength(0);
    const order = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(order).not.toContain('ghost');
    expect(order.filter((text) => text.startsWith('T'))).toHaveLength(3);
  });

  test('a repeated header row does not swallow the carried merge', () => {
    // Header repeats lead the continuation fragment. The body merge below them continues a
    // restart from page 1 — it must not attach to the repeated header cell above it.
    const header = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + tc(p('H')) + tc(p('Hb')) + '</w:tr>';
    const tall = Array.from({ length: 5 }, (_, index) => p(`T${index}`)).join('');
    const part = loadPart(
      `<w:tbl>${GRID}${header}` +
        tr(tc(tall, '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('side'))) +
        `<w:tr>${TALL_ROW}` +
        tc(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>') +
        tc(p('side2')) +
        '</w:tr>' +
        '</w:tbl>'
    );
    const result = layoutTiny(part);
    const fragment = tableFragments(result).slice(1).flat()[0]!;
    const repeat = fragment.rows[0]!;
    expect(repeat.isHeaderRepeat).toBe(true);
    // The repeated header keeps its own one-row height…
    expect(repeat.cells[0]!.rowSpan ?? 1).toBe(1);
    expect(repeat.cells[0]!.box.height).toBe(repeat.box.height);
    // …and the carried merge below it paints in its own band.
    const merged = fragment.rows[1]!.cells[0]!;
    expect(merged.paintInert ?? false).toBe(false);
    expect(sidesOf(merged)).toContain('left');
  });
});

describe('resolveVMergeSpans page-fragment semantics', () => {
  const cell = (
    id: string,
    gridColumn: number,
    vMergeContinue = false
  ): TableRowFragmentRecord['cells'][number] => ({
    id,
    gridColumn,
    gridSpan: 1,
    vMergeContinue,
    ...(vMergeContinue ? { paintInert: true as const } : {}),
    blocks: [],
    box: { x: gridColumn * 20, y: 0, width: 20, height: 10 },
  });

  const row = (
    id: string,
    cells: TableRowFragmentRecord['cells'],
    y: number,
    isHeaderRepeat = false
  ): TableRowFragmentRecord => ({
    id,
    isHeaderRepeat,
    cells: cells.map((c) => ({ ...c, box: { ...c.box, y } })),
    box: { x: 0, y, width: 40, height: 10 },
  });

  test('a carried-in continue heads the merge only under pageFragment', () => {
    const rows = [
      row('r0', [cell('carried', 0, true), cell('b0', 1)], 0),
      row('r1', [cell('carried-2', 0, true), cell('b1', 1)], 10),
    ];
    expect(resolveVMergeSpans(rows).has('carried')).toBe(false);
    expect(
      resolveVMergeSpans(rows, undefined, undefined, { pageFragment: true }).get('carried')
    ).toBe(2);
  });

  test('an orphan continue AFTER the column is claimed stays ignored', () => {
    const rows = [
      row('r0', [cell('plain', 0)], 0),
      row('r1', [cell('other', 0)], 10),
      row('r2', [cell('orphan', 0, true)], 20),
    ];
    // `other` ends `plain`'s merge and owns the column, so the later continue extends
    // `other` rather than opening a merge of its own.
    const spans = resolveVMergeSpans(rows, undefined, undefined, { pageFragment: true });
    expect(spans.has('orphan')).toBe(false);
    expect(spans.get('other')).toBe(2);
  });

  test('a repeated header row hands no merge to the body rows below it', () => {
    const rows = [
      row('h0', [cell('h0c0', 0), cell('h0c1', 1)], 0, true),
      row('r0', [cell('carried', 0, true), cell('b0', 1)], 10),
      row('r1', [cell('carried-2', 0, true), cell('b1', 1)], 20),
    ];
    const spans = resolveVMergeSpans(rows, undefined, undefined, { pageFragment: true });
    expect(spans.get('h0c0')).toBe(1);
    expect(spans.get('carried')).toBe(2);
  });
});
