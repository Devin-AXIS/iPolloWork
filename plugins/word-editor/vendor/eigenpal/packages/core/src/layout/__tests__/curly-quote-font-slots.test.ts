import { describe, expect, test } from 'bun:test';
import type { BidiEmbeddingLevels } from '../bidi.ts';
import { resolveRunStyle } from '../run-style.ts';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  eastAsiaRunsOfSegments,
  itemizeScriptFontSlots,
  styleForFontSlot,
} from '../script-itemization.ts';

const ltr = (text: string): BidiEmbeddingLevels => ({
  paragraphs: [{ from: 0, to: text.length, level: 0 }],
  levels: new Uint8Array(text.length),
});

describe('curly quotes use the authored hAnsi face without an East Asian hint', () => {
  test.each(['‘', '’', '“', '”'])('%s keeps its font slot beside Han text', (quote) => {
    for (const text of [`甲${quote}乙`, `${quote}甲`, `甲${quote}`, quote]) {
      const item = itemizeScriptFontSlots(text, 0, ltr(text)).find(({ from, to }) =>
        text.slice(from, to).includes(quote)
      );
      expect(item).toMatchObject({ slot: 'hAnsi', script: 'Zyyy' });
      const ranges = eastAsiaRunsOfSegments([text]);
      const quoteOffset = text.indexOf(quote);
      expect(ranges.some(({ from, to }) => from <= quoteOffset && quoteOffset < to)).toBe(false);
    }
  });

  test('uses the same authored face before and after text segment boundaries', () => {
    expect(eastAsiaRunsOfSegments(['甲', '“', '乙', '”', '丙'])).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 2, from: 0, to: 1 },
      { segment: 4, from: 0, to: 1 },
    ]);
    const style = resolveRunStyle([
      {
        localName: 'rFonts',
        attributes: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' },
      },
    ]);
    const text = '甲“乙”丙';
    const faces = itemizeScriptFontSlots(text, 0, ltr(text)).map((item) => ({
      text: text.slice(item.from, item.to),
      family: styleForFontSlot(style, item.slot).fontFamily,
    }));
    expect(faces).toEqual([
      { text: '甲', family: 'SimSun' },
      { text: '“', family: 'Times New Roman' },
      { text: '乙', family: 'SimSun' },
      { text: '”', family: 'Times New Roman' },
      { text: '丙', family: 'SimSun' },
    ]);
  });

  test('retains the explicit East Asian hint and its run scope', () => {
    expect(eastAsiaRunsOfSegments(['甲“乙”丙'], [true])).toEqual([{ segment: 0, from: 0, to: 5 }]);
    expect(eastAsiaRunsOfSegments(['甲', '“', '乙', '”', '丙'], [false, true])).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 1, from: 0, to: 1 },
      { segment: 2, from: 0, to: 1 },
      { segment: 4, from: 0, to: 1 },
    ]);
  });

  test('keeps combining marks in the quote face and keeps fullwidth punctuation East Asian', () => {
    expect(eastAsiaRunsOfSegments(['甲“\u0301乙'])).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 0, from: 3, to: 4 },
    ]);
    expect(eastAsiaRunsOfSegments(['甲“', '\u0301乙'], [true])).toEqual([
      { segment: 0, from: 0, to: 2 },
      { segment: 1, from: 0, to: 2 },
    ]);
    expect(eastAsiaRunsOfSegments(['甲「乙」丙，丁'])).toEqual([{ segment: 0, from: 0, to: 7 }]);
  });

  test.each(['', ' w:hint="eastAsia"'])(
    'layout uses the authored quote face and retains OOXML with hint %s',
    (hint) => {
      const xml =
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" ' +
        `w:eastAsia="SimSun"${hint}/><w:sz w:val="28"/><w:spacing w:val="-4"/>` +
        '</w:rPr><w:t>甲“乙”丙</w:t></w:r></w:p></w:body></w:document>';
      const loaded = readOoxmlPart(xml, {
        name: '/word/document.xml',
        contentType: 'application/xml',
      });
      if (!loaded.ok) throw Error(loaded.reason);
      const before = serializeOoxmlPart(loaded.part);
      const base = createFixedMeasurer(7, 14);
      const calls: { text: string; family: string | null }[] = [];
      const layout = layoutSemanticDocument(loaded.part, 0, {
        measurer: {
          ...base,
          measure(text, style) {
            calls.push({ text, family: style.fontFamily });
            return base.measure(text, style);
          },
        },
      });
      const spans = layout.pages.flatMap((page) =>
        page.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
        )
      );
      const quoteFace = hint ? 'SimSun' : 'Arial';
      expect(calls.some(({ text, family }) => /[“”]/.test(text) && family === quoteFace)).toBe(
        true
      );
      expect(spans.map((span) => span.text).join('')).toBe('甲“乙”丙');
      expect(
        spans
          .filter((span) => /[“”]/.test(span.text))
          .every((span) => styleForFontSlot(span.style, span.fontSlot).fontFamily === quoteFace)
      ).toBe(true);
      expect(
        spans.every(
          (span) => span.style.fontSizePt === 14 && span.style.characterSpacingPt === -0.2
        )
      ).toBe(true);
      expect(serializeOoxmlPart(loaded.part)).toBe(before);
    }
  );

  test.each([
    ['cs', false],
    ['cs', true],
    ['rtl', false],
    ['rtl', true],
  ] as const)('w:%s keeps its complex-script face (East Asian hint: %s)', (flag, hinted) => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" w:eastAsia="SimSun" ' +
      `w:cs="Courier New"${hinted ? ' w:hint="eastAsia"' : ''}/>` +
      `<w:${flag}/><w:sz w:val="28"/><w:szCs w:val="32"/>` +
      '</w:rPr><w:t>甲‘乙’丙“丁”戊</w:t></w:r></w:p></w:body></w:document>';
    const loaded = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!loaded.ok) throw Error(loaded.reason);
    const before = serializeOoxmlPart(loaded.part);
    const base = createFixedMeasurer(7, 14);
    const calls: { text: string; family: string | null; size: number }[] = [];
    const layout = layoutSemanticDocument(loaded.part, 0, {
      measurer: {
        ...base,
        measure(text, style) {
          calls.push({ text, family: style.fontFamily, size: style.fontSizePt });
          return base.measure(text, style);
        },
      },
    });
    const spans = layout.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
    );
    const quoteCalls = calls.filter(({ text }) => /[‘’“”]/u.test(text));
    expect(quoteCalls.length).toBeGreaterThan(0);
    expect(quoteCalls.every(({ family, size }) => family === 'Courier New' && size === 16)).toBe(
      true
    );
    const quoteSpans = spans.filter((span) => /[‘’“”]/u.test(span.text));
    expect(quoteSpans.length).toBeGreaterThan(0);
    expect(
      quoteSpans.every(
        (span) =>
          styleForFontSlot(span.style, span.fontSlot).fontFamily === 'Courier New' &&
          span.style.fontSizePt === 16
      )
    ).toBe(true);
    expect(serializeOoxmlPart(loaded.part)).toBe(before);
  });
});

describe('dashes, ellipses, low quotes, and the middle dot use hAnsi without a hint', () => {
  const marks = ['–', '—', '…', '‚', '„', '·'];

  test.each(marks)('%s keeps its font slot beside Han text', (mark) => {
    for (const text of [`甲${mark}乙`, `${mark}甲`, `甲${mark}`, mark]) {
      const item = itemizeScriptFontSlots(text, 0, ltr(text)).find(({ from, to }) =>
        text.slice(from, to).includes(mark)
      );
      expect(item).toMatchObject({ slot: 'hAnsi', script: 'Zyyy' });
      const offset = text.indexOf(mark);
      const ranges = eastAsiaRunsOfSegments([text]);
      expect(ranges.some(({ from, to }) => from <= offset && offset < to)).toBe(false);
      expect(eastAsiaRunsOfSegments([text], [true])).toEqual([
        { segment: 0, from: 0, to: text.length },
      ]);
    }
  });

  test.each([
    ['SimSun', 'zh-CN', ''],
    ['SimSun', 'zh-CN', ' w:hint="eastAsia"'],
    ['Yu Mincho', 'ja-JP', ''],
    ['MS Mincho', 'ja-JP', ' w:hint="eastAsia"'],
  ])('layout measures each mark in the authored face (%s, %s, hint %s)', (face, lang, hint) => {
    const text = `汉${marks.join('汉')}汉`;
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" ' +
      `w:eastAsia="${face}"${hint}/><w:lang w:val="en-US" w:eastAsia="${lang}"/>` +
      `</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
    const loaded = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!loaded.ok) throw Error(loaded.reason);
    const before = serializeOoxmlPart(loaded.part);
    const layout = layoutSemanticDocument(loaded.part, 0, { measurer: createFixedMeasurer(7, 14) });
    const spans = layout.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
    );
    expect(spans.map((span) => span.text).join('')).toBe(text);
    const markFace = hint ? face : 'Arial';
    for (const span of spans) {
      const family = styleForFontSlot(span.style, span.fontSlot).fontFamily;
      for (const character of span.text)
        expect([character, family]).toEqual([character, character === '汉' ? face : markFace]);
    }
    expect(serializeOoxmlPart(loaded.part)).toBe(before);
  });
});
