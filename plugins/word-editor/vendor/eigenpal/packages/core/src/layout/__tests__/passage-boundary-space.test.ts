import { expect, test } from 'bun:test';
import { alignBidiPassageSpans, alignPassageSpans } from '../passage-alignment.ts';
import type { StyleSpanRecord } from '../semantic-records.ts';

// A right-to-left word itemizes the space after it as a span of its own. When the pen stepped
// over a float right after that word, the space landed at the start of the next passage.
const span = (
  text: string,
  x: number,
  width: number,
  extra: Partial<StyleSpanRecord> = {}
): StyleSpanRecord =>
  ({
    text,
    range: { start: 0, end: text.length },
    props: [],
    style: {},
    box: { x, y: 0, width, height: 12 },
    ...extra,
  }) as unknown as StyleSpanRecord;

const PASSAGES = [
  { start: 0, end: 100 },
  { start: 180, end: 300 },
];

// The left part holds "aa " and a right-to-left word in visual order (x 40..80); the space
// after that word jumped the float to x 180; "bb " and "cc" follow it.
const line = () => [
  span('aa ', 0, 30),
  span('word', 40, 40, { style: { shaping: { direction: 'rtl' } } } as Partial<StyleSpanRecord>),
  span(' ', 180, 10, { wrapAdvanceBefore: 100 }),
  span('bb ', 190, 30),
  span('cc', 220, 20),
];

/** Record each part, then leave it where the pen placed it. */
function recordParts(align: typeof alignPassageSpans) {
  const parts: { texts: string[]; start: number; firstX: number }[] = [];
  const aligned = align(line(), PASSAGES, (part, passage) => {
    parts.push({ texts: part.map((s) => s.text), start: passage.start, firstX: part[0]!.box.x });
    return part;
  });
  return { parts, aligned };
}

for (const [name, align] of [
  ['ordinary', alignPassageSpans],
  ['bidi', alignBidiPassageSpans],
] as const) {
  test(`a space split off before a float ends the passage before it (${name} lines)`, () => {
    const { parts, aligned } = recordParts(align);
    expect(parts.map((part) => part.texts)).toEqual([
      ['aa ', 'word', ' '],
      ['bb ', 'cc'],
    ]);
    // The space follows the rightmost edge of the left part, and the right part opens its
    // passage at the float edge.
    expect(aligned!.find((s) => s.text === ' ')!.box.x).toBe(80);
    expect(parts[1]!.firstX).toBe(180);
    expect(aligned!.find((s) => s.text === 'cc')!.box.x).toBe(210);
  });
}

test('a space inside the next passage text stays there', () => {
  // The span before the float already ends in a space, so the split space is authored text of
  // the later passage, and it keeps its place.
  const spans = [
    span('aa ', 0, 30),
    span(' ', 180, 10, { wrapAdvanceBefore: 150 }),
    span('bb', 190, 20),
  ];
  const parts: string[][] = [];
  alignPassageSpans(spans, PASSAGES, (part) => {
    parts.push(part.map((s) => s.text));
    return part;
  });
  expect(parts).toEqual([['aa '], [' ', 'bb']]);
});
