import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type TextMeasurer,
} from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) =>
  `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const tab = '<w:r><w:rPr><w:rtl/></w:rPr><w:tab/></w:r>';

/** Lays out one paragraph in a 400pt content box and returns its first line's spans. */
function spans(ppr: string, body: string, measurer: TextMeasurer = createFixedMeasurer(6, 12)) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${ppr}</w:pPr>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const laid = layoutSemanticDocument(read.part, 0, {
    measurer,
    geometry: { width: 400, height: 300, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  return linesOf(laid)[0]!.spans.map((span) => ({
    text: span.text,
    left: Math.round(span.box.x),
    right: Math.round(span.box.x + span.box.width),
  }));
}

const textSpans = (list: ReturnType<typeof spans>) =>
  list.filter((span) => span.text.trim() !== '');

describe('tabs in a right-to-left paragraph', () => {
  test('text before the tab stays at the leading (right) edge', () => {
    const [first, second] = textSpans(spans('<w:bidi/>', run('اسم') + tab + run('الكلية')));
    expect(first).toMatchObject({ text: 'اسم', right: 400 });
    // The default stop is 36pt from the leading margin; the next segment starts there.
    expect(second).toMatchObject({ text: 'الكلية', right: 400 - 36 });
  });

  test('an authored left stop counts from the right margin', () => {
    const [, second] = textSpans(
      spans(
        '<w:bidi/><w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs>',
        run('اسم') + tab + run('الكلية')
      )
    );
    expect(second!.right).toBe(400 - 144);
  });

  test('a right stop puts the trailing edge of the segment on the stop', () => {
    const [, second] = textSpans(
      spans(
        '<w:bidi/><w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs>',
        run('اسم') + tab + run('الكلية')
      )
    );
    expect(second!.left).toBe(400 - 216);
  });

  test('segments keep their logical order across two tabs', () => {
    const texts = textSpans(
      spans('<w:bidi/>', run('اسم') + tab + run('الكلية') + tab + run('القسم'))
    );
    expect(texts.map((span) => span.text)).toEqual(['اسم', 'الكلية', 'القسم']);
    expect(texts[0]!.left).toBeGreaterThan(texts[1]!.right - 1);
    expect(texts[1]!.left).toBeGreaterThan(texts[2]!.right - 1);
    expect(texts[2]!.right).toBe(400 - 72);
  });

  test('a hanging indent supplies a stop at the leading indent', () => {
    const tabbed = run('أ') + tab + run('الكلية');
    const [, hanging] = textSpans(spans('<w:bidi/><w:ind w:left="1080" w:hanging="360"/>', tabbed));
    expect(hanging!.right).toBe(400 - 54);
    // The trailing (left) indent is no stop.
    const [, trailing] = textSpans(
      spans('<w:bidi/><w:ind w:left="360" w:right="1080" w:hanging="360"/>', tabbed)
    );
    expect(trailing!.right).toBe(400 - 18);
  });

  test('a decimal stop puts the left edge of the point on the stop', () => {
    const decimal = '<w:bidi/><w:tabs><w:tab w:val="decimal" w:pos="2880"/></w:tabs>';
    const number = '<w:r><w:t>1234.5</w:t></w:r>';
    const [, digits] = textSpans(spans(decimal, run('أ') + tab + number));
    // `1234` lies left of the stop at 256, `.5` right of it (11pt text: 5.45pt a character).
    const char = (6 * 11) / 12;
    expect(digits).toMatchObject({
      left: Math.round(256 - 4 * char),
      right: Math.round(256 + 2 * char),
    });
    // With no point, the text ends on the stop, as at a right stop.
    const [, word] = textSpans(spans(decimal, run('أ') + tab + run('الكلية')));
    expect(word!.left).toBe(256);
  });

  test('a right stop measures a joined segment as a whole', () => {
    // A measurer where each letter alone is wider than the joined word, as with Arabic
    // isolated forms. The segment's trailing edge must still land on the stop.
    const fixed = createFixedMeasurer(6, 12);
    const joined: TextMeasurer = {
      ...fixed,
      measure: (text, style) => (text.length === 1 ? 10 : fixed.measure(text, style)),
    };
    const [, second] = textSpans(
      spans(
        '<w:bidi/><w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs>',
        run('اسم') + tab + run('الكلية'),
        joined
      )
    );
    expect(second!.left).toBe(400 - 216);
  });
});
