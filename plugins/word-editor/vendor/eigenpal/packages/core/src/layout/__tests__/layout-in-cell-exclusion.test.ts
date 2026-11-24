import { describe, expect, test } from 'bun:test';
import { load, layoutContext, squareAnchorInCell } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const measurer = createFixedMeasurer(6, 14);

function layout(xml: string, compatibilityMode: number | undefined) {
  const part = load(xml);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(compatibilityMode !== undefined ? { compatibilityMode } : {}),
  });
}

/** Every line of the single cell, in the order they were laid out. */
function cellLines(
  xml: string,
  compatibilityMode?: number
): readonly { readonly contentX: number }[] {
  const lines: { readonly contentX: number }[] = [];
  // Paragraphs inside cells only: the body reads an empty paragraph after its final table.
  const walk = (fragments: readonly unknown[], inCell = false): void => {
    for (const fragment of fragments as readonly Record<string, unknown>[]) {
      if (fragment.kind === 'paragraph') {
        if (!inCell) continue;
        for (const line of fragment.lines as readonly { contentX: number }[])
          lines.push({ contentX: line.contentX });
        continue;
      }
      for (const row of (fragment.rows ?? []) as readonly Record<string, unknown>[])
        for (const cell of (row.cells ?? []) as readonly Record<string, unknown>[])
          walk((cell.blocks ?? []) as readonly unknown[], true);
    }
  };
  walk(layout(xml, compatibilityMode).pages[0]!.fragments);
  return lines;
}

describe('w:layoutInCell and a float anchored inside a table cell', () => {
  // Word honours `layoutInCell="0"` only in compatibility mode 14 and below, or with no mode:
  // the object is positioned against the page and the cell's text runs straight through it.
  // From mode 15 Word ignores the flag and lays the object out in the cell, as for `"1"`.
  // Word 16.113 printed identical rows this way under modes absent, 12, 14, 15 and 16.
  const TEXT = 'word '.repeat(60);

  test('a float that stays in the cell pushes the cell text across', () => {
    const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '1' }));
    expect(lines.length).toBeGreaterThan(1);
    // The object is 144pt wide, so every line it covers starts well clear of the cell edge.
    for (const line of lines) expect(line.contentX).toBeGreaterThan(100);
  });

  for (const mode of [undefined, 14]) {
    test(`layoutInCell="0" leaves the cell text alone in mode ${mode ?? 'absent'}`, () => {
      const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '0' }), mode);
      expect(lines.length).toBeGreaterThan(1);
      // Only the cell's own inset remains; nothing near the object's 144pt width.
      for (const line of lines) expect(line.contentX).toBeLessThan(1);
    });
  }

  for (const mode of [15, 16]) {
    test(`layoutInCell="0" still wraps the cell text in mode ${mode}`, () => {
      const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '0' }), mode);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.contentX).toBeGreaterThan(100);
    });
  }

  test('the object sits in an indented cell exactly when the mode lays it out there', () => {
    const drawingOf = (layoutInCell: '0' | '1', mode: number) => {
      const xml = squareAnchorInCell({ text: TEXT, layoutInCell, tableIndent: 2880 });
      const drawings = layout(xml, mode).pages[0]!.anchoredDrawings ?? [];
      expect(drawings).toHaveLength(1);
      return drawings[0]!;
    };
    const inCell = drawingOf('1', 15);
    expect(inCell.layoutInCell).toBe(true);
    // Mode 15 ignores the `0`: same place as `1`, and the record says it is in the cell.
    const ignored = drawingOf('0', 15);
    expect(ignored.layoutInCell).toBe(true);
    expect(ignored.x).toBeCloseTo(inCell.x, 3);
    // Mode 14 honours it: the object leaves the indented cell for the page column.
    expect(inCell.x).toBeGreaterThan(20);
    const honoured = drawingOf('0', 14);
    expect(honoured.layoutInCell).toBe(false);
    expect(honoured.x).toBeCloseTo(0, 3);
  });

  test('a vertically centred cell republishes the object where the mode lays it out', () => {
    const drawingOf = (layoutInCell: '0' | '1', mode: number) => {
      const xml = squareAnchorInCell({
        text: 'word',
        layoutInCell,
        tableIndent: 2880,
        centred: true,
      });
      const drawings = layout(xml, mode).pages[0]!.anchoredDrawings ?? [];
      expect(drawings).toHaveLength(1);
      return drawings[0]!;
    };
    const inCell = drawingOf('1', 15);
    // Centring moved the content, and the object with it, well below the row top.
    expect(inCell.y).toBeGreaterThan(50);
    const ignored = drawingOf('0', 15);
    expect(ignored.layoutInCell).toBe(true);
    expect(ignored.x).toBeCloseTo(inCell.x, 3);
    expect(ignored.y).toBeCloseTo(inCell.y, 3);
    expect(drawingOf('0', 14).layoutInCell).toBe(false);
  });

  test('an object positioned against its character or line stays in the cell in mode 14', () => {
    for (const frames of [
      { horizontalFrame: 'character' as const },
      { verticalFrame: 'line' as const },
    ]) {
      const xml = squareAnchorInCell({ text: TEXT, layoutInCell: '0', ...frames });
      expect(layout(xml, 14).pages[0]!.anchoredDrawings?.[0]?.layoutInCell).toBe(true);
      const lines = cellLines(xml, 14);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]!.contentX).toBeGreaterThan(100);
    }
  });

  // Headers, footers, notes and text boxes reuse cell flow but are not tables. Word ignores
  // `layoutInCell` there, and before mode 15 runs header text straight under every logo.
  const headerStory = (
    layoutInCell: '0' | '1',
    mode: number | undefined,
    wrap?: 'topAndBottom'
  ) => {
    const cell = squareAnchorInCell({ text: TEXT, layoutInCell, ...(wrap ? { wrap } : {}) });
    const paragraph = cell.slice(cell.indexOf('<w:p>'), cell.lastIndexOf('</w:p>') + 6);
    const xml =
      cell.slice(0, cell.indexOf('>') + 1).replace('<w:document', '<w:hdr') +
      paragraph +
      '</w:hdr>';
    const part = load(xml, '/word/header1.xml');
    const story = layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, '/word/header1.xml'),
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        marginLeft: 72,
        marginRight: 72,
        marginTop: 72,
        marginBottom: 72,
      },
      undefined,
      mode === undefined ? undefined : { compatibilityMode: mode }
    );
    const lines = (
      story.fragments[0] as { lines: readonly { contentX: number; box: { y: number } }[] }
    ).lines;
    return { drawing: story.anchoredDrawings?.[0], lines };
  };

  for (const layoutInCell of ['0', '1'] as const) {
    for (const mode of [undefined, 14]) {
      test(`a header runs its text under a logo (layoutInCell=${layoutInCell}, mode ${mode ?? 'absent'})`, () => {
        const square = headerStory(layoutInCell, mode);
        expect(square.drawing?.layoutInCell).toBe(true);
        expect(square.lines.length).toBeGreaterThan(1);
        for (const line of square.lines) expect(line.contentX).toBeLessThan(1);
        expect(headerStory(layoutInCell, mode, 'topAndBottom').lines[0]!.box.y).toBeLessThan(1);
      });
    }
    test(`a header wraps its text around a logo in mode 15 (layoutInCell=${layoutInCell})`, () => {
      const square = headerStory(layoutInCell, 15);
      expect(square.drawing?.layoutInCell).toBe(true);
      expect(square.lines.length).toBeGreaterThan(1);
      expect(square.lines[0]!.contentX).toBeGreaterThan(100);
      expect(headerStory(layoutInCell, 15, 'topAndBottom').lines[0]!.box.y).toBeGreaterThan(70);
    });
  }

  test('a header TABLE cell still wraps its text around its logo before mode 15', () => {
    // A second paragraph in the same cell wraps too: it reads the float's zone, not its own.
    const cell = squareAnchorInCell({ text: 'logo line', layoutInCell: '1' }).replace(
      '</w:p></w:tc>',
      `</w:p><w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p></w:tc>`
    );
    const table = cell.slice(cell.indexOf('<w:tbl>'), cell.lastIndexOf('</w:tbl>') + 8);
    const xml =
      cell.slice(0, cell.indexOf('>') + 1).replace('<w:document', '<w:hdr') + table + '</w:hdr>';
    const part = load(xml, '/word/header1.xml');
    const story = layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, '/word/header1.xml'),
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        marginLeft: 72,
        marginRight: 72,
        marginTop: 72,
        marginBottom: 72,
      },
      undefined,
      { compatibilityMode: 14 }
    );
    const tableFragment = story.fragments[0] as {
      rows: { cells: { blocks: { lines: { contentX: number }[] }[] }[] }[];
    };
    const blocks = tableFragment.rows[0]!.cells[0]!.blocks;
    expect(blocks[0]!.lines[0]!.contentX).toBeGreaterThan(100);
    expect(blocks[1]!.lines.length).toBeGreaterThan(1);
    expect(blocks[1]!.lines[0]!.contentX).toBeGreaterThan(100);
  });
});
