// Comprehensive fixture §5.1–§5.3 table fidelity: gray hairlines, vMerge span, mixed borders.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

function layoutFixture() {
  const bytes = readFileSync(
    `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
  );
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  const part = result.package.parts.get(result.package.mainDocumentPart)!;
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
}

function cellText(cell: TableFragmentRecord['rows'][number]['cells'][number]): string {
  return cell.blocks
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

function findTable(layout: ReturnType<typeof layoutFixture>, needle: string): TableFragmentRecord {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      const texts = fragment.rows.flatMap((row) => row.cells.map(cellText)).join('|');
      if (texts.includes(needle)) return fragment;
    }
  }
  throw new Error(`table containing ${needle} not found`);
}

describe('comprehensive fixture table fidelity', () => {
  test('§5.1 gray hairline borders from tcBorders', () => {
    const table = findTable(layoutFixture(), 'Alpha Test');
    const header = table.rows[0]!.cells[0]!;
    expect(header.borders?.top).toEqual({ style: 'single', color: '999999', widthPt: 0.125 });
    expect(header.borders?.left).toEqual({ style: 'single', color: '999999', widthPt: 0.125 });
    expect(header.shading).toBe('1B3A5C');
    // Interior cell owns bottom/right; hairline grey.
    const body = table.rows[1]!.cells[1]!;
    expect(body.borders?.bottom?.color).toBe('999999');
    expect(body.borders?.right?.color).toBe('999999');
  });

  test('§5.2 gridSpan header, vMerge span height, centered content, no interior seam', () => {
    const table = findTable(layoutFixture(), 'Merged Header');
    const header = table.rows[0]!.cells[0]!;
    expect(header.gridSpan).toBe(3);
    expect(header.box.width).toBe(table.box.width);

    const restart = table.rows[2]!.cells[0]!;
    const cont = table.rows[3]!.cells[0]!;
    expect(cellText(restart)).toBe('Revenue (row span)');
    expect(cont.vMergeContinue).toBe(true);
    expect(cont.paintInert).toBe(true);
    expect(cont.borders).toEqual({});
    expect(restart.rowSpan).toBe(2);
    expect(restart.box.height).toBeCloseTo(
      table.rows[2]!.box.height + table.rows[3]!.box.height,
      5
    );
    // Outer bottom of the span remains; the mid-span seam is not a separate edge
    // (continue is paint-inert and restart owns only the span's outer bottom).
    expect(restart.borders?.bottom).toEqual({
      style: 'single',
      color: '999999',
      widthPt: 0.125,
    });
    expect(cont.borders).toEqual({});
    // vAlign center: content sits below the top pad inside the spanned box.
    const contentTop = restart.blocks[0]!.box.y;
    expect(contentTop).toBeGreaterThan(restart.box.y + 4);
    const mid = restart.box.y + restart.box.height / 2;
    expect(contentTop).toBeLessThan(mid + 1);
  });

  test('§5.3 mixed borders: double blue, dashed red, dotted green, absent interior, triple purple', () => {
    const table = findTable(layoutFixture(), 'Double blue');
    const [tl, tr] = table.rows[0]!.cells;
    const [bl, br] = table.rows[1]!.cells;

    expect(tl!.borders?.top).toEqual({ style: 'double', color: '2E75B6', widthPt: 0.375 });
    expect(tl!.borders?.left).toEqual({ style: 'double', color: '2E75B6', widthPt: 0.375 });
    expect(tl!.borders?.right).toEqual({ style: 'dashed', color: 'CC3333', widthPt: 0.125 });
    expect(tl!.borders?.bottom).toEqual({ style: 'double', color: '2E75B6', widthPt: 0.375 });

    expect(tr!.borders?.top).toEqual({ style: 'dotted', color: '339933', widthPt: 0.125 });
    expect(tr!.borders?.right).toEqual({ style: 'dotted', color: '339933', widthPt: 0.125 });
    expect(tr!.borders?.left).toBeUndefined(); // owned by TL

    // Bottom mid-vertical absent (none vs none).
    expect(bl!.borders?.right).toBeUndefined();
    expect(br!.borders?.left).toBeUndefined();

    // BL bottom none → explicit none suppresses table outer edge.
    expect(bl!.borders?.bottom).toBeUndefined();
    expect(bl!.shading).toBe('FFF3CD');

    expect(br!.borders?.bottom).toEqual({ style: 'triple', color: '9933CC', widthPt: 0.375 });
    expect(br!.shading).toBe('E8F5E9');
    expect(tr!.borders?.bottom).toEqual({ style: 'dotted', color: '339933', widthPt: 0.125 });
  });

  test('§18.5 explicit cell none suppresses the table frame', () => {
    const table = findTable(layoutFixture(), 'Column A');
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.borders?.top).toBeUndefined();
        expect(cell.borders?.right).toBeUndefined();
        expect(cell.borders?.bottom).toBeUndefined();
        expect(cell.borders?.left).toBeUndefined();
      }
    }
  });

  test('§6.1 nested-table host bottom pad matches authored tcMar; §6.2 follows tightly', () => {
    const layout = layoutFixture();
    const outer = findTable(layout, 'Text after nested table');
    const host = outer.rows[1]!.cells[0]!;
    const mixed = outer.rows[1]!.cells[1]!;
    const afterNested = host.blocks[host.blocks.length - 1]!;
    expect(afterNested.kind).toBe('paragraph');
    if (afterNested.kind !== 'paragraph') throw new Error('unreachable');
    const afterLine = afterNested.lines[afterNested.lines.length - 1]!;
    const hostPadTop = host.blocks[0]!.box.y - host.box.y;
    const hostPadBottom = host.box.y + host.box.height - (afterLine.box.y + afterLine.box.height);
    // The band above is charged here in full, and the outer bottom reserves its full
    // hairline stroke: both pads are the 4pt `w:tcMar` plus one whole 0.1pt rule.
    expect(hostPadTop).toBeCloseTo(4.1, 2);
    expect(hostPadBottom).toBeCloseTo(4.1, 2);
    // Top pad must not regress when bottom shrinks.
    expect(hostPadTop).toBeGreaterThan(3.5);

    const nested = host.blocks.find((block) => block.kind === 'table');
    expect(nested?.kind).toBe('table');
    if (!nested || nested.kind !== 'table') throw new Error('unreachable');
    // Inner tcMar 40 twips each side: no defaultLineHeight+2*pad (20pt) floor.
    expect(nested.rows[0]!.box.height).toBeLessThan(18);
    const inner = nested.rows[0]!.cells[0]!;
    const innerPara = inner.blocks[0]!;
    // The first nested row clears its full outer top rule, and its bottom is the interior
    // band, which the row below it now carries.
    expect(innerPara.box.y - inner.box.y).toBeCloseTo(2.1, 2);
    expect(inner.box.y + inner.box.height - (innerPara.box.y + innerPara.box.height)).toBeCloseTo(
      2,
      2
    );

    // Mixed cell stretches with the row; excess is row equalization, not host bottom pad.
    //
    // Asserted structurally rather than against a bound: the two cells share a row, so they
    // share a bottom edge, and the mixed cell's larger gap is its content being shorter than
    // the host's. A tuned ceiling could not tell that apart from an invented per-cell floor
    // once the legitimate slack grew past it, which is how this came to read as a defect.
    const imagePara = mixed.blocks[mixed.blocks.length - 1]!;
    expect(imagePara.kind).toBe('paragraph');
    if (imagePara.kind !== 'paragraph') throw new Error('unreachable');
    const imageLine = imagePara.lines[imagePara.lines.length - 1]!;
    const mixedPadBottom =
      mixed.box.y + mixed.box.height - (imageLine.box.y + imageLine.box.height);
    expect(mixed.box.y + mixed.box.height).toBeCloseTo(host.box.y + host.box.height, 2);
    // The host cell in the same row still keeps its authored tcMar, so the difference is
    // content height, not padding policy.
    expect(mixedPadBottom).toBeGreaterThan(hostPadBottom);

    let section62Y: number | undefined;
    for (const page of layout.pages) {
      for (const fragment of page.fragments) {
        if (fragment.kind !== 'paragraph') continue;
        const text = fragment.lines
          .flatMap((line) => line.spans)
          .map((span) => span.text)
          .join('');
        if (text.includes('6.2 Triple-Nested')) {
          section62Y = fragment.box.y;
        }
      }
    }
    expect(section62Y).toBeDefined();
    // Pre-fix §6.2 sat at ~217pt under the inflated nested rows; content-sized rows pull it up.
    expect(section62Y!).toBeLessThan(210);
    expect(section62Y!).toBeGreaterThan(outer.box.y + outer.box.height);
  });
});
