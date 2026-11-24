import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  observeExclusionLayoutPassesForTest,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string, height = 20, props = '') =>
  `<w:p><w:pPr><w:spacing w:line="${height * 20}" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
function source(attributes: string, height = 20, members = 1) {
  const frame = `<w:framePr w:x="0" ${attributes}/>`;
  const body =
    paragraph('Lead') +
    Array.from({ length: members }, (_, index) => paragraph(`FRAME${index}`, height, frame)).join(
      ''
    ) +
    paragraph('Anchor word '.repeat(5)) +
    paragraph('Tail');
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const options = {
  measurer: createFixedMeasurer(5, 20),
  geometry: { width: 200, height: 200, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
};
const paragraphs = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');

test('unplaceable blocking frame groups fall back without overlapping or dropping their anchors', () => {
  for (const [attributes, height, members] of [
    ['w:y="0" w:w="1600" w:wrap="none"', 400, 1],
    ['w:y="0" w:w="4000"', 400, 1],
    ['w:y="0" w:w="1600" w:wrap="none" w:vSpace="31680"', 20, 1],
    ['w:y="0" w:w="4000"', 100, 2],
  ] as const) {
    const part = source(attributes, height, members);
    const saved = serializeOoxmlPart(part);
    let passes = 0;
    const stop = observeExclusionLayoutPassesForTest(() => {
      passes++;
    });
    let layout: ReturnType<typeof layoutSemanticDocument>;
    try {
      layout = layoutSemanticDocument(part, 0, options);
    } finally {
      stop();
    }
    const blocks = paragraphs(layout);
    expect(
      blocks.filter((block) => block.props.some((prop) => prop.localName === 'framePr'))
    ).toHaveLength(members);
    expect(blocks.every((block) => !block.outOfFlow)).toBe(true);
    expect(
      blocks
        .flatMap((block) => block.lines.flatMap((line) => line.spans.map((span) => span.text)))
        .join('')
    ).toBe(
      'Lead' +
        Array.from({ length: members }, (_, index) => `FRAME${index}`).join('') +
        'Anchor word '.repeat(5) +
        'Tail'
    );
    expect(layout.pages.every((page) => page.fragments.length > 0)).toBe(true);
    expect(passes).toBeLessThan(20);
    expect(serializeOoxmlPart(part)).toBe(saved);
  }
});

test('tall side-wrapped frames remain positioned when they leave a usable text lane', () => {
  const layout = layoutSemanticDocument(source('w:y="0" w:w="1600"', 400), 0, options);
  const blocks = paragraphs(layout);
  expect(blocks[1]!.outOfFlow).toBe(true);
  expect(blocks[2]!.lines[0]!.contentX).toBeGreaterThanOrEqual(80);
  expect(layout.pages).toHaveLength(1);
});

test('negative text-relative vertical offsets raise the frame above its anchor, down to the page top', () => {
  const margined = {
    ...options,
    geometry: { ...options.geometry, margin: { ...options.geometry.margin, top: 40 } },
  };
  for (const [offset, expected] of [
    [-400, 0],
    [-2000, -40],
  ] as const) {
    const part = source(`w:y="${offset}" w:w="1600" w:vAnchor="text"`);
    const before = serializeOoxmlPart(part);
    const blocks = paragraphs(layoutSemanticDocument(part, 0, margined));
    const framed = blocks[1]!;
    expect(framed.outOfFlow).toBe(true);
    expect(framed.box.y).toBe(expected);
    // The anchor keeps its flow position; the raised frame takes no flow space.
    expect(blocks[2]!.box.y).toBe(20);
    expect(serializeOoxmlPart(part)).toBe(before);
  }
});

test('negative page-relative and margin-relative offsets remain authored', () => {
  for (const anchor of ['page', 'margin']) {
    const layout = layoutSemanticDocument(
      source(`w:y="-200" w:w="1600" w:vAnchor="${anchor}"`),
      0,
      options
    );
    const framed = paragraphs(layout)[1]!;
    expect(framed.outOfFlow).toBe(true);
    expect(framed.box.y).toBe(-10);
  }
});

test('blocked-frame fallback remains stable across warm replays and source changes', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const blocked = source('w:y="0" w:w="1600" w:wrap="none" w:vSpace="31680"');
  const supported = source('w:y="0" w:w="1600" w:wrap="none"');
  for (const [revision, part] of [blocked, blocked, supported, blocked].entries()) {
    const warm = layoutSemanticDocument(part, revision, { ...options, session, cache });
    expect(warm.pages).toEqual(layoutSemanticDocument(part, revision, options).pages);
  }
});
