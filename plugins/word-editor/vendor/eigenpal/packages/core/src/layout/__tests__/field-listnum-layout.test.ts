// LISTNUM fields through full layout: the number comes from the document's list definitions
// and the counting that numbered paragraphs share, never from the instruction running.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../index.ts';
import { parseListNumInstruction } from '../field-listnum.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string, numbering?: string) {
  const doc = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!doc.ok) throw new Error(doc.reason);
  if (numbering === undefined) return { part: doc.part };
  const num = readOoxmlPart(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!num.ok) throw new Error(num.reason);
  return { part: doc.part, numberingIndex: buildNumberingIndex(num.part.root) };
}

/** A complex field; `result` adds a separator and a saved result. */
const field = (instr: string, result?: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
  (result === undefined
    ? ''
    : `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${result}</w:t></w:r>`) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const para = (content: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;
const numPr = (numId: string, ilvl: number) =>
  `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
const heading = (level: number) => `<w:pStyle w:val="Heading${level}"/>`;

function abstract(id: string, name: string | null, texts: readonly string[]): string {
  const levels = Array.from({ length: 9 }, (_, ilvl) => {
    const lvlText = texts[ilvl] ?? `%${ilvl + 1}.`;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
      `<w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/></w:lvl>`
    );
  }).join('');
  return `<w:abstractNum w:abstractNumId="${id}">${name ? `<w:name w:val="${name}"/>` : ''}${levels}</w:abstractNum>`;
}
const NUMBERING =
  abstract('0', 'schedule numbering', ['S%1.', 'S%1.%2', 'S%3', 'S%4', '[%5]']) +
  abstract('1', null, ['U%1.', 'U%2)']) +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map(
      (fragment) =>
        (fragment.marker ? `${fragment.marker.text} ` : '') +
        fragment.lines
          .flatMap((line) => line.spans.map((span) => span.text))
          .join('')
          .trim()
    )
  );

function layoutOf(body: string, numbering?: string): string[] {
  const { part, numberingIndex } = load(body, numbering);
  return textsOf(
    layoutSemanticDocument(part, 1, { measurer, ...(numberingIndex ? { numberingIndex } : {}) })
  );
}

describe('parseListNumInstruction', () => {
  test('reads the name, the level and the start value', () => {
    expect(parseListNumInstruction(' LISTNUM ')).toEqual({ name: null, level: null, start: null });
    expect(parseListNumInstruction(' LISTNUM "schedule numbering" \\l 5 ')).toEqual({
      name: 'schedule numbering',
      level: 4,
      start: null,
    });
    expect(parseListNumInstruction(' listnum LegalDefault \\s 7 \\* MERGEFORMAT ')).toEqual({
      name: 'LegalDefault',
      level: null,
      start: 7,
    });
    // An out-of-range level clamps; an unknown switch and a general format are ignored.
    expect(parseListNumInstruction(' LISTNUM \\l 12 \\x \\* roman ')?.level).toBe(8);
    expect(parseListNumInstruction(' LISTNUM \\l 0 ')?.level).toBe(0);
  });

  test('a level or start without a whole number, and other keywords, fail closed', () => {
    expect(parseListNumInstruction(' LISTNUM \\l ')).toBeNull();
    expect(parseListNumInstruction(' LISTNUM \\s x ')).toBeNull();
    expect(parseListNumInstruction(' LISTNUM "open ')).toBeNull();
    expect(parseListNumInstruction(' LISTNUMBER ')).toBeNull();
    expect(parseListNumInstruction(' AUTONUM ')).toBeNull();
  });
});

describe('LISTNUM fields number from the list walk', () => {
  test('a named list at a stated level counts in its own format, without saved results', () => {
    const fieldPara = (level: number, tag: string) =>
      para(field(`LISTNUM "schedule numbering" \\l ${level}`) + text(` ${tag}`));
    expect(
      layoutOf(
        fieldPara(5, 'one') + fieldPara(5, 'two') + fieldPara(4, 'three') + fieldPara(5, 'four'),
        NUMBERING
      )
    ).toEqual(['[1] one', '[2] two', 'S2 three', '[1] four']);
  });

  test('the field and the numbered paragraphs of its list continue each other', () => {
    expect(
      layoutOf(
        para(text('real'), numPr('1', 0)) +
          para(field('LISTNUM "schedule numbering" \\l 1') + text(' field')) +
          para(text('real'), numPr('1', 0)) +
          para(text('real ') + field('LISTNUM "Schedule Numbering"'), numPr('1', 0)) +
          para(text('real'), numPr('1', 1)),
        NUMBERING
      )
    ).toEqual(['S1. real', 'S2. field', 'S3. real', 'S4. real S4.1', 'S4.2 real']);
  });

  test('the built-in list counts in one paragraph, across levels, and from \\s', () => {
    expect(
      layoutOf(
        para(field('LISTNUM') + text(' x ') + field('LISTNUM') + text(' y ') + field('LISTNUM'))
      )
    ).toEqual(['1) x 2) y 3)']);
    expect(
      layoutOf(
        para(field('LISTNUM \\l 2')) +
          para(field('LISTNUM \\l 1')) +
          para(field('LISTNUM \\l 2')) +
          para(field('LISTNUM \\l 3')) +
          para(field('LISTNUM \\l 9')) +
          para(field('LISTNUM \\s 7'))
      )
    ).toEqual(['a)', '2)', 'a)', 'i)', 'i.', '7)']);
  });

  test('the count goes on past the largest \\s value', () => {
    expect(layoutOf(para(field('LISTNUM \\s 99999')) + para(field('LISTNUM')))).toEqual([
      '9999)',
      '10000)',
    ]);
  });

  test('the built-in names share one counter and pick their own formats', () => {
    expect(
      layoutOf(
        para(field('LISTNUM NumberDefault')) +
          para(field('LISTNUM nosuchlist')) +
          para(field('LISTNUM LegalDefault \\l 2')) +
          para(field('LISTNUM OutlineDefault \\l 1'))
      )
    ).toEqual(['1)', '2)', '2.1.', 'III.']);
  });

  test('a saved result does not decide the number, and still counts', () => {
    expect(
      layoutOf(para(field('LISTNUM', 'Q7')) + para(field('LISTNUM')) + para(field('LISTNUM')))
    ).toEqual(['1)', '2)', '3)']);
    expect(
      layoutOf(
        para('<w:fldSimple w:instr=" LISTNUM \\l 1 "/>') +
          para('<w:fldSimple w:instr=" LISTNUM \\l 1 "><w:r><w:t>Z3</w:t></w:r></w:fldSimple>')
      )
    ).toEqual(['1)', '2)']);
  });

  test('without a name the field follows its paragraph list, then the last numbered one', () => {
    expect(
      layoutOf(
        para(text('a ') + field('LISTNUM'), numPr('2', 0)) +
          para(text('b ') + field('LISTNUM'), numPr('2', 1)) +
          para(field('LISTNUM') + text(' plain')) +
          para(field('LISTNUM NumberDefault') + text(' built-in')),
        NUMBERING
      )
    ).toEqual(['U1. a U1)', 'U2) b 1.', 'U3) plain', '1) built-in']);
  });

  test('on the built-in list a field takes its heading level, or one below the last heading', () => {
    expect(
      layoutOf(
        para(field('LISTNUM'), heading(2)) +
          para(field('LISTNUM')) +
          para(field('LISTNUM'), heading(1)) +
          para(field('LISTNUM'), '<w:outlineLvl w:val="2"/>')
      )
    ).toEqual(['a)', 'i)', '2)', 'i)']);
  });

  test('a named field without \\l takes the last numbered level of its list, else the first', () => {
    expect(
      layoutOf(
        para(text('real'), numPr('1', 1)) + para(field('LISTNUM "schedule numbering"')),
        NUMBERING
      )
    ).toEqual(['S1.1 real', 'S1.2']);
    expect(
      layoutOf(
        para(text('real'), numPr('2', 1)) + para(field('LISTNUM "schedule numbering"'), heading(2)),
        NUMBERING
      )
    ).toEqual(['U1) real', 'S1.']);
  });

  test('a field without \\l keeps the level of the field before it in its paragraph', () => {
    expect(
      layoutOf(
        para(text('real'), numPr('2', 0)) +
          para(
            field('LISTNUM \\l 2') + text(' x ') + field('LISTNUM') + text(' y ') + field('LISTNUM')
          ) +
          para(field('LISTNUM')),
        NUMBERING
      )
    ).toEqual(['U1. real', 'U1) x U2) y U3)', 'U2.']);
    // On the built-in list, also past a field of another list between them.
    expect(
      layoutOf(
        para(
          field('LISTNUM \\l 2') +
            text(' x ') +
            field('LISTNUM "schedule numbering"') +
            text(' y ') +
            field('LISTNUM')
        ),
        NUMBERING
      )
    ).toEqual(['a) x S1. y b)']);
    // In a numbered paragraph of the same list, the paragraph decides.
    expect(
      layoutOf(
        para(
          text('real ') + field('LISTNUM \\l 3') + text(' x ') + field('LISTNUM'),
          numPr('2', 0)
        ),
        NUMBERING
      )
    ).toEqual(['U1. real 1. x U2)']);
  });

  test('a second layout session over the same story keeps the numbers', () => {
    const body =
      para(text('real'), numPr('2', 0)) +
      para(field('LISTNUM', 'saved') + text(' one')) +
      para(field('LISTNUM', 'saved') + text(' two'));
    const { part, numberingIndex } = load(body, NUMBERING);
    const texts = () =>
      textsOf(
        layoutSemanticDocument(part, 1, {
          measurer,
          numberingIndex: numberingIndex!,
          session: createLayoutSession(),
        })
      );
    expect(texts()).toEqual(['U1. real', 'U2. one', 'U3. two']);
    // The next session starts from the first one's list walk.
    expect(texts()).toEqual(['U1. real', 'U2. one', 'U3. two']);
  });

  test('an edit before a field renumbers it', () => {
    const one = para(field('LISTNUM') + text(' a')) + para(field('LISTNUM') + text(' b'));
    expect(layoutOf(one)).toEqual(['1) a', '2) b']);
    expect(layoutOf(para(field('LISTNUM') + text(' new')) + one)).toEqual([
      '1) new',
      '2) a',
      '3) b',
    ]);
  });
});
