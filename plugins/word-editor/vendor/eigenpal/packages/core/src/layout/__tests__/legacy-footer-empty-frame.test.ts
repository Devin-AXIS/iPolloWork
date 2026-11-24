import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import { caretStopsForBlocks } from '../semantic-interaction.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
function read(xml: string, name = '/word/footer1.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}
const styles = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
const frame =
  '<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/>';
const complex =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
const simple = '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>';
const anchor = '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:ind w:right="360"/></w:pPr></w:p>';
const body = (field = complex, spacing = '') =>
  `<w:p><w:pPr><w:pStyle w:val="Footer"/>${frame}${spacing}</w:pPr><w:r><w:t xml:space="preserve">Sheet - </w:t></w:r>${field}</w:p>${anchor}`;
const part = (xml: string) => read(`<w:ftr xmlns:w="${W}">${xml}</w:ftr>`);
const lay = (xml = body()) =>
  layoutHeaderFooterStory(part(xml), 400, measurer, 'empty-frame', undefined, styles);
const paragraphs = (story: ReturnType<typeof lay>) =>
  story.fragments as readonly ParagraphFragmentRecord[];

for (const [name, field] of [
  ['complex', complex],
  ['simple', simple],
]) {
  test(`${name} PAGE frame uses its empty anchor height and preserves field positions`, () => {
    const source = part(body(field));
    const before = serializeOoxmlPart(source);
    const story = layoutHeaderFooterStory(source, 400, measurer, 'empty-frame', undefined, styles);
    const [framed, empty] = paragraphs(story);
    const alone = lay(anchor);
    expect(empty!.box).toEqual(alone.fragments[0]!.box);
    expect(story.flowHeight).toBe(alone.flowHeight);
    expect(framed!.lines[0]!.box.y - empty!.lines[0]!.box.y).toBeCloseTo(6.05, 6);
    expect(framed!.box.x + framed!.box.width).toBeCloseTo(400, 6);
    expect(serializeOoxmlPart(source)).toBe(before);
    for (const pageNumber of [1, 12, 123]) {
      const projected = story.withPageContext({
        pageNumber,
        pageCount: 200,
        sectionPageCount: 200,
      });
      const [value] = paragraphs(projected);
      expect(value!.lines[0]!.spans.map((s) => s.text).join('')).toBe(`Sheet - ${pageNumber}`);
      expect(value!.box.x + value!.box.width).toBeCloseTo(400, 6);
      expect(projected.flowHeight).toBe(story.flowHeight);
    }
  });
}

test('direct frame spacing moves the frame without changing the empty anchor budget', () => {
  const inherited = lay();
  const direct = lay(body(complex, '<w:spacing w:before="240" w:after="0"/>'));
  expect(direct.flowHeight).toBe(inherited.flowHeight);
  expect(paragraphs(direct)[1]!.box).toEqual(paragraphs(inherited)[1]!.box);
  expect(paragraphs(direct)[0]!.lines[0]!.box.y - paragraphs(inherited)[0]!.lines[0]!.box.y).toBe(
    6
  );
});

test('body pagination returns the boundary paragraph and remains stable with a warm session', () => {
  const lines = Array.from(
    { length: 47 },
    () =>
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="284" w:lineRule="exact"/></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>'
  ).join('');
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${lines}<w:p><w:pPr><w:widowControl/><w:spacing w:before="0" w:after="0" w:line="284" w:lineRule="exact"/></w:pPr><w:r><w:t>Boundary</w:t><w:br/><w:t>End</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="10880" w:h="16840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:footer="720"/></w:sectPr></w:body></w:document>`,
    '/word/document.xml'
  );
  const session = createLayoutSession();
  const run = (story: ReturnType<typeof lay>, warm = false) =>
    layoutSemanticDocument(document, 0, {
      measurer,
      styleCascade: styles,
      ...(warm ? { session } : {}),
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map(),
        footers: new Map([['default', story]]),
      },
    });
  const story = lay();
  const cold = run(story),
    warm = run(story, true),
    repeat = run(story, true);
  expect(cold.pages).toHaveLength(1);
  expect(warm.pages).toEqual(cold.pages);
  expect(repeat.pages).toEqual(cold.pages);
  expect(cold.pages[0]!.contentBox.y + cold.pages[0]!.contentBox.height).toBe(770);
  expect(run(lay(body().replace(frame, ''))).pages).toHaveLength(2);
});

test('frame and empty anchor keep separate caret positions and pointer targets', () => {
  const story = lay();
  const [framed, empty] = paragraphs(story);
  const model = {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 544, height: 842 },
        contentBox: { x: 72, y: 72, width: 400, height: 698 },
        fragments: story.fragments,
      },
    ],
  } as SemanticLayout;
  const hit = hitTestFragments(model, 0, story.fragments, { x: 0, y: empty!.lines[0]!.box.y + 1 });
  expect(hit?.position.paragraphId).toBe(empty!.paragraphId);
  const stops = caretStopsForBlocks(model, 0, story.fragments);
  expect(stops.some((stop) => stop.position.paragraphId === framed!.paragraphId)).toBe(true);
  expect(stops.some((stop) => stop.position.paragraphId === empty!.paragraphId)).toBe(true);
});

test('unknown frames, two fields, and unsupported fields keep ordinary flow', () => {
  for (const xml of [
    body().replace('w:vAnchor="text"', 'w:vAnchor="page"'),
    body().replace('w:y="1"', 'w:y="400"'),
    body().replace('w:y="1"', 'w:y="1" w:w="200"'),
    body().replace(' PAGE ', ' NUMPAGES '),
    body().replace(' PAGE ', ' INCLUDETEXT file '),
    body(complex + complex),
    body(simple.replace('PAGE', 'NUMPAGES')),
    body().replace(frame, frame + frame),
  ]) {
    const ordinary = lay(xml.replaceAll(frame, ''));
    const result = lay(xml);
    expect(result.fragments[1]!.box.y).toBeGreaterThan(0);
    expect(result.flowHeight).toBe(ordinary.flowHeight);
  }
  // A visible anchor or a later paragraph clear of the number takes the general frame lane.
  for (const xml of [
    body().replace(anchor, anchor.replace('</w:p>', '<w:r><w:t>Visible</w:t></w:r></w:p>')),
    body() + anchor,
  ]) {
    const [framed, next] = paragraphs(lay(xml));
    expect(framed!.outOfFlow).toBe(true);
    expect(next!.box.y).toBe(0);
  }
});

for (const enabled of [false, true]) {
  test(`fixed paragraph spacing controls the empty-anchor frame offset: ${enabled}`, () => {
    const fixedStyles = buildStyleCascadeTable(
      read(
        `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="paragraph" w:styleId="Footer"><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:style></w:styles>`,
        '/word/styles.xml'
      ).root,
      undefined,
      read(
        `<w:settings xmlns:w="${W}"><w:compat><w:doNotUseHTMLParagraphAutoSpacing w:val="${enabled ? '1' : '0'}"/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
        '/word/settings.xml'
      ).root
    );
    const source = part(body());
    const before = serializeOoxmlPart(source);
    const story = layoutHeaderFooterStory(
      source,
      400,
      measurer,
      'empty-frame-settings',
      undefined,
      fixedStyles
    );
    const [framed, empty] = paragraphs(story);
    const alone = layoutHeaderFooterStory(
      part(anchor),
      400,
      measurer,
      'empty-frame-settings',
      undefined,
      fixedStyles
    );
    expect(story.flowHeight).toBe(alone.flowHeight);
    expect(empty!.box).toEqual(alone.fragments[0]!.box);
    expect(framed!.lines[0]!.box.y - empty!.lines[0]!.box.y).toBeCloseTo(enabled ? 0.05 : 6.05, 6);
    expect(serializeOoxmlPart(source)).toBe(before);
    const projected = story.withPageContext({
      pageNumber: 123,
      pageCount: 200,
      sectionPageCount: 200,
    });
    const [value, projectedAnchor] = paragraphs(projected);
    expect(value!.lines[0]!.box.y - projectedAnchor!.lines[0]!.box.y).toBeCloseTo(
      enabled ? 0.05 : 6.05,
      6
    );
    expect(projected.flowHeight).toBe(story.flowHeight);
  });
}
