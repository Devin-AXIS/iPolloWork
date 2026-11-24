// A header whose first paragraph is an auto-sized text frame (`w:vAnchor="text"`) holding the
// page number. The frame takes no place in the story flow: the paragraph after it opens the
// header, and the frame sits in that paragraph's band at the margin `w:xAlign` names. `inside`
// and `outside` follow the parity of the physical sheet, not the displayed page number.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { readHeaderPageFrame } from '../header-page-frame.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { finalizePageFieldProjection } from '../field-page-furniture.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument, type PageFurniture } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import { layoutContext, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';
import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../semantic-records.ts';

const W = WML_NAMESPACE_URI;
const WIDTH = 400;
const measurer = createFixedMeasurer(6, 14);

const frameProperties = (align = 'inside') =>
  `<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="${align}" w:y="1"/>`;
const pageField =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve">PAGE  </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const framed = (properties = frameProperties(), content = pageField) =>
  `<w:p><w:pPr><w:pStyle w:val="Header"/>${properties}</w:pPr>${content}</w:p>`;
// A centered running head, clear of both margins.
const anchor = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>RUNNING HEAD</w:t></w:r></w:p>';
// A left-aligned heading on the next line, whose top meets the frame's lower edge.
const heading = '<w:p><w:r><w:t>Heading after the frame</w:t></w:r></w:p>';
const body = framed() + anchor + heading;

function headerPart(content: string, root = 'hdr'): OoxmlPart {
  const kind = root === 'hdr' ? 'header' : 'footer';
  const parsed = readOoxmlPart(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`, {
    name: `/word/${kind}1.xml`,
    contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

const lay = (content: string, root = 'hdr') =>
  layoutHeaderFooterStory(headerPart(content, root), WIDTH, measurer, 'header-frame');

const onPage = (story: ReturnType<typeof lay>, pageNumber: number, sheetNumber?: number) =>
  story.withPageContext({
    pageNumber,
    pageCount: 200,
    sectionPageCount: 200,
    ...(sheetNumber !== undefined ? { sheetNumber } : {}),
  });

function paragraphs(blocks: readonly BlockFragmentRecord[]): ParagraphFragmentRecord[] {
  return blocks.map((block) => {
    if (block.kind !== 'paragraph') throw new Error('paragraph expected');
    return block;
  });
}

const textOf = (fragment: ParagraphFragmentRecord) =>
  fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');

function ink(fragment: ParagraphFragmentRecord): { left: number; right: number } {
  const spans = fragment.lines[0]!.spans.filter((span) => span.text.trim() !== '');
  return {
    left: spans[0]!.box.x,
    right: spans.at(-1)!.box.x + spans.at(-1)!.box.width,
  };
}

// The measurer's units at the default run size: one character's advance and one line.
const probe = paragraphs(lay(anchor).fragments)[0]!;
const LINE = probe.lines[0]!.box.height;
const CHAR = (ink(probe).right - ink(probe).left) / 'RUNNING HEAD'.length;

/** Where a fragment and its text sit; identities differ between the two parts compared. */
const geometry = (fragment: ParagraphFragmentRecord) => ({
  box: fragment.box,
  spacing: fragment.spacing,
  lines: fragment.lines.map((line) => ({
    box: line.box,
    contentX: line.contentX,
    baseline: line.baseline,
    spans: line.spans.map((span) => ({ text: span.text, box: span.box })),
  })),
});

describe('a PAGE frame that opens a header', () => {
  test('the anchor opens the story and the frame shares its band', () => {
    const part = headerPart(body);
    const before = serializeOoxmlPart(part);
    const story = layoutHeaderFooterStory(part, WIDTH, measurer, 'header-frame');
    const alone = paragraphs(lay(anchor + heading).fragments);
    const [frame, running, next] = paragraphs(story.fragments);

    // The two paragraphs after the frame lay out exactly as they do without it.
    expect(geometry(running!)).toEqual(geometry(alone[0]!));
    expect(geometry(next!)).toEqual(geometry(alone[1]!));
    expect(story.flowHeight).toBe(2 * LINE);
    // The frame starts 1 twip below the anchor's top, at the left margin of an odd page.
    expect(frame!.box.y).toBeCloseTo(0.05, 6);
    expect(frame!.box.x).toBe(0);
    expect(frame!.box.width).toBeCloseTo(CHAR, 9);
    expect(frame!.lines[0]!.box).toEqual({
      ...frame!.lines[0]!.box,
      x: 0,
      width: frame!.box.width,
    });
    // Three addressable paragraphs; the frame keeps the story's first line id; the source
    // is untouched.
    expect(new Set([frame, running, next].map((item) => item!.paragraphId)).size).toBe(3);
    expect(frame!.lines[0]!.id).toBe('hf-/word/header1.xml-line-0');
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('inside and outside follow the parity of the page number', () => {
    const sides = (align: string, anchorXml = anchor) => {
      const story = lay(framed(frameProperties(align)) + anchorXml);
      return [1, 2, 3, 4].map((pageNumber) => paragraphs(onPage(story, pageNumber).fragments)[0]!);
    };
    const inside = sides('inside');
    expect(inside.map((frame) => ink(frame).left)).toEqual([0, WIDTH - CHAR, 0, WIDTH - CHAR]);
    const outside = sides('outside');
    expect(outside.map((frame) => ink(frame).left)).toEqual([WIDTH - CHAR, 0, WIDTH - CHAR, 0]);
    for (const [align, left] of [
      ['left', 0],
      ['center', (WIDTH - CHAR) / 2],
      ['right', WIDTH - CHAR],
    ] as const) {
      // An empty anchor leaves the whole band free, the center included.
      for (const frame of sides(align, '<w:p/>')) expect(ink(frame).left).toBeCloseTo(left, 9);
    }
  });

  test('a wider page value keeps its margin edge and the header height', () => {
    const story = lay(body);
    for (const pageNumber of [8, 9, 98, 99, 998, 999]) {
      const projected = onPage(story, pageNumber);
      const [frame] = paragraphs(projected.fragments);
      expect(textOf(frame!)).toBe(String(pageNumber));
      const digits = String(pageNumber).length * CHAR;
      expect(frame!.box.width).toBeCloseTo(digits, 9);
      const { left, right } = ink(frame!);
      if (pageNumber % 2 === 1) expect(left).toBe(0);
      else expect(right).toBe(WIDTH);
      expect(right - left).toBeCloseTo(digits, 9);
      expect(projected.flowHeight).toBe(story.flowHeight);
    }
  });

  test('an empty frame does not add a line before the anchor', () => {
    const part = headerPart(framed(frameProperties('right'), '') + anchor + heading);
    const xml = serializeOoxmlPart(part);
    const story = layoutHeaderFooterStory(part, WIDTH, measurer, 'empty-header-frame');
    const expected = paragraphs(lay(anchor + heading).fragments);
    const [empty, running, next] = paragraphs(story.fragments);
    expect(empty!.box.width).toBe(0);
    expect(geometry(running!)).toEqual(geometry(expected[0]!));
    expect(geometry(next!)).toEqual(geometry(expected[1]!));
    expect(story.flowHeight).toBe(2 * LINE);
    const reopened = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(readHeaderPageFrame(reopened.part)).not.toBeNull();
    expect(serializeOoxmlPart(part)).toBe(xml);
  });

  for (const decoration of [
    '',
    '<w:u w:val="single"/><w:highlight w:val="yellow"/>',
    '<w:rStyle w:val="MarkedSpaces"/>',
  ]) {
    test(`whitespace frames retain flow and selectable width, decoration=${decoration}`, () => {
      const content =
        framed(
          frameProperties('right'),
          `<w:r><w:rPr>${decoration}</w:rPr><w:t xml:space="preserve">   </w:t></w:r>`
        ) + anchor;
      const part = headerPart(content);
      const styles = readOoxmlPart(
        `<w:styles xmlns:w="${W}">` +
          '<w:style w:type="character" w:styleId="MarkedSpaces"><w:rPr>' +
          '<w:highlight w:val="yellow"/><w:u w:val="single"/></w:rPr></w:style></w:styles>',
        { name: '/word/styles.xml', contentType: 'app/xml' }
      );
      if (!styles.ok) throw new Error(styles.reason);
      const cascade = buildStyleCascadeTable(styles.part.root);
      expect(readHeaderPageFrame(part)).toBeNull();
      const story = layoutHeaderFooterStory(
        part,
        WIDTH,
        measurer,
        'spaces-frame',
        undefined,
        cascade
      );
      const [frame, running] = paragraphs(story.fragments);
      expect(frame!.box.width).toBe(WIDTH);
      expect(running!.box.y).toBeGreaterThan(frame!.box.y);
      const spans = frame!.lines.flatMap((line) => line.spans);
      expect(spans.map((span) => span.text).join('')).toBe('   ');
      expect(spans.every((span) => span.box.x + span.box.width <= WIDTH)).toBe(true);
      if (decoration) expect(spans[0]!.style.highlight).toBe('yellow');
    });
  }

  test('an empty frame does not displace an anchored picture or its text', () => {
    const picture = squareAnchorAtLeft({ text: 'Running title' })
      .replace('<w:document ', '<w:hdr ')
      .replace('<w:body>', '')
      .replace('</w:body></w:document>', '</w:hdr>');
    const story = (frame: string) => {
      const xml = picture.replace('<w:p>', frame + '<w:p>');
      const parsed = readOoxmlPart(xml, {
        name: '/word/header1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      });
      if (!parsed.ok) throw new Error(parsed.reason);
      return layoutHeaderFooterStory(
        parsed.part,
        WIDTH,
        measurer,
        'frame-with-picture',
        undefined,
        undefined,
        undefined,
        128,
        undefined,
        undefined,
        layoutContext(parsed.part, parsed.part.name)
      );
    };
    const plain = story('');
    const empty = story(framed(frameProperties('right'), ''));
    expect(empty.flowHeight).toBeCloseTo(plain.flowHeight + 0.05, 6);
    expect(geometry(paragraphs(empty.fragments)[1]!)).toEqual(
      geometry(paragraphs(plain.fragments)[0]!)
    );
    expect(empty.anchoredDrawings).toHaveLength(1);
    const pictureGeometry = (value: typeof plain) => {
      const { x, y, width, height } = value.anchoredDrawings![0]!;
      return { x, y, width, height };
    };
    expect(pictureGeometry(empty)).toEqual(pictureGeometry(plain));
    // Visible frames still refuse this interaction rather than guessing at wrapping.
    expect(story(framed(frameProperties('right'))).flowHeight).toBeGreaterThan(plain.flowHeight);
  });

  test('an empty cached result still opens the header with the anchor', () => {
    const empty = framed(frameProperties(), pageField.replace('<w:r><w:t>1</w:t></w:r>', ''));
    const story = lay(empty + anchor);
    const [frame, running] = paragraphs(story.fragments);
    expect(running!.box.y).toBe(0);
    expect(frame!.box.width).toBe(0);
    // The frame ends 1 twip below the single anchor line, and the story reaches its bottom.
    expect(story.flowHeight).toBeCloseTo(LINE + 0.05, 9);
    const [projected] = paragraphs(onPage(story, 12).fragments);
    expect(textOf(projected!)).toBe('12');
    expect(ink(projected!).right).toBeCloseTo(WIDTH, 9);
  });

  test('a wider value on a later page keeps the placement the header was admitted with', () => {
    // 71 characters end about two characters short of the right margin: clear of "1", not "100".
    const long = `<w:p><w:r><w:t>${'x'.repeat(71)}</w:t></w:r></w:p>`;
    const story = lay(framed(frameProperties('right')) + long);
    expect(story.fragments[1]!.box.y).toBe(0);
    const projected = onPage(story, 100);
    const [frame, running] = paragraphs(projected.fragments);
    expect(textOf(frame!)).toBe('100');
    expect(ink(frame!).left).toBeLessThan(ink(running!).right);
    expect(running!.box.y).toBe(0);
    expect(projected.flowHeight).toBe(story.flowHeight);
  });

  test('the physical sheet picks the side, whatever number the frame displays', () => {
    const story = lay(body);
    // Displayed 1 on sheets 1 and 2, displayed 2 on sheet 3: a restart on the second sheet.
    const placed = [
      [1, 1],
      [1, 2],
      [2, 3],
    ].map(
      ([pageNumber, sheetNumber]) =>
        paragraphs(onPage(story, pageNumber!, sheetNumber).fragments)[0]!
    );
    expect(placed.map(textOf)).toEqual(['1', '1', '2']);
    expect(placed.map((frame) => ink(frame).left)).toEqual([0, WIDTH - CHAR, 0]);
    // The same displayed value on two parities is two layouts, not one cached for both.
    expect(onPage(story, 1, 2)).not.toBe(onPage(story, 1, 1));
    expect(onPage(story, 1, 4)).toBe(onPage(story, 1, 2));
  });

  test('page contexts cache by value, and a repeated context reuses its layout', () => {
    const story = lay(body);
    expect(onPage(story, 7)).toBe(onPage(story, 7));
    expect(onPage(story, 7)).not.toBe(onPage(story, 8));
  });

  test('the frame box is its ink, so clicks beside it reach the running head', () => {
    const story = onPage(lay(body), 12);
    const [frame, running] = paragraphs(story.fragments);
    const model = {
      revision: 0,
      pages: [
        {
          index: 0,
          box: { x: 0, y: 0, width: 544, height: 792 },
          contentBox: { x: 72, y: 72, width: WIDTH, height: 648 },
          fragments: [],
          header: {
            kind: 'header',
            variant: 'default',
            partName: story.partName,
            part: story.part,
            box: { x: 72, y: 36, width: WIDTH, height: story.flowHeight },
            fragments: story.fragments,
          },
        },
      ],
    } as unknown as SemanticLayout;
    const y = 5;
    const onNumber = hitTestFragments(model, 0, story.fragments, {
      x: frame!.box.x + frame!.box.width / 2,
      y,
    });
    expect(onNumber?.position.paragraphId).toBe(frame!.paragraphId);
    for (const x of [2, 200, frame!.box.x - 2]) {
      const beside = hitTestFragments(model, 0, story.fragments, { x, y });
      expect(beside?.position.paragraphId).toBe(running!.paragraphId);
    }
  });
});

describe('a frame placed by parity without a page field', () => {
  const text = '<w:r><w:t>DRAFT</w:t></w:r>';

  test('lays out once per parity', () => {
    const story = lay(framed(frameProperties(), text) + anchor);
    expect(story.pageFieldNeeds.hasPage).toBe(false);
    expect(story.pageFieldNeeds.hasPageParity).toBe(true);
    const odd = onPage(story, 1);
    const even = onPage(story, 2);
    expect(onPage(story, 3)).toBe(odd);
    expect(onPage(story, 4)).toBe(even);
    expect(ink(paragraphs(odd.fragments)[0]!).left).toBe(0);
    expect(ink(paragraphs(even.fragments)[0]!).right).toBe(WIDTH);
    // The sheet decides the parity; the displayed number does not.
    expect(onPage(story, 1, 2)).toBe(even);
    expect(onPage(story, 2, 3)).toBe(odd);
  });

  test('a left, center or right frame reads no page context', () => {
    for (const align of ['left', 'center', 'right']) {
      const story = lay(framed(frameProperties(align), text) + anchor);
      expect(story.pageFieldNeeds.hasPageParity).toBeUndefined();
      expect(onPage(story, 2)).toBe(story);
    }
  });
});

describe('placement on document pages', () => {
  const sectPr = (extra = '') =>
    `<w:sectPr>${extra}<w:pgSz w:w="8400" w:h="2400"/>` +
    '<w:pgMar w:top="400" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>' +
    '</w:sectPr>';
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;

  function documentPart(bodyXml: string): OoxmlPart {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.part;
  }

  const furniture = (content: string, evenContent?: string): PageFurniture => {
    const headers: PageFurniture['headers'] extends ReadonlyMap<infer K, infer V>
      ? Map<K, V>
      : never = new Map();
    headers.set('default', lay(content));
    if (evenContent !== undefined) {
      headers.set('even', layoutHeaderFooterStory(evenPart(evenContent), WIDTH, measurer, 'hf'));
    }
    return {
      titlePage: false,
      evenAndOddHeaders: evenContent !== undefined,
      headers,
      footers: new Map(),
    };
  };
  const evenPart = (content: string) => {
    const parsed = readOoxmlPart(`<w:hdr xmlns:w="${W}">${content}</w:hdr>`, {
      name: '/word/header2.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.part;
  };

  const frames = (layout: SemanticLayout) =>
    layout.pages.map((page) => {
      const [frame, running] = paragraphs(page.header!.fragments);
      return { text: textOf(frame!), left: ink(frame!).left, anchorY: running!.box.y };
    });

  test('a section that restarts its numbering places by the physical sheet', () => {
    // Section 1 has one page. Section 2 starts on physical page 2 and restarts at 1.
    const bodyXml = (restart: string) =>
      `<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
      text('two') +
      pageBreak +
      text('three') +
      sectPr(restart);
    const header = furniture(body);
    const lay2 = (restart: string) =>
      layoutSemanticDocument(documentPart(bodyXml(restart)), 1, {
        measurer,
        sectionFurniture: [header, header],
      });
    expect(frames(lay2(''))).toEqual([
      { text: '1', left: 0, anchorY: 0 },
      { text: '2', left: WIDTH - CHAR, anchorY: 0 },
      { text: '3', left: 0, anchorY: 0 },
    ]);
    // Sheet 2 displays 1 and is still an even sheet, so `inside` takes the right margin.
    expect(frames(lay2('<w:pgNumType w:start="1"/>'))).toEqual([
      { text: '1', left: 0, anchorY: 0 },
      { text: '1', left: WIDTH - CHAR, anchorY: 0 },
      { text: '2', left: 0, anchorY: 0 },
    ]);
    // A frame with no page field follows the sheet's parity too.
    const draft = furniture(framed(frameProperties(), '<w:r><w:t>DRAFT</w:t></w:r>') + anchor);
    const drafted = layoutSemanticDocument(documentPart(bodyXml('<w:pgNumType w:start="1"/>')), 1, {
      measurer,
      sectionFurniture: [draft, draft],
    });
    expect(frames(drafted).map((frame) => frame.left)).toEqual([0, WIDTH - 5 * CHAR, 0]);
  });

  test('a published header re-projects when its sheet moves but its number does not', () => {
    const bodyXml =
      `<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
      text('two') +
      sectPr('<w:pgNumType w:start="1"/>');
    const header = furniture(body);
    const published = layoutSemanticDocument(documentPart(bodyXml), 1, {
      measurer,
      sectionFurniture: [header, header],
    });
    expect(frames(published).map((frame) => [frame.text, frame.left])).toEqual([
      ['1', 0],
      ['1', WIDTH - CHAR],
    ]);
    // Reused sheets that trade places: the same records, the same displayed number and page
    // count, another sheet. Only the sheet parity moved, and each header must follow it.
    const [first, second] = published.pages;
    const swapped = finalizePageFieldProjection({
      ...published,
      revision: 2,
      pages: [
        { ...second!, index: 0 },
        { ...first!, index: 1 },
      ],
    });
    expect(swapped.pages[0]!.header).not.toBe(second!.header);
    expect(swapped.pages[1]!.header).not.toBe(first!.header);
    expect(frames(swapped).map((frame) => [frame.text, frame.left])).toEqual([
      ['1', 0],
      ['1', WIDTH - CHAR],
    ]);
  });

  test('an edit that adds a sheet before a restarted section flips its frames', () => {
    const session = createLayoutSession();
    const header = furniture(body);
    const bodyXml = (breaks: number) =>
      `<w:p><w:r><w:t>one</w:t></w:r></w:p>` +
      pageBreak.repeat(breaks) +
      `<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>end</w:t></w:r></w:p>` +
      text('two') +
      pageBreak +
      text('three') +
      sectPr('<w:pgNumType w:start="1"/>');
    const run = (breaks: number, revision: number) =>
      frames(
        layoutSemanticDocument(documentPart(bodyXml(breaks)), revision, {
          measurer,
          session,
          sectionFurniture: [header, header],
        })
      ).map((frame) => [frame.text, frame.left]);
    const left = 0,
      right = WIDTH - CHAR;
    expect(run(0, 1)).toEqual([
      ['1', left],
      ['1', right],
      ['2', left],
    ]);
    expect(run(1, 2)).toEqual([
      ['1', left],
      ['2', right],
      ['1', left],
      ['2', right],
    ]);
    expect(run(0, 3)).toEqual([
      ['1', left],
      ['1', right],
      ['2', left],
    ]);
  });

  test('even and default variants each place their own frame', () => {
    const even = framed(frameProperties('outside')) + anchor;
    const layout = layoutSemanticDocument(
      documentPart(text('one') + pageBreak + text('two') + pageBreak + text('three') + sectPr()),
      1,
      { measurer, sectionFurniture: [furniture(body, even)] }
    );
    expect(layout.pages.map((page) => page.header?.variant)).toEqual([
      'default',
      'even',
      'default',
    ]);
    // Page 2 is even: `inside` would be right; the even variant's `outside` is left.
    expect(frames(layout).map((frame) => frame.left)).toEqual([0, 0, 0]);
    expect(frames(layout).map((frame) => frame.text)).toEqual(['1', '2', '3']);
  });

  test('the header height excludes the frame, so the body starts one line higher', () => {
    const layoutWith = (content: string) =>
      layoutSemanticDocument(documentPart(text('body') + sectPr()), 1, {
        measurer,
        sectionFurniture: [furniture(content)],
      }).pages[0]!;
    const withFrame = layoutWith(body);
    const withoutFrame = layoutWith(anchor + heading);
    expect(withFrame.contentBox.y).toBe(withoutFrame.contentBox.y);
    expect(withFrame.header!.box.height).toBe(2 * LINE);
  });

  test('the default wrap is around, so an auto frame also leaves the flow', () => {
    const auto = body.replace('w:wrap="around"', 'w:wrap="auto"');
    expect(auto).not.toBe(body);
    const layoutWith = (content: string) =>
      layoutSemanticDocument(documentPart(text('body') + sectPr()), 1, {
        measurer,
        sectionFurniture: [furniture(content)],
      }).pages[0]!;
    expect(layoutWith(auto).contentBox.y).toBe(layoutWith(body).contentBox.y);
    expect(layoutWith(auto).header!.box.height).toBe(2 * LINE);
  });
});

describe('structures that keep the ordinary flow', () => {
  const inFlow = (content: string, root = 'hdr') => {
    const blocks = lay(content, root).fragments;
    // In flow, the frame paragraph takes the story's first line and pushes the next block down.
    return blocks.length === 1 || blocks[1]!.box.y > 0;
  };
  const samples: [string, string][] = [
    ['an explicit position', body.replace(' w:xAlign="inside"', ' w:x="100"')],
    ['a frame width', body.replace('w:y="1"', 'w:y="1" w:w="600"')],
    ['a frame distance', body.replace('w:y="1"', 'w:y="1" w:hSpace="180"')],
    ['page-relative', body.replace('w:hAnchor="margin"', 'w:hAnchor="page"')],
    ['page-anchored', body.replace('w:vAnchor="text"', 'w:vAnchor="page"')],
    ['wrap through', body.replace('w:wrap="around"', 'w:wrap="through"')],
    ['a negative offset', body.replace('w:y="1"', 'w:y="-20"')],
    ['an offset below the anchor line', body.replace('w:y="1"', 'w:y="400"')],
    ['a foreign attribute', body.replace('<w:framePr ', `<w:framePr xmlns:x="urn:x" x:y="1" `)],
    ['NUMPAGES', body.replace('PAGE  ', 'NUMPAGES')],
    ['a tab in the frame', body.replace('<w:t>1</w:t>', '<w:tab/><w:t>1</w:t>')],
    ['a line break in the frame', framed(frameProperties(), '<w:r><w:t>A</w:t><w:br/></w:r>')],
    ['frame indentation', body.replace('<w:pStyle w:val="Header"/>', '<w:ind w:left="200"/>')],
    ['two frames', framed() + framed() + anchor],
    ['a frame after the first paragraph', anchor + framed() + heading],
    ['a table after the frame', framed() + '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'],
    ['a frame alone', framed()],
  ];
  for (const [label, content] of samples) {
    test(label, () => {
      expect(content).not.toBe(body);
      expect(inFlow(content)).toBe(true);
    });
  }

  test('a running head whose text reaches under the frame on either side', () => {
    const left = '<w:p><w:r><w:t>Left running head</w:t></w:r></w:p>';
    const story = lay(framed() + left);
    expect(inFlow(framed() + left)).toBe(true);
    // An even page would leave the left margin free, but the answer holds for every page, so
    // the header keeps one height.
    const even = onPage(story, 2);
    expect(even.fragments[1]!.box.y).toBeGreaterThan(0);
    expect(even.flowHeight).toBe(story.flowHeight);
    // A frame that only ever takes the right margin is placed.
    const right = paragraphs(lay(framed(frameProperties('right')) + left).fragments);
    expect(ink(right[0]!).right).toBeCloseTo(WIDTH, 9);
    expect(right[1]!.box.y).toBe(0);
  });

  test('a bordered paragraph in the frame band', () => {
    const bordered =
      '<w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="4"/></w:pBdr>' +
      '</w:pPr><w:r><w:t>HEAD</w:t></w:r></w:p>';
    expect(inFlow(framed() + bordered)).toBe(true);
  });

  test('a frame that a paragraph style supplies or extends', () => {
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Framed">` +
        '<w:name w:val="Framed"/><w:pPr><w:framePr w:w="2000" w:wrap="around" ' +
        'w:vAnchor="text" w:hAnchor="margin" w:xAlign="right"/></w:pPr></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const cascade = buildStyleCascadeTable(styles.part.root);
    const styled = '<w:p><w:pPr><w:pStyle w:val="Framed"/></w:pPr><w:r><w:t>HEAD</w:t></w:r></w:p>';
    for (const content of [
      body.replace('<w:pStyle w:val="Header"/>', '<w:pStyle w:val="Framed"/>'),
      framed() + anchor + styled,
    ]) {
      const story = layoutHeaderFooterStory(
        headerPart(content),
        WIDTH,
        measurer,
        'hf',
        undefined,
        cascade
      );
      expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
    }
  });

  test('a wide header is refused before its children are queued', () => {
    const part = headerPart(body);
    const children = Array.from({ length: 5000 }, () => part.root.children[1]!);
    let queued = 0;
    const iterate = children[Symbol.iterator].bind(children);
    Object.defineProperty(children, Symbol.iterator, {
      value: function* () {
        for (const child of iterate()) {
          queued += 1;
          yield child;
        }
      },
    });
    const wide = { ...part, root: { ...part.root, children } } as unknown as OoxmlPart;
    expect(readHeaderPageFrame(wide)).toBeNull();
    expect(queued).toBe(0);
  });

  test('a footer is left to the footer lanes', () => {
    expect(readHeaderPageFrame(headerPart(body, 'ftr'))).toBeNull();
    expect(inFlow(body, 'ftr')).toBe(true);
  });
});
