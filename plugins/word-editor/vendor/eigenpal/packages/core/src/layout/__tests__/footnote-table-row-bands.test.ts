// A footnote reference inside a body table row keeps the band of its ROW, not of the whole
// table fragment. Notes of early rows stay on their reference page while later rows move.
// A long note splits when at least two of its lines fit below the referencing row. With
// room for fewer, the row moves to the next page with the note. Inside a row that can
// split, the note budgets below the reference line, and the rest of the row continues.
//
// The page is 350pt by 210pt with 20pt margins: a 170pt body of exact 14pt lines. The
// footnote separator and every note line are exact 14pt lines too.
import { describe, expect, test } from 'bun:test';
import { createLayoutSession } from '../layout-session.ts';
import { bodyOnlyPage } from '../note-fragment-geometry.ts';
import { rowContinuesOn } from '../note-table-reference-band.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import {
  bandOf,
  cite,
  expectComplete,
  INTRO,
  type Laid,
  layoutProbe,
  names,
  noteLines,
  pages,
  rows,
  TAIL,
  tbl,
  tr,
} from './footnote-row-band-fixtures.ts';
import { para } from './table-row-keep-fixtures.ts';
describe('footnote references in body table rows', () => {
  // Rows 2, 4, 6 and 8 cite one-line notes. Six rows and three notes fill the first page.
  const refs = new Map([
    [2, 1],
    [4, 2],
    [6, 3],
    [8, 4],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ]);
  const body = INTRO + tbl(rows(8, refs)) + TAIL;

  test('notes of early rows stay with their rows while later rows move', () => {
    const laid = layoutProbe(body, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b1 R3a R3b R4a R4b2 R5a R5b R6a R6b3 | 1,2,3',
      'R7a R7b R8a R8b4 TAIL | 4',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(8), 'TAIL'], [1, 2, 3, 4]);
  });

  test('the band is the referencing row, in page-content coordinates', () => {
    const laid = layoutProbe(body, notes);
    const { band, table } = bandOf(laid, 2);
    const row = table.rows.find((r) => r.rowIndex === 3)!;
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.bottom).toBeCloseTo(row.box.y + row.box.height, 3);
    expect(band.bottom).toBeLessThan(table.box.y + table.box.height - 1);
    expect(band.evictable).toBe(true);
  });

  test('repeated header rows move nothing but the body rows', () => {
    const laid = layoutProbe(
      INTRO +
        tbl(rows(8, refs, (n, spec) => (n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec))) +
        TAIL,
      notes
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b1 R3a R3b R4a R4b2 R5a R5b R6a R6b3 | 1,2,3',
      'R1a R1b R7a R7b R8a R8b4 TAIL | 4',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a row whose long note keeps two lines below it', () => {
  // Row 5 cites a four-line note. Below row 5 there is room for three note lines. The row
  // stays, and the note splits: widow control leaves two lines on each page. A note that
  // splits ends the page body at its reference, so row 6 and everything after it move on.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 4],
  ]);

  test('stays, its note continues, and the next row moves on', () => {
    const laid = layoutProbe(INTRO + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(8), 'TAIL'], [1, 2]);
  });

  test('two lines of room are enough', () => {
    const laid = layoutProbe(para('INTRO', 3) + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('the last row of a table stays, and the content after the table moves on', () => {
    // The referencing row ends the table, and a three-line paragraph follows it. The row
    // stays; the paragraph after the table moves on with the rest of the body.
    const laid = layoutProbe(INTRO + tbl(rows(5, refs)) + para('TAIL', 3), notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'TAIL1 TAIL2 TAIL3 | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(5), 'TAIL1', 'TAIL2', 'TAIL3']);
  });

  test('a short table ending mid-page keeps its referencing row', () => {
    const laid = layoutProbe(INTRO + tbl(rows(6, refs)) + para('TAIL', 3), notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'R6a R6b TAIL1 TAIL2 TAIL3 | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a vertical merge in another cell does not keep the table band', () => {
    // The first column merges rows 1 through 8. The referencing cells do not merge.
    const merged = rows(8, refs, (n, spec) => ({
      ...spec,
      firstTcPr: n === 1 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>',
      first: n === 1 ? cite('M') : cite(''),
    }));
    const laid = layoutProbe(INTRO + tbl(merged) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 M R1b1 R2b R3b R4b R5b2 | 1,2',
      'R6b R7b R8b TAIL | 2c',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a reference in a nested table takes the outer row band', () => {
    // The empty paragraph after the nested table takes no room, so the outer row is one
    // line high and paginates as the plain referencing row does: row 6 moves on.
    const nested = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, second: tbl([tr({ name: 'N', note: 2 })]) + cite('') } : spec
    );
    const laid = layoutProbe(INTRO + tbl(nested) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a Na Nb2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a note that fits whole leaves the next rows in place', () => {
    // With one introduction line, the whole note fits below row 5, and row 6 fits too.
    const laid = layoutProbe(
      para('INTRO', 1) + tbl(rows(8, refs)) + TAIL,
      new Map([
        [1, 1],
        [2, 3],
      ])
    );
    expect(pages(laid.layout)[0]).toBe(
      'INTRO1 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 R6a R6b | 1,2'
    );
    expect(laid.fixedPoint).toBe(true);
  });

  test('a split note fills the room below its reference', () => {
    // An eight-line note has four lines of room below row 5 with one introduction line.
    const laid = layoutProbe(
      para('INTRO', 1) + tbl(rows(8, refs)) + TAIL,
      new Map([
        [1, 1],
        [2, 8],
      ])
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(4);
    expect(laid.fixedPoint).toBe(true);
  });

  test('warm passes that start or stop the split match a clean layout', () => {
    const one = para('INTRO', 1) + tbl(rows(8, refs)) + TAIL;
    const two = INTRO + tbl(rows(8, refs)) + TAIL;
    for (const [before, after] of [
      [one, two],
      [two, one],
    ] as const) {
      const session = createLayoutSession();
      layoutProbe(before, notes, session, 1);
      const warm = layoutProbe(after, notes, session, 2);
      const clean = layoutProbe(after, notes);
      expect(pages(warm.layout)).toEqual(pages(clean.layout));
      expect(warm.fixedPoint).toBe(true);
    }
  });
});

describe('a row with room for one note line below it', () => {
  // Four introduction lines leave room for one line of the four-line note below row 5, so
  // the row moves to the next page, where its note fits whole. The hold-out keeps it there.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 4],
  ]);
  const INTRO4 = para('INTRO', 4);
  const intro = ['INTRO1', 'INTRO2', 'INTRO3', 'INTRO4'];

  test('moves with its note to the next page and stays there', () => {
    const laid = layoutProbe(INTRO4 + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 INTRO4 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, [...intro, ...names(8), 'TAIL'], [1, 2]);
  });

  test('a warm pass after an edit matches a clean layout', () => {
    const session = createLayoutSession();
    layoutProbe(INTRO4 + tbl(rows(8, refs)) + TAIL, notes, session, 1);
    const edited = INTRO4.replace('INTRO1', 'INTROx1') + tbl(rows(8, refs)) + TAIL;
    const warm = layoutProbe(edited, notes, session, 2);
    const clean = layoutProbe(edited, notes);
    expect(pages(warm.layout)).toEqual(pages(clean.layout));
    expect(warm.fixedPoint).toBe(true);
  });

  test('a whole row that ends the page moves with its note', () => {
    // Row 8 ends page 1 and cites a two-line note with no room below it. The page after
    // opens with the paragraph after the table, so row 8 is whole, not a split head.
    const lastRefs = new Map([[8, 1]]);
    const lastNotes = new Map([[1, 2]]);
    const body = (intro: string) => intro + tbl(rows(8, lastRefs)) + TAIL;
    const laid = layoutProbe(body(INTRO4), lastNotes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 INTRO4 R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b R6a R6b R7a R7b | ',
      'R8a R8b1 TAIL | 1',
    ]);
    expect(laid.fixedPoint).toBe(true);
    // A warm pass that reaches the same shape from a layout where row 8 had room agrees.
    const session = createLayoutSession();
    layoutProbe(body(INTRO), lastNotes, session, 1);
    const warm = layoutProbe(body(INTRO4), lastNotes, session, 2);
    expect(pages(warm.layout)).toEqual(pages(laid.layout));
    expect(warm.fixedPoint).toBe(true);
  });

  test('a rotated referencing cell takes its row band', () => {
    // The exact 35pt row leaves room for one note line below it.
    const rotated = rows(8, refs, (n, spec) =>
      n === 5
        ? {
            ...spec,
            trPr: '<w:trHeight w:val="700" w:hRule="exact"/>',
            secondTcPr: '<w:textDirection w:val="btLr"/>',
          }
        : spec
    );
    const laid = layoutProbe(INTRO + tbl(rotated) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a multi-line referencing row', () => {
  // Row 5's first cell holds three lines, and its second cell cites a two-line note from
  // its only line. One note line fits below the row, and the whole note fits below the
  // reference line.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 2],
  ]);
  const tall = (trPr?: string) =>
    rows(8, refs, (n, spec) => (n === 5 ? { ...spec, trPr, first: para('R5a', 3) } : spec));
  const lines = names(8).flatMap((name) => (name === 'R5a' ? ['R5a1', 'R5a2', 'R5a3'] : [name]));

  test('continues on the next page below the reference line', () => {
    const laid = layoutProbe(INTRO + tbl(tall()) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b2 | 1,2',
      'R5a3 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    const { band } = bandOf(laid, 2);
    expect(band.bottom - band.top).toBeCloseTo(14, 3);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1, 2]);
  });

  test('moves whole with its note when it cannot split', () => {
    const laid = layoutProbe(INTRO + tbl(tall('<w:cantSplit/>')) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a1 R5a2 R5a3 R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1, 2]);
  });

  test('a row that the body alone moves publishes no hold', () => {
    // Nine introduction lines leave 16pt, and the row that cannot split needs 56pt. It
    // moves for body reasons, so the page before it reserves nothing to keep it out.
    const pushed = rows(4, new Map([[3, 1]]), (n, spec) =>
      n === 3 ? { ...spec, trPr: '<w:cantSplit/>', first: para('R3a', 4) } : spec
    );
    const laid = layoutProbe(para('INTRO', 9) + tbl(pushed) + TAIL, new Map([[1, 1]]));
    expect(pages(laid.layout)[1]).toStartWith('R3a1 R3a2 R3a3 R3a4 R3b1');
    expect(laid.reserves.get(0) ?? 0).toBe(0);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('legal breaks inside a multi-line referencing row', () => {
  // Row 5's first cell holds one paragraph of several lines, and its second cell cites a
  // four-line note from its only line. One line of intro leaves three note lines below the
  // whole row and five below the reference line. Cell paragraphs follow widow control only in
  // compatibility mode 15 and later, so these probes name their mode.
  const refs = new Map([[5, 1]]);
  const notes = new Map([[1, 4]]);
  const body = (first: string) =>
    para('INTRO', 1) +
    tbl(rows(8, refs, (n, spec) => (n === 5 ? { ...spec, first } : spec))) +
    TAIL;

  test('a paragraph without widow control breaks below the reference line', () => {
    const laid = layoutProbe(body(para('R5a', 3)), notes, createLayoutSession(), 1, 15);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b1 | 1',
      'R5a3 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    expect(bandOf(laid, 1).band.bottom - bandOf(laid, 1).band.top).toBeCloseTo(14, 3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a three-line paragraph under widow control keeps the row whole', () => {
    // Widow control allows no break in three lines, so the row stays whole and the note
    // splits below it.
    const laid = layoutProbe(
      body(para('R5a', 3, { widow: true })),
      notes,
      createLayoutSession(),
      1,
      15
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5a3 R5b1 | 1',
      'R6a R6b R7a R7b R8a R8b TAIL | 1c',
    ]);
    const { band, table } = bandOf(laid, 1);
    const row = table.rows.find((r) => r.rowIndex === 4)!;
    expect(band.bottom).toBeCloseTo(row.box.y + row.box.height, 3);
    expect(noteLines(laid.layout, 0, 1)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a paragraph that keeps its lines together keeps the row whole', () => {
    const laid = layoutProbe(
      body(para('R5a', 3, { keepLines: true })),
      notes,
      createLayoutSession(),
      1,
      15
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5a3 R5b1 | 1',
      'R6a R6b R7a R7b R8a R8b TAIL | 1c',
    ]);
    expect(noteLines(laid.layout, 0, 1)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('widow control moves the split to the first legal break', () => {
    // Four lines under widow control break only after the second line, so the note budgets
    // below that break and the row splits there.
    const laid = layoutProbe(
      body(para('R5a', 4, { widow: true })),
      notes,
      createLayoutSession(),
      1,
      15
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b1 | 1',
      'R5a3 R5a4 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    expect(noteLines(laid.layout, 0, 1)).toBe(4);
    expect(laid.fixedPoint).toBe(true);
  });

  test('in compatibility mode 14 a cell paragraph under widow control breaks anywhere', () => {
    const laid = layoutProbe(
      body(para('R5a', 3, { widow: true })),
      notes,
      createLayoutSession(),
      1,
      14
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b1 | 1',
      'R5a3 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });

  test('in compatibility mode 14 a cell paragraph that keeps its lines breaks anywhere', () => {
    const laid = layoutProbe(
      body(para('R5a', 3, { keepLines: true })),
      notes,
      createLayoutSession(),
      1,
      14
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b1 | 1',
      'R5a3 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    expect(noteLines(laid.layout, 0, 1)).toBe(4);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a row that cannot continue below its reference line', () => {
  // Row 5 cites a long note. The row cannot split below the reference line, so the note
  // budgets below the whole row box, and the row stays when two note lines fit there.
  const refs = new Map([[5, 1]]);
  /** An empty paragraph of exact height `pt`, which shifts the table by that much. */
  const spacer = (pt: number) =>
    `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" ` +
    `w:line="${pt * 20}" w:lineRule="exact"/></w:pPr></w:p>`;
  /** Every cell paragraph gets 8pt space after, so each one-line row is 22pt tall. */
  const after8 = (xml: string) =>
    xml.replaceAll('w:after="0" w:line="280"', 'w:after="160" w:line="280"');
  const rowBand = (laid: Laid) => {
    const { band, table } = bandOf(laid, 1);
    const row = table.rows.find((r) => r.rowIndex === 4)!;
    expect(band.bottom).toBeCloseTo(row.box.y + row.box.height, 3);
    return row;
  };

  test('a row that cannot split keeps three lines and splits the note', () => {
    // Reference probe cs4 (modes 0 and 15): row 5 stays whole, two note lines, row 6 moves.
    const kept = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, trPr: '<w:cantSplit/>', first: para('R5a', 3) } : spec
    );
    const laid = layoutProbe(para('INTRO', 1) + tbl(kept) + TAIL, new Map([[1, 4]]));
    expect(pages(laid.layout)).toEqual([
      'INTRO1 R1a R1b R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5a3 R5b1 | 1',
      'R6a R6b R7a R7b R8a R8b TAIL | 1c',
    ]);
    expect(rowBand(laid).placesWhole).toBe(true);
    expect(noteLines(laid.layout, 0, 1)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('an exact-height row keeps its height and splits the note', () => {
    const exact = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, trPr: '<w:trHeight w:val="600" w:hRule="exact"/>' } : spec
    );
    const laid = layoutProbe(INTRO + tbl(exact) + TAIL, new Map([[1, 6]]));
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b1 | 1',
      'R6a R6b R7a R7b R8a R8b TAIL | 1c',
    ]);
    expect(rowBand(laid).box.height).toBeCloseTo(30, 3);
    expect(noteLines(laid.layout, 0, 1)).toBe(3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('rows with space after keep it below the reference line', () => {
    // The 13pt spacer leaves two note lines below row 5, counting its space after.
    const laid = layoutProbe(spacer(13) + after8(tbl(rows(9, refs))) + TAIL, new Map([[1, 6]]));
    expect(pages(laid.layout)[0]).toBe('R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b1 | 1');
    expect(noteLines(laid.layout, 0, 1)).toBe(2);
    expect(rowBand(laid).box.height).toBeCloseTo(22, 3);
    expect(laid.fixedPoint).toBe(true);
    // With a 5pt spacer, two lines fit below the space after and three below the line. The
    // row keeps its space after, so the note places two lines.
    const tight = layoutProbe(spacer(5) + after8(tbl(rows(9, refs))) + TAIL, new Map([[1, 6]]));
    expect(pages(tight.layout)[0]).toBe('R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b1 | 1');
    expect(noteLines(tight.layout, 0, 1)).toBe(2);
    expect(tight.fixedPoint).toBe(true);
  });

  test('an at-least row keeps its minimum height and splits the note', () => {
    const atLeast = rows(9, refs, (n, spec) =>
      n === 5 ? { ...spec, trPr: '<w:trHeight w:val="500" w:hRule="atLeast"/>' } : spec
    );
    // Reference probe al_m15. Mode 0 differs; see the todo below.
    const laid = layoutProbe(
      spacer(1) + tbl(atLeast) + TAIL,
      new Map([[1, 6]]),
      createLayoutSession(),
      1,
      15
    );
    expect(pages(laid.layout)).toEqual([
      'R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b1 | 1',
      'R6a R6b R7a R7b R8a R8b R9a R9b TAIL | 1c',
    ]);
    const row = rowBand(laid);
    expect(row.box.height).toBeCloseTo(25, 3);
    expect(row.placesWhole).toBeUndefined();
    expect(noteLines(laid.layout, 0, 1)).toBe(4);
    expect(laid.fixedPoint).toBe(true);
  });

  // Reference probe al_m0: without compatibility mode 15, the at-least row moves whole to
  // page 2 with its whole note, and rows 6 to 8 follow it there. The engine keeps row 5.
  test.todo('an at-least row in mode 0 moves whole with its note to the next page');
});

describe('a referencing row that splits at the page end', () => {
  /** The notes whose first fragment opens on each page. */
  const openings = (layout: SemanticLayout) =>
    layout.pages.map((page) =>
      (page.footnotes?.notes ?? []).filter((n) => !n.continuation).map((n) => n.noteId)
    );

  for (const where of ['first', 'last'] as const) {
    test(`a row that cannot split but fits no page keeps its note (reference ${where})`, () => {
      // Row 3 has w:cantSplit and 16 lines, so it splits on a fresh page anyway.
      const second =
        where === 'first' ? cite('R3b', 1) + para('R3c', 3) : para('R3c', 3) + cite('R3b', 1);
      const tall = rows(5, new Map(), (n, spec) =>
        n === 3 ? { ...spec, trPr: '<w:cantSplit/>', first: para('R3a', 16), second } : spec
      );
      for (const mode of [14, 15]) {
        const laid = layoutProbe(INTRO + tbl(tall) + TAIL, new Map([[1, 2]]), undefined, 1, mode);
        const refPage = pages(laid.layout).findIndex((text) => text.includes('R3b1'));
        expect(openings(laid.layout)[refPage]).toEqual([1]);
        expect(laid.fixedPoint).toBe(true);
      }
    });
  }

  test('a paragraph that keeps its lines together keeps its note when the row splits', () => {
    // Row 5 holds a six-line w:keepLines paragraph that reaches past the page end, so the
    // paginator splits it there. The note fits below the reference line.
    const kept = rows(8, new Map([[5, 1]]), (n, spec) =>
      n === 5 ? { ...spec, first: para('R5a', 6, { keepLines: true }) } : spec
    );
    const laid = layoutProbe(
      para('INTRO', 3) + tbl(kept) + TAIL,
      new Map([[1, 2]]),
      undefined,
      1,
      15
    );
    const refPage = pages(laid.layout).findIndex((text) => text.includes('R5b1'));
    expect(refPage).toBe(0);
    expect(openings(laid.layout)[0]).toEqual([1]);
    expect(noteLines(laid.layout, 0, 1)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('rows that keep the whole-table band', () => {
  const refs = new Map([[5, 1]]);
  const notes = new Map([[1, 1]]);

  const tableBand = (laid: Laid, noteId: number) => {
    const { band, table } = bandOf(laid, noteId);
    expect(band.top).toBeCloseTo(table.box.y, 3);
    expect(band.bottom).toBeCloseTo(table.box.y + table.box.height, 3);
    expect(band.evictable).toBe(false);
  };

  test('a reference in a vertically merged cell that spans rows', () => {
    const merged = rows(8, refs, (n, spec) =>
      n === 5
        ? { ...spec, secondTcPr: '<w:vMerge w:val="restart"/>' }
        : n === 6
          ? { ...spec, secondTcPr: '<w:vMerge/>', second: cite('') }
          : spec
    );
    tableBand(layoutProbe(INTRO + tbl(merged) + TAIL, notes), 1);
  });

  test('a row that keeps with the next row', () => {
    const kept = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, first: cite('R5a', undefined, '<w:keepNext/>') } : spec
    );
    tableBand(layoutProbe(INTRO + tbl(kept) + TAIL, notes), 1);
  });

  test('a reference in an authored header row', () => {
    const header = rows(8, new Map([[1, 1]]), (n, spec) =>
      n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec
    );
    tableBand(layoutProbe(INTRO + tbl(header) + TAIL, notes), 1);
  });

  test('a positioned table', () => {
    const floating =
      '<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:tblpY="0"/>';
    tableBand(layoutProbe(INTRO + tbl(rows(8, refs), floating) + TAIL, notes), 1);
  });
});

describe('rows that take the row band but do not move', () => {
  test('the first body row under repeated header rows', () => {
    // Row 9 opens page 2 under the repeated header row. Moving it would reopen page 3 the
    // same way, so its band never evicts.
    const refs = new Map([[9, 1]]);
    const laid = layoutProbe(
      INTRO +
        tbl(rows(14, refs, (n, spec) => (n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec))) +
        TAIL,
      new Map([[1, 1]])
    );
    const { band, table, page } = bandOf(laid, 1);
    expect(page).toBe(1);
    const header = table.rows[0]!;
    const row = table.rows[1]!;
    expect(header.isHeaderRepeat).toBe(true);
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.blockTop).toBeCloseTo(row.box.y - header.box.height, 3);
    expect(band.evictable).toBe(false);
  });

  test('a row taller than the page keeps every line and its note', () => {
    // Row 4 holds twenty lines and cites a note from its first line.
    const tall = rows(6, new Map([[4, 1]]), (n, spec) =>
      n === 4 ? { ...spec, first: para('T', 20) } : spec
    );
    const laid = layoutProbe(INTRO + tbl(tall) + TAIL, new Map([[1, 2]]));
    const lines = names(6).flatMap((name) =>
      name === 'R4a' ? Array.from({ length: 20 }, (_, i) => `T${i + 1}`) : [name]
    );
    // The row's head stays on page 1 with its reference: a split head is not moved to the
    // next page, where the rest of the row would fill the band below the reference again.
    // The note budgets below the reference line, so the row continues on page 2 below it.
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1]);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b R3a R3b T1 T2 T3 T4 R4b1 | 1',
      'T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 | ',
      'T17 T18 T19 T20 R5a R5b R6a R6b TAIL | ',
    ]);
    const { band } = bandOf(laid, 1);
    expect(band.endsPageRowId).toBeDefined();
    expect(rowContinuesOn(bodyOnlyPage(laid.layout.pages[1]!), band.endsPageRowId!)).toBe(true);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a row below a row that keeps with it', () => {
    const kept = rows(8, new Map([[5, 1]]), (n, spec) =>
      n === 4 ? { ...spec, first: cite('R4a', undefined, '<w:keepNext/>') } : spec
    );
    const { band, table } = bandOf(layoutProbe(INTRO + tbl(kept) + TAIL, new Map([[1, 1]])), 1);
    const row = table.rows.find((r) => r.rowIndex === 4)!;
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.evictable).toBe(false);
  });
});

describe('a whole row taller than the page before mode 15', () => {
  // Row 3 has w:cantSplit and 16 lines (224pt), so it stays whole on a fresh page and runs
  // past the 170pt body (`tallRowStaysWhole`). No reserve can make room below it. The page
  // keeps the first line of the first note the row references, at the page bottom over the
  // row; the rest of that note and every later note continue on the next page.
  const tall = (second: string) =>
    rows(5, new Map(), (n, spec) =>
      n === 3 ? { ...spec, trPr: '<w:cantSplit/>', first: para('R3a', 16), second } : spec
    );
  const notesOn = (layout: SemanticLayout, index: number) =>
    (layout.pages[index]?.footnotes?.notes ?? []).map(
      (note) => `${note.noteId}${note.continuation ? 'c' : ''}:${note.mark ?? '-'}`
    );
  const rowPage = (layout: SemanticLayout) =>
    pages(layout).findIndex((text) => text.includes('R3a1'));

  test('the first note keeps its first line; a later note opens on the next page', () => {
    // Note 1 sits on the row's first line, note 2 on its fifteenth line, past the margin.
    const second = cite('R3b', 1) + para('R3c', 13) + cite('R3d', 2);
    for (const mode of [undefined, 14]) {
      const laid = layoutProbe(
        INTRO + tbl(tall(second)) + TAIL,
        new Map([
          [1, 3],
          [2, 1],
        ]),
        undefined,
        1,
        mode
      );
      const at = rowPage(laid.layout);
      expect(notesOn(laid.layout, at)).toEqual(['1:1']);
      expect(noteLines(laid.layout, at, 1)).toBe(1);
      // The note area sits at the page bottom, over the row that runs past it.
      const page = laid.layout.pages[at]!;
      const area = page.footnotes!;
      expect(area.box.y + area.box.height).toBeCloseTo(
        page.contentBox.y + page.contentBox.height,
        3
      );
      expect(area.fallbackReason).toBeUndefined();
      // Note 1 continues without a mark; note 2 opens with its own mark.
      expect(notesOn(laid.layout, at + 1)).toEqual(['1c:-', '2:2']);
      expect(noteLines(laid.layout, at + 1, 1)).toBe(2);
      expect(laid.fixedPoint).toBe(true);
    }
  });

  test('a row that ends past the margin below repeated header rows keeps no note line', () => {
    // A 2-line header row (28pt) repeats above row 3: 11 lines (154pt) with w:cantSplit. The
    // row fits a fresh page, but not below the repeat, and stays whole past the margin there
    // (`repeatKeepsWholeRow`). It is not taller than the page, so its 3-line note moves whole,
    // with its mark, to the next page.
    const body = rows(5, new Map(), (n, spec) =>
      n === 1
        ? { ...spec, trPr: '<w:tblHeader/>', first: para('R1a', 2) }
        : n === 3
          ? {
              ...spec,
              trPr: '<w:cantSplit/>',
              first: para('R3a', 11),
              second: para('R3c', 4) + cite('R3d', 1),
            }
          : spec
    );
    const laid = layoutProbe(INTRO + tbl(body) + TAIL, new Map([[1, 3]]), undefined, 1, 14);
    const at = rowPage(laid.layout);
    const table = laid.layout.pages[at]!.fragments.find(
      (f): f is TableFragmentRecord => f.kind === 'table'
    )!;
    expect(table.rows[0]?.isHeaderRepeat).toBe(true);
    expect(bandOf(laid, 1).band.rowOverflowsPage).toBeUndefined();
    // The row page has no footnote area; the next page opens the whole note with its mark.
    expect(laid.layout.pages[at]!.footnotes).toBeUndefined();
    expect(notesOn(laid.layout, at + 1)).toEqual(['1:1']);
    expect(noteLines(laid.layout, at + 1, 1)).toBe(3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a note carried from the page before keeps the row notes behind it', () => {
    // Note 1 has 40 lines and continues for pages. The tall row opens page 2, where the
    // carried rest of note 1 finds no room. Note 2 of the row must not start before note 1
    // ends: it keeps no line on the row page and opens after note 1's last line.
    const second = cite('R3b', 2) + para('R3c', 14);
    const laid = layoutProbe(
      cite('INTRO', 1) + tbl(tall(second)) + TAIL,
      new Map([
        [1, 40],
        [2, 3],
      ]),
      undefined,
      1,
      14
    );
    const at = rowPage(laid.layout);
    const opened = (id: number) =>
      laid.layout.pages.findIndex((page) =>
        (page.footnotes?.notes ?? []).some((n) => n.noteId === id && !n.continuation)
      );
    const lastOf = (id: number) =>
      laid.layout.pages.findLastIndex((page) =>
        (page.footnotes?.notes ?? []).some((n) => n.noteId === id)
      );
    expect(at).toBeGreaterThan(0);
    // The row page paints no separator without notes, and note 2 opens, with its mark, only
    // on the page where note 1 ends.
    expect(laid.layout.pages[at]!.footnotes).toBeUndefined();
    expect(opened(2)).toBe(lastOf(1));
    expect(notesOn(laid.layout, opened(2))).toEqual(['1c:-', '2:2']);
    expect(noteLines(laid.layout, opened(2), 2)).toBe(3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a single note referenced past the bottom margin stays on the row page', () => {
    const second = para('R3c', 14) + cite('R3d', 1);
    const laid = layoutProbe(INTRO + tbl(tall(second)) + TAIL, new Map([[1, 1]]), undefined, 1, 14);
    const at = rowPage(laid.layout);
    expect(notesOn(laid.layout, at)).toEqual(['1:1']);
    expect(notesOn(laid.layout, at + 1)).toEqual([]);
    expect(laid.fixedPoint).toBe(true);
  });
});
