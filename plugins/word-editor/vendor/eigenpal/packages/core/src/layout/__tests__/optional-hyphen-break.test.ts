import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { spanOffsetX } from '../semantic-hit-test.ts';
import type { LineRecord, SemanticLayout, TextMeasurer } from '../semantic-records.ts';

// At 11pt every character is 6pt wide, so a measure of `chars` characters is `chars * 120`
// twips.
const SOFT = '|';
const SIZE = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const measurer = createFixedMeasurer(6, 14);

function runsOf(text: string): string {
  return text
    .split(SOFT)
    .map((part, index) => (index > 0 ? `<w:r>${SIZE}<w:softHyphen/></w:r>` : '') + textRun(part))
    .join('');
}

function textRun(text: string): string {
  return text ? `<w:r>${SIZE}<w:t xml:space="preserve">${text}</w:t></w:r>` : '';
}

function layoutOf(
  text: string,
  chars: number,
  jc?: string,
  using: TextMeasurer = measurer
): SemanticLayout {
  const width = Math.round(chars * 120);
  const justification =
    jc === 'bidi'
      ? '<w:pPr><w:bidi/></w:pPr>'
      : jc === 'bidi-both'
        ? '<w:pPr><w:bidi/><w:jc w:val="both"/></w:pPr>'
        : jc
          ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>`
          : '';
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p>${justification}${runsOf(text)}</w:p>` +
      `<w:sectPr><w:pgSz w:w="${width + 800}" w:h="6000"/>` +
      '<w:pgMar w:left="400" w:right="400" w:top="200" w:bottom="200"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  return layoutSemanticDocument(opened.part, 1, { measurer: using });
}

function paragraphOf(layout: SemanticLayout) {
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  return paragraph;
}

function layoutLines(text: string, chars: number, jc?: string): readonly LineRecord[] {
  const layout = layoutOf(text, chars, jc);
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  return paragraph.lines;
}

/** Each line as a reader sees it: a broken optional hyphen as `-`, any other one as nothing. */
function shown(lines: readonly LineRecord[]): string[] {
  return lines.map((line) =>
    line.spans
      .map((span) => (span.optionalHyphenBreak ? '-' : span.text.replaceAll('\u00ad', '')))
      .join('')
  );
}

test('a word that does not fit breaks after its optional hyphen and shows a hyphen', () => {
  const lines = layoutLines('xx aaaa|bbbb', 10);
  expect(shown(lines)).toEqual(['xx aaaa-', 'bbbb']);
  const hyphen = lines[0]!.spans.at(-1)!;
  // Still one model character, painted from U+00AD.
  expect(hyphen.text).toBe('\u00ad');
  expect(hyphen.range.end - hyphen.range.start).toBe(1);
  expect(hyphen.range.start).toBe(7);
  expect(hyphen.box.width).toBe(6);
  expect(spanOffsetX(hyphen, 7, measurer)).toBeCloseTo(hyphen.box.x, 6);
  expect(spanOffsetX(hyphen, 8, measurer)).toBeCloseTo(hyphen.box.x + 6, 6);
  expect(lines[1]!.spans[0]!.range.start).toBe(8);
});

test('an optional hyphen inside a line that fits shows nothing', () => {
  const lines = layoutLines('xx aaaa|bbbb', 12);
  expect(shown(lines)).toEqual(['xx aaaabbbb']);
  expect(lines[0]!.spans.some((span) => span.optionalHyphenBreak)).toBe(false);
});

test('the visible hyphen must fit, so the word moves and breaks on the next line', () => {
  expect(shown(layoutLines('xx aaaa|bbbb', 7.5))).toEqual(['xx ', 'aaaa-', 'bbbb']);
  expect(shown(layoutLines('xx aaaa|bbbb', 7))).toEqual(['xx ', 'aaaa-', 'bbbb']);
});

test('the line breaks at the last optional hyphen that fits', () => {
  expect(shown(layoutLines('xx aa|bb|cc|dd', 9.5))).toEqual(['xx aabb-', 'ccdd']);
  expect(shown(layoutLines('xx aa|bb|cc|dd', 7.5))).toEqual(['xx aa-', 'bbccdd']);
});

test('an optional hyphen after a space is a later break than the space', () => {
  expect(shown(layoutLines('xx aaaa |bbbbbb', 10))).toEqual(['xx aaaa -', 'bbbbbb']);
});

test('a space after an optional hyphen is the break, and the hyphen stays hidden', () => {
  expect(shown(layoutLines('xx aaaa| bbbbbb', 10))).toEqual(['xx aaaa ', 'bbbbbb']);
});

test('an oversized word still breaks at its optional hyphen', () => {
  expect(shown(layoutLines('aaaaaa|bbbbbb', 5))).toEqual(['aaaaa', 'a-', 'bbbbb', 'b']);
});

test('alignment places the visible hyphen at the right edge', () => {
  for (const jc of ['right', 'both']) {
    const lines = layoutLines('xx aaaa|bbbb yy', 10, jc);
    expect(shown(lines)).toEqual(['xx aaaa-', 'bbbb yy']);
    const hyphen = lines[0]!.spans.at(-1)!;
    expect(hyphen.box.x + hyphen.box.width).toBeCloseTo(lines[0]!.box.x + 60, 6);
  }
});

test('an optional hyphen that opens its line can end it with only the hyphen', () => {
  // Measured behavior: nothing before the hyphen still lets the line break after it.
  expect(shown(layoutLines('|bbbbbbbbbbbbbb', 5.5))).toEqual(['-', 'bbbbb', 'bbbbb', 'bbbb']);
  expect(shown(layoutLines('xxxxxxxxx |bbbbbbbbbbbbbb', 10.5))).toEqual([
    'xxxxxxxxx ',
    '-',
    'bbbbbbbbbb',
    'bbbb',
  ]);
});

test('adjacent optional hyphens show one hyphen and never a line of its own', () => {
  for (const chars of [10, 10.5]) {
    expect(shown(layoutLines('xx aaaaaa||bbbbbbbbbbbb', chars))).toEqual([
      'xx aaaaaa-',
      'bbbbbbbbbb',
      'bb',
    ]);
  }
  expect(shown(layoutLines('xx aaaaaa||bb', 10.5))).toEqual(['xx aaaaaa-', 'bb']);
});

test('a right-to-left line shows the hyphen at its left end and keeps visual order', () => {
  const lines = layoutLines('אא בבבב|גגגג', 8.5, 'bidi');
  expect(shown(lines)).toEqual(['אא בבבב-', 'גגגג']);
  const visual = (line: LineRecord) =>
    [...line.spans]
      .sort((a, b) => a.box.x - b.box.x)
      .map((span) => (span.optionalHyphenBreak ? '-' : span.text.trim()))
      .filter((text) => text.length > 0);
  // Read from the right: אא, then בבבב, then the hyphen at the line end on the left.
  expect(visual(lines[0]!)).toEqual(['-', 'בבבב', 'אא']);
  const hidden = layoutLines('אא בבבב|גגגג', 12, 'bidi');
  expect(shown(hidden)).toEqual(['אא בבבבגגגג']);
  // Without a break the hyphen draws nothing, and the word still reads right to left.
  expect(visual(hidden[0]!).filter((text) => text !== '\u00ad')).toEqual(['גגגג', 'בבבב', 'אא']);
});

test('a literal U+00AD in run text draws a measured hyphen and is not a break', () => {
  const text = (line: LineRecord) => line.spans.map((span) => span.text).join('');
  const width = (line: LineRecord) => line.spans.reduce((sum, span) => sum + span.box.width, 0);
  const lines = layoutLines('xx aaaa\u00adbbbb', 10);
  expect(lines.map(text)).toEqual(['xx ', 'aaaa\u00adbbbb']);
  expect(width(lines[1]!)).toBeCloseTo(54, 6);
  expect(lines.flatMap((line) => line.spans).some((span) => span.optionalHyphenBreak)).toBe(false);
  // Only a word too long for any line is cut, after the characters that fit.
  expect(layoutLines('xx aa\u00adbb\u00adcc\u00addd', 9.5).map(text)).toEqual([
    'xx ',
    'aa\u00adbb\u00adcc\u00ad',
    'dd',
  ]);
});

test('in a right-to-left line the caret before the visible hyphen is on its right', () => {
  const layout = layoutOf('אא בבבב|גגגג', 8.5, 'bidi');
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  const hyphen = paragraph.lines[0]!.spans.find((span) => span.optionalHyphenBreak)!;
  const paragraphId = hyphen.range.paragraphId;
  // Offset 7 is before the hyphen in reading order, so at its right edge.
  expect(caretAt(layout, { paragraphId, offset: 7 }, measurer)!.x).toBeCloseTo(
    hyphen.box.x + hyphen.box.width,
    6
  );
  expect(spanOffsetX(hyphen, 8, measurer)).toBeCloseTo(hyphen.box.x, 6);
});

test('a hyphen after digits in a right-to-left line stays with the digits', () => {
  const lines = layoutLines('אא 1234|5678', 8.5, 'bidi');
  expect(shown(lines)).toEqual(['אא 1234-', '5678']);
  const visual = [...lines[0]!.spans]
    .sort((a, b) => a.box.x - b.box.x)
    .map((span) => (span.optionalHyphenBreak ? '-' : span.text.trim()))
    .filter((text) => text.length > 0);
  // Measured: the digits read left to right, and the hyphen follows them.
  expect(visual).toEqual(['1234', '-', 'אא']);
});

test('letters join across an optional hyphen that draws nothing', () => {
  const spans = layoutLines('مرح|با', 20, 'bidi').flatMap((line) => line.spans);
  const before = spans.find((span) => span.text === 'مرح')!;
  const after = spans.find((span) => span.text === 'با')!;
  // The hyphen stays in the context; the shaper treats it as transparent.
  expect(before.style.shaping?.context?.after).toBe('\u00adبا');
  expect(after.style.shaping?.context?.before).toBe('مرح\u00ad');
});

test('letters do not join across an optional hyphen where the line breaks', () => {
  const lines = layoutLines('ا مرحمرح|بابا', 9.5, 'bidi');
  expect(shown(lines)).toEqual(['ا مرحمرح-', 'بابا']);
  const before = lines[0]!.spans.find((span) => span.text === 'مرحمرح')!;
  const after = lines[1]!.spans.find((span) => span.text === 'بابا')!;
  expect(before.style.shaping?.context?.after ?? '').toBe('');
  expect(after.style.shaping?.context?.before ?? '').toBe('');
});

test('the paragraph text keeps one character per optional hyphen', () => {
  const lines = layoutLines('xx aa|bb|cc|dd', 9.5);
  const spans = lines.flatMap((line) => line.spans);
  expect(spans.map((span) => span.text).join('')).toBe('xx aa\u00adbb\u00adcc\u00addd');
  expect(spans.at(-1)!.range.end).toBe(14);
});

// Unjoined Arabic forms are wider: 4pt more at an edge with no joining context.
const unjoinedWider: TextMeasurer = {
  ...measurer,
  measure(text, style) {
    let width = measurer.measure(text, style);
    const context = style.shaping?.context;
    if (style.shaping && /[\u0600-\u06ff]$/u.test(text) && !context?.after) width += 4;
    if (style.shaping && /^[\u0600-\u06ff]/u.test(text) && !context?.before) width += 4;
    return width;
  },
};

test('a break at an optional hyphen fits the unjoined letters on both lines', () => {
  const cases = [
    ['bidi', 'ا مرحمرح|بابا ب ب ب'],
    ['bidi', 'ا مرحمرح|بابا'],
    ['bidi-both', 'ا مرحمرح|بابا'],
  ] as const;
  for (const [jc, text] of cases) {
    for (const chars of [8, 9, 9.5, 10, 11]) {
      const lines = paragraphOf(layoutOf(text, chars, jc, unjoinedWider)).lines;
      for (const line of lines) {
        const ink = line.spans.filter((span) => span.box.width > 0 && span.text.trim() !== '');
        const right = Math.max(...ink.map((span) => span.box.x + span.box.width));
        const left = Math.min(...ink.map((span) => span.box.x));
        expect(left).toBeGreaterThanOrEqual(-0.01);
        expect(right).toBeLessThanOrEqual(chars * 6 + 0.01);
      }
      const broken = lines.find((line) => line.spans.some((span) => span.optionalHyphenBreak));
      if (!broken) continue;
      // The letters on each side of the break are laid out without joining across it.
      const before = broken.spans.find((span) => span.text === 'مرحمرح')!;
      expect(before.style.shaping?.context?.after ?? '').toBe('');
      const next = lines[lines.indexOf(broken) + 1]!;
      expect(next.spans[0]!.style.shaping?.context?.before ?? '').toBe('');
    }
  }
});

test('a cut word opening the line after a hyphen break fits at its unjoined width', () => {
  const lines = paragraphOf(layoutOf('مرح|بببببببب ب', 400 / 120, 'bidi', unjoinedWider)).lines;
  const broken = lines.findIndex((line) => line.spans.some((span) => span.optionalHyphenBreak));
  expect(broken).toBeGreaterThanOrEqual(0);
  const opening = lines[broken + 1]!.spans[0]!;
  // The first piece of the cut word no longer joins back across the hyphen, and fits.
  expect(opening.style.shaping?.context?.before ?? '').toBe('');
  expect(opening.box.width).toBeLessThanOrEqual(20 + 0.01);
  // A later piece is inside the word, so it keeps the word's own context.
  const later = lines[broken + 2]!.spans[0]!;
  expect(later.style.shaping?.context?.before ?? '').not.toBe('');
});
