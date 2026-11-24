// A no-break space glues its neighbours whether or not a run boundary sits beside it.
//
// U+00A0 NO-BREAK SPACE, U+202F NARROW NO-BREAK SPACE, U+2007 FIGURE SPACE and U+FEFF /
// U+2060 (word joiners) never offer a line break inside one run. A generator that writes
// "Sec." + a run holding only U+00A0 + "12" must lay out the same as the one-run text: the
// seam test used to read every JavaScript `\s` as a break, so the line could end before,
// between or after the glue. Ordinary spaces, tabs, dashes and ideographs keep their seam
// opportunities.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { lineOpenDecisionAt } from '../cjk-line-break.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per character for an 11pt run, so a 60pt measure holds exactly ten. */
const measurer = createFixedMeasurer(6, 14);

const NBSP = '\u00a0';
const NNBSP = '\u202f';
const FIGURE = '\u2007';
const BOM = '\ufeff';
const WORD_JOINER = '\u2060';
const GLUE = [NBSP, NNBSP, FIGURE, BOM, WORD_JOINER] as const;
const name = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const breakLines = (body: string, width: number) =>
  breakParagraph(paragraph(`<w:p>${body}</w:p>`), 'p', 0, width, measurer, undefined, null);

const linesOf = (body: string, width = 60): string[] =>
  breakLines(body, width).map((line) => line.spans.map((span) => span.text).join(''));

const run = (text: string, properties = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const runs = (...texts: string[]) => texts.map((text) => run(text)).join('');

/** Seam layouts of `before + glue + after`, each with the same text in one run. */
function seamShapes(
  before: string,
  glue: string,
  after: string
): Record<string, { body: string; text: string }> {
  const text = before + glue + after;
  return {
    'glue in its own run': { body: runs(before, glue, after), text },
    'glue ends the first run': { body: runs(before + glue, after), text },
    'glue starts the second run': { body: runs(before, glue + after), text },
    'doubled glue in one-character runs': {
      body: runs(before, glue, glue, after),
      text: before + glue + glue + after,
    },
  };
}

/** Whether a line ends on, or the next line starts with, one of the glue characters. */
function brokenAtGlue(lines: readonly string[], glue: string): boolean {
  return lines.some(
    (line, index) =>
      index + 1 < lines.length && (line.endsWith(glue) || lines[index + 1]!.startsWith(glue))
  );
}

describe('no-break spaces at run seams', () => {
  for (const glue of GLUE) {
    test(`${name(glue)} wraps the same across runs as inside one run`, () => {
      const before = 'aa bbbb';
      const after = 'cc dd ee';
      for (const [shape, { body, text }] of Object.entries(seamShapes(before, glue, after))) {
        // From 54pt, where "bbbb", the glue and "cc " fit a line of their own.
        for (let width = 54; width <= 96; width += 6) {
          const oneRun = linesOf(run(text), width);
          const split = linesOf(body, width);
          expect({ shape, width, lines: split }).toEqual({ shape, width, lines: oneRun });
          expect(brokenAtGlue(split, glue)).toBe(false);
        }
      }
    });
  }

  test('a double U+00A0 after a label stays on the line with the label and the next word', () => {
    // The shape a numbered legal clause takes: "(a)", two no-break spaces, then the text.
    const body = runs('xxxxx (a)', NBSP, NBSP, 'Next word');
    expect(linesOf(body)).toEqual(['xxxxx ', `(a)${NBSP}${NBSP}Next `, 'word']);
    expect(linesOf(runs('xxxxx (a)', NBSP + NBSP, 'Next word'))).toEqual(linesOf(body));
    expect(linesOf(run(`xxxxx (a)${NBSP}${NBSP}Next word`))).toEqual(linesOf(body));
  });

  test('glue between runs of different formatting keeps every run and its properties', () => {
    const body =
      run('aaaa ') +
      run('bbbb', '<w:b/>') +
      run(NBSP, '<w:i/>') +
      run('cc', '<w:rFonts w:ascii="Other Face" w:hAnsi="Other Face"/>');
    const lines = breakLines(body, 60);
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'aaaa ',
      `bbbb${NBSP}cc`,
    ]);
    const spans = lines[1]!.spans;
    expect(spans.map((span) => span.text)).toEqual(['bbbb', NBSP, 'cc']);
    expect(spans.map((span) => [span.style.bold, span.style.italic])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(spans[2]!.style.fontFamily).toBe('Other Face');
    // Model offsets stay one UTF-16 unit per authored character, glue included.
    expect(spans.map((span) => [span.range.start, span.range.end])).toEqual([
      [5, 9],
      [9, 10],
      [10, 12],
    ]);
  });

  test('glue on a line whose join does not fit leaves the earlier space as the break', () => {
    // "bbbb" + U+00A0 + "cc" is seven characters; with "aaaa " before it on a ten-character
    // line the whole group moves, instead of "aaaa bbbb" + U+00A0 staying behind.
    expect(linesOf(runs('aaaa bbbb', NBSP, 'cc'))).toEqual(['aaaa ', `bbbb${NBSP}cc`]);
    expect(linesOf(runs('aaaa bbbb' + NBSP, 'cc'))).toEqual(['aaaa ', `bbbb${NBSP}cc`]);
    expect(linesOf(runs('aaaa bbbb', NBSP + 'cc'))).toEqual(['aaaa ', `bbbb${NBSP}cc`]);
  });
});

describe('seam break opportunities that must remain', () => {
  test('an ordinary space in its own run still breaks', () => {
    expect(linesOf(runs('aaaa bbbb', ' ', 'cc'))).toEqual(['aaaa bbbb ', 'cc']);
  });

  test('an ordinary space after the glue still breaks', () => {
    expect(linesOf(runs(`aaaa bbb${NBSP}`, ' ', 'cc'))).toEqual([`aaaa bbb${NBSP} `, 'cc']);
    expect(linesOf(run(`aaaa bbb${NBSP} cc`))).toEqual([`aaaa bbb${NBSP} `, 'cc']);
  });

  test('a tab run after the glue still lets the next text open a line', () => {
    const lines = linesOf(runs(`aa${NBSP}bb`, '\t', 'cccccc'));
    expect(lines).toEqual([`aa${NBSP}bb\t`, 'cccccc']);
  });

  test('a dash ending a run still breaks when glue follows later', () => {
    expect(linesOf(runs('aaaa-', `bbbb${NBSP}cc`), 48)).toEqual(['aaaa-', `bbbb${NBSP}cc`]);
  });

  test('a soft hyphen character is not turned into a seam opportunity', () => {
    // U+00AD is not whitespace and the flow does not hyphenate, so the word stays whole.
    const oneRun = linesOf(run('aaaa bbb\u00adccc'));
    expect(linesOf(runs('aaaa bbb\u00ad', 'ccc'))).toEqual(oneRun);
    expect(linesOf(runs('aaaa bbb', '\u00adccc'))).toEqual(oneRun);
  });

  test('ideographs keep their seam opportunities beside glue', () => {
    // Ideographic text takes the paragraph-wide analysis: the glue still forbids the cuts on
    // either side of it, while the ideographs around it keep theirs.
    const body = runs('漢字漢字', NBSP, '漢字漢字漢字');
    const lines = linesOf(body, 36);
    expect(lines.join('')).toBe(`漢字漢字${NBSP}漢字漢字漢字`);
    expect(brokenAtGlue(lines, NBSP)).toBe(false);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines).toEqual(linesOf(run(`漢字漢字${NBSP}漢字漢字漢字`), 36));
  });

  test('every no-break character glues ideographs in one run and across runs', () => {
    for (const glue of GLUE) {
      for (let width = 12; width <= 60; width += 6) {
        const oneRun = linesOf(run(`漢字漢字${glue}漢字漢字漢字`), width);
        expect({ glue: name(glue), width, broken: brokenAtGlue(oneRun, glue) }).toEqual({
          glue: name(glue),
          width,
          broken: false,
        });
        expect(linesOf(runs('漢字漢字', glue, '漢字漢字漢字'), width)).toEqual(oneRun);
      }
    }
  });
});

describe('glued tokens wider than the measure', () => {
  test('a run-spanning glued token chops at the margin and keeps every character', () => {
    const token = ['aaaaaa', NBSP, 'bbbbbb', NNBSP, 'cccccc', FIGURE, 'dddddd'];
    const lines = breakLines(runs(...token), 60);
    const texts = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts.join('')).toBe(token.join(''));
    expect(texts).toEqual(linesOf(run(token.join('')), 60));
    for (const line of lines) {
      const width = line.spans.reduce((sum, span) => sum + span.box.width, 0);
      expect(width).toBeLessThanOrEqual(60 + 0.001);
    }
    // Model offsets tile the paragraph with no gap and no overlap.
    const ranges = lines.flatMap((line) => line.spans.map((span) => span.range));
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.start).toBe(ranges[index - 1]!.end);
    }
    expect(ranges.at(-1)!.end).toBe(token.join('').length);
  });

  test('a glued token longer than a one-character measure still terminates', () => {
    const lines = linesOf(runs('ab', NBSP, NBSP, 'cd'), 6);
    expect(lines.join('')).toBe(`ab${NBSP}${NBSP}cd`);
    expect(lines.length).toBeLessThanOrEqual(6);
  });
});

describe('lineOpenDecisionAt', () => {
  test('glue on either side of a seam continues the word', () => {
    for (const glue of GLUE) {
      expect([name(glue), lineOpenDecisionAt(`word${glue}`, 'next', false)]).toEqual([
        name(glue),
        'continues',
      ]);
      expect([name(glue), lineOpenDecisionAt('word', `${glue}next`, false)]).toEqual([
        name(glue),
        'continues',
      ]);
      expect([name(glue), lineOpenDecisionAt(glue, glue, false)]).toEqual([
        name(glue),
        'continues',
      ]);
    }
  });

  test('breaking whitespace at a seam still opens', () => {
    for (const space of [' ', '\t', '\n', ' ', ' ', '　']) {
      expect([name(space), lineOpenDecisionAt(`word${space}`, 'next', false)]).toEqual([
        name(space),
        'opens',
      ]);
    }
    expect(lineOpenDecisionAt('word', ' next', false)).toBe('opens');
    expect(lineOpenDecisionAt(`word${NBSP}`, ' next', false)).toBe('opens');
    expect(lineOpenDecisionAt('word ', `${NBSP}next`, false)).toBe('opens');
  });

  test('an intra-piece cut and the paragraph start still open', () => {
    expect(lineOpenDecisionAt(`word${NBSP}`, 'next', true)).toBe('opens');
    expect(lineOpenDecisionAt('', `${NBSP}next`, false)).toBe('opens');
  });
});
