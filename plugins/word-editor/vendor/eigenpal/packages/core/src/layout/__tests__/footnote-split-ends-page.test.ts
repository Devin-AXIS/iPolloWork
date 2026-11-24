// A footnote that starts on a page and continues on the next one ends the page body right
// after its reference. Nothing of the body follows the reference on that page: the rest of
// its paragraph, later paragraphs, and later rows move on, and the note takes all the room
// below the reference. The smallest legal opening still stays: an orphan pair under widow
// control, or the first line of a kept successor.
import { describe, expect, test } from 'bun:test';
import { createLayoutSession } from '../layout-session.ts';
import { cite, INTRO, layoutProbe, noteLines, pages, TAIL } from './footnote-row-band-fixtures.ts';

const EXACT = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';

/** A paragraph of `count` lines `${name}1`.. whose first line cites footnote `note`. */
const citingFirstLine = (name: string, count: number, note: number, widow = false) => {
  const runs = Array.from(
    { length: count },
    (_, i) =>
      `<w:r>${i ? '<w:br/>' : ''}<w:t>${name}${i + 1}</w:t></w:r>` +
      (i === 0 ? `<w:r><w:footnoteReference w:id="${note}"/></w:r>` : '')
  );
  const widowControl = widow ? '' : '<w:widowControl w:val="0"/>';
  return `<w:p><w:pPr>${widowControl}${EXACT}</w:pPr>${runs.join('')}</w:p>`;
};

const P4 = cite('P1', 1) + cite('P2') + cite('P3') + cite('P4');
const notes = (lines: number) =>
  new Map([
    [1, 1],
    [2, lines],
  ]);

describe('a paragraph whose note splits', () => {
  test('ends the page, and its note fills the room below it', () => {
    // Below P5 there is room for three lines of the eight-line note.
    const laid = layoutProbe(INTRO + P4 + cite('P5', 2) + cite('P6') + TAIL, notes(8));
    expect(pages(laid.layout)).toEqual(['INTRO1 INTRO2 P11 P2 P3 P4 P52 | 1,2', 'P6 TAIL | 2c']);
    expect(noteLines(laid.layout, 0, 2)).toBe(3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a note that fits whole leaves the next paragraph in place', () => {
    const laid = layoutProbe(cite('INTRO') + P4 + cite('P5', 2) + cite('P6') + TAIL, notes(3));
    expect(pages(laid.layout)[0]).toBe('INTRO P11 P2 P3 P4 P52 P6 | 1,2');
    expect(laid.fixedPoint).toBe(true);
  });

  test('the rest of the citing paragraph moves on', () => {
    const laid = layoutProbe(INTRO + P4 + citingFirstLine('Q', 4, 2) + TAIL, notes(4));
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 P11 P2 P3 P4 Q12 | 1,2',
      'Q2 Q3 Q4 TAIL | 2c',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });

  test('widow control keeps the orphan pair', () => {
    const laid = layoutProbe(INTRO + P4 + citingFirstLine('Q', 4, 2, true) + TAIL, notes(8));
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 P11 P2 P3 P4 Q12 Q2 | 1,2',
      'Q3 Q4 TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a kept paragraph keeps the first line of its successor in mode 15', () => {
    const kept = cite('P5', 2, '<w:keepNext/>');
    const successor = `<w:p><w:pPr><w:widowControl w:val="0"/>${EXACT}</w:pPr><w:r><w:t>Q1</w:t></w:r><w:r><w:br/><w:t>Q2</w:t></w:r></w:p>`;
    const laid = layoutProbe(
      cite('INTRO') + P4 + kept + successor + TAIL,
      notes(8),
      createLayoutSession(),
      1,
      15
    );
    expect(pages(laid.layout)).toEqual(['INTRO P11 P2 P3 P4 P52 Q1 | 1,2', 'Q2 TAIL | 2c']);
    expect(noteLines(laid.layout, 0, 2)).toBe(3);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a warm pass that starts the split matches a clean layout', () => {
    const before = cite('INTRO') + P4 + cite('P5', 2) + cite('P6') + TAIL;
    const after = INTRO + P4 + cite('P5', 2) + cite('P6') + TAIL;
    const session = createLayoutSession();
    layoutProbe(before, notes(4), session, 1);
    const warm = layoutProbe(after, notes(4), session, 2);
    expect(pages(warm.layout)).toEqual(pages(layoutProbe(after, notes(4)).layout));
    expect(warm.fixedPoint).toBe(true);
  });
});
