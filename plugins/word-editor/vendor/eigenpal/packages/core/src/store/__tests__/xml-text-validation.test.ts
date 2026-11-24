import { expect, test } from 'bun:test';
import { escapeXmlAttributeChecked, escapeXmlChecked, isValidXmlText } from '../package/sinks.ts';

test('XML text validation covers every code point in the XML 1.0 character production', () => {
  const mismatches: number[] = [];
  let mismatchCount = 0;
  for (let point = 0; point <= 0x10ffff; point++) {
    const allowed =
      point === 0x9 ||
      point === 0xa ||
      point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      point >= 0x10000;
    if (isValidXmlText(String.fromCodePoint(point)) !== allowed) {
      mismatchCount++;
      if (mismatches.length < 16) mismatches.push(point);
    }
  }
  expect(mismatches).toEqual([]);
  expect(mismatchCount).toBe(0);
});

test('XML text validation rejects malformed surrogate sequences without consuming adjacent text', () => {
  for (const high of ['\ud800', '\udbff'])
    for (const low of ['\udc00', '\udfff']) {
      const pair = high + low;
      for (const valid of ['', pair, pair + pair, `A${pair}B`, '\t\r\n'])
        expect(isValidXmlText(valid)).toBe(true);
      for (const invalid of [
        high,
        low,
        high + high,
        low + high,
        low + low,
        high + 'A' + low,
        high + pair,
        pair + low,
        pair + high,
        pair + '\u0000',
      ]) {
        for (const prefix of ['', 'A', pair, 'A'.repeat(16384)]) {
          expect(isValidXmlText(prefix + invalid)).toBe(false);
          expect(isValidXmlText(prefix + invalid + pair)).toBe(false);
        }
      }
    }
});

test('XML checks reject non-string scalars without coercion and retain checked escaping', () => {
  const object = {
    toString() {
      throw Error('Validation must not coerce objects');
    },
  };
  for (const value of [undefined, null, true, 1, [], object, new String('valid')])
    expect(isValidXmlText(value as string)).toBe(false);
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(isValidXmlText('valid')).toBe(true);
    expect(isValidXmlText('\ufffe')).toBe(false);
    expect(isValidXmlText('\u{10ffff}')).toBe(true);
  }
  const value = `\u{10000}<&"'\r\n\t`;
  expect(escapeXmlChecked(value, 'text')).toBe(`\u{10000}&lt;&amp;&quot;&apos;&#xD;\n\t`);
  expect(escapeXmlAttributeChecked(value, 'attribute')).toBe(
    '\u{10000}&lt;&amp;&quot;&apos;&#xD;&#xA;&#x9;'
  );
  for (const invalid of ['\u0000', '\uffff', '\ud800', '\udfff']) {
    expect(() => escapeXmlChecked(invalid, 'text')).toThrow('not valid in XML 1.0');
    expect(() => escapeXmlAttributeChecked(invalid, 'attribute')).toThrow('not valid in XML 1.0');
  }
});
