// Thai, Lao, Khmer, and Myanmar line breaking (#1384).
//
// These scripts put no spaces between words. Layout wraps them at any grapheme cluster that
// fits, never at a dictionary word, and table AutoFit keeps an unspaced run whole as one
// segment. A zero-width space (U+200B) is the way to mark a word boundary: a line may end
// after it, and it stays at the end of that line. No line breaks inside a stacked consonant
// (after a Khmer coeng or a Myanmar virama) or before a combining mark, such as a Myanmar
// spacing vowel, even where grapheme rules end a cluster.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { paragraphMinimumWidthPt } from '../table-autofit-widths.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per UTF-16 unit at 11pt. */
const measurer = createFixedMeasurer(6, 14);

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

const run = (text: string, props = ''): string =>
  `<w:r><w:rPr>${props}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const linesOf = (body: string, width: number): string[] =>
  breakParagraph(paragraph(body), 'p', 0, width, measurer, undefined, null).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

const minimumOf = (body: string): number =>
  paragraphMinimumWidthPt(paragraph(body) as OoxmlElement, {
    context: { measurer },
    view: {
      styleCascade: undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });

const THAI = 'ฉันอยากกินข้าววันนี้';
const LAO = 'ພາສາລາວເປັນພາສາທີ່ສວຍງາມຫຼາຍ';
const KHMER = 'ភាសាខ្មែរជាភាសាផ្លូវការនៃប្រទេសកម្ពុជា';
const MYANMAR = 'မြန်မာဘာသာစကားသည်ရုံးသုံးဘာသာစကားဖြစ်သည်';

describe('unspaced text wraps at any cluster that fits', () => {
  test('in each script, filling every line', () => {
    expect(linesOf(`<w:p>${run(THAI)}</w:p>`, 54)).toEqual(['ฉันอยากกิ', 'นข้าววัน', 'นี้']);
    expect(linesOf(`<w:p>${run(LAO)}</w:p>`, 60)).toEqual(['ພາສາລາວເປັ', 'ນພາສາທີ່ສວ', 'ຍງາມຫຼາຍ']);
    expect(linesOf(`<w:p>${run(KHMER)}</w:p>`, 72)).toEqual([
      'ភាសាខ្មែរជា',
      'ភាសាផ្លូវការ',
      'នៃប្រទេសក',
      'ម្ពុជា',
    ]);
    expect(linesOf(`<w:p>${run(MYANMAR)}</w:p>`, 84)).toEqual([
      'မြန်မာဘာသာစကား',
      'သည်ရုံးသုံးဘာ',
      'သာစကားဖြစ်သည်',
    ]);
  });

  test('a run seam does not change the lines', () => {
    const split = `<w:p>${run('ฉันอยากกินข')}${run('้าววันนี้', '<w:b/>')}</w:p>`;
    expect(linesOf(split, 54)).toEqual(linesOf(`<w:p>${run(THAI)}</w:p>`, 54));
  });

  test('repetition marks and the marks after a sentence sign may start a line', () => {
    expect(linesOf(`<w:p>${run('ต่างๆนานา')}</w:p>`, 24)).toEqual(['ต่าง', 'ๆนาน', 'า']);
    expect(linesOf(`<w:p>${run('ภาษา๚”ไทย')}</w:p>`, 30)).toEqual(['ภาษา๚', '”ไทย']);
  });
});

describe('table AutoFit', () => {
  test('keeps an unspaced run whole as one segment', () => {
    expect(minimumOf(`<w:p>${run(THAI)}</w:p>`)).toBeCloseTo(120, 5);
    expect(minimumOf(`<w:p>${run(LAO)}</w:p>`)).toBeCloseTo(168, 5);
    expect(minimumOf(`<w:p>${run('ฉันอยาก กินข้าว')}</w:p>`)).toBeCloseTo(42, 5);
  });

  test('ends a segment at a zero-width space', () => {
    expect(minimumOf(`<w:p>${run('ฉัน​อยาก​กิน')}</w:p>`)).toBeCloseTo(30, 5);
    expect(minimumOf(`<w:p>${run('ฉัน​')}${run('อยาก')}</w:p>`)).toBeCloseTo(24, 5);
  });
});

describe('zero-width space', () => {
  const SPACED = 'ฉัน​อยาก​กิน​ข้าว​วัน​นี้';

  test('a line may end after it, and it stays at the end of that line', () => {
    expect(linesOf(`<w:p>${run(SPACED)}</w:p>`, 60)).toEqual(['ฉัน​อยาก​', 'กิน​ข้าว​', 'วัน​นี้']);
    expect(linesOf(`<w:p>${run('alpha​beta')}</w:p>`, 42)).toEqual(['alpha​', 'beta']);
  });

  test('never starts a line, even after a space or an emergency cut', () => {
    expect(linesOf(`<w:p>${run('alpha ​beta')}</w:p>`, 42)).toEqual(['alpha ​', 'beta']);
    for (const width of [12, 18, 24, 30])
      for (const line of linesOf(`<w:p>${run('ភាសា​ខ្មែរ​គឺជា​ភាសា')}</w:p>`, width))
        expect(line.startsWith('​')).toBe(false);
  });
});

describe('clusters that never split', () => {
  test('a Khmer coeng or Myanmar virama keeps the stacked consonant with its base', () => {
    for (const width of [12, 18, 24, 30]) {
      for (const text of ['ភាសាខ្មែរ', 'ប្រទេសកម្ពុជា', 'ကမ္ဘာ']) {
        const lines = linesOf(`<w:p>${run(text)}</w:p>`, width);
        expect(lines.join('')).toBe(text);
        for (const line of lines.slice(0, -1)) expect(line).not.toMatch(/[្္]$/u);
      }
      const seam = linesOf(`<w:p>${run('ភាសាខ្')}${run('មែរ')}</w:p>`, width);
      for (const line of seam.slice(0, -1)) expect(line).not.toMatch(/្$/u);
    }
  });

  test('a Myanmar spacing vowel or visarga stays with its consonant', () => {
    // Grapheme rules end a cluster before U+102C and U+1038; a line never does.
    const text = 'ကျောင်းသွားလေးတော်ကမ္ဘာ';
    for (const width of [12, 18, 24, 30, 36]) {
      const lines = linesOf(`<w:p>${run(text)}</w:p>`, width);
      expect(lines.join('')).toBe(text);
      for (const line of lines) expect(line, `at ${width}`).not.toMatch(/^[ါား]/u);
    }
    expect(linesOf(`<w:p>${run(text)}</w:p>`, 24)).toEqual([
      'ကျော',
      'င်း',
      'သွား',
      'လေး',
      'တော်',
      'က',
      'မ္ဘာ',
    ]);
    // A run seam before the vowel is no break either.
    for (const line of linesOf(`<w:p>${run('သွ')}${run('ား', '<w:b/>')}</w:p>`, 12))
      expect(line).not.toMatch(/^ာ/u);
  });

  test('a word that starts with a mark after a space still breaks at the space', () => {
    // Zawgyi-encoded Myanmar stores the vowel sign U+1031 before its consonant.
    const zawgyi = Array(8).fill('\u1031\u1019\u102c\u1004\u1039').join(' ');
    const lines = linesOf(`<w:p>${run(zawgyi)}</w:p>`, 72);
    expect(lines).toEqual(
      Array(4)
        .fill(null)
        .map((_, i) => (i < 3 ? 'ေမာင္ ေမာင္ ' : 'ေမာင္ ေမာင္'))
    );
    // Split into runs at the spaces, too, and after a zero-width space or a tab.
    const words = Array(8).fill('ေမာင္');
    expect(linesOf(`<w:p>${words.map((word) => run(`${word} `)).join('')}</w:p>`, 72)).toEqual(
      linesOf(`<w:p>${run(`${zawgyi} `)}</w:p>`, 72)
    );
    expect(linesOf(`<w:p>${run(words.join('\u200b'))}</w:p>`, 60)[1]!.startsWith('\u1031')).toBe(
      true
    );
  });

  test('Zawgyi words break at the spaces in East Asian paragraphs too', () => {
    // Zawgyi ends a word with U+1039 as the visible asat; only a letter after it stacks.
    const word = '\u1031\u1019\u102c\u1004\u1039';
    const zawgyi = Array(8).fill(word).join(' ');
    for (const body of [
      `<w:p>${run(zawgyi, '<w:lang w:eastAsia="zh-CN"/>')}</w:p>`,
      `<w:p>${run(`中文 ${zawgyi}`)}</w:p>`,
    ]) {
      for (const width of [60, 72, 96]) {
        const lines = linesOf(body, width);
        expect(lines.join('')).toContain(zawgyi);
        for (const line of lines)
          for (const token of line.trim().split(' '))
            expect([word, '中文'], `${JSON.stringify(lines)} at ${width}`).toContain(token);
      }
    }
  });

  test('a combining mark in the next run stays with its base letter', () => {
    expect(linesOf(`<w:p>${run('abcde')}${run('́fgh')}</w:p>`, 30)).toEqual(['abcdé', 'fgh']);
  });
});

describe('a dash that opens a run', () => {
  test('breaks after itself when text precedes it in the run before', () => {
    expect(linesOf(`<w:p>${run('ALPHA')}${run('-PRIME')}</w:p>`, 42)).toEqual(['ALPHA-', 'PRIME']);
    expect(minimumOf(`<w:p>${run('word')}${run('-word word')}</w:p>`)).toBeCloseTo(30, 5);
  });
});
