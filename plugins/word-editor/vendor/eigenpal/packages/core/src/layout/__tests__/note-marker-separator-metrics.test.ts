import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutNoteSeparator, noteSeparatorAreaBox } from '../note-layout.ts';
import { noteMarksCacheToken } from '../note-projection.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text) => text.length * 5,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};
const marker = (size = 24) => `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:separator/></w:r>`;
function part(body: string, kind = 'separator') {
  const parsed = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:type="${kind}" w:id="-1">${body}</w:footnote></w:footnotes>`,
    {
      name: '/word/footnotes.xml',
      contentType: 'app/xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const options = { measurer, producer: 'marker-test' };

test('a marker reserves its authored run metrics and preserves paragraph spacing', () => {
  const source = part(
    `<w:p><w:pPr><w:spacing w:before="100" w:after="140"/></w:pPr>${marker(40)}</w:p>`
  );
  const before = serializeOoxmlPart(source);
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote');
  expect(result.flowHeight).toBe(32);
  expect(result.ruleBox).toEqual({ x: 0, y: 16, width: 144, height: 0.5 });
  expect(result.fragments).toEqual([]);
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('leading empty paragraphs move the marker rather than painting a line in the first paragraph', () => {
  const source = part(`<w:p/><w:p>${marker()}</w:p>`);
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote');
  expect(result.flowHeight).toBe(22);
  expect(result.ruleBox!.y).toBeCloseTo(16.6, 6);
});

test('marker rules honor paragraph alignment and continuation width', () => {
  const source = part(
    `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="200" w:right="400"/></w:pPr>${marker()}</w:p>`
  );
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote');
  expect(result.ruleBox!.x).toBe(123);
  const continuation = layoutNoteSeparator(
    part(
      `<w:p>${marker().replace('<w:separator/>', '<w:continuationSeparator/>')}</w:p>`,
      'continuationSeparator'
    ),
    'continuationSeparator',
    300,
    options,
    'footnote'
  );
  expect(continuation.ruleBox!.width).toBe(300);
  expect(noteSeparatorAreaBox(result, 72, 400, 500)).toEqual({
    ...result.ruleBox!,
    x: 195,
    y: 506.6,
  });
});

test('marker height uses the same safety cap as an authored separator story', () => {
  const source = part(`<w:p>${marker(400)}</w:p>`);
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote', 30);
  expect(result.synthetic).toBe(true);
  expect(result.fallbackReason).toBe('note-separator-height-cap');
  expect(result.flowHeight).toBe(6);
});

test('marker measurement has its own cache identity and is stable on warm layouts', () => {
  const context = { marks: new Map<string, string | null>(), activeNoteKey: 'footnote:-1' };
  expect(noteMarksCacheToken(context)).not.toBe(
    noteMarksCacheToken({ ...context, measureSeparatorMarkers: true })
  );
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const source = part(`<w:p>${marker(40)}</w:p>`);
  const first = layoutNoteSeparator(source, 'separator', 400, { ...options, cache }, 'footnote');
  expect(layoutNoteSeparator(source, 'separator', 400, { ...options, cache }, 'footnote')).toEqual(
    first
  );
});

test('marker rules retain the resolved run color', () => {
  const source = part(
    '<w:p><w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:separator/></w:r></w:p>'
  );
  expect(layoutNoteSeparator(source, 'separator', 400, options, 'footnote').ruleColor).toBe(
    'C00000'
  );
});

test('multiple marker paragraphs retain every rule and color', () => {
  const source = part(
    `<w:p>${marker()}</w:p><w:p><w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:separator/></w:r></w:p>`
  );
  const before = serializeOoxmlPart(source);
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote');
  expect(result.ruleStyle).toBeUndefined();
  const spans = result.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
  );
  expect(spans.filter((span) => span.noteSeparator).map((span) => span.box.width)).toEqual([
    144, 144,
  ]);
  expect(spans[1]!.style.color).toBe('C00000');
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('mixed text and markers reserve actual rule advances without replacing source text', () => {
  const source = part(
    `<w:p><w:r><w:t>Before</w:t></w:r>${marker()}<w:r><w:t>After</w:t></w:r>${marker()}</w:p>`
  );
  const before = serializeOoxmlPart(source);
  const result = layoutNoteSeparator(source, 'separator', 400, options, 'footnote');
  expect(result.ruleStyle).toBeUndefined();
  const paragraph = result.fragments[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected a paragraph');
  expect(paragraph.lines).toHaveLength(1);
  const spans = paragraph.lines[0]!.spans;
  expect(spans.map((span) => span.text)).toEqual(['Before', '\uFFFC', 'After', '\uFFFC']);
  expect(spans.map((span) => span.box.x)).toEqual([0, 30, 174, 199]);
  expect(spans.map((span) => span.range.end - span.range.start)).toEqual([6, 1, 5, 1]);
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('the marker element controls width independently of the note type', () => {
  const source = part(`<w:p>${marker()}</w:p>`, 'continuationSeparator');
  expect(
    layoutNoteSeparator(source, 'continuationSeparator', 300, options, 'footnote').ruleBox!.width
  ).toBe(144);
  const full = part(
    `<w:p>${marker().replace('<w:separator/>', '<w:continuationSeparator/>')}</w:p>`
  );
  expect(layoutNoteSeparator(full, 'separator', 300, options, 'footnote').ruleBox!.width).toBe(300);
});

test('markers wrap as atoms and fit narrow story bands', () => {
  const source = part(`<w:p>${marker()}${marker()}</w:p>`);
  const result = layoutNoteSeparator(source, 'separator', 100, options, 'footnote');
  const paragraph = result.fragments[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected a paragraph');
  expect(paragraph.lines).toHaveLength(2);
  expect(paragraph.lines.map((line) => line.spans[0]!.box.width)).toEqual([100, 100]);
  expect(paragraph.lines.map((line) => line.spans[0]!.range.start)).toEqual([0, 1]);
});

for (const [name, body] of [
  ['empty story', ''],
  ['empty paragraph', '<w:p/>'],
  ['hidden marker', '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:separator/></w:r></w:p>'],
  [
    'deleted marker',
    '<w:p><w:del w:id="1" w:author="Author"><w:r><w:separator/></w:r></w:del></w:p>',
  ],
]) {
  test(`an authored ${name} does not acquire a synthetic separator rule`, () => {
    const source = part(body!);
    const before = serializeOoxmlPart(source);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const opts = { ...options, cache, displayMode: 'proposed' as const };
    const result = layoutNoteSeparator(source, 'separator', 400, opts, 'footnote');
    expect(result.synthetic).toBe(false);
    expect(result.ruleStyle).toBeUndefined();
    expect(result.ruleBox).toBeUndefined();
    expect(
      result.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.filter((span) => span.noteSeparator))
          : []
      )
    ).toEqual([]);
    expect(layoutNoteSeparator(source, 'separator', 400, opts, 'footnote')).toEqual(result);
    expect(serializeOoxmlPart(source)).toBe(before);
    if (body === '') expect(result.flowHeight).toBe(0);
  });
}

test('a missing separator story retains the default rule', () => {
  const result = layoutNoteSeparator(null, 'separator', 400, options, 'footnote');
  expect(result.synthetic).toBe(true);
  expect(result.ruleStyle).toBe('single');
  expect(noteSeparatorAreaBox(result, 72, 400, 500).width).toBe(144);
});
