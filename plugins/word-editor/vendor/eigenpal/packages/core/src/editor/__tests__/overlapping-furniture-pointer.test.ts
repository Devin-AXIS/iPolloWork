// A negative `w:top` or `w:bottom` measures the body from the page edge, so a tall header or
// footer paints over body lines. Inside the body's content box the body takes the press: a
// double click on a body word selects the word, and a click on body text while the header is
// open returns to the body. The story's own glyphs and anchored drawings stay reachable where
// no body glyph is under the pointer, and the margin band outside the body still opens it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type {
  AnchoredDrawingRecord,
  HeaderFooterStoryRecord,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
} from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  picture,
} from './image-decode-harness.ts';

const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FTR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const EMU_PER_POINT = 12700;

const bodyParagraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const rightParagraph = (text: string) =>
  `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A 36pt picture in front of the text, placed from the column and the page. */
function floatingPicture(id: number, columnX: number, pageY: number): string {
  return (
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    `layoutInCell="1" allowOverlap="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${columnX * EMU_PER_POINT}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${pageY * EMU_PER_POINT}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="457200" cy="457200"/><wp:wrapNone/><wp:docPr id="${id}" name="pic"/>` +
    `${picture(id)}</wp:anchor></w:drawing></w:r></w:p>`
  );
}

interface OverlapOptions {
  /** `w:pgMar/@w:top` in twips; negative for an exact inset. */
  readonly top?: number;
  /** Extra header content after the right-aligned lines. */
  readonly headerExtra?: string;
}

/**
 * Letter paper, a 64.8pt exact top inset and a 57.6pt exact bottom inset. The header holds
 * twelve right-aligned lines from 36pt down; the footer holds eight from near the page
 * bottom up. Body lines are short and left-aligned, so the story text and the body text sit
 * side by side on the overlapped lines.
 */
function overlapDocx(options: OverlapOptions = {}): Uint8Array {
  const header = Array.from({ length: 12 }, (_, i) => rightParagraph(`H${i + 1}`)).join('');
  const footer = Array.from({ length: 8 }, (_, i) => rightParagraph(`F${i + 1}`)).join('');
  const body = Array.from({ length: 60 }, (_, i) => bodyParagraph(`Body word ${i + 1}`)).join('');
  const imageRels = strToU8(
    `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
  );
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>${body}<w:sectPr>` +
        '<w:headerReference r:id="rIdHdr" w:type="default"/>' +
        '<w:footerReference r:id="rIdFtr" w:type="default"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        `<w:pgMar w:top="${options.top ?? -1296}" w:right="1440" w:bottom="-1152" w:left="1440" ` +
        'w:header="720" w:footer="144" w:gutter="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdHdr" Type="${HDR}" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${FTR}" Target="footer1.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr ${DRAWING_NS}>${header}${options.headerExtra ?? ''}</w:hdr>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr ${DRAWING_NS}>${footer}</w:ftr>`),
    'word/styles.xml': strToU8(`<w:styles ${DRAWING_NS}>${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/_rels/header1.xml.rels': imageRels,
    'word/media/image1.png': PNG_1X1,
  });
}

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly pages: HTMLElement;
  readonly page: PageRecord;
}

function mount(bytes: Uint8Array): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // happy-dom has no layout. With the pages layer at the client origin and scale 1, a client
  // point is a sheet point on the first page.
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 2000, bottom: 4000, width: 2000, height: 4000 }),
  });
  pages.focus();
  return { surface: result.surface, pages, page: result.surface.layout().pages[0]! };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function press(mounted: Mounted, point: Point): PointerEvent {
  const init = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: point.x,
    clientY: point.y,
  };
  const event = new PointerEvent('pointerdown', init);
  mounted.pages.dispatchEvent(event);
  document.dispatchEvent(new PointerEvent('pointerup', init));
  return event;
}

function doublePress(mounted: Mounted, point: Point): void {
  press(mounted, point);
  press(mounted, point);
}

const paragraphs = (blocks: readonly { kind: string }[]): ParagraphFragmentRecord[] =>
  blocks.filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');

/** Every line of the body in sheet coordinates, with its paragraph id. */
function bodyLines(page: PageRecord): { line: LineRecord; paragraphId: string; top: number }[] {
  return paragraphs(page.fragments).flatMap((fragment) =>
    fragment.lines.map((line) => ({
      line,
      paragraphId: fragment.paragraphId,
      top: page.contentBox.y + line.box.y,
    }))
  );
}

/** Every line of a story in sheet coordinates, with its paragraph id. */
function storyLines(story: HeaderFooterStoryRecord) {
  return paragraphs(story.fragments)
    .flatMap((fragment) =>
      fragment.lines.map((line) => ({
        line,
        paragraphId: fragment.paragraphId,
        top: story.box.y + line.box.y,
      }))
    )
    .filter((entry) => entry.line.spans.length > 0);
}

const inContentBox = (page: PageRecord, y: number): boolean =>
  y >= page.contentBox.y && y < page.contentBox.y + page.contentBox.height;

/**
 * A point on the first glyph of a body line that the story also covers. The fifth such line
 * by default, so a selection there cannot be the initial caret in the first paragraph.
 */
function bodyGlyphUnder(page: PageRecord, story: HeaderFooterStoryRecord, index = 4) {
  const found = bodyLines(page).filter(
    ({ line, top }) =>
      top >= story.box.y &&
      top + line.box.height <= story.box.y + story.box.height &&
      line.spans.length > 0
  )[index];
  if (!found) throw new Error('no body line under the story');
  const span = found.line.spans[0]!;
  return {
    paragraphId: found.paragraphId,
    point: {
      x: page.contentBox.x + span.box.x + 2,
      y: found.top + found.line.box.height / 2,
    },
  };
}

/** A point on the last glyph of a story line, inside or outside the body's content box. */
function storyGlyph(page: PageRecord, story: HeaderFooterStoryRecord, insideBody: boolean) {
  const found = storyLines(story).find(({ top, line }) =>
    insideBody
      ? inContentBox(page, top) && inContentBox(page, top + line.box.height)
      : top + line.box.height <= page.contentBox.y
  );
  if (!found) throw new Error('no story line in the requested band');
  const span = found.line.spans[found.line.spans.length - 1]!;
  return {
    paragraphId: found.paragraphId,
    point: {
      x: story.box.x + span.box.x + span.box.width - 1,
      y: found.top + found.line.box.height / 2,
    },
  };
}

const insideStoryBox = (story: HeaderFooterStoryRecord, point: Point): boolean =>
  point.x >= story.box.x &&
  point.x < story.box.x + story.box.width &&
  point.y >= story.box.y &&
  point.y < story.box.y + story.box.height;

function drawingCentre(story: HeaderFooterStoryRecord, drawing: AnchoredDrawingRecord): Point {
  return {
    x: story.box.x + drawing.x + drawing.width / 2,
    y: story.box.y + drawing.y + drawing.height / 2,
  };
}

function expectBodyWord(mounted: Mounted, paragraphId: string): void {
  expect(mounted.surface.activeScope()).toEqual({ kind: 'body' });
  const { anchor, head } = mounted.surface.state().selection;
  expect(anchor.paragraphId).toBe(paragraphId);
  expect(head.paragraphId).toBe(paragraphId);
  expect(head.offset).toBeGreaterThan(anchor.offset);
}

function expectInHeader(mounted: Mounted, paragraphId: string): void {
  expect(mounted.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdHdr' });
  expect(mounted.surface.state().selection.head.paragraphId).toBe(paragraphId);
}

describe('a header over body lines (negative top margin)', () => {
  test('the fixture overlaps: the body starts at 64.8pt, inside the header story', () => {
    const { page, surface } = mount(overlapDocx());
    expect(page.contentBox.y).toBeCloseTo(64.8, 5);
    const header = page.header!;
    expect(header.box.y).toBeCloseTo(36, 5);
    expect(header.box.y + header.box.height).toBeGreaterThan(page.contentBox.y + 100);
    const footer = page.footer!;
    expect(footer.box.y).toBeLessThan(page.contentBox.y + page.contentBox.height - 50);
    surface.destroy();
  });

  test('a double click on a body word selects the word, not the header', () => {
    const mounted = mount(overlapDocx());
    const { paragraphId, point } = bodyGlyphUnder(mounted.page, mounted.page.header!);
    expect(inContentBox(mounted.page, point.y)).toBe(true);
    doublePress(mounted, point);
    expectBodyWord(mounted, paragraphId);
    mounted.surface.destroy();
  });

  test('a double click on header text inside the body area, clear of body text, opens it', () => {
    const mounted = mount(overlapDocx());
    const { paragraphId, point } = storyGlyph(mounted.page, mounted.page.header!, true);
    doublePress(mounted, point);
    expectInHeader(mounted, paragraphId);
    mounted.surface.destroy();
  });

  test('a double click on header text in the margin above the body still opens it', () => {
    const mounted = mount(overlapDocx());
    const { paragraphId, point } = storyGlyph(mounted.page, mounted.page.header!, false);
    expect(point.y).toBeLessThan(mounted.page.contentBox.y);
    doublePress(mounted, point);
    expectInHeader(mounted, paragraphId);
    mounted.surface.destroy();
  });

  test('a double click in body whitespace beside the header lines stays in the body', () => {
    const mounted = mount(overlapDocx());
    const { paragraphId, point } = bodyGlyphUnder(mounted.page, mounted.page.header!);
    // Between the short body text and the right-aligned header text on the same line.
    const between = {
      x: mounted.page.contentBox.x + mounted.page.contentBox.width / 2,
      y: point.y,
    };
    doublePress(mounted, between);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'body' });
    expect(mounted.surface.state().selection.head.paragraphId).toBe(paragraphId);
    mounted.surface.destroy();
  });

  test('a floating header picture over body whitespace opens the header on a double click', () => {
    // 300pt right of the column edge, clear of the short body lines and the header text.
    const mounted = mount(overlapDocx({ headerExtra: floatingPicture(21, 300, 120) }));
    const header = mounted.page.header!;
    const [drawing] = header.anchoredDrawings ?? [];
    expect(drawing).toBeDefined();
    const point = drawingCentre(header, drawing!);
    expect(inContentBox(mounted.page, point.y)).toBe(true);
    expect(insideStoryBox(header, point)).toBe(true);
    doublePress(mounted, point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdHdr' });
    mounted.surface.destroy();
  });

  test('a floating header picture over body glyphs leaves the body word selectable', () => {
    // At the column edge, over the start of the body lines, inside the header story.
    const mounted = mount(overlapDocx({ headerExtra: floatingPicture(22, 0, 120) }));
    const header = mounted.page.header!;
    const [drawing] = header.anchoredDrawings ?? [];
    expect(drawing).toBeDefined();
    const top = header.box.y + drawing!.y;
    const covered = bodyLines(mounted.page).find(
      ({ line, top: lineTop }) =>
        lineTop >= top && lineTop + line.box.height <= top + drawing!.height
    )!;
    const point = {
      x: mounted.page.contentBox.x + covered.line.spans[0]!.box.x + 2,
      y: covered.top + covered.line.box.height / 2,
    };
    expect(point.x).toBeLessThan(header.box.x + drawing!.x + drawing!.width);
    expect(insideStoryBox(header, point)).toBe(true);
    doublePress(mounted, point);
    expectBodyWord(mounted, covered.paragraphId);
    mounted.surface.destroy();
  });
});

describe('an open header over body lines', () => {
  function openHeader(): Mounted {
    const mounted = mount(overlapDocx());
    expect(mounted.surface.enterHeaderFooter({ rId: 'rIdHdr', pageIndex: 0 })).toBe(true);
    return mounted;
  }

  test('a click on body text returns to the body', () => {
    const mounted = openHeader();
    const { point } = bodyGlyphUnder(mounted.page, mounted.page.header!);
    press(mounted, point);
    // The exit restores the body selection from before the header opened.
    expect(mounted.surface.activeScope()).toEqual({ kind: 'body' });
    mounted.surface.destroy();
  });

  test('a click on its own text inside the body area keeps editing the header', () => {
    const mounted = openHeader();
    const { paragraphId, point } = storyGlyph(mounted.page, mounted.page.header!, true);
    press(mounted, point);
    expectInHeader(mounted, paragraphId);
    mounted.surface.destroy();
  });

  test('a click in its whitespace beside its text keeps editing the header', () => {
    const mounted = openHeader();
    const { paragraphId, point } = storyGlyph(mounted.page, mounted.page.header!, true);
    // Left of the right-aligned text, right of the short body line on the same row.
    press(mounted, { x: point.x - 60, y: point.y });
    expectInHeader(mounted, paragraphId);
    mounted.surface.destroy();
  });
});

describe('a footer over body lines (negative bottom margin)', () => {
  test('a double click on a body word selects the word, not the footer', () => {
    const mounted = mount(overlapDocx());
    const { paragraphId, point } = bodyGlyphUnder(mounted.page, mounted.page.footer!, 0);
    doublePress(mounted, point);
    expectBodyWord(mounted, paragraphId);
    mounted.surface.destroy();
  });
});

describe('a positive margin keeps the band', () => {
  test('a double click in the header margin whitespace still opens the header', () => {
    const mounted = mount(overlapDocx({ top: 4000 }));
    const header = mounted.page.header!;
    // The header grows past 4000 twips, so the body starts below the story: no overlap.
    expect(mounted.page.contentBox.y).toBeGreaterThanOrEqual(header.box.y + header.box.height);
    doublePress(mounted, { x: header.box.x + 8, y: header.box.y + 4 });
    expect(mounted.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdHdr' });
    mounted.surface.destroy();
  });
});

test('drop point lookup refuses inactive header glyphs over body whitespace', () => {
  const mounted = mount(overlapDocx());
  try {
    const { point } = storyGlyph(mounted.page, mounted.page.header!, true);
    expect(mounted.surface.pointAt(point.x, point.y)).toBeNull();
    const body = bodyGlyphUnder(mounted.page, mounted.page.header!);
    expect(mounted.surface.pointAt(body.point.x, body.point.y)?.hit.position.paragraphId).toBe(
      body.paragraphId
    );
  } finally {
    mounted.surface.destroy();
  }
});
