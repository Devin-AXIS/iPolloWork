// A space that a zero-width space follows, at the end of a line (#1384).
//
// The zero-width space stays at the end of the line it ends. When the space before it fits,
// the space is content: a right-aligned line ends one space short of the measure, and a
// centered one shifts by half a space. It hangs only when it overflows. Inside a justified
// line, "space + U+200B" is a slot like a plain space. The measurer gives U+200B no width, as
// a shaped font does.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { caretBoxOnLine, layoutSemanticDocument, type SemanticLayout } from '../index.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixed = createFixedMeasurer(6, 14);
const measurer: TextMeasurer = {
  ...fixed,
  measure: (text, style) => fixed.measure(text.replace(/​/gu, ''), style),
};
/** 1500 twips less two 200-twip margins: a 55pt measure. */
const MEASURE = 55;

function document(jc: string, text: string, rtl = false): OoxmlPart {
  const pPr = `<w:pPr>${rtl ? '<w:bidi/>' : ''}<w:jc w:val="${jc}"/></w:pPr>`;
  const rPr = `<w:rPr>${rtl ? '<w:rtl/>' : ''}<w:sz w:val="22"/></w:rPr>`;
  // `~` separates runs.
  const runs = text
    .split('~')
    .map((part) => `<w:r>${rPr}<w:t xml:space="preserve">${part}</w:t></w:r>`)
    .join('');
  const body =
    `<w:p>${pPr}${runs}</w:p>` +
    '<w:sectPr><w:pgSz w:w="1500" w:h="20000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Each line's spans as [text without U+200B, x, width], rounded to a hundredth. */
const geometry = (layout: SemanticLayout) =>
  layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) =>
            line.spans.map((span) => [
              span.text.replace(/​/gu, ''),
              Math.round(span.box.x * 100) / 100,
              Math.round(span.box.width * 100) / 100,
            ])
          )
        : []
    )
  );

const lay = (jc: string, text: string, rtl = false) =>
  geometry(layoutSemanticDocument(document(jc, text, rtl), 1, { measurer }));

/** The ink end of each line: the last span with ink, without spaces and zero-width spaces. */
const inkEnds = (rows: ReturnType<typeof lay>) =>
  rows.map((line) => {
    const spans = line as [string, number, number][];
    const last = [...spans].reverse().find(([text]) => text.trim() !== '')!;
    return Math.round((last[1] + last[0].trimEnd().length * 6) * 100) / 100;
  });

describe('a space before a zero-width space counts at the line end when it fits', () => {
  test('right: the ink ends one space short of the measure', () => {
    // "aaaa " + U+200B fits (30pt): the space is content.
    expect(inkEnds(lay('right', 'aaaa \u200bbbbbbbbbb'))).toEqual([MEASURE - 6, MEASURE]);
    // A plain space at the line end still hangs.
    expect(inkEnds(lay('right', 'aaaa bbbbbbbbb'))).toEqual([MEASURE, MEASURE]);
  });

  test('right: a space that overflows hangs', () => {
    // "aaaaaaaaa" fills 54pt of 55; the space after it overflows and hangs.
    expect(inkEnds(lay('right', 'aaaaaaaaa \u200bbb'))).toEqual([MEASURE, MEASURE]);
  });

  test('center: the line shifts by half a space', () => {
    const spaced = inkEnds(lay('center', 'aaaa \u200bbbbbbbbbb'))[0]!;
    const plain = inkEnds(lay('center', 'aaaa bbbbbbbbb'))[0]!;
    expect(plain - spaced).toBeCloseTo(3, 5);
  });

  test('justify: a stretched line ends one space short, and inner slots stretch', () => {
    const rows = lay('both', 'aa \u200bbb \u200bcc \u200bdddddddd');
    expect(inkEnds(rows)[0]).toBeCloseTo(MEASURE - 6, 5);
    const xs = (rows[0] as [string, number, number][]).map(([, x]) => x);
    // 1pt of slack over the two inner slots; the space closing the line takes none.
    expect(xs).toEqual([0, 18.5, 37]);
  });

  test('on a justified line the caret after a stretched space is at its painted end', () => {
    const carets = (text: string) => {
      const layout = layoutSemanticDocument(document('both', text), 1, { measurer });
      const fragment = layout.pages[0]!.fragments.find((entry) => entry.kind === 'paragraph');
      if (fragment?.kind !== 'paragraph') throw new Error('no paragraph');
      const line = fragment.lines[0]!;
      const out: number[] = [];
      for (let offset = line.range.start; offset <= line.range.end; offset++)
        out.push(Math.round(caretBoxOnLine(line, offset, measurer)!.x * 10) / 10);
      return out;
    };
    // The zero-width space in the same run as the space, or in a run of its own: offset 3
    // (between the space and the zero-width space) and offset 4 are one visible position.
    const together = carets('aa \u200b~bb \u200b~cc \u200b~dd \u200b~eeeeeeee');
    const apart = carets('aa ~\u200b~bb ~\u200b~cc ~\u200b~dd ~\u200b~eeeeeeee');
    expect(together).toEqual(apart);
    expect(together[3]).toBeCloseTo(together[4]!, 5);
    expect(together[3]).toBeGreaterThan(18.25);
  });
});
