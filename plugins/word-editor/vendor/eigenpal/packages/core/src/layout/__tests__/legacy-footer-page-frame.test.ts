import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const frame =
  '<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="center" w:y="1"/>';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
const body = `<w:p><w:pPr><w:pStyle w:val="Footer"/>${frame}</w:pPr>${field}</w:p><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>`;
const measurer = createFixedMeasurer(6, 14);

function partOf(content = body, header = false) {
  const kind = header ? 'header' : 'footer';
  const root = header ? 'hdr' : 'ftr';
  const parsed = readOoxmlPart(`<w:${root} xmlns:w="${WML_NAMESPACE_URI}">${content}</w:${root}>`, {
    name: `/word/${kind}1.xml`,
    contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function documentOf(story: ReturnType<typeof layoutHeaderFooterStory>): SemanticLayout {
  return {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 544, height: 792 },
        contentBox: { x: 72, y: 72, width: 400, height: 648 },
        fragments: [],
        footer: {
          kind: 'footer',
          variant: 'default',
          partName: story.partName,
          part: story.part,
          box: { x: 72, y: 730, width: 400, height: story.flowHeight },
          fragments: story.fragments,
        },
      },
    ],
  } as SemanticLayout;
}

test('centers the legacy PAGE frame without charging its empty anchor paragraph twice', () => {
  const part = partOf();
  const before = serializeOoxmlPart(part);
  const story = layoutHeaderFooterStory(part, 400, measurer, 'test');
  expect(story.fragments).toHaveLength(2);
  const first = story.fragments[0]!;
  const second = story.fragments[1]!;
  if (first.kind !== 'paragraph' || second.kind !== 'paragraph')
    throw new Error('paragraphs required');
  expect(story.flowHeight).toBeCloseTo(first.box.height + 0.05, 3);
  expect(first.alignment).toBe('center');
  const span = first.lines[0]!.spans[0]!;
  expect(span.box.x + span.box.width / 2).toBeCloseTo(200, 4);
  expect(first.lines[0]!.contentX).toBe(span.box.x);
  expect(second.box.y).toBeCloseTo(0, 4);
  expect(first.paragraphId).not.toBe(second.paragraphId);
  expect(story.part).toBe(part);
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('re-evaluates and re-centers multi-digit PAGE results per page', () => {
  const story = layoutHeaderFooterStory(partOf(), 400, measurer, 'test');
  for (const pageNumber of [1, 12, 123]) {
    const projected = story.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    const paragraph = projected.fragments[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('paragraph required');
    const spans = paragraph.lines[0]!.spans;
    expect(spans.map((span) => span.text).join('')).toBe(String(pageNumber));
    expect(spans[0]!.box.x + spans.reduce((sum, span) => sum + span.box.width, 0) / 2).toBeCloseTo(
      200,
      4
    );
    expect(projected.flowHeight).toBeCloseTo(story.flowHeight, 4);
  }
});

/** The general story frame lane places the number out of flow, beside the anchor's text. */
function expectPlacedBeside(content: string): void {
  const [first, second] = layoutHeaderFooterStory(
    partOf(content),
    400,
    measurer,
    'beside'
  ).fragments;
  if (first?.kind !== 'paragraph' || second?.kind !== 'paragraph')
    throw new Error('paragraphs required');
  expect(first.outOfFlow).toBe(true);
  expect(second.box.y).toBe(0);
}

test('leaves other frame structures in ordinary flow', () => {
  const samples = [
    body.replace('w:y="1"', 'w:y="200"'),
    body.replace('w:y="1"', 'w:y="1" w:w="200"'),
    body.replace(' PAGE ', ' NUMPAGES '),
    body.replace(' PAGE ', ' PAGEREF anchor '),
    body.replace('<w:t>1</w:t>', '<w:t>Page 1</w:t>'),
    body.replace(frame, frame + '<w:spacing w:after="200"/>'),
    body.replace(frame, frame + frame),
    body.replace('w:xAlign="center"', 'xAlign="center"'),
    body.replace('<w:t>1</w:t>', '<w:t>' + '1'.repeat(257) + '</w:t>'),
  ];
  for (const content of samples) {
    const story = layoutHeaderFooterStory(partOf(content), 400, measurer, 'test');
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
  // A number that stays clear of the anchor's text takes the general story frame lane.
  expectPlacedBeside(body.replace('w:xAlign="center"', 'w:xAlign="left"'));
  expectPlacedBeside(
    body.replace('</w:pPr></w:p>', '</w:pPr><w:r><w:t>not empty</w:t></w:r></w:p>')
  );
  // A header takes the header frame lane, not this footer lane.
  const header = layoutHeaderFooterStory(partOf(body, true), 400, measurer, 'test');
  expect(header.fragments[1]!.box.y).toBe(0);
  expect(header.fragments[0]!.box.y).toBeCloseTo(0.05, 6);
});

test('centers PAGE over a middle-dot anchor without moving or merging its text', () => {
  const decorated = body.replace(
    '</w:pPr></w:p>',
    '<w:jc w:val="center"/><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">·   ·</w:t></w:r></w:p>'
  );
  const part = partOf(decorated),
    before = serializeOoxmlPart(part);
  const story = layoutHeaderFooterStory(part, 400, measurer, 'decorated');
  for (const pageNumber of [1, 12, 123]) {
    const projected = story.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    const [first, second] = projected.fragments;
    if (first?.kind !== 'paragraph' || second?.kind !== 'paragraph')
      throw new Error('paragraphs required');
    expect(first.lines[0]!.spans.map((span) => span.text).join('')).toBe(String(pageNumber));
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('·   ·');
    expect(first.paragraphId).not.toBe(second.paragraphId);
    const start = first.lines[0]!.spans[0]!.box,
      end = first.lines[0]!.spans.at(-1)!.box;
    expect((start.x + end.x + end.width) / 2).toBeCloseTo(200, 4);
    expect(second.box.y).toBe(0);
    expect(projected.flowHeight).toBeCloseTo(first.box.height + 0.05, 3);
  }
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('does not overlay meaningful, left-aligned or field-bearing anchor content', () => {
  for (const [content, align] of [
    ['· note ·', 'center'],
    ['·'.repeat(40), 'center'],
  ]) {
    const decorated = body.replace(
      '</w:pPr></w:p>',
      `<w:jc w:val="${align}"/></w:pPr><w:r><w:t>${content}</w:t></w:r></w:p>`
    );
    const story = layoutHeaderFooterStory(partOf(decorated), 400, measurer, 'refused');
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
  // Left-aligned or field-bearing anchor content clear of the number does not meet it.
  expectPlacedBeside(
    body.replace('</w:pPr></w:p>', '<w:jc w:val="left"/></w:pPr><w:r><w:t>·   ·</w:t></w:r></w:p>')
  );
  expectPlacedBeside(body.replace('</w:pPr></w:p>', `</w:pPr>${field}</w:p>`));
});

test('accepts the switches Word writes after PAGE without moving the frame', () => {
  const plain = layoutHeaderFooterStory(partOf(), 400, measurer, 'plain');
  for (const instruction of [' PAGE \\* MERGEFORMAT ', ' PAGE \\# "0" ', ' page ']) {
    const story = layoutHeaderFooterStory(
      partOf(body.replace(' PAGE ', instruction)),
      400,
      measurer,
      'switch'
    );
    const [first, second] = story.fragments;
    if (first?.kind !== 'paragraph' || second?.kind !== 'paragraph')
      throw new Error('paragraphs required');
    expect(first.alignment).toBe('center');
    expect(first.box).toEqual(plain.fragments[0]!.box);
    expect(second.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(plain.flowHeight, 4);
  }
});

test('an instruction split across instrText runs still takes the frame lane', () => {
  const split = body.replace(
    '<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>',
    '<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:instrText>\\* MERGEFORMAT</w:instrText></w:r>'
  );
  expect(split).not.toBe(body);
  const [first, second] = layoutHeaderFooterStory(partOf(split), 400, measurer, 'split').fragments;
  if (first?.kind !== 'paragraph' || second?.kind !== 'paragraph')
    throw new Error('paragraphs required');
  expect(first.alignment).toBe('center');
  expect(second.box.y).toBe(0);
});

test('switches the page-field projection does not evaluate stay in ordinary flow', () => {
  // The lane must never claim a field whose value the page context will not refresh; the
  // cached text would then repeat on every page.
  for (const instruction of ['PAGE \\* Ordinal \\* MERGEFORMAT', ' PAGE \\* CardText ']) {
    const story = layoutHeaderFooterStory(
      partOf(body.replace(' PAGE ', instruction)),
      400,
      measurer,
      'unevaluated'
    );
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
});

test('the frame box is its ink, so clicks beside it reach the anchor paragraph', () => {
  const story = layoutHeaderFooterStory(partOf(), 400, measurer, 'hit');
  for (const pageNumber of [1, 123]) {
    const projected = story.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    const [framed, anchor] = projected.fragments;
    if (framed?.kind !== 'paragraph' || anchor?.kind !== 'paragraph')
      throw new Error('paragraphs required');
    const spans = framed.lines[0]!.spans;
    const ink = spans.reduce((sum, span) => sum + span.box.width, 0);
    expect(framed.box.width).toBeCloseTo(ink, 4);
    expect(framed.box.x).toBeCloseTo(spans[0]!.box.x, 4);
    expect(framed.box.x + framed.box.width / 2).toBeCloseTo(200, 4);
    expect(anchor.box).toMatchObject({ x: 0, width: 400 });
    const model = documentOf(projected);
    const inside = hitTestFragments(model, 0, projected.fragments, { x: 200, y: 3 });
    expect(inside?.position.paragraphId).toBe(framed.paragraphId);
    for (const x of [20, framed.box.x - 1, framed.box.x + framed.box.width + 1, 380]) {
      const beside = hitTestFragments(model, 0, projected.fragments, { x, y: 3 });
      expect(beside?.position.paragraphId).toBe(anchor.paragraphId);
    }
  }
});

test('clicks on the middle-dot decoration reach the anchor paragraph', () => {
  const decorated = body.replace(
    '</w:pPr></w:p>',
    '<w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">·   ·</w:t></w:r></w:p>'
  );
  const story = layoutHeaderFooterStory(partOf(decorated), 400, measurer, 'dots');
  const [framed, anchor] = story.fragments;
  if (framed?.kind !== 'paragraph' || anchor?.kind !== 'paragraph')
    throw new Error('paragraphs required');
  const dot = anchor.lines[0]!.spans[0]!;
  expect(dot.box.x).toBeLessThan(framed.box.x);
  const model = documentOf(story);
  const onDot = hitTestFragments(model, 0, story.fragments, { x: dot.box.x + 1, y: 3 });
  expect(onDot?.position).toEqual({ paragraphId: anchor.paragraphId, offset: 0 });
  const onPage = hitTestFragments(model, 0, story.fragments, { x: 200, y: 3 });
  expect(onPage?.position.paragraphId).toBe(framed.paragraphId);
});
