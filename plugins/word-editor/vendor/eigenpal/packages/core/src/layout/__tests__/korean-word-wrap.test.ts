// Under word wrapping (`w:wordWrap`, ECMA-376 §17.3.1.45), Hangul breaks like a Latin letter.
// A Korean word keeps the ASCII punctuation, digits, and Latin letters that it holds, so a
// line never ends or opens inside it.
import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { loadFixture } from './punctuation-kerning-fixture.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';

// Every character, a space too, is 24 pt wide, so the 240 pt measure holds ten.
const texts = (text: string, paragraphProperties = '') =>
  loadFixture({
    text,
    available: 240,
    language: 'ko-KR',
    paragraphProperties: `<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:jc w:val="both"/>${paragraphProperties}`,
  }).lines.map((line) => line.spans.map((span) => span.text).join(''));

test('a closing parenthesis stays in its Korean word', () => {
  expect(texts('가나다라 마바(사아), 자차')).toEqual(['가나다라 ', '마바(사아), 자차']);
});

test('an opening parenthesis stays in its Korean word', () => {
  expect(texts('가나다라마바 사아자(차카)')).toEqual(['가나다라마바 ', '사아자(차카)']);
});

test('digits and Latin letters stay in their Korean word', () => {
  expect(texts('가나다라마바사 10회 자차')).toEqual(['가나다라마바사 ', '10회 자차']);
  expect(texts('가나다라마바사 mm이 자차')).toEqual(['가나다라마바사 ', 'mm이 자차']);
});

test('a Korean word wider than the line breaks at its last fitting character', () => {
  expect(texts('가나 다라마바사아자차카타파하')).toEqual(['가나 ', '다라마바사아자차카타', '파하']);
});

test('a table cell is no narrower than its widest Korean word', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const part = (xml: string, name: string) => {
    const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
    if (!read.ok) throw new Error(read.reason);
    return read.part;
  };
  const body = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">가나(다라), 마</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    '/word/styles.xml'
  );
  const node = body.root.children[0]!.children.find(
    (child) => child.kind === 'paragraph'
  ) as OoxmlElement;
  const { min } = paragraphContentWidthsPt(node, {
    context: { measurer: createFixedMeasurer(6, 14) },
    view: {
      styleCascade: buildStyleCascadeTable(styles.root),
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
  // 11 pt characters are 6 pt wide, and the seven characters of "가나(다라)," are one unit.
  expect(min).toBeCloseTo(42, 8);
});

test('character wrapping still breaks a Korean word at its punctuation', () => {
  expect(texts('가나다라 마바(사아), 자차', '<w:wordWrap w:val="0"/>')).toEqual([
    '가나다라 마바(사아',
    '), 자차',
  ]);
});
