// `w:wordWrap` off lets lines open between any two characters. Korean text keeps Latin words
// whole: the paragraph mark and the runs must both resolve to a Korean East Asian language.
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 11pt text: every character is 6pt wide, so a 60pt line holds ten characters.
const measurer = createFixedMeasurer(6, 14);
const geometry = { width: 80, height: 400, margin: { left: 10, right: 10, top: 10, bottom: 10 } };
const KO = '<w:lang w:eastAsia="ko-KR"/>';
const JA = '<w:lang w:eastAsia="ja-JP"/>';
const OFF = '<w:wordWrap w:val="0"/>';
const LATIN = 'alpha bravo charlie delta';

function part(xml: string, name: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const run = (text: string, rPr = '') =>
  `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (runs: string, pPr = OFF) => `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
const document = (body: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, '/word/document.xml');
const styles = (defaultRunProperties = '') =>
  buildStyleCascadeTable(
    part(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/>${defaultRunProperties}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
      '/word/styles.xml'
    ).root
  );

function layout(body: string, defaultRunProperties = '', session = createLayoutSession()) {
  return layoutSemanticDocument(document(body), 0, {
    session,
    measurer,
    geometry,
    styleCascade: styles(defaultRunProperties),
  });
}
const linesOf = (fragment: ParagraphFragmentRecord) =>
  fragment.lines.map((line) => line.spans.map((span) => span.text).join(''));
function bodyLines(value: ReturnType<typeof layout>): string[][] {
  return value.pages[0]!.fragments.map((fragment) => linesOf(fragment as ParagraphFragmentRecord));
}

const WHOLE = ['alpha ', 'bravo ', 'charlie ', 'delta'];
const DIVIDED = ['alpha brav', 'o charlie ', 'delta'];

test('a Korean paragraph mark and Korean runs keep Latin words whole', () => {
  expect(bodyLines(layout(paragraph(run(LATIN)), KO))).toEqual([WHOLE]);
  // The document default reaches the mark and the run alike; direct properties do the same.
  expect(bodyLines(layout(paragraph(run(LATIN, KO), `${OFF}<w:rPr>${KO}</w:rPr>`)))).toEqual([
    WHOLE,
  ]);
  // A run East Asian font changes nothing.
  const font = '<w:rFonts w:eastAsia="Test CJK"/>';
  expect(bodyLines(layout(paragraph(run(LATIN, font)), KO))).toEqual([WHOLE]);
});

test('character wrapping divides Latin words without a Korean mark or run', () => {
  // No East Asian language anywhere.
  expect(bodyLines(layout(paragraph(run(LATIN))))).toEqual([DIVIDED]);
  // A Korean run under a paragraph mark that is not Korean.
  expect(bodyLines(layout(paragraph(run(LATIN, KO))))).toEqual([DIVIDED]);
  // A Japanese run under a Korean paragraph mark.
  expect(bodyLines(layout(paragraph(run(LATIN, JA)), KO))).toEqual([DIVIDED]);
  // A Korean non-East-Asian language tag is not an East Asian language.
  expect(bodyLines(layout(paragraph(run(LATIN, '<w:lang w:val="ko-KR"/>'))))).toEqual([DIVIDED]);
  // Ordinary word wrapping is unchanged.
  expect(bodyLines(layout(paragraph(run(LATIN), ''), KO))).toEqual([WHOLE]);
  expect(bodyLines(layout(paragraph(run(LATIN), '')))).toEqual([WHOLE]);
});

test('Hangul text no longer decides whether Latin words stay whole', () => {
  const text = '가나 alpha bravo';
  // Without a Korean paragraph mark, the Latin word beside Hangul divides.
  expect(bodyLines(layout(paragraph(run(text))))).toEqual([['가나 alpha b', 'ravo']]);
  expect(bodyLines(layout(paragraph(run(text)), KO))).toEqual([['가나 alpha ', 'bravo']]);
});

test('Hangul syllables wrap one by one in either case', () => {
  const text = '가나다라마바사아자차카타파';
  for (const defaults of ['', KO])
    expect(bodyLines(layout(paragraph(run(text)), defaults))).toEqual([
      ['가나다라마바사아자차', '카타파'],
    ]);
});

test('a boundary stays closed only between two Korean runs', () => {
  // A word divided between two Korean runs stays whole.
  const word = (left: string, right: string) =>
    paragraph(run('alpha bra', left) + run('vo charlie delta', right));
  expect(bodyLines(layout(word(KO, KO), KO))).toEqual([WHOLE]);
  // The seam into a Japanese run opens.
  expect(bodyLines(layout(word(KO, JA), KO))).toEqual([DIVIDED]);
  // Inside a Japanese run, Latin words divide; the Korean run beside it keeps its words.
  const runs = paragraph(run('alpha bravo', JA) + run(' charlie delta', KO));
  expect(bodyLines(layout(runs, KO))).toEqual([DIVIDED]);
});

test('only the East Asian language attribute makes text Korean', () => {
  const val = (language: string) => `<w:lang w:val="${language}"/>`;
  // A Korean w:val on the mark and the run, or in the defaults, does not keep words whole.
  const koreanVal = paragraph(run(LATIN, val('ko-KR')), `${OFF}<w:rPr>${val('ko-KR')}</w:rPr>`);
  expect(bodyLines(layout(koreanVal))).toEqual([DIVIDED]);
  expect(bodyLines(layout(paragraph(run(LATIN)), val('ko-KR')))).toEqual([DIVIDED]);
  // A w:val in another language does not cancel an inherited Korean East Asian language,
  // on the run or on the mark.
  expect(bodyLines(layout(paragraph(run(LATIN, val('ja-JP'))), KO))).toEqual([WHOLE]);
  const japaneseMark = paragraph(run(LATIN), `${OFF}<w:rPr>${val('ja-JP')}</w:rPr>`);
  expect(bodyLines(layout(japaneseMark, KO))).toEqual([WHOLE]);
});

test('a combining mark in its own run sets the left side of the next boundary', () => {
  const COMBINING = '́';
  // The mark joins the cluster of "b", but the boundary after it touches the Japanese run.
  const split = (middle: string) =>
    paragraph(run('alpha b', KO) + run(COMBINING, middle) + run('ravo charlie delta', KO));
  expect(bodyLines(layout(split(KO), KO))).toEqual([
    [`alpha `, `b${COMBINING}ravo `, 'charlie ', 'delta'],
  ]);
  // With a Japanese mark run, the boundary opens; "ravo" in the Korean run stays whole.
  expect(bodyLines(layout(split(JA), KO))).toEqual([
    [`alpha b${COMBINING}`, 'ravo ', 'charlie ', 'delta'],
  ]);
});

test('table cell minimum widths follow the same rule', () => {
  const minimum = (defaults: string) => {
    const source = document(paragraph(run('abcdefgh')));
    const node = source.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    ) as OoxmlElement;
    return paragraphContentWidthsPt(node, {
      context: { measurer },
      view: {
        styleCascade: styles(defaults),
        displayMode: 'all-markup',
        authorFilter: undefined,
        readNested: () => null,
      },
      tableCellStyle: undefined,
    }).min;
  };
  // The Korean word is the cell's narrowest width; otherwise one character is.
  expect(minimum(KO)).toBeCloseTo(48, 8);
  expect(minimum('')).toBeCloseTo(6, 8);
});

test('changing the document default language relays out the paragraph', () => {
  const session = createLayoutSession();
  const body = paragraph(run(LATIN));
  const source = document(body);
  const before = serializeOoxmlPart(source);
  const korean = layoutSemanticDocument(source, 0, {
    session,
    measurer,
    geometry,
    styleCascade: styles(KO),
  });
  const plain = layoutSemanticDocument(source, 0, {
    session,
    measurer,
    geometry,
    styleCascade: styles(),
  });
  expect(bodyLines(korean)).toEqual([WHOLE]);
  expect(bodyLines(plain)).toEqual([DIVIDED]);
  expect(serializeOoxmlPart(source)).toBe(before);
});
