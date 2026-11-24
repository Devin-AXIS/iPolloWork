// A justified or distributed line in a modern compatibility mode shrinks its inter-word spaces
// to keep one more word. A space beside Hangul shrinks with the others, by the same amount,
// unless the document balances single-byte and double-byte widths
// (`w:balanceSingleByteDoubleByteWidth`). With that setting, a space beside East Asian text
// takes the balanced width, half the font size (`balanced-space-widths.test.ts`), and keeps it:
// only the line's other spaces shrink. The cost test reads the line without the word as it
// would stretch, its narrower spaces first.
import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { anyShrunk, shrunkBy } from './shrunk-space.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Every character is 10 pt and a space is 4 pt, plus the style's character spacing, so a plain
// space can give up 1 pt. A balanced space at 11 pt is 5.5 pt.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce((n, c) => n + (c === ' ' ? 4 : 10) + style.characterSpacingPt, 0),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
function part(name: string, xml: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const cascade = (balanced: boolean) =>
  buildStyleCascadeTable(
    part('/word/styles.xml', `<w:styles xmlns:w="${W}"/>`).root,
    undefined,
    part(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:compat>` +
        (balanced ? '<w:balanceSingleByteDoubleByteWidth/>' : '') +
        '<w:compatSetting w:name="compatibilityMode" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    ).root
  );
// Batang at 11 pt; the measurer gives every face the same advances.
const run = (text: string) =>
  '<w:r><w:rPr><w:rFonts w:ascii="Batang" w:hAnsi="Batang" w:eastAsia="Batang"/>' +
  `<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
/** One paragraph of `runs` on a `width` pt measure; `balanced` writes the setting. */
const layout = (runs: string | readonly string[], width: number, balanced = true, jc = 'both') =>
  layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${[runs].flat().map(run).join('')}</w:p>` +
        `<w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/>` +
        '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
    ),
    1,
    { measurer, compatibilityMode: 15, styleCascade: cascade(balanced) }
  );
const content = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) =>
    line.spans
      .map((span) => span.text)
      .join('')
      .trimEnd()
  );
/** How far the space in front of `word` shrank on the first line, whichever span holds it. */
const shrunkBefore = (result: ReturnType<typeof layout>, word: string) => {
  const spans = linesOf(result)[0]!.spans;
  return shrunkBy(
    spans,
    spans.findIndex((span, index) => span.text.endsWith(' ') && spans[index + 1]?.text === word)
  );
};

test('without balanced widths, spaces beside Hangul shrink by the same amount as the others', () => {
  // `가가 나나 다다` is 2 pt too wide, and its two spaces give up 1 pt each.
  const korean = layout('가가 나나 다다 라라', 66, false);
  expect(content(korean)).toEqual(['가가 나나 다다', '라라']);
  expect(shrunkBefore(korean, '나나')).toBeCloseTo(1, 6);
  expect(shrunkBefore(korean, '다다')).toBeCloseTo(1, 6);
  // `aa bb 가가 나나 cc` is 2 pt too wide: four spaces, one between Latin words, give 0.5 pt each.
  const mixed = layout('aa bb 가가 나나 cc', 114, false);
  expect(content(mixed)).toEqual(['aa bb 가가 나나 cc']);
  for (const word of ['bb', '가가', '나나', 'cc'])
    expect(shrunkBefore(mixed, word)).toBeCloseTo(0.5, 6);
});

test('with balanced widths, spaces between Hangul words keep their advance', () => {
  // The same line, 5 pt too wide with spaces at 5.5 pt: they keep that width.
  const result = layout('가가 나나 다다 라라', 66);
  expect(content(result)).toEqual(['가가 나나', '다다 라라']);
  expect(anyShrunk(linesOf(result)[0]!.spans)).toBe(false);
  // Only the Latin space of the mixed line lends, 1 pt of the 6.5 pt it needs.
  expect(content(layout('aa bb 가가 나나 cc', 114))).toEqual(['aa bb 가가 나나', 'cc']);
});

test('with balanced widths, a space run between Hangul runs keeps its advance', () => {
  const runs = ['가가', ' ', '나나', ' ', '다다', ' ', '라라'];
  expect(content(layout(runs, 66))).toEqual(['가가 나나', '다다 라라']);
  expect(content(layout(runs, 66, false))).toEqual(['가가 나나 다다', '라라']);
});

test('with balanced widths, a distributed line keeps the spaces beside Hangul too', () => {
  expect(content(layout('가가 나나 다다 라라', 66, true, 'distribute'))).toEqual([
    '가가 나나',
    '다다 라라',
  ]);
  expect(content(layout('가가 나나 다다 라라', 66, false, 'distribute'))).toEqual([
    '가가 나나 다다',
    '라라',
  ]);
});

test('with balanced widths, Thai distribution and kashida lines stay inside the measure', () => {
  // Line fitting and alignment keep the same spaces: the line never keeps a word that only
  // spaces beside Hangul could make room for.
  for (const jc of ['thaiDistribute', 'lowKashida', 'mediumKashida', 'highKashida']) {
    const result = layout('가가 나나 다다 라라', 66, true, jc);
    expect(content(result)).toEqual(['가가 나나', '다다 라라']);
    const spans = linesOf(result)[0]!.spans.filter((span) => span.text.trim() !== '');
    const last = spans.at(-1)!;
    expect(last.box.x + last.box.width).toBeLessThanOrEqual(66 + 1e-6);
  }
});

test('with balanced widths, Latin spaces on a line with Hangul shrink alone', () => {
  // `aa bb cc 가가` is 93.5 pt, 1 pt too wide: the two Latin spaces give up 0.5 pt each.
  const result = layout('aa bb cc 가가 dd', 92.5);
  expect(content(result)).toEqual(['aa bb cc 가가', 'dd']);
  expect(shrunkBefore(result, 'bb')).toBeCloseTo(0.5, 6);
  expect(shrunkBefore(result, 'cc')).toBeCloseTo(0.5, 6);
  expect(shrunkBefore(result, '가가')).toBeCloseTo(0, 6);
});

test('with balanced widths, the space before a Hangul word still hangs after the shorter line', () => {
  // `aa bb 가가` is 3.5 pt too wide; only the space after `aa` can lend, 1 pt.
  expect(content(layout('aa bb 가가 dd', 66))).toEqual(['aa bb', '가가 dd']);
  // Ten `a` words and `가가` are 4.5 pt too wide, and nine Latin spaces lend 9 pt. Without the
  // word, the space before `가가` hangs, so the shorter line stretches its nine spaces by 21 pt:
  // 0.58 pt per point, more than twice the shrink of 0.13 pt per point.
  expect(content(layout('a a a a a a a a a a 가가 b', 157))[0]).toBe('a a a a a a a a a a 가가');
});

test('with balanced widths, the shorter line stretches its narrower spaces first', () => {
  // `a a a a a a a 가 가 가 가 가 가` is 187 pt: six Latin spaces and six at the balanced width.
  // On 198 pt, `b` is 4.5 pt too wide, 0.19 pt per point of the Latin spaces; twice that is
  // 0.38. Without `b`, the 11 pt of slack bring the Latin spaces to 5.5 pt and then widen all
  // twelve: 0.42 pt per point of Latin space, so `b` stays. Spread over every space alike, the
  // stretch would be 0.19 pt per point, and `b` would wrap.
  const text = 'a a a a a a a 가 가 가 가 가 가 b';
  expect(content(layout(text, 198))).toEqual([text]);
  // On 197 pt, `b` is 5.5 pt too wide: 0.46 against a stretch of 0.40, so `b` wraps.
  expect(content(layout(text, 197))).toEqual(['a a a a a a a 가 가 가 가 가 가', 'b']);
});
