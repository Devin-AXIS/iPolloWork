import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlProperty,
} from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { frameOrigins, paragraphFrameOrigin, readParagraphFrame } from '../paragraph-frame.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string, properties = '') =>
  `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/>${properties}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const frame = (attributes = '') => `<w:framePr w:x="400" w:y="600" w:w="1000" ${attributes}/>`;
function document(body: string, sectionType = '') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr>${sectionType}<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(6, 10);
const framesOf = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter(
      (fragment): fragment is ParagraphFragmentRecord =>
        fragment.kind === 'paragraph' && fragment.outOfFlow === true
    );

test('bounded frame properties parse the complete schema vocabulary', () => {
  const read = (attributes: Record<string, string>) =>
    readParagraphFrame([{ localName: 'framePr', attributes }]);
  const attributes = { x: '400', y: '600', w: '1000' };
  expect(read(attributes)).toMatchObject({
    x: 20,
    y: 30,
    width: 50,
    horizontalAnchor: 'text',
    verticalAnchor: 'text',
    wrap: 'around',
  });
  expect(read({ ...attributes, h: '3301', hRule: 'exact' })).toMatchObject({
    height: 165.05,
    heightRule: 'exact',
  });
  expect(read({ ...attributes, h: '3301', hRule: 'atLeast' })).toMatchObject({
    height: 165.05,
    heightRule: 'atLeast',
  });
  expect(read({ ...attributes, h: '3301', hRule: 'auto' })).toMatchObject({
    heightRule: 'auto',
  });
  expect(read({ ...attributes, h: '3301' })).toMatchObject({
    heightRule: 'atLeast',
    height: 165.05,
  });
  expect(read({ ...attributes, h: '000' })).toMatchObject({ heightRule: 'auto' });
  expect(read({ x: '400', y: '600' })).toMatchObject({ autoWidth: true, width: 0 });
  expect(
    read({
      ...attributes,
      x: 'invalid',
      y: 'invalid',
      xAlign: 'center',
      yAlign: 'bottom',
      vAnchor: 'page',
      wrap: 'through',
      anchorLock: '1',
    })
  ).toMatchObject({
    xAlign: 'center',
    yAlign: 'bottom',
    wrap: 'through',
    anchorLocked: true,
  });
  for (const wrap of ['auto', 'around', 'tight', 'through', 'none', 'notBeside'])
    expect(read({ ...attributes, wrap })).not.toBeNull();
  for (const override of [
    { w: '0' },
    { x: 'Infinity' },
    { y: '999999999' },
    { hRule: 'exact' },
    { h: '0', hRule: 'exact' },
    { h: '999999999', hRule: 'exact' },
    { h: '999999999' },
    { h: '-20' },
    { dropCap: 'drop' },
    { dropCap: 'invalid' },
    { wrap: 'invalid' },
    { xAlign: 'invalid' },
    { yAlign: 'invalid' },
    { hAnchor: 'bogus' },
  ])
    expect(read({ ...attributes, ...override })).toBeNull();
  const props: OoxmlProperty[] = [
    { localName: 'framePr', attributes },
    { localName: 'framePr', attributes: { ...attributes, x: '800' } },
  ];
  expect(readParagraphFrame(props)?.x).toBe(40);
});

test('page and margin frame origins differ while authored paragraph alignment survives', () => {
  const source = document(
    paragraph('page', frame('w:hAnchor="page" w:vAnchor="page"') + '<w:jc w:val="right"/>') +
      paragraph('margin', frame('w:hAnchor="margin" w:vAnchor="margin"')) +
      paragraph('anchor')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  const [page, margin] = framesOf(layout);
  expect(page!.box).toMatchObject({ x: 10, y: 20, width: 50 });
  expect(page!.alignment).toBe('right');
  expect(margin!.box).toMatchObject({ x: 20, y: 30, width: 50 });
  expect(layout.pages).toHaveLength(1);
});

test('identical adjacent frame paragraphs share one frame and wrap at its authored width', () => {
  const source = document(
    paragraph('abcdefghijklmno', frame()) + paragraph('second', frame()) + paragraph('anchor')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  const [first, second] = framesOf(layout);
  expect(first!.lines).toHaveLength(2);
  expect(second!.box.y).toBe(first!.box.y + first!.box.height);
  expect(second!.positionedFrame?.groupId).toBe(first!.positionedFrame?.groupId);
  expect(second!.positionedFrame?.box).toEqual(first!.positionedFrame?.box);
  expect(second!.paragraphId).not.toBe(first!.paragraphId);
});

test('adjacent exact-height frame paragraphs share and stay inside the authored box', () => {
  const fixed = frame('w:h="3301" w:hRule="exact" w:hAnchor="page" w:vAnchor="page"');
  const framed = Array.from({ length: 18 }, (_, index) => paragraph(`line ${index}`, fixed)).join(
    ''
  );
  const source = document(framed + paragraph('ordinary'));
  const layout = layoutSemanticDocument(source, 0, { measurer });
  const positioned = framesOf(layout);
  expect(positioned).toHaveLength(18);
  expect(positioned.every((item) => item.clipToBox)).toBe(true);
  expect(positioned.every((item) => item.positionedFrame?.box.height === 165.05)).toBe(true);
  expect(
    positioned.every(
      (item) =>
        item.box.y >= item.positionedFrame!.box.y &&
        item.box.y + item.box.height <=
          item.positionedFrame!.box.y + item.positionedFrame!.box.height
    )
  ).toBe(true);
  expect(new Set(positioned.map((item) => item.positionedFrame?.groupId)).size).toBe(1);
  const ordinary = layout.pages
    .flatMap((page) => page.fragments)
    .find(
      (item) =>
        item.kind === 'paragraph' &&
        item.lines.some((line) => line.spans.some((span) => span.text === 'ordinary'))
    ) as ParagraphFragmentRecord;
  expect(ordinary.outOfFlow).not.toBe(true);
});

test('auto and atLeast frame heights use content height and authored minimums', () => {
  for (const [attributes, expected] of [
    ['w:h="1200" w:hRule="auto"', 10],
    ['w:h="1200"', 60],
    ['w:h="100"', 10],
    ['w:h="0"', 10],
    ['w:h="1200" w:hRule="atLeast"', 60],
    ['w:h="100" w:hRule="atLeast"', 10],
  ] as const) {
    const source = document(
      paragraph(
        'height',
        frame(`${attributes} w:hAnchor="page" w:vAnchor="page"`) +
          '<w:spacing w:line="200" w:lineRule="exact"/>'
      ) + paragraph('anchor')
    );
    const positioned = framesOf(layoutSemanticDocument(source, 0, { measurer }))[0]!;
    expect(positioned.positionedFrame?.box.height).toBe(expected);
    expect(positioned.clipToBox).not.toBe(true);
  }
});

test('automatic width uses the containing text column and keeps aligned content inside it', () => {
  const auto = '<w:framePr w:x="0" w:y="0"/>';
  const source = document(
    paragraph('short', auto + '<w:jc w:val="right"/>') +
      paragraph('longer text', auto) +
      paragraph('anchor')
  );
  const [first, second] = framesOf(layoutSemanticDocument(source, 0, { measurer }));
  expect(first!.positionedFrame?.box.width).toBe(second!.positionedFrame?.box.width);
  expect(first!.positionedFrame!.box.width).toBeGreaterThan(first!.lines[0]!.spans[0]!.box.width);
  expect(first!.lines[0]!.spans[0]!.box.x).toBeGreaterThan(first!.positionedFrame!.box.x);
  expect(second!.positionedFrame!.box.width).toBe(180);
});

test('relative alignment supersedes offsets and follows physical page parity', () => {
  const aligned = (xAlign: string, yAlign = 'top') =>
    `<w:framePr w:x="invalid" w:y="invalid" w:w="1000" w:h="400" w:hRule="exact" w:hAnchor="page" w:vAnchor="page" w:xAlign="${xAlign}" w:yAlign="${yAlign}"/>`;
  const source = document(
    paragraph('inside odd', aligned('inside', 'center')) +
      paragraph('first anchor') +
      paragraph('inside even', aligned('inside', 'bottom')) +
      paragraph('second anchor', '<w:pageBreakBefore/>')
  );
  const [odd, even] = framesOf(layoutSemanticDocument(source, 0, { measurer }));
  expect(odd!.box).toMatchObject({ x: -10, y: 80, width: 50 });
  expect(even!.box).toMatchObject({ x: 140, y: 170, width: 50 });
});

test('inside alignment invalidates retained layout when the section page parity changes', () => {
  const source = document(
    paragraph('inside', '<w:framePr w:w="1000" w:hAnchor="page" w:xAlign="inside"/>') +
      paragraph('anchor')
  );
  const session = createLayoutSession();
  layoutSemanticDocument(source, 0, { measurer, session, pageIndexStart: 0 });
  const shifted = layoutSemanticDocument(source, 1, { measurer, session, pageIndexStart: 1 });
  const cold = layoutSemanticDocument(source, 1, { measurer, pageIndexStart: 1 });
  expect(shifted.pages).toEqual(cold.pages);
  expect(framesOf(shifted)[0]!.positionedFrame!.box.x).toBe(140);
});

test('all relative frame alignments resolve against their anchor boxes', () => {
  const read = (attributes: Record<string, string>) =>
    readParagraphFrame([{ localName: 'framePr', attributes }])!;
  const origins = {
    pageNumber: 1,
    page: { x: 0, y: 0, width: 200, height: 300 },
    margin: { x: 20, y: 30, width: 160, height: 240 },
    text: { x: 40, y: 60, width: 120, height: 180 },
  };
  const size = { width: 50, height: 20 };
  for (const [xAlign, x] of [
    ['left', 0],
    ['center', 75],
    ['right', 150],
    ['inside', 0],
    ['outside', 150],
  ] as const) {
    const frame = read({ w: '1000', hAnchor: 'page', xAlign });
    expect(paragraphFrameOrigin(frame, origins, size).x).toBe(x);
  }
  expect(
    paragraphFrameOrigin(
      read({ w: '1000', hAnchor: 'page', xAlign: 'inside' }),
      { ...origins, pageNumber: 2 },
      size
    ).x
  ).toBe(150);
  for (const [yAlign, y] of [
    ['top', 0],
    ['center', 140],
    ['bottom', 280],
    ['inside', 0],
    ['outside', 280],
    ['inline', 60],
  ] as const) {
    const frame = read({ w: '1000', vAnchor: 'page', yAlign });
    expect(paragraphFrameOrigin(frame, origins, size).y).toBe(y);
  }
  const textRelative = read({ w: '1000', y: '400', vAnchor: 'text', yAlign: 'center' });
  expect(textRelative.yAlign).toBeUndefined();
  expect(paragraphFrameOrigin(textRelative, origins, size).y).toBe(80);
});

test('margin alignment uses authored page margins instead of the remaining text area', () => {
  const origins = frameOrigins(
    1,
    { width: 200, height: 300, margin: { top: 20, right: 30, bottom: 40, left: 10 } },
    35,
    { x: 5, y: 70, width: 100, height: 80 }
  );
  expect(origins.margin).toEqual({ x: 0, y: -15, width: 160, height: 240 });
  expect(origins.text).toEqual({ x: 5, y: 70, width: 100, height: 80 });
});

test('exact-height frame groups agree between incremental and cold layout', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const fixed = frame('w:h="3301" w:hRule="exact" w:hAnchor="page" w:vAnchor="page"');
  for (const revision of [0, 1]) {
    const source = document(
      paragraph('first', fixed) + paragraph(`second ${revision}`, fixed) + paragraph('ordinary')
    );
    const warm = layoutSemanticDocument(source, revision, { measurer, session, cache });
    const cold = layoutSemanticDocument(source, revision, { measurer });
    expect(warm.pages).toEqual(cold.pages);
  }
});

test('automatic frame edits agree between incremental and cold layout', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  for (const [revision, text] of ['short', 'a much longer frame line', 'tiny'].entries()) {
    const source = document(
      paragraph(text, '<w:framePr w:x="0" w:y="0"/>') +
        paragraph('member', '<w:framePr w:x="0" w:y="0"/>') +
        paragraph('anchor')
    );
    const warm = layoutSemanticDocument(source, revision, { measurer, session, cache });
    expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, { measurer }).pages);
  }
});

test('text frames follow the placed anchor across spacing and page breaks', () => {
  for (const pageBreak of ['', '<w:pageBreakBefore/>']) {
    const source = document(
      paragraph('lead') +
        paragraph('framed', frame()) +
        paragraph(
          'anchor',
          '<w:spacing w:before="400" w:line="200" w:lineRule="exact"/>' + pageBreak
        )
    );
    const layout = layoutSemanticDocument(source, 0, { measurer });
    const placed = framesOf(layout)[0]!;
    const page = layout.pages.find((item) => item.fragments.includes(placed))!;
    const anchor = page.fragments.find(
      (fragment) =>
        fragment.kind === 'paragraph' && fragment.paragraphId === placed.positionedFrame?.anchorId
    ) as ParagraphFragmentRecord;
    expect(placed.box.y).toBeCloseTo(anchor.lines[0]!.box.y + 30, 6);
    expect(page.index).toBe(pageBreak ? 1 : 0);
  }
});

test('anchor edits and frame group edits agree between incremental and cold layout', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  for (const [revision, before] of [0, 400, 100, 0].entries()) {
    const source = document(
      paragraph('lead') +
        paragraph('first', frame()) +
        paragraph(`second${revision}`, frame()) +
        paragraph('anchor', `<w:spacing w:before="${before}" w:line="200" w:lineRule="exact"/>`)
    );
    const warm = layoutSemanticDocument(source, revision, { measurer, session, cache });
    const cold = layoutSemanticDocument(source, revision, { measurer });
    expect(warm.pages).toEqual(cold.pages);
  }
});

test('anchorLock keeps the frame before its logical anchor across split, join, and save', () => {
  const source = document(
    paragraph('locked', frame('w:anchorLock="1"')) + paragraph('anchor text')
  );
  const body = source.root.children.find(
    (node): node is OoxmlElement => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  const original = body.children.filter((node): node is OoxmlElement => node.kind === 'paragraph');
  const split = applyTreeOp(source, {
    op: 'splitParagraph',
    paragraphId: original[1]!.id,
    offset: 6,
  });
  if (!split.ok || !split.effect.split) throw new Error('expected anchor split');
  const splitLayout = layoutSemanticDocument(split.part, 1, { measurer });
  expect(framesOf(splitLayout)[0]!.positionedFrame?.anchorId).toBe(original[1]!.id);
  const joined = applyTreeOp(split.part, {
    op: 'joinParagraphs',
    firstId: original[1]!.id,
    secondId: split.effect.split.tail,
  });
  if (!joined.ok) throw new Error(joined.reason);
  expect(
    framesOf(layoutSemanticDocument(joined.part, 2, { measurer }))[0]!.positionedFrame?.anchorId
  ).toBe(original[1]!.id);
  const saved = serializeOoxmlPart(joined.part);
  expect(saved).toContain('w:anchorLock="1"');
  const reopened = readOoxmlPart(saved, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(framesOf(layoutSemanticDocument(reopened.part, 3, { measurer }))).toHaveLength(1);
});

test('keep-next measures the next ordinary paragraph across positioned frames', () => {
  const source = document(
    paragraph('Lead', '<w:spacing w:line="2800" w:lineRule="exact"/>') +
      paragraph('Heading', '<w:keepNext/><w:spacing w:line="400" w:lineRule="exact"/>') +
      paragraph(
        'Frame',
        '<w:framePr w:x="0" w:y="0" w:w="1000"/><w:spacing w:line="1600" w:lineRule="exact"/>'
      ) +
      paragraph('Anchor', '<w:spacing w:line="400" w:lineRule="exact"/>')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  expect(layout.pages).toHaveLength(1);
  const heading = layout.pages[0]!.fragments.find(
    (block) =>
      block.kind === 'paragraph' &&
      block.lines.some((line) => line.spans.some((span) => span.text === 'Heading'))
  )!;
  expect(heading.box.y).toBe(140);
});

test('a continuous section wraps beside earlier frames, after the mark that anchors them', () => {
  const geometry =
    '<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/>';
  const source = document(
    paragraph(
      'Frame',
      '<w:framePr w:x="0" w:y="0" w:w="1000" w:vSpace="100"/><w:spacing w:line="2000" w:lineRule="exact"/>'
    ) +
      paragraph('', `<w:sectPr>${geometry}</w:sectPr>`) +
      paragraph('Following section'),
    '<w:type w:val="continuous"/>'
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  expect(layout.pages).toHaveLength(1);
  const frame = framesOf(layout)[0]!.positionedFrame!.box;
  const fragments = layout.pages[0]!.fragments;
  const mark = fragments.at(-2)! as ParagraphFragmentRecord;
  const following = fragments.at(-1)! as ParagraphFragmentRecord;
  // The anchoring mark keeps its line, and the next section starts below it, beside the frame.
  expect(mark.outOfFlow).toBeFalsy();
  expect(following.box.y).toBeGreaterThanOrEqual(mark.box.y + mark.box.height);
  expect(following.box.y).toBeLessThan(frame.y + frame.height);
  expect(following.lines[0]!.contentX).toBeGreaterThanOrEqual(frame.x + frame.width);
});

test('frames below the body do not add a page for an empty continuous section', () => {
  const geometry =
    '<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:bottom="1000" w:left="200" w:right="200"/>';
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  for (const [revision, y] of [3400, 600, 3400].entries()) {
    const source = document(
      paragraph('Frame', `<w:framePr w:x="0" w:y="${y}" w:w="1000" w:vAnchor="page"/>`) +
        paragraph('', `<w:sectPr>${geometry}</w:sectPr>`) +
        paragraph(''),
      '<w:type w:val="continuous"/>'
    );
    const saved = serializeOoxmlPart(source);
    const layout = layoutSemanticDocument(source, revision, { measurer, session, cache });
    expect(layout.pages).toEqual(layoutSemanticDocument(source, revision, { measurer }).pages);
    expect(layout.pages).toHaveLength(1);
    const positioned = framesOf(layout)[0]!;
    expect(positioned.positionedFrame!.box.y).toBe(y / 20 - 10);
    // The mark anchoring the frame keeps its line; the next section starts below it.
    if (y === 3400) expect(layout.pages[0]!.fragments.at(-1)!.box.y).toBe(10);
    expect(serializeOoxmlPart(source)).toBe(saved);
  }
});
