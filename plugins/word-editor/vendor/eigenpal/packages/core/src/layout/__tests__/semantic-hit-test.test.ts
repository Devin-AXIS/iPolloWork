// Pointer hit testing in model space.
//
// Every case here is a point that is NOT on a glyph — an indent, a margin, the gap between
// two lines, a cell's padding, the gutter between two sheets. Those are the clicks a person
// makes when aiming at the start or the end of a line, and answering them well is the whole
// difference between a caret that goes where it was meant to and one that jumps.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  caretBoxOnLine,
  DEFAULT_VERTICAL_WEIGHT,
  hitTestPage,
  hitTestSheet,
  isFurniturePoint,
  lineEndOffset,
  pageAtY,
  spanOffsetX,
} from '../semantic-hit-test.ts';
import { caretAt, caretStops, moveCaret } from '../semantic-interaction.ts';
import { resetGraphemeBoundary, setGraphemeBoundary } from '../grapheme.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import {
  paragraphFragmentsOf,
  type SemanticLayout,
  type TextMeasurer,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (body: string, port: TextMeasurer = measurer): SemanticLayout =>
  layoutSemanticDocument(load(body), 1, {
    measurer: port,
    styleCascade: elevenPointDefaults(),
  });

const P0 = '/word/document.xml#0.0.0';
const P1 = '/word/document.xml#0.0.1';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr}${cells}</w:tr>`;

/** Every hit test in this file names its page, the way the pointer path does. */
const hit = (layout: SemanticLayout, x: number, y: number, port?: TextMeasurer) =>
  hitTestPage(layout, 0, { x, y }, port ? { measurer: port } : {});

describe('a click beside a line', () => {
  test('left of the first glyph is the START of that line', () => {
    // The single most common miss: aiming at the start of a line and landing in the margin.
    const layout = lay(p('abcdef'));
    expect(hit(layout, -40, 5)!.position).toEqual({ paragraphId: P0, offset: 0 });
  });

  test('left of an INDENTED line is still that line, not the one below it', () => {
    // The indent strip is outside the paragraph's box entirely, so nothing contains the point.
    const layout = lay(`<w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>abc</w:t></w:r></w:p>`);
    const found = hit(layout, 10, 5)!;
    expect(found.position).toEqual({ paragraphId: P0, offset: 0 });
    expect(found.onGlyphs).toBe(false);
  });

  test('right of the last glyph is the END of that line', () => {
    const layout = lay(p('abc'));
    expect(hit(layout, 9999, 5)!.position).toEqual({ paragraphId: P0, offset: 3 });
  });

  test('a CENTRED line measures from its glyphs, not from its line box', () => {
    // The line box spans the full column while the text sits in the middle of it. Reading the
    // line box would call a click in the left third "inside the line" and interpolate a
    // position out of empty space.
    const layout = lay(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>abc</w:t></w:r></w:p>`);
    const spans = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!.spans;
    expect(spans[0]!.box.x).toBeGreaterThan(200);
    expect(hit(layout, 100, 5)!.position.offset).toBe(0);
    expect(hit(layout, 400, 5)!.position.offset).toBe(3);
  });

  test('an empty paragraph can still be clicked into', () => {
    const layout = lay('<w:p/>');
    expect(hit(layout, 300, 5)!.position).toEqual({ paragraphId: P0, offset: 0 });
  });

  test('an EMPTY centred paragraph puts its caret in the middle, not at the margin', () => {
    // The line has no spans to carry the alignment offset, so the caret used to be drawn at
    // the left edge of the column and only jumped to the centre once a character was typed.
    const empty = lay('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
    const emptyLine = paragraphFragmentsOf(empty.pages[0]!)[0]!.lines[0]!;
    const middle = emptyLine.box.x + emptyLine.box.width / 2;
    expect(emptyLine.spans).toHaveLength(0);
    expect(caretBoxOnLine(emptyLine, 0, measurer).x).toBeCloseTo(middle, 5);

    // ...and the first keystroke barely moves it — half a glyph, not half a page.
    const typed = lay(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`);
    const typedLine = paragraphFragmentsOf(typed.pages[0]!)[0]!.lines[0]!;
    expect(Math.abs(caretBoxOnLine(typedLine, 0, measurer).x - middle)).toBeLessThan(6);
  });

  test('an EMPTY right-aligned paragraph puts its caret at the right edge', () => {
    const layout = lay('<w:p><w:pPr><w:jc w:val="right"/></w:pPr></w:p>');
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    expect(caretBoxOnLine(line, 0, measurer).x).toBeCloseTo(line.box.x + line.box.width, 5);
  });

  test('a click anywhere on an empty centred line lands on the aligned caret x', () => {
    // The band still spans the whole column — a click in the left margin belongs to this
    // paragraph — but the position it resolves to is the centred one.
    const layout = lay('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    const found = hit(layout, 20, 5)!;
    expect(found.position).toEqual({ paragraphId: P0, offset: 0 });
    expect(caretAt(layout, found.position, { measurer })!.x).toBeCloseTo(
      line.box.x + line.box.width / 2,
      5
    );
  });

  test('an empty JUSTIFIED paragraph stays flush left', () => {
    // `w:jc both` sets its last line flush left, and an empty paragraph is all last line.
    const layout = lay('<w:p><w:pPr><w:jc w:val="both"/></w:pPr></w:p>');
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    expect(caretBoxOnLine(line, 0, measurer).x).toBeCloseTo(line.box.x, 5);
  });

  test('an empty paragraph takes its FIRST-LINE indent, the way a filled one does', () => {
    // `box.x` is the column edge and does not carry `w:firstLine`, so reading it put the
    // caret a whole indent left of where the first character would land.
    const ind = (attr: string) =>
      paragraphFragmentsOf(lay(`<w:p><w:pPr><w:ind ${attr}/></w:pPr></w:p>`).pages[0]!)[0]!
        .lines[0]!;
    const withText = paragraphFragmentsOf(
      lay(`<w:p><w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`).pages[0]!
    )[0]!.lines[0]!;
    expect(caretBoxOnLine(ind('w:firstLine="720"'), 0, measurer).x).toBeCloseTo(36, 5);
    expect(caretBoxOnLine(withText, 0, measurer).x).toBeCloseTo(36, 5);
    // A hanging indent is the same rule with the opposite sign: the first line pulls back.
    expect(caretBoxOnLine(ind('w:left="720" w:hanging="720"'), 0, measurer).x).toBeCloseTo(0, 5);
  });

  test('an empty centred paragraph in a TABLE CELL centres in the cell', () => {
    // Table layout carries its own copy of the alignment maths; it drifts silently otherwise.
    const layout = lay(
      `<w:tbl>${tr(tc('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'))}</w:tbl>`
    );
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    expect(line.spans).toHaveLength(0);
    expect(caretBoxOnLine(line, 0, measurer).x).toBeCloseTo(line.box.x + line.box.width / 2, 5);
  });
});

describe('a click above or below the lines', () => {
  test('above the first line clamps into the first line', () => {
    const layout = lay(p('abc'));
    expect(hit(layout, 12, -500)!.position.offset).toBe(2);
  });

  test('below the last line clamps into the last line', () => {
    const layout = lay(p('ab') + p('cd'));
    const found = hit(layout, 9999, 9999)!;
    expect(found.position).toEqual({ paragraphId: P1, offset: 2 });
  });

  test('between two lines the LOWER line wins, with no epsilon anywhere', () => {
    // Bands are half-open, so a point exactly on a shared edge belongs to one line by
    // construction rather than by a tolerance somebody has to keep tuned.
    const layout = lay(p('ab') + p('cd'));
    expect(hit(layout, 0, 14)!.position.paragraphId).toBe(P1);
    expect(hit(layout, 0, 13.999)!.position.paragraphId).toBe(P0);
  });
});

describe('the nearest-block rule weights the vertical axis', () => {
  // An indented first paragraph and a full-width second one. A point in the left margin,
  // LEVEL with the first line, is horizontally nearer the second paragraph's box and
  // vertically nearer the first. Word puts the caret on the line you are level with.
  const layout = lay(
    `<w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>first</w:t></w:r></w:p>` + p('second')
  );

  test('level-with-a-short-line beats directly-below-a-long-one', () => {
    expect(hitTestPage(layout, 0, { x: 10, y: 5 })!.position.paragraphId).toBe(P0);
  });

  test('and the weight is what does it, not the geometry by itself', () => {
    // Same point, same layout, weight removed: the answer flips. Without this the test would
    // pass for a reason that has nothing to do with the rule under test.
    const unweighted = hitTestPage(layout, 0, { x: 10, y: 5 }, { verticalWeight: 1 });
    expect(unweighted!.position.paragraphId).toBe(P1);
    expect(DEFAULT_VERTICAL_WEIGHT).toBe(8);
  });
});

describe('the end of a soft-wrapped line', () => {
  const layout = lay(p('word '.repeat(30).trim()));
  const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;

  test('the fixture really does wrap, or the rule is untested', () => {
    expect(lines.length).toBe(2);
    expect(lines[0]!.range.end).toBe(75);
  });

  test('past the end, the caret lands after the wrap space and stays on the clicked line', () => {
    // The offset after the space also starts the next line. The hit names the clicked line,
    // which the caret keeps as its affinity, so the click does not appear to miss.
    expect(lineEndOffset(layout, lines[0]!)).toBe(75);
    const landed = hit(layout, 9999, 5)!;
    expect(landed.position.offset).toBe(75);
    expect(landed.caret.lineId).toBe(lines[0]!.id);
  });

  test('the LAST line of a paragraph has no wrap space to discount', () => {
    expect(lineEndOffset(layout, lines[1]!)).toBe(lines[1]!.range.end);
    expect(hit(layout, 9999, 20)!.position.offset).toBe(149);
  });
});

describe('pages', () => {
  const layout = lay(p('x').repeat(200));

  test('the fixture really does span several sheets', () => {
    expect(layout.pages.length).toBeGreaterThan(3);
  });

  test('the gutter between two sheets belongs to the sheet ABOVE it', () => {
    // The nearest text to a point in that gap is the last line of the page above.
    const first = layout.pages[0]!;
    const gutterY = first.box.y + first.box.height + 4;
    expect(gutterY).toBeLessThan(layout.pages[1]!.box.y);
    expect(pageAtY(layout, gutterY)).toBe(0);
  });

  test('above the first sheet clamps to it, past the last sheet clamps to that', () => {
    expect(pageAtY(layout, -9999)).toBe(0);
    expect(pageAtY(layout, 9_999_999)).toBe(layout.pages.length - 1);
  });

  test('a sheet-space point resolves through the page it lands on', () => {
    const second = layout.pages[1]!;
    const found = hitTestSheet(layout, {
      x: second.contentBox.x - 30,
      y: second.contentBox.y + 5,
    })!;
    expect(found.pageIndex).toBe(1);
    expect(found.position.offset).toBe(0);
  });

  test('an empty document answers nothing rather than guessing', () => {
    expect(hitTestPage({ revision: 1, pages: [] }, 0, { x: 0, y: 0 })).toBeNull();
    expect(pageAtY({ revision: 1, pages: [] }, 0)).toBe(-1);
  });

  test('a point over no page furniture is not reported as furniture', () => {
    expect(isFurniturePoint(layout, { x: 100, y: 100 })).toBe(false);
  });
});

describe('tables', () => {
  const grid = `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;
  const layout = lay(grid);
  const table = layout.pages[0]!.fragments[0]!;
  if (table.kind !== 'table') throw new Error('fixture is not a table');

  test('the fixture is a two-by-two grid', () => {
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells).toHaveLength(2);
  });

  test('a click in a cell resolves to that cell, and names it', () => {
    const found = hit(layout, table.rows[1]!.cells[1]!.box.x + 5, table.rows[1]!.box.y + 5)!;
    expect(found.cell).toMatchObject({
      tableId: table.tableId,
      rowId: table.rows[1]!.id,
      cellId: table.rows[1]!.cells[1]!.id,
      rowIndex: 1,
      gridColumn: 1,
    });
  });

  test("a click in a cell's LEFT padding lands at the start of its text", () => {
    const cell = table.rows[0]!.cells[1]!;
    const found = hit(layout, cell.box.x + 1, table.rows[0]!.box.y + 2)!;
    expect(found.position.offset).toBe(0);
    expect(found.cell!.cellId).toBe(cell.id);
  });

  test("a click in a cell's BOTTOM padding lands at the END of its last block", () => {
    // Falls out of the recursion: the padding is outside every block box, so the nearest
    // block is the last one and the line clamp finishes the job.
    const cell = table.rows[0]!.cells[0]!;
    const found = hit(layout, cell.box.x + cell.box.width - 1, cell.box.y + cell.box.height - 1)!;
    expect(found.position.offset).toBe(2);
    expect(found.cell!.cellId).toBe(cell.id);
  });

  test('a click past the last column still names the last column', () => {
    const found = hit(layout, 9999, table.rows[0]!.box.y + 5)!;
    expect(found.cell!.gridColumn).toBe(1);
  });

  test('a row ordinal counts the table, not the page', () => {
    expect(hit(layout, 5, table.rows[0]!.box.y + 5)!.cell!.rowIndex).toBe(0);
    expect(hit(layout, 5, table.rows[1]!.box.y + 5)!.cell!.rowIndex).toBe(1);
  });
});

describe('a vertically merged cell', () => {
  const merged = `<w:tbl>${tr(
    tc(p('top'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('B1'))
  )}${tr(tc('', '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('B2')))}</w:tbl>`;
  const layout = lay(merged);
  const table = layout.pages[0]!.fragments[0]!;
  if (table.kind !== 'table') throw new Error('fixture is not a table');

  test('the fixture really is a continuation holding no blocks', () => {
    expect(table.rows[1]!.cells[0]!.vMergeContinue).toBe(true);
    expect(table.rows[1]!.cells[0]!.blocks).toHaveLength(0);
  });

  test('clicking the continuation puts the caret in the text drawn there', () => {
    // The continuation paints a box but holds nothing. Resolving into it directly would find
    // no paragraph and fall through to somewhere else on the page entirely.
    const origin = table.rows[0]!.cells[0]!;
    const originBlock = origin.blocks[0]!;
    if (originBlock.kind !== 'paragraph') throw new Error('fixture cell is not a paragraph');
    const found = hit(layout, 5, table.rows[1]!.box.y + 5)!;
    expect(found.position.paragraphId).toBe(originBlock.paragraphId);
    expect(found.cell!.cellId).toBe(origin.id);
  });
});

describe('the character within a run', () => {
  /** Narrow `i`, wide `a` — so a uniform interpolation and a real search disagree. */
  const proportional: TextMeasurer = {
    measure: (text) => [...text].reduce((sum, char) => sum + (char === 'i' ? 2 : 10), 0),
    lineMetrics: () => ({ height: 14, baseline: 11 }),
  };

  test('the measurer resolves the boundary the pointer is actually nearest', () => {
    const layout = lay(p('iiiia'), proportional);
    // Prefix widths are 0, 2, 4, 6, 8, 18. A point at 9 is one unit past the boundary at 8
    // and nine short of the one at 18.
    expect(hit(layout, 9, 5, proportional)!.position.offset).toBe(4);
  });

  test('and without one the answer is the honest interpolation, not the same number', () => {
    // Proves the measurer is doing the work rather than the two paths happening to agree.
    const layout = lay(p('iiiia'), proportional);
    expect(hit(layout, 9, 5)!.position.offset).toBe(3);
  });

  test('a grapheme cluster is never split', () => {
    const layout = lay(p('éx'));
    for (let x = 0; x <= 18; x += 1) {
      expect(hit(layout, x, 5, measurer)!.position.offset).not.toBe(1);
    }
  });

  test('a point on the glyphs reports itself as such', () => {
    const layout = lay(p('abcdef'));
    expect(hit(layout, 12, 5)!.onGlyphs).toBe(true);
    expect(hit(layout, 9999, 5)!.onGlyphs).toBe(false);
  });
});

describe('cost', () => {
  test('a hit test does not scan the document', () => {
    // Hit testing runs on every pointer move of a drag. Anything proportional to document
    // length here makes dragging through a long document quadratic in its length, so the
    // budget is asserted structurally rather than by a clock.
    let calls = 0;
    const counting: TextMeasurer = {
      measure: (text, style: ResolvedRunStyle) => {
        calls += 1;
        return measurer.measure(text, style);
      },
      lineMetrics: (style: ResolvedRunStyle) => measurer.lineMetrics(style),
    };
    const layout = lay(p('the quick brown fox jumps over the lazy dog').repeat(1200), counting);
    expect(layout.pages.length).toBeGreaterThan(20);

    const last = layout.pages.length - 1;
    calls = 0;
    hitTestPage(layout, 0, { x: 40, y: 5 }, { measurer: counting });
    const onFirstPage = calls;
    calls = 0;
    hitTestPage(layout, last, { x: 40, y: 5 }, { measurer: counting });
    const onLastPage = calls;

    // A binary search over one span's grapheme boundaries, and nothing else.
    expect(onFirstPage).toBeLessThanOrEqual(16);
    expect(onLastPage).toBeLessThanOrEqual(16);
  });

  test('and a re-crossed span costs nothing the second time', () => {
    let calls = 0;
    const counting: TextMeasurer = {
      measure: (text, style: ResolvedRunStyle) => {
        calls += 1;
        return measurer.measure(text, style);
      },
      lineMetrics: (style: ResolvedRunStyle) => measurer.lineMetrics(style),
    };
    const layout = lay(p('abcdefghijklmnop'), counting);
    hitTestPage(layout, 0, { x: 40, y: 5 }, { measurer: counting });
    calls = 0;
    hitTestPage(layout, 0, { x: 40, y: 5 }, { measurer: counting });
    expect(calls).toBe(0);
  });
});

describe('a press always resolves, whatever the table holds', () => {
  // A click has to put the caret somewhere. Every case here produced NO position at all,
  // which the pointer lane turns into a dead press: no caret, no focus, nothing.
  test('a page of nothing but vertical-merge continuations is still clickable', () => {
    // Continuation-only rows have no implicit text height. Author a row height so this
    // hit-test fixture still exercises pages containing only continuation cells.
    const rows = Array.from({ length: 120 }, () =>
      tr(
        tc('', '<w:tcPr><w:vMerge/></w:tcPr>'),
        '<w:trPr><w:trHeight w:val="280" w:hRule="exact"/></w:trPr>'
      )
    ).join('');
    const layout = lay(
      `<w:tbl>${tr(tc(p('origin'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>'))}${rows}</w:tbl>`
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(hitTestPage(layout, page.index, { x: 20, y: 20 })).not.toBeNull();
    }
  });

  test('a cell holding no block at all is still clickable', () => {
    const layout = lay(`<w:tbl>${tr(tc(''))}</w:tbl>` + p('after'));
    expect(hit(layout, 20, 5)).not.toBeNull();
  });

  test('a row holding no cell at all is still clickable', () => {
    const layout = lay(`<w:tbl>${tr('')}</w:tbl>` + p('after'));
    expect(hit(layout, 20, 5)).not.toBeNull();
  });
});

describe('a vertical merge that began on an earlier page', () => {
  // The merged run starts on one page and continues on the next, so a walk confined to the
  // continuation's own fragment finds no origin and the click lands in another column.
  const rows = Array.from({ length: 90 }, (_, index) =>
    tr(tc('', '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p(`R${index}`)))
  ).join('');
  const layout = lay(
    `<w:tbl>${tr(
      tc(p('LEFT'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('R'))
    )}${rows}</w:tbl>`
  );

  test('the fixture really does continue onto a later page', () => {
    expect(layout.pages.length).toBeGreaterThan(1);
  });

  test('clicking it resolves to the merged column, not the one beside it', () => {
    const later = layout.pages[layout.pages.length - 1]!;
    const table = later.fragments.find((block) => block.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('fixture is not a table');
    const row = table.rows[1] ?? table.rows[0]!;
    const found = hitTestPage(layout, later.index, {
      x: row.cells[0]!.box.x + 5,
      y: row.box.y + 5,
    })!;
    expect(found.cell!.gridColumn).toBe(0);
  });
});

describe('a repeated header row', () => {
  const layout = lay(
    `<w:tbl>${tr(
      tc(p('HEAD ')) + tc(p('H2')),
      '<w:trPr><w:tblHeader/></w:trPr>'
    )}${Array.from({ length: 90 }, (_, i) => tr(tc(p(`A${i}`)) + tc(p(`B${i}`)))).join('')}</w:tbl>`
  );

  test('the fixture really does repeat the header', () => {
    expect(layout.pages.length).toBeGreaterThan(1);
    const later = layout.pages[1]!.fragments.find((block) => block.kind === 'table');
    if (!later || later.kind !== 'table') throw new Error('fixture is not a table');
    expect(later.rows[0]!.isHeaderRepeat).toBe(true);
  });

  test('a repeat does not make the original look soft-wrapped', () => {
    // The repeat re-emits the same paragraph with a DIFFERENT line id, so recording it made
    // every earlier copy look wrapped — and the trailing space became unreachable.
    const first = layout.pages[0]!.fragments.find((block) => block.kind === 'table');
    if (!first || first.kind !== 'table') throw new Error('fixture is not a table');
    const cell = first.rows[0]!.cells[0]!.blocks[0]!;
    if (cell.kind !== 'paragraph') throw new Error('fixture cell is not a paragraph');
    const line = cell.lines[0]!;
    expect(lineEndOffset(layout, line)).toBe(line.range.end);
  });

  test('a position it resolves always paints on the page it was clicked on', () => {
    // A repeat is a COPY: its paragraphs already have caret stops on the original's page, so
    // resolving into one returned a position whose caret painted on a different page.
    for (const page of layout.pages) {
      const found = hitTestPage(layout, page.index, { x: 20, y: 8 });
      if (!found) continue;
      const caret = caretAt(layout, found.position);
      expect({ page: page.index, agrees: caret?.pageIndex === found.pageIndex }).toEqual({
        page: page.index,
        agrees: true,
      });
    }
  });
});

describe('the caches key on everything their answer depends on', () => {
  test('a second measurer is not served the first one’s widths', () => {
    const wide: TextMeasurer = {
      measure: (text) => text.length * 20,
      lineMetrics: () => ({ height: 14, baseline: 11 }),
    };
    const narrow: TextMeasurer = {
      measure: (text) => text.length * 2,
      lineMetrics: () => ({ height: 14, baseline: 11 }),
    };
    // Layout publishes no eager caretEdges (issue #632); stripping stays as a guard so
    // this case exercises the measurer-keyed prefix cache even if a producer adds them.
    const laid = lay(p('abcdefghij'), wide);
    const layout: SemanticLayout = {
      ...laid,
      pages: laid.pages.map((page) => ({
        ...page,
        fragments: page.fragments.map((fragment) => {
          if (fragment.kind !== 'paragraph') return fragment;
          return {
            ...fragment,
            lines: fragment.lines.map((line) => ({
              ...line,
              spans: line.spans.map((span) => ({ ...span, caretEdges: undefined })),
            })),
          };
        }),
      })),
    };
    const first = hit(layout, 50, 5, narrow)!.position.offset;
    const second = hit(layout, 50, 5, wide)!.position.offset;
    // At 20pt per character x=50 is nearest the boundary after 2; at 2pt it is past the end.
    expect(second).toBe(2);
    expect(first).toBe(10);
    expect(first).not.toBe(second);
  });

  test('replacing the grapheme boundary is not masked by a warm cache', () => {
    const layout = lay(p('éx'));
    hit(layout, 3, 5, measurer);
    setGraphemeBoundary({
      // One segment per code unit, so the combining mark becomes its own boundary.
      segment: (text) =>
        [...text].map((character, index) => ({
          index,
          text: character,
          utf16From: index,
          utf16To: index + 1,
        })),
    });
    try {
      const offsets = new Set<number>();
      for (let x = 0; x <= 18; x += 1) offsets.add(hit(layout, x, 5, measurer)!.position.offset);
      expect(offsets.has(1)).toBe(true);
    } finally {
      resetGraphemeBoundary();
    }
  });
});

describe('the caret x of a trimmed line end', () => {
  test('comes from the span that holds the offset, not from the right edge', () => {
    // Two runs each contributing one trailing space — ordinary in producer-split text. The
    // caret used to paint at the far right edge, past the space it had just stepped back over.
    const layout = lay(
      `<w:p><w:r><w:t xml:space="preserve">${'word '.repeat(14)}word</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> </w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> </w:t></w:r>` +
        `<w:r><w:t>tail</w:t></w:r></w:p>`
    );
    const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
    if (lines.length < 2) return; // the fixture did not wrap; nothing to assert
    const first = lines[0]!;
    const found = hit(layout, 9999, first.box.y + 2)!;
    const spanRight = first.spans.reduce((max, s) => Math.max(max, s.box.x + s.box.width), 0);
    if (found.position.offset === first.range.end) return; // nothing was trimmed
    expect(found.caret.x).toBeLessThan(spanRight);
  });
});

describe('the caret sits at a glyph edge', () => {
  /** Narrow `i`, wide `W` — a proportional face, where interpolation and truth diverge. */
  const proportional: TextMeasurer = {
    measure: (text) => [...text].reduce((sum, ch) => sum + (ch === 'i' ? 2 : 30), 0),
    lineMetrics: () => ({ height: 14, baseline: 11 }),
  };

  test('measured, not interpolated across the span', () => {
    // Interpolation puts offset 3 of a 6-character span at half its advance, which in a
    // proportional face is nowhere near a glyph boundary — it draws the caret THROUGH a
    // letter. The painted caret reads this, so the error is visible, not theoretical.
    const layout = lay(p('iiiWWW'), proportional);
    const span = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!.spans[0]!;
    // True edge after "iii" is 3 narrow glyphs; interpolation would say half of 96.
    expect(spanOffsetX(span, 3, proportional)).toBe(span.box.x + 6);
    // Layout publishes no eager per-character edges (issue #632): prefix widths are
    // measured on demand, so a caller WITHOUT a measurer gets the stated interpolation
    // fallback, never a stale array.
    expect(span.caretEdges).toBeUndefined();
    expect(spanOffsetX(span, 3, undefined)).toBe(span.box.x + span.box.width / 2);
  });

  test('and caretAt uses it, so the caret and the hit test agree', () => {
    const layout = lay(p('iiiWWW'), proportional);
    const caret = caretAt(layout, { paragraphId: P0, offset: 3 }, proportional)!;
    const span = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!.spans[0]!;
    expect(caret.x).toBe(span.box.x + 6);
    // Clicking where the caret is drawn resolves back to the offset it was drawn for.
    expect(hit(layout, caret.x, 5, proportional)!.position.offset).toBe(3);
  });

  test('published caretEdges win over a disagreeing measurer', () => {
    // When a span DOES carry published edges (a producer may attach them), interaction
    // must not re-measure a prefix that could disagree (canvas vs CSS, or a swapped host
    // measurer). Layout itself no longer publishes them eagerly (issue #632), so the
    // contract is pinned on a span given explicit edges.
    const layout = lay(p('Irurein'), proportional);
    const laid = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!.spans[0]!;
    const edges = [0, 2, 4, 6, 8, 10, 12, 14];
    const span = { ...laid, caretEdges: edges };
    const beforeE = 4; // Irur|
    const published = span.box.x + edges[beforeE]!;
    const liar: TextMeasurer = {
      measure: () => 999,
      lineMetrics: () => ({ height: 14, baseline: 11 }),
    };
    expect(spanOffsetX(span, beforeE, liar)).toBe(published);
  });

  test('after a justified space the caret sits with the next word, not inside the gap', () => {
    // Wide column + short words so the first line is justified and layout leaves slack
    // only after expandable spaces (the paint `word-spacing` slots).
    const words = Array.from({ length: 12 }, (_, index) => `w${index}`).join(' ');
    const layout = lay(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>${words}</w:t></w:r></w:p>`,
      proportional
    );
    const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
    expect(line.spans.length).toBeGreaterThan(2);
    const first = line.spans[0]!;
    const second = line.spans[1]!;
    expect(first.text.endsWith(' ')).toBe(true);
    expect(second.box.x).toBeGreaterThan(first.box.x + first.box.width + 0.25);
    const caret = caretAt(layout, { paragraphId: P0, offset: first.range.end }, proportional)!;
    expect(caret.x).toBe(second.box.x);
  });
});

describe('a w:caps run is measured as it is DRAWN', () => {
  // `w:caps` paints uppercase glyphs while the model keeps the source text. Line breaking
  // always measured the drawn form, so the span box was right — but the caret edges were
  // taken from the source, so the caret drifted further left with every letter and a click
  // resolved to an earlier offset than the one under the pointer.
  /** Uppercase is wider than lowercase, as it is in any proportional face. */
  const cased: TextMeasurer = {
    measure: (text) => [...text].reduce((sum, ch) => sum + (ch === ch.toUpperCase() ? 10 : 6), 0),
    lineMetrics: () => ({ height: 14, baseline: 11 }),
  };
  const caps = (text: string) => `<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

  test('caret edges follow the uppercase glyphs, not the source text', () => {
    const layout = lay(caps('abcdef'), cased);
    const span = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!.spans[0]!;
    // Drawn as "ABCDEF": six wide glyphs, and the reserved advance already said so.
    expect(span.box.width).toBe(60);
    // Measuring the source "abc" would answer 18 here and disagree with that box.
    expect(spanOffsetX(span, 3, cased)).toBe(span.box.x + 30);
  });

  test('so a click lands on the letter it was aimed at', () => {
    const layout = lay(caps('abcdef'), cased);
    const caret = caretAt(layout, { paragraphId: P0, offset: 3 }, cased)!;
    expect(caret.x).toBe(30);
    // Clicking where the caret is drawn resolves back to the offset it was drawn for.
    expect(hit(layout, caret.x, 5, cased)!.position.offset).toBe(3);
    // A point inside the fifth glyph is offset 4, not the earlier offset source-text
    // metrics would have interpolated it to.
    expect(hit(layout, 44, 5, cased)!.position.offset).toBe(4);
  });

  test('a JUSTIFIED caps line is not over-stretched by phantom trailing whitespace', () => {
    // `alignSpans` prices a line's trailing whitespace as `box.width - measure(visible)`.
    // The box was reserved from the DRAWN text, so measuring the visible part from the
    // SOURCE made almost the whole span look like whitespace, inflating the slack justify
    // then distributes. Centre and right pass `lineUsedWidth` and never read it; a
    // justified NON-LAST line is the only path that does — hence enough words to wrap.
    const words = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ');
    const layout = lay(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>` +
        `<w:r><w:rPr><w:caps/></w:rPr><w:t>${words}</w:t></w:r></w:p>`,
      cased
    );
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.lines.length).toBeGreaterThan(1); // or the rule is untested
    const line = fragment.lines[0]!;
    const last = line.spans[line.spans.length - 1]!;
    expect(last.text.endsWith(' ')).toBe(true);
    // Only the trailing space may hang into the margin. The GLYPHS must stop at the column
    // edge; measuring the source text pushed them past it.
    const visible = last.text.replace(/\s+$/, '');
    const drawnVisible = cased.measure(visible.toUpperCase(), last.style);
    expect(last.box.x + drawnVisible).toBeLessThanOrEqual(
      layout.pages[0]!.contentBox.width + 0.001
    );
  });
});

describe('the caret is as tall as the run it sits in', () => {
  // A line is as tall as its LARGEST run, so a caret in small text on a line that also
  // carries large text was drawn several times the height of the text it was in.
  const mixed = lay(
    `<w:p>` +
      `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">8pt </w:t></w:r>` +
      `<w:r><w:rPr><w:sz w:val="72"/></w:rPr><w:t>36pt</w:t></w:r>` +
      `</w:p>`
  );
  const line = paragraphFragmentsOf(mixed.pages[0]!)[0]!.lines[0]!;

  test('the fixture really does mix run sizes on one line', () => {
    const heights = line.spans.map((span) => span.box.height);
    expect(heights.length).toBe(2);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) * 2);
    expect(line.box.height).toBe(Math.max(...heights));
  });

  test('a caret in the small run is the SMALL run’s height', () => {
    const small = line.spans[0]!;
    const caret = caretAt(mixed, { paragraphId: P0, offset: small.range.start + 1 }, measurer)!;
    expect(caret.height).toBe(small.box.height);
    expect(caret.height).toBeLessThan(line.box.height);
  });

  test('and a caret in the large run is the large one’s', () => {
    const large = line.spans[1]!;
    const caret = caretAt(mixed, { paragraphId: P0, offset: large.range.start + 1 }, measurer)!;
    expect(caret.height).toBe(large.box.height);
    expect(caret.y).toBe(large.box.y);
  });

  test('at the boundary the caret belongs to the run a keystroke would continue', () => {
    const small = line.spans[0]!;
    const caret = caretAt(mixed, { paragraphId: P0, offset: small.range.end }, measurer)!;
    expect(caret.height).toBe(small.box.height);
  });

  test('an empty paragraph still gets a caret, from its line', () => {
    const empty = lay('<w:p/>');
    const emptyLine = paragraphFragmentsOf(empty.pages[0]!)[0]!.lines[0]!;
    const caret = caretAt(empty, { paragraphId: P0, offset: 0 }, measurer)!;
    expect(caret.height).toBe(emptyLine.box.height);
    expect(caret.height).toBeGreaterThan(0);
  });

  test('and what a click reports matches what gets painted', () => {
    const small = line.spans[0]!;
    const found = hit(mixed, small.box.x + 2, line.box.y + 2, measurer)!;
    expect(found.caret.height).toBe(caretAt(mixed, found.position, measurer)!.height);
  });
});

describe('the caret is aligned the way the text is', () => {
  // Span boxes all start at the LINE's top — the painter baseline-aligns the glyphs in CSS —
  // so reading a span box directly drew a small run's caret floating above the text it was
  // in, and a superscript caret over the text beside it.
  const proportional: TextMeasurer = {
    measure: (text, style) => text.length * style.fontSizePt * 0.5,
    lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt * 0.95 }),
  };
  const doc = lay(
    `<w:p>` +
      `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">8pt </w:t></w:r>` +
      `<w:r><w:rPr><w:sz w:val="72"/></w:rPr><w:t>36pt</w:t></w:r>` +
      `<w:r><w:rPr><w:vertAlign w:val="superscript"/><w:sz w:val="22"/></w:rPr><w:t>sup</w:t></w:r>` +
      `</w:p>`,
    proportional
  );
  const line = paragraphFragmentsOf(doc.pages[0]!)[0]!.lines[0]!;
  /** Where a caret's own baseline falls, given the measurer's 0.95 ascent ratio. */
  const baselineOf = (offset: number): number => {
    const caret = caretAt(doc, { paragraphId: P0, offset }, proportional)!;
    return caret.y + (caret.height / 1.2) * 0.95;
  };

  test('the fixture stacks every span at the line top, which is the trap', () => {
    expect(line.spans.map((span) => span.box.y)).toEqual([0, 0, 0]);
    expect(line.baseline).toBeGreaterThan(0);
  });

  test('a small run and a large run share the line’s baseline', () => {
    expect(baselineOf(1)).toBeCloseTo(line.baseline, 5);
    expect(baselineOf(6)).toBeCloseTo(line.baseline, 5);
  });

  test('so a small caret sits ON its text, not at the top of the line', () => {
    const small = caretAt(doc, { paragraphId: P0, offset: 1 }, proportional)!;
    // Well below the line top, and its descender just past the baseline.
    expect(small.y).toBeGreaterThan(line.box.y + line.box.height / 2);
    expect(small.y + small.height).toBeGreaterThan(line.baseline);
    expect(small.y).toBeLessThan(line.baseline);
  });

  test('and a superscript caret is lifted exactly as far as its glyphs', () => {
    // The painter raises superscript by a third of the font size without moving the box.
    expect(line.baseline - baselineOf(10)).toBeCloseTo(11 * 0.33, 5);
  });

  test('without a measurer it falls back to the line, rather than guessing', () => {
    const caret = caretAt(doc, { paragraphId: P0, offset: 1 })!;
    expect(caret.y).toBe(line.box.y);
    expect(caret.height).toBe(line.box.height);
  });
});

describe('tab stops own caret geometry (layout advance, not measure(\\t))', () => {
  // Fixed measurer charges 6pt per code unit — including U+0009 — so a regression that
  // measures the tab character instead of using the published stop advance places the
  // post-tab caret ~6pt after the preceding run instead of at the aligned destination.
  const tabParagraph = (
    val: 'left' | 'center' | 'right' | 'decimal',
    posTwips: number,
    after: string
  ) =>
    `<w:p><w:pPr><w:tabs><w:tab w:val="${val}" w:pos="${posTwips}"/></w:tabs></w:pPr>` +
    `<w:r><w:t>L</w:t><w:tab/><w:t>${after}</w:t></w:r></w:p>`;

  for (const { val, pos, after } of [
    { val: 'left' as const, pos: 1440, after: 'X' },
    { val: 'center' as const, pos: 2400, after: 'ABCD' },
    { val: 'right' as const, pos: 2400, after: 'ABCD' },
    { val: 'decimal' as const, pos: 2400, after: '12.5' },
  ]) {
    test(`${val} tab: offset after \\t paints at following text, not after L`, () => {
      const layout = lay(tabParagraph(val, pos, after), measurer);
      const line = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
      const tab = line.spans.find((span) => span.text === '\t')!;
      const following = line.spans[line.spans.indexOf(tab) + 1]!;
      expect(tab.box.width).toBeGreaterThan(measurer.measure('\t', tab.style));

      const afterTab = tab.range.end;
      expect(following.range.start).toBe(afterTab);

      const painted = caretAt(layout, { paragraphId: P0, offset: afterTab }, measurer)!;
      expect(painted.x).toBeCloseTo(following.box.x, 5);
      expect(painted.x).toBeGreaterThan(tab.box.x + 10);

      const beforeTab = caretAt(layout, { paragraphId: P0, offset: tab.range.start }, measurer)!;
      expect(beforeTab.x).toBeCloseTo(tab.box.x, 5);

      // Hit the post-tab destination → same model offset; Left/Right round-trip.
      const clicked = hit(layout, following.box.x + 1, line.box.y + 2, measurer)!;
      expect(clicked.position.offset).toBe(afterTab);
      const right = moveCaret(layout, { paragraphId: P0, offset: tab.range.start }, 'right')!;
      expect(right.position.offset).toBe(afterTab);
      const left = moveCaret(layout, right.position, 'left')!;
      expect(left.position.offset).toBe(tab.range.start);

      const stop = caretStops(layout, measurer).find(
        (entry) => entry.position.offset === afterTab
      )!;
      expect(stop.x).toBeCloseTo(following.box.x, 5);
      expect(caretBoxOnLine(line, afterTab, measurer).x).toBeCloseTo(following.box.x, 5);
    });
  }
});
