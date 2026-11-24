import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/>${props}</w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const cap = (text = 'D', attrs = '', position = -6) =>
  `<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" ${attrs}/><w:spacing w:before="0" w:after="0" w:line="600" w:lineRule="exact"/><w:ind w:firstLine="200"/></w:pPr><w:r><w:rPr><w:sz w:val="88"/><w:position w:val="${position}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const read = (body: string) => {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
};
const options = {
  measurer: createFixedMeasurer(6, 10),
  geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
};
const paras = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');

test('an explicitly sized drop cap wraps three lines and shares their last baseline', () => {
  for (const position of [-6, 0, 8]) {
    const source = read(cap('D', '', position) + p('word '.repeat(50)));
    const before = serializeOoxmlPart(source);
    const layout = layoutSemanticDocument(source, 0, options);
    const [letter, body] = paras(layout);
    expect(letter!.positionedFrame?.dropCapLines).toBe(3);
    expect(letter!.positionedFrame!.box.height).toBe(30);
    expect(letter!.lines[0]!.spans[0]!.box.x).toBe(10);
    for (const line of body!.lines.slice(0, 3))
      expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(34);
    expect(body!.lines[3]!.spans[0]!.box.x).toBe(0);
    const large = letter!.lines[0]!,
      third = body!.lines[2]!;
    expect(large.box.y + large.baseline - large.spans[0]!.style.baselineShiftPt).toBeCloseTo(
      third.box.y + third.baseline,
      6
    );
    expect(serializeOoxmlPart(source)).toBe(before);
  }
});

test('a right-to-left dropped cap falls back without overlapping its body text', () => {
  const rtl = '<w:bidi/>';
  const rtlCap = cap().replace('<w:ind w:firstLine="200"/>', `<w:ind w:firstLine="200"/>${rtl}`);
  const [letter, body] = paras(
    layoutSemanticDocument(read(rtlCap + p('word '.repeat(50), rtl)), 0, options)
  );
  expect(letter!.positionedFrame).toBeUndefined();
  expect(body!.positionedFrame).toBeUndefined();
  expect(body!.box.y).toBeGreaterThanOrEqual(letter!.box.y + letter!.box.height);
});

test('the occupied band moves with the anchor when only two body lines fit', () => {
  const source = read(
    p('Lead', '<w:spacing w:line="1500" w:lineRule="exact"/>') + cap() + p('word '.repeat(20))
  );
  const layout = layoutSemanticDocument(source, 0, {
    ...options,
    geometry: { ...options.geometry, height: 100 },
  });
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0]!.fragments).toHaveLength(1);
  const letter = paras(layout).find((block) => block.positionedFrame)!;
  expect(layout.pages[1]!.fragments).toContain(letter);
  expect(letter.positionedFrame!.box.y).toBe(0);
  expect(letter.positionedFrame!.box.height).toBe(30);
});

test('warm caches follow cap width edits and unsupported/terminal caps retain ordinary flow', () => {
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const session = createLayoutSession();
  const sources = [read(cap() + p('word '.repeat(30))), read(cap('WW') + p('word '.repeat(30)))];
  for (const [revision, source] of [...sources, sources[0]!].entries()) {
    const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
    expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
    expect(paras(warm)[0]!.positionedFrame!.box.width).toBeCloseTo(
      source === sources[0] ? 34.001 : 58.001,
      5
    );
  }
  for (const source of [
    read(cap()),
    read(cap('D', 'w:hAnchor="invalid"') + p('word '.repeat(20))),
    read(cap('D'.repeat(33)) + p('body')),
  ]) {
    const layout = layoutSemanticDocument(source, 0, options);
    expect(paras(layout).every((block) => !block.positionedFrame)).toBe(true);
  }
});

test('a margin drop cap sits outside the text column without displacing body lines', () => {
  const marginCap = cap('M', 'w:hSpace="100"').replace('w:dropCap="drop"', 'w:dropCap="margin"');
  const [letter, body] = paras(
    layoutSemanticDocument(read(marginCap + p('word '.repeat(20))), 0, options)
  );
  expect(letter!.positionedFrame?.dropCapLines).toBe(3);
  expect(letter!.positionedFrame!.box.x + letter!.positionedFrame!.box.width + 5).toBeCloseTo(0, 5);
  expect(body!.lines.slice(0, 3).every((line) => line.contentX === 0)).toBe(true);
  const rtlCap = marginCap.replace(
    '<w:ind w:firstLine="200"/>',
    '<w:ind w:firstLine="200"/><w:bidi/>'
  );
  const rtlLetter = paras(layoutSemanticDocument(read(rtlCap + p('body')), 0, options))[0]!;
  expect(rtlLetter.positionedFrame!.box.x).toBeCloseTo(205, 5);
});

test('drop-cap line sizing supersedes bounded frame geometry attributes', () => {
  const decorated = cap(
    'D',
    'w:w="1000" w:h="1200" w:hRule="exact" w:x="-200" w:y="400" ' +
      'w:xAlign="right" w:yAlign="bottom" w:hAnchor="page" w:vAnchor="margin"'
  );
  const letter = paras(layoutSemanticDocument(read(decorated + p('body')), 0, options))[0]!;
  expect(letter.positionedFrame?.box.height).toBe(30);
  expect(letter.positionedFrame?.box.width).toBeCloseTo(34.001, 5);
});

test('overheight and competing caps fall back without overlapping body ink', () => {
  for (const source of [
    read(cap() + cap('E') + p('word '.repeat(8))),
    read(cap() + p('word '.repeat(8), '<w:spacing w:line="900" w:lineRule="exact"/>')),
  ]) {
    const layout = layoutSemanticDocument(source, 0, {
      ...options,
      geometry: { ...options.geometry, height: 100 },
    });
    expect(paras(layout).every((block) => !block.positionedFrame)).toBe(true);
    expect(layout.pages.length).toBeLessThan(8);
  }
});

for (const kind of ['drop', 'margin']) {
  test(`a multiline ${kind} cap retains ordinary flow without overlapping body text`, () => {
    const source = read(
      cap('MMMMMMMMMMMM', '', 0).replace('w:dropCap="drop"', `w:dropCap="${kind}"`) +
        p('word '.repeat(50))
    );
    const before = serializeOoxmlPart(source);
    const [letter, body] = paras(layoutSemanticDocument(source, 0, options));
    expect(letter!.lines.length).toBeGreaterThan(1);
    expect(letter!.positionedFrame).toBeUndefined();
    expect(body!.box.y).toBeGreaterThanOrEqual(letter!.box.y + letter!.box.height);
    expect(serializeOoxmlPart(source)).toBe(before);
  });
}
