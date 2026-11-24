import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory, type HeaderFooterPageContext } from '../hf-layout.ts';
import { readPositionedHeaderFrames } from '../header-positioned-frames.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const measurer = createFixedMeasurer(5, 12);
const page: HeaderFooterPageContext = {
  pageNumber: 1,
  pageWidth: 600,
  pageHeight: 800,
  marginLeft: 70,
  marginRight: 70,
  marginTop: 72,
  marginBottom: 72,
  storyDistance: 30,
};
const frame = (extra = '') =>
  `<w:framePr w:w="4000" w:h="1000" w:x="6400" w:y="960" w:hAnchor="page" w:vAnchor="page" ${extra}/>`;
const borders =
  '<w:pBdr><w:top w:val="single" w:sz="8" w:space="1"/><w:left w:val="single" w:sz="8" w:space="1"/><w:bottom w:val="single" w:sz="8" w:space="1"/><w:right w:val="single" w:sz="8" w:space="1"/></w:pBdr>';
const text = (value: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
const framed = (value = 'FRAME', properties = frame()) => text(value, properties + borders);
const ordinary = text('ANCHOR');
function part(content: string, root = 'hdr') {
  const result = readOoxmlPart(
    `<w:${root} xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${content}</w:${root}>`,
    {
      name: root === 'hdr' ? '/word/header1.xml' : '/word/document.xml',
      contentType: 'app/xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function lay(content: string, geometry = page) {
  return layoutHeaderFooterStory(
    part(content),
    460,
    measurer,
    'positioned-header-test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'proposed',
    undefined,
    undefined,
    undefined,
    geometry
  );
}
const paragraphs = (story: ReturnType<typeof lay>) =>
  story.fragments as readonly ParagraphFragmentRecord[];

describe('page-anchored header frame groups', () => {
  test('matching adjacent paragraphs share width, borders, and minimum height without body reserve', () => {
    const source = part(framed('FIRST') + framed('SECOND') + ordinary);
    const before = serializeOoxmlPart(source);
    const story = layoutHeaderFooterStory(
      source,
      460,
      measurer,
      'positioned-header-test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'proposed',
      undefined,
      undefined,
      undefined,
      page
    );
    const [first, second, anchor] = paragraphs(story);
    expect(first!.box.x).toBe(250);
    expect(first!.box.y).toBe(18);
    expect(first!.box.width).toBe(200);
    expect(second!.box.y).toBeGreaterThan(first!.box.y);
    expect(second!.box.y + second!.box.height).toBe(68);
    expect(first!.borders!.some((edge) => edge.side === 'bottom')).toBe(false);
    expect(second!.borders!.some((edge) => edge.side === 'top')).toBe(false);
    expect(first!.outOfFlow).toBe(true);
    expect(second!.outOfFlow).toBe(true);
    expect(anchor!.box).toEqual(paragraphs(lay(ordinary))[0]!.box);
    expect(story.flowHeight).toBe(lay(ordinary).flowHeight);
    expect(serializeOoxmlPart(source)).toBe(before);
    expect(first!.range).toEqual({ paragraphId: '/word/header1.xml#0.0', start: 0, end: 5 });
    expect(second!.lines[0]!.spans[0]!.range).toEqual({
      paragraphId: '/word/header1.xml#0.1',
      start: 0,
      end: 6,
    });
  });

  test('different frame coordinates do not group, and ordinary source order stays intact', () => {
    const content =
      ordinary + framed('FIRST') + framed('SECOND', frame().replace('y="960"', 'y="2400"'));
    const source = part(content);
    expect(readPositionedHeaderFrames(source)!.length).toBe(2);
    const [anchor, first, second] = paragraphs(lay(content));
    expect(anchor!.box.y).toBe(0);
    expect(first!.box.y).toBe(18);
    expect(second!.box.y).toBe(90);
    expect(first!.bottomBorder).toBeDefined();
    expect(second!.borders!.some((border) => border.side === 'top')).toBe(true);
  });

  test('auto height ignores authored height, while a minimum height extends only closing decoration', () => {
    const minimum = paragraphs(lay(framed() + ordinary))[0]!;
    const auto = paragraphs(lay(framed('FRAME', frame('w:hRule="auto"')) + ordinary))[0]!;
    expect(minimum.lines).toEqual(auto.lines);
    expect(minimum.box.height).toBe(50);
    expect(auto.box.height).toBeLessThan(50);
    expect(minimum.bottomBorder!.box.y).toBeGreaterThan(auto.bottomBorder!.box.y);
    expect(minimum.borders!.find((border) => border.side === 'left')!.box.height).toBe(50);
  });

  test('page-relative placement follows the story origin and caches each origin separately', () => {
    const story = lay(framed() + ordinary);
    const shifted = story.withPageContext({
      pageNumber: 2,
      pageCount: 3,
      sectionPageCount: 3,
      storyTop: 40,
    });
    expect(paragraphs(shifted)[0]!.box.y).toBe(8);
    expect(paragraphs(shifted)[0]!.box.y + 40).toBe(paragraphs(story)[0]!.box.y + 30);
    expect(shifted.flowHeight).toBe(story.flowHeight);
    expect(
      story.withPageContext({ pageNumber: 2, pageCount: 3, sectionPageCount: 3, storyTop: 40 })
    ).toBe(shifted);
  });

  for (const [name, properties] of [
    ['negative coordinate', frame().replace('x="6400"', 'x="-1"')],
    ['oversized coordinate', frame().replace('x="6400"', 'x="999999999999"')],
    ['off-page frame', frame().replace('x="6400"', 'x="11900"')],
    ['exact height', frame('w:hRule="exact"')],
    ['unknown attribute', frame('w:xAlign="right"')],
  ])
    test(`${name} retains complete ordinary flow`, () => {
      const result = lay(framed('FRAME', properties) + ordinary);
      expect(paragraphs(result).some((paragraph) => paragraph.outOfFlow)).toBe(false);
      expect(
        paragraphs(result).map((paragraph) =>
          paragraph.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
        )
      ).toEqual(['FRAME', 'ANCHOR']);
    });

  test('overlapping ordinary text keeps ordinary flow instead of removing its content', () => {
    const result = lay(
      framed('FRAME', frame().replace('x="6400"', 'x="1400"').replace('y="960"', 'y="600"')) +
        ordinary
    );
    expect(paragraphs(result).some((paragraph) => paragraph.outOfFlow)).toBe(false);
  });

  test('warm layout preserves geometry after frame text edits', () => {
    const session = createLayoutSession();
    const body = part(
      '<w:body>' +
        text('BODY') +
        '<w:sectPr><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:top="1440" w:left="1400" w:right="1400" w:bottom="1440" w:header="600"/></w:sectPr></w:body>',
      'document'
    );
    for (const [index, value] of ['FRAME', 'LONGER FRAME', 'FRAME'].entries()) {
      const story = lay(framed(value) + ordinary);
      const furniture = {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default' as const, story]]),
        footers: new Map(),
      };
      const warm = layoutSemanticDocument(body, index + 1, {
        measurer,
        session,
        sectionFurniture: [furniture],
      });
      const cold = layoutSemanticDocument(body, index + 1, {
        measurer,
        sectionFurniture: [furniture],
      });
      expect(warm.pages).toEqual(cold.pages);
    }
  });
});

const picture =
  '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="635000"/><wp:docPr id="1" name="Image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
function imageStory(content: string) {
  const source = part(content);
  return layoutHeaderFooterStory(
    source,
    460,
    measurer,
    'positioned-header-image',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'proposed',
    layoutContext(source, source.name),
    undefined,
    undefined,
    page
  );
}

test('an inline image keeps its complete geometry before or after a frame group', () => {
  const standalone = imageStory(picture);
  const expected = paragraphs(standalone)[0]!.lines[0]!.drawings![0]!;
  for (const content of [
    picture + framed('ONE') + framed('TWO'),
    framed('ONE') + framed('TWO') + picture,
  ]) {
    const story = imageStory(content);
    const image = paragraphs(story).flatMap((paragraph) =>
      paragraph.lines.flatMap((line) => line.drawings ?? [])
    )[0]!;
    expect(image.paintBounds).toEqual(expected.paintBounds);
    expect(image.geometry).toEqual(expected.geometry);
    expect(story.flowHeight).toBe(standalone.flowHeight);
    expect(paragraphs(story).filter((paragraph) => paragraph.outOfFlow)).toHaveLength(2);
  }
});

test('first and default header variants keep separate frame ownership on later pages', () => {
  const body = part(
    '<w:body>' +
      text('PAGE ONE') +
      text('PAGE TWO', '<w:pageBreakBefore/>') +
      '<w:sectPr><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:top="1440" w:left="1400" w:right="1400" w:bottom="1440" w:header="600"/><w:titlePg/></w:sectPr></w:body>',
    'document'
  );
  const first = imageStory(framed('FIRST') + picture);
  const normal = imageStory(framed('DEFAULT') + picture);
  const run = (includeDefault: boolean) =>
    layoutSemanticDocument(body, 1, {
      measurer,
      sectionFurniture: [
        {
          titlePage: true,
          evenAndOddHeaders: false,
          headers: new Map(
            includeDefault
              ? [
                  ['first', first],
                  ['default', normal],
                ]
              : [['first', first]]
          ),
          footers: new Map(),
        },
      ],
    });
  const onlyFirst = run(false);
  expect(onlyFirst.pages).toHaveLength(2);
  expect(onlyFirst.pages[0]!.header!.variant).toBe('first');
  expect(onlyFirst.pages[1]!.header).toBeUndefined();
  const both = run(true);
  expect(both.pages[1]!.header!.variant).toBe('default');
  expect(both.pages[1]!.contentBox.y - both.pages[1]!.box.y).toBe(both.pages[0]!.contentBox.y);
  expect(both.pages[1]!.header!.fragments[0]!.box).toEqual(
    both.pages[0]!.header!.fragments[0]!.box
  );
});

test('unsupported nested, styled, revised, or excessive frame groups keep ordinary flow', () => {
  const many = Array.from({ length: 17 }, (_, index) =>
    framed('FRAME', frame().replace('y="960"', `y="${1000 + index}"`))
  ).join('');
  expect(readPositionedHeaderFrames(part(many + ordinary))).toBeNull();
  expect(
    readPositionedHeaderFrames(
      part(`<w:sdt><w:sdtContent>${framed()}</w:sdtContent></w:sdt>` + ordinary)
    )
  ).toBeNull();
  expect(
    readPositionedHeaderFrames(
      part(
        framed().replace('<w:r>', '<w:r><w:rPr><w:ins w:id="1" w:author="Author"/></w:rPr>') +
          ordinary
      )
    )
  ).toBeNull();
  const styles = part(
    '<w:style w:type="paragraph" w:styleId="Frame"><w:name w:val="Frame"/><w:pPr><w:framePr w:xAlign="right"/></w:pPr></w:style>',
    'styles'
  );
  const source = part(framed('FRAME', '<w:pStyle w:val="Frame"/>' + frame()) + ordinary);
  const story = layoutHeaderFooterStory(
    source,
    460,
    measurer,
    'styled-frame',
    undefined,
    buildStyleCascadeTable(styles.root),
    undefined,
    undefined,
    undefined,
    'proposed',
    undefined,
    undefined,
    undefined,
    page
  );
  expect(paragraphs(story).some((paragraph) => paragraph.outOfFlow)).toBe(false);
});

test('minimum frame height extends final spacing inside the border without changing text width', () => {
  const content = text('FRAME', frame() + borders + '<w:spacing w:after="200"/>') + ordinary;
  const first = paragraphs(lay(content))[0]!;
  expect(first.bottomBorder!.box.y + first.bottomBorder!.box.height).toBe(
    first.box.y + first.box.height
  );
  expect(first.box.width).toBe(200);
  expect(first.borders!.find((border) => border.side === 'left')!.box.x).toBe(first.box.x - 3.5);
  expect(first.borders!.find((border) => border.side === 'right')!.box.x).toBe(first.box.x + 202.5);
});

test('live ordinary fields cannot change group admission after body reservation', () => {
  const narrow =
    '<w:p><w:pPr><w:framePr w:x="1600" w:y="600" w:w="400" w:hAnchor="page" w:vAnchor="page"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>';
  const field = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';
  const source = part(narrow + field);
  const fixed = {
    measure: (value: string) => value.length * 5,
    lineMetrics: () => ({ height: 12, baseline: 9 }),
  };
  const story = layoutHeaderFooterStory(
    source,
    460,
    fixed,
    'live-frame-field',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'proposed',
    undefined,
    undefined,
    undefined,
    { ...page, marginTop: 40 }
  );
  const larger = story.withPageContext({
    pageNumber: 100,
    pageCount: 100,
    sectionPageCount: 100,
    storyTop: 30,
  });
  expect(larger.flowHeight).toBe(story.flowHeight);
  expect(paragraphs(story).some((paragraph) => paragraph.outOfFlow)).toBe(false);
  const body = part(
    '<w:body>' +
      text('BODY') +
      '<w:sectPr><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:top="800" w:left="1400" w:right="1400" w:bottom="1440" w:header="600"/><w:pgNumType w:start="100"/></w:sectPr></w:body>',
    'document'
  );
  const result = layoutSemanticDocument(body, 1, {
    measurer: fixed,
    sectionFurniture: [
      {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', story]]),
        footers: new Map(),
      },
    ],
  });
  expect(result.pages[0]!.contentBox.y).toBeGreaterThanOrEqual(30 + larger.flowHeight);
  expect(readPositionedHeaderFrames(source)).toBeNull();
  const complex =
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> STYLEREF "Heading" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Title</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  expect(readPositionedHeaderFrames(part(narrow + complex))).toBeNull();
});
