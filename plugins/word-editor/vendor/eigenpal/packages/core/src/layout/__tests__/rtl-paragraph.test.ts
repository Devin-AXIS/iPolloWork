import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { paragraphAlignment } from '../paragraph-flow.ts';
import { jcValueForAlignment } from '../paragraph-alignment.ts';
import { spanOffsetX, hitTestPage, lineEndOffset } from '../semantic-hit-test.ts';
import { paragraphIsRtl, reorderBidiSpans } from '../rtl-paragraph.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}
const measurer = createFixedMeasurer(6, 14);
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
function layout(text: string, pPr = '', table = false, width = 120, rPr = '') {
  const paragraph = `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body>${table ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>` : paragraph}<w:sectPr><w:pgSz w:w="${width * 20 + 600}" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`
    ),
    0,
    {
      measurer,
      styleCascade: buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:bidi/></w:pPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      ),
    }
  );
}

const bidiJc = (val: string) => [{ localName: 'bidi' }, { localName: 'jc', attributes: { val } }];

test('inherited bidi gives logical start alignment and permits an explicit off override', () => {
  expect(paragraphIsRtl([{ localName: 'bidi' }])).toBe(true);
  expect(
    paragraphIsRtl([{ localName: 'bidi' }, { localName: 'bidi', attributes: { val: 'off' } }])
  ).toBe(false);
  expect(paragraphAlignment([{ localName: 'bidi' }])).toBe('right');
  expect(
    paragraphAlignment([{ localName: 'jc', attributes: { val: 'start' } }, { localName: 'bidi' }])
  ).toBe('right');
  expect(
    paragraphAlignment([{ localName: 'bidi' }, { localName: 'jc', attributes: { val: 'end' } }])
  ).toBe('left');
  // Word 16 reads `left`/`right` as the leading and trailing edges of a bidi paragraph.
  expect(paragraphAlignment(bidiJc('left'))).toBe('right');
  expect(paragraphAlignment(bidiJc('right'))).toBe('left');
  expect(paragraphAlignment(bidiJc('lowKashida'))).toBe('both');
  expect(paragraphAlignment([{ localName: 'jc', attributes: { val: 'left' } }])).toBe('left');
  expect(linesOf(layout('abc', '<w:bidi w:val="0"/>'))[0]!.contentX).toBe(0);
});

test('a physical alignment request is spelled per paragraph direction', () => {
  expect(jcValueForAlignment('right', true)).toBe('left');
  expect(jcValueForAlignment('left', true)).toBe('right');
  expect(jcValueForAlignment('right', false)).toBe('right');
  expect(jcValueForAlignment('justify', true)).toBe('both');
  for (const align of ['left', 'right', 'center', 'both'] as const) {
    const val = jcValueForAlignment(align, true);
    expect(paragraphAlignment(bidiJc(val))).toBe(align);
  }
});

test.each([false, true])(
  'RTL words use descending positions in body/table=%s without reversing text or numbers',
  (table) => {
    const lines = linesOf(layout('مرحبا عالم 123', '', table));
    const line = lines.find((l) => l.spans.some((s) => s.text.includes('مرحبا')))!;
    const first = line.spans.find((s) => s.text.includes('مرحبا'))!;
    const last = line.spans.find((s) => s.text.includes('123'))!;
    expect(first.box.x).toBeGreaterThan(last.box.x);
    expect(first.style.shaping?.direction).toBe('rtl');
    expect(last.style.shaping?.direction).toBe('ltr');
    expect(line.spans.map((s) => s.text).join('')).toBe('مرحبا عالم 123');
    expect(spanOffsetX(first, first.range.start, measurer)).toBe(first.box.x + first.box.width);
    expect(spanOffsetX(first, first.range.end, measurer)).toBeCloseTo(first.box.x);
  }
);

test('wrapping retains logical offsets and right-aligned final line', () => {
  const text = 'مرحبا عالم '.repeat(12).trim();
  const lines = linesOf(layout(text));
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.flatMap((l) => l.spans.map((s) => s.text)).join('')).toBe(text);
  const last = lines.at(-1)!;
  expect(Math.max(...last.spans.map((s) => s.box.x + s.box.width))).toBeCloseTo(120);
  for (const line of lines) {
    const positions = line.spans.filter((s) => s.box.width > 0).map((s) => s.box.x);
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
  }
});

test('paint keeps DOM text in logical order and places bidi runs at published geometry', () => {
  const result = layout('مرحبا عالم 123');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const line = linesOf(result)[0]!;
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(elements.map((el) => el.textContent).join('')).toBe('مرحبا عالم 123');
  let advance = 0;
  for (const [index, span] of line.spans.entries()) {
    const el = elements[index]!;
    expect(el.style.direction).toBe(span.style.shaping?.direction ?? 'ltr');
    expect(parseFloat(el.style.left) + advance + line.contentX).toBeCloseTo(span.box.x);
    advance += span.box.width;
  }
});

test('wrapped Latin trailing spaces stay at the right of their text', () => {
  const lines = linesOf(layout('אבג abc def ghi jkl mno pqr stu'));
  for (const line of lines.slice(0, -1)) {
    const last = line.spans.at(-1)!;
    expect(last.text.trim()).toBe('');
    expect(last.style.shaping?.direction).toBe('ltr');
    const textEnd = Math.max(...line.spans.slice(0, -1).map((span) => span.box.x + span.box.width));
    expect(last.box.x).toBeCloseTo(textEnd, 6);
  }
});

test('first-line indent applies at the RTL start edge', () => {
  const line = linesOf(layout('مرحبا عالم', '<w:ind w:firstLine="240"/>'))[0]!;
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(108);
});

test('the final justified RTL line aligns to the right', () => {
  const line = linesOf(layout('مرحبا', '<w:jc w:val="both"/>'))[0]!;
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(120);
});

test('RTL words cannot consume the fixed gap around a floating object', () => {
  const source = linesOf(layout('مرحبا'))[0]!.spans[0]!;
  const spans = [
    { ...source, text: 'A', box: { ...source.box, x: 0, width: 30 } },
    { ...source, text: 'B', box: { ...source.box, x: 30, width: 20 } },
    { ...source, text: 'C', box: { ...source.box, x: 100, width: 20 }, wrapAdvanceBefore: 50 },
  ];
  const reordered = reorderBidiSpans(spans);
  for (const span of reordered) {
    expect(span.box.x + span.box.width <= 50 || span.box.x >= 100).toBe(true);
  }
  expect(reordered.map((span) => span.box.width)).toEqual([30, 20, 20]);
});

test('clicking beyond a wrapped RTL line lands after its trailing space on that line', () => {
  const result = layout('مرحبا عالم '.repeat(12));
  const line = linesOf(result)[0]!;
  const hit = hitTestPage(
    result,
    0,
    { x: line.contentX - 20, y: line.box.y + line.box.height / 2 },
    { measurer }
  );
  expect(hit?.lineId).toBe(line.id);
  expect(hit?.position.offset).toBe(lineEndOffset(result, line));
  expect(hit?.position.offset).toBe(line.range.end);
  expect(hit?.caret.lineId).toBe(line.id);
});

test('bidi itemization does not add breaks at nonbreaking spaces', () => {
  const lines = linesOf(layout('אב אבג\u00a0דהו', '', false, 50));
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'אב ',
    'אבג\u00a0דהו',
  ]);
});

test('logical RTL indents apply to the inherited leading and trailing sides', () => {
  const result = layout('مرحبا', '<w:ind w:start="720" w:end="240"/>');
  const line = linesOf(result)[0]!;
  expect(line.box.x).toBe(12);
  expect(line.box.width).toBe(72);
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(84);
  // `w:left` is the transitional spelling of `w:start`: the leading (right) side here.
  const transitional = linesOf(layout('مرحبا', '<w:ind w:left="240" w:right="480"/>'))[0]!;
  expect(transitional.box.x).toBe(24);
  expect(Math.max(...transitional.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(
    108
  );
});

test('justified RTL spans stretch authored spaces in the native text band', () => {
  const result = layout('مرحبا عالم '.repeat(8), '<w:jc w:val="both"/>', false, 120, '<w:rtl/>');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const line = linesOf(result)[0]!;
  const elements = Array.from(
    host.querySelectorAll<HTMLElement>('.docx-line')
  )[0]!.querySelectorAll<HTMLElement>('.layout-run-text');
  expect(line.spans.some((span) => (span.style.shaping?.wordSpacingPt ?? 0) > 0)).toBe(true);
  for (const [index, span] of line.spans.entries()) {
    if (!span.style.shaping?.wordSpacingPt) continue;
    expect(parseFloat(elements[index]!.style.wordSpacing)).toBeCloseTo(
      span.style.shaping.wordSpacingPt
    );
  }
});

test('scaled RTL ink preserves the published outer band width', () => {
  const result = layout('مرحبا', '', false, 120, '<w:w w:val="200"/>');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const span = linesOf(result)[0]!.spans[0]!;
  const outer = host.querySelector<HTMLElement>('.layout-run-text')!;
  expect(outer.style.transform).toBe('');
  expect(parseFloat(outer.style.width)).toBeCloseTo(span.box.width);
  const ink = outer.querySelector<HTMLElement>('[data-docx-clipped-fill]')!;
  expect(ink.style.transform).toBe('scaleX(2)');
  expect(ink.style.transformOrigin).toBe('right');
  expect(parseFloat(ink.style.width) * 2).toBeCloseTo(span.box.width);
});

// Word PDF controls: /tmp/docx-word-compare/word-followup-numeric-bidi-reference.pdf.
// Each label is a separate paragraph. Expected orders come from physical word bounds.
test.each([
  ['1 980', ['1', '980'], ['980', '1']],
  ['1 980 200', ['1', '980', '200'], ['200', '980', '1']],
  ['١ ٩٨٠', ['٩٨٠', '١'], ['٩٨٠', '١']],
  ['(1 980)', ['1', '980'], ['980', '1']],
  ['العربية 1 980', ['980', '1'], ['980', '1']],
  ['1 980 العربية', ['1', '980'], ['980', '1']],
])('numeric groups match Word physical order for %s', (text, ordinaryOrder, rtlOrder) => {
  for (const rPr of ['', '<w:rtl/>', '<w:rtl w:val="0"/>']) {
    const line = linesOf(layout(text, '<w:jc w:val="both"/>', false, 180, rPr))[0]!;
    const groups = Array.from(text.matchAll(/[0-9\u0660-\u0669]+/gu)).map((match) => {
      const start = match.index;
      const end = start + match[0].length;
      const source = line.spans.find((span) => span.range.start <= start && span.range.end >= end)!;
      return { text: match[0], x: spanOffsetX(source, start, measurer) };
    });
    expect(groups.sort((a, b) => a.x - b.x).map((group) => group.text)).toEqual(
      rPr === '<w:rtl/>' ? rtlOrder : ordinaryOrder
    );
    expect(line.spans.map((span) => span.text).join('')).toBe(text);
    expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(180);
    if (text === '1 980 العربية') {
      const arabic = line.spans.find((span) => span.text.includes('العربية'))!;
      const numeric = line.spans.find((span) => span.text.includes('980'))!;
      expect(arabic.box.x > numeric.box.x).toBe(rPr !== '<w:rtl/>');
    }
  }
});

test.each([false, true])(
  'grouped numeric text keeps ascending caret offsets in body/table=%s',
  (table) => {
    const result = layout('1 980', '<w:jc w:val="both"/>', table);
    const line = linesOf(result)[0]!;
    const positions = Array.from({ length: 6 }, (_, offset) => {
      const span = line.spans.find(
        (candidate) => candidate.range.start <= offset && candidate.range.end >= offset
      )!;
      return spanOffsetX(span, offset, measurer);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (let offset = 0; offset < 5; offset++) {
      const hit = hitTestPage(
        result,
        0,
        { x: positions[offset]! + 1, y: line.box.y + line.box.height / 2 },
        { measurer }
      );
      expect(hit?.position.offset).toBe(offset);
    }
  }
);

test.each([
  [
    [
      ['1', ''],
      [' ', ''],
      ['980', ''],
    ],
    ['1', '980'],
    undefined,
  ],
  [
    [
      ['1 980', ''],
      [' العربية', '<w:rtl/>'],
    ],
    ['1', '980'],
    'left',
  ],
  [
    [
      ['1 980', '<w:rtl w:val="0"/>'],
      [' العربية', '<w:rtl/>'],
    ],
    ['1', '980'],
    'left',
  ],
  [
    [
      ['العربية ', '<w:rtl/>'],
      ['1 980', ''],
    ],
    ['1', '980'],
    'right',
  ],
  [
    [
      ['1', ''],
      [' ', '<w:rtl/>'],
      ['980', ''],
    ],
    ['980', '1'],
    undefined,
  ],
  [
    [
      ['1', '<w:rtl/>'],
      [' ', '<w:rtl w:val="0"/>'],
      ['980', '<w:rtl/>'],
    ],
    ['980', '1'],
    undefined,
  ],
] as const)(
  'run direction boundaries keep numeric units in Word order: %j',
  (runs, expected, arabicSide) => {
    const text = runs.map(([text]) => text).join('');
    const xml = runs
      .map(
        ([text, properties]) =>
          `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`
      )
      .join('');
    const result = layoutSemanticDocument(
      part(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/><w:jc w:val="both"/></w:pPr>${xml}</w:p></w:body></w:document>`
      ),
      0,
      { measurer }
    );
    const line = linesOf(result)[0]!;
    const positions = [...text.matchAll(/[0-9]+/gu)].map((match) => {
      const span = line.spans.find(
        (span) => span.range.start <= match.index && span.range.end >= match.index + match[0].length
      )!;
      return { text: match[0], x: spanOffsetX(span, match.index, measurer) };
    });
    expect(positions.sort((a, b) => a.x - b.x).map((group) => group.text)).toEqual([...expected]);
    expect(line.spans.map((span) => span.text).join('')).toBe(text);
    if (arabicSide) {
      const arabic = line.spans.find((span) => span.text.includes('العربية'))!;
      expect(arabic.box.x < positions[0]!.x).toBe(arabicSide === 'left');
    }
  }
);

test.each(['', '<w:rtl w:val="0"/>'])(
  'unmarked Arabic punctuation retains its LTR run context: %s',
  (rPr) => {
    const line = linesOf(layout('العربية.', '', false, 120, rPr))[0]!;
    const period = line.spans.find((span) => span.text === '.')!;
    const arabic = line.spans.find((span) => span.text.includes('العربية'))!;
    expect(period.box.x).toBeGreaterThan(arabic.box.x);
    expect(period.style.shaping?.direction).toBe('ltr');
    expect(arabic.style.shaping?.direction).toBe('rtl');
  }
);

test('explicit run direction uses the final inherited property and resets across manual breaks', () => {
  const line = linesOf(layout('1 980', '', false, 120, '<w:rtl/><w:rtl w:val="0"/>'))[0]!;
  expect(line.spans.find((span) => span.text.includes('1'))!.box.x).toBeLessThan(
    line.spans.find((span) => span.text.includes('980'))!.box.x
  );
  const result = layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>1 980</w:t><w:br/><w:t>2 409</w:t></w:r></w:p></w:body></w:document>`
    ),
    0,
    { measurer }
  );
  const lines = linesOf(result);
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    const digits = line.spans.filter((span) => /[0-9]/u.test(span.text));
    expect(digits.map((span) => span.box.x)).toEqual(
      digits.map((span) => span.box.x).sort((a, b) => a - b)
    );
  }
});

test('authored Unicode controls keep the paragraph policy after wrapping beyond their source position', () => {
  const text = '\u202bאבג 1 980 abc def ghi jkl mno pqr\u202c';
  const result = layout(text, '', false, 90);
  const lines = linesOf(result);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.flatMap((line) => line.spans.map((span) => span.text)).join('')).toBe(text);
  for (const line of lines) {
    for (const span of line.spans) expect(span.style.shaping?.runDirection).toBeUndefined();
  }
});

test.each(['', '<w:rtl/>', '<w:rtl w:val="0"/>'])(
  'mixed Hebrew follows the authored run context: %s',
  (rPr) => {
    const line = linesOf(layout('אבג ABC דהו', '', false, 120, rPr))[0]!;
    const first = line.spans.find((span) => span.text.includes('אבג'))!;
    const latin = line.spans.find((span) => span.text.includes('ABC'))!;
    const last = line.spans.find((span) => span.text.includes('דהו'))!;
    expect(first.box.x < latin.box.x).toBe(rPr !== '<w:rtl/>');
    expect(last.box.x > latin.box.x).toBe(rPr !== '<w:rtl/>');
  }
);
