// `w:pgBorders` (ECMA-376 §17.6.10): parse, published frame geometry, painted frame.
//
// The three things this feature is easy to get wrong, each pinned here:
//   - `w:offsetFrom` defaults to `text`, not `page`, and the two put the frame in different
//     places — one measured from the sheet edge, one from the text.
//   - `w:sz` is EIGHTHS of a point, like every other `CT_Border`.
//   - an ART border (`apples`, …) is a bitmap tile, not a line; degrading it to a rectangle
//     invents a frame nobody authored.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { bodySectionNode, parseSectionProperties } from '../section-properties.ts';
import { parsePageBorders } from '../page-borders.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageBorderStrokeRecord, PageRecord } from '../semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Letter, one-inch margins — layout's defaults, so every number below is arithmetic. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

/** `count` single-line paragraphs, then a body `w:sectPr` carrying `pgBorders`. */
function docBody(pgBorders: string, count = 1): string {
  const paragraphs = Array.from(
    { length: count },
    (_, index) => `<w:p><w:r><w:t>p${index}</w:t></w:r></w:p>`
  ).join('');
  return `${paragraphs}<w:sectPr>${pgBorders}</w:sectPr>`;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

function bordersOf(pgBorders: string) {
  const part = load(docBody(pgBorders));
  const sectPr = bodySectionNode(part);
  if (!sectPr) throw new Error('no body sectPr');
  return parsePageBorders(sectPr);
}

function strokeOf(page: PageRecord | undefined, side: string): PageBorderStrokeRecord | undefined {
  return page?.pageBorders?.strokes.find((stroke) => stroke.side === side);
}

function painted(body: string): HTMLElement {
  const container = document.createElement('div');
  paintSemanticLayout(container, lay(body), { scale: 1 });
  return container;
}

const SINGLE_1PT = 'w:val="single" w:sz="8" w:space="24"';
const allSides = (attrs = SINGLE_1PT, element = ''): string =>
  `<w:pgBorders ${element}><w:top ${attrs}/><w:left ${attrs}/><w:bottom ${attrs}/><w:right ${attrs}/></w:pgBorders>`;

describe('w:pgBorders — parsing', () => {
  test('offsetFrom defaults to text, not page, when the attribute is absent', () => {
    expect(bordersOf(allSides())?.offsetFrom).toBe('text');
    expect(bordersOf(allSides(SINGLE_1PT, 'w:offsetFrom="page"'))?.offsetFrom).toBe('page');
    expect(bordersOf(allSides(SINGLE_1PT, 'w:offsetFrom="text"'))?.offsetFrom).toBe('text');
    // An unknown value is not a third mode; it falls back to the schema default.
    expect(bordersOf(allSides(SINGLE_1PT, 'w:offsetFrom="margin"'))?.offsetFrom).toBe('text');
  });

  test('display and zOrder take their schema defaults', () => {
    const bare = bordersOf(allSides());
    expect(bare?.display).toBe('allPages');
    expect(bare?.zOrder).toBe('front');
    expect(bordersOf(allSides(SINGLE_1PT, 'w:display="firstPage"'))?.display).toBe('firstPage');
    expect(bordersOf(allSides(SINGLE_1PT, 'w:display="notFirstPage"'))?.display).toBe(
      'notFirstPage'
    );
    expect(bordersOf(allSides(SINGLE_1PT, 'w:zOrder="back"'))?.zOrder).toBe('back');
  });

  test('w:sz is eighths of a point and w:space is whole points', () => {
    const edge = bordersOf(allSides('w:val="single" w:sz="24" w:space="31"'))?.top;
    expect(edge?.widthPt).toBe(3);
    expect(edge?.spacePt).toBe(31);
    expect(bordersOf(allSides('w:val="single" w:sz="4"'))?.top?.widthPt).toBe(0.5);
    // A bare edge with no `w:sz` still paints: Word's ½pt default.
    expect(bordersOf(allSides('w:val="single"'))?.top?.widthPt).toBe(0.5);
  });

  test('borders only in the tracked previous properties still frame the pages', () => {
    const change = (old: string) =>
      `<w:sectPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:sectPr>` +
      `<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>${old}</w:sectPr></w:sectPrChange>`;
    const blue = allSides('w:val="single" w:sz="24" w:color="00B0F0"');
    const red = allSides('w:val="single" w:sz="8" w:color="FF0000"');
    expect(bordersOf(change(blue))?.top?.color).toBe('00B0F0');
    // The section's own borders win over the previous ones.
    expect(bordersOf(red + change(blue))?.top?.color).toBe('FF0000');
    expect(bordersOf(change(''))).toBeUndefined();
    // The page keeps the current size: the previous landscape size does not apply.
    const page = lay(docBody(change(blue))).pages[0]!;
    expect(page.box.width).toBe(PAGE_WIDTH);
    expect(strokeOf(page, 'top')?.edge.color).toBe('00B0F0');
  });

  test('w:color auto keeps a null colour for paint to default to black', () => {
    expect(bordersOf(allSides('w:val="single" w:sz="8" w:color="auto"'))?.top?.color).toBeNull();
    expect(bordersOf(allSides('w:val="single" w:sz="8" w:color="FF0000"'))?.top?.color).toBe(
      'FF0000'
    );
  });

  test('none / nil sides are dropped; a pgBorders with nothing left is undefined', () => {
    const mixed = bordersOf(
      `<w:pgBorders><w:top ${SINGLE_1PT}/><w:left w:val="none"/><w:bottom w:val="nil"/></w:pgBorders>`
    );
    expect(mixed?.top).toBeDefined();
    expect(mixed?.left).toBeUndefined();
    expect(mixed?.bottom).toBeUndefined();
    expect(mixed?.right).toBeUndefined();
    expect(bordersOf('<w:pgBorders><w:top w:val="none"/></w:pgBorders>')).toBeUndefined();
    expect(bordersOf('<w:pgBorders/>')).toBeUndefined();
  });

  test('art borders are ignored, not degraded to a line', () => {
    const mixed = bordersOf(
      `<w:pgBorders><w:top w:val="apples" w:sz="8" w:space="24"/><w:left ${SINGLE_1PT}/></w:pgBorders>`
    );
    expect(mixed?.top).toBeUndefined();
    expect(mixed?.left?.val).toBe('single');
    // A wholly decorative frame publishes nothing rather than a plain black box.
    expect(bordersOf(allSides('w:val="cabins" w:sz="8" w:space="24"'))).toBeUndefined();
  });

  test('parseSectionProperties carries the frame onto the section', () => {
    const part = load(docBody(allSides(SINGLE_1PT, 'w:zOrder="back"')));
    const properties = parseSectionProperties(bodySectionNode(part));
    expect(properties.pageBorders?.zOrder).toBe('back');
    expect(parseSectionProperties(bodySectionNode(load(docBody('')))).pageBorders).toBeUndefined();
  });
});

describe('w:pgBorders — layout publishes the frame', () => {
  test('offsetFrom="page" measures w:space from the sheet edge', () => {
    const page = lay(docBody(allSides(SINGLE_1PT, 'w:offsetFrom="page"'))).pages[0]!;
    // space 24, stroke 1pt (w:sz="8"): the rule's OUTER face sits 24pt in from each edge.
    expect(strokeOf(page, 'top')!.box).toEqual({ x: 24, y: 24, width: 564, height: 1 });
    expect(strokeOf(page, 'left')!.box).toEqual({ x: 24, y: 24, width: 1, height: 744 });
    expect(strokeOf(page, 'bottom')!.box).toEqual({
      x: 24,
      y: PAGE_HEIGHT - 24 - 1,
      width: 564,
      height: 1,
    });
    expect(strokeOf(page, 'right')!.box).toEqual({
      x: PAGE_WIDTH - 24 - 1,
      y: 24,
      width: 1,
      height: 744,
    });
  });

  test('offsetFrom="text" (the default) measures w:space from the text, so margins move it', () => {
    const page = lay(docBody(allSides())).pages[0]!;
    // margin 72 − space 24 − stroke 1 = 47 from each sheet edge.
    const inset = MARGIN - 24 - 1;
    expect(inset).toBe(47);
    expect(strokeOf(page, 'top')!.box).toEqual({
      x: inset,
      y: inset,
      width: PAGE_WIDTH - 2 * inset,
      height: 1,
    });
    expect(strokeOf(page, 'right')!.box.x).toBe(PAGE_WIDTH - inset - 1);
    // The same file read as `page` would land the frame somewhere else entirely.
    const asPage = lay(docBody(allSides(SINGLE_1PT, 'w:offsetFrom="page"'))).pages[0]!;
    expect(strokeOf(asPage, 'top')!.box.y).not.toBe(strokeOf(page, 'top')!.box.y);
  });

  test('offsetFrom="text" pins the frame to the sheet rather than off it', () => {
    // space 96 > margin 72: Word cannot draw outside the paper, and neither does this.
    const page = lay(docBody(allSides('w:val="single" w:sz="8" w:space="96"'))).pages[0]!;
    expect(strokeOf(page, 'top')!.box.y).toBe(0);
    expect(strokeOf(page, 'left')!.box.x).toBe(0);
  });

  test('w:sz reaches the published stroke as eighths of a point', () => {
    const thick = lay(docBody(allSides('w:val="single" w:sz="24" w:space="24"'))).pages[0]!;
    expect(strokeOf(thick, 'top')!.box.height).toBe(3);
    expect(strokeOf(thick, 'left')!.box.width).toBe(3);
    // A compound style publishes the INFLATED band instead, like every other border.
    const dbl = lay(docBody(allSides('w:val="double" w:sz="8" w:space="24"'))).pages[0]!;
    expect(strokeOf(dbl, 'top')!.box.height).toBe(3);
  });

  test('a side switched off publishes no stroke, and the rest still close a rectangle', () => {
    const page = lay(
      docBody(
        `<w:pgBorders w:offsetFrom="page"><w:top ${SINGLE_1PT}/><w:left w:val="none"/><w:bottom ${SINGLE_1PT}/><w:right ${SINGLE_1PT}/></w:pgBorders>`
      )
    ).pages[0]!;
    expect(page.pageBorders!.strokes.map((stroke) => stroke.side).sort()).toEqual([
      'bottom',
      'right',
      'top',
    ]);
    // The missing left edge leaves the rectangle open at the sheet edge, and the two
    // horizontal rules run to it rather than stopping where a left rule would have been.
    // They still end on the right rule's OUTER face, so the surviving corners close.
    expect(strokeOf(page, 'top')!.box.x).toBe(0);
    expect(strokeOf(page, 'top')!.box.width).toBe(PAGE_WIDTH - 24);
    expect(strokeOf(page, 'right')!.box.x + strokeOf(page, 'right')!.box.width).toBe(
      PAGE_WIDTH - 24
    );
  });

  test('an art border publishes no frame at all', () => {
    const page = lay(docBody(allSides('w:val="apples" w:sz="8" w:space="24"'))).pages[0]!;
    expect(page.pageBorders).toBeUndefined();
  });

  test('display="firstPage" draws only on the section first page', () => {
    const layout = lay(docBody(allSides(SINGLE_1PT, 'w:display="firstPage"'), 120));
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages[0]!.pageBorders?.strokes.length).toBe(4);
    for (const page of layout.pages.slice(1)) expect(page.pageBorders).toBeUndefined();
  });

  test('display="notFirstPage" draws on every page but the first', () => {
    const layout = lay(docBody(allSides(SINGLE_1PT, 'w:display="notFirstPage"'), 120));
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages[0]!.pageBorders).toBeUndefined();
    for (const page of layout.pages.slice(1)) expect(page.pageBorders?.strokes.length).toBe(4);
  });

  test('display="allPages" is the default and draws on all of them', () => {
    const layout = lay(docBody(allSides(), 120));
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) expect(page.pageBorders?.strokes.length).toBe(4);
  });

  test('display is SECTION-scoped: each section gets its own first page', () => {
    // Section one: 120 paragraphs closed by a paragraph-level sectPr. Section two: 120 more,
    // closed by the body sectPr. Both ask for a first-page-only frame.
    const borders = allSides(SINGLE_1PT, 'w:display="firstPage"');
    const filler = (prefix: string) =>
      Array.from({ length: 120 }, (_, i) => `<w:p><w:r><w:t>${prefix}${i}</w:t></w:r></w:p>`).join(
        ''
      );
    const layout = lay(
      `${filler('a')}<w:p><w:pPr><w:sectPr>${borders}</w:sectPr></w:pPr></w:p>` +
        `${filler('b')}<w:sectPr>${borders}</w:sectPr>`
    );
    const framed = layout.pages
      .map((page, index) => (page.pageBorders ? index : -1))
      .filter((index) => index >= 0);
    // Two frames in a document Word paginates onto many sheets: one per section, and the
    // second is NOT page 0 of the document.
    expect(framed.length).toBe(2);
    expect(framed[0]).toBe(0);
    expect(framed[1]).toBeGreaterThan(0);
  });

  test('strokes are page-box relative, so every sheet publishes the same frame', () => {
    const layout = lay(docBody(allSides(SINGLE_1PT, 'w:offsetFrom="page"'), 120));
    const first = strokeOf(layout.pages[0], 'top')!.box;
    const second = strokeOf(layout.pages[1], 'top')!.box;
    expect(second).toEqual(first);
    // The sheets themselves are stacked, which is exactly what the frame must NOT inherit.
    expect(layout.pages[1]!.box.y).toBeGreaterThan(layout.pages[0]!.box.y);
  });
});

describe('w:pgBorders — paint', () => {
  const pageElement = (container: HTMLElement): HTMLElement =>
    container.querySelector('.docx-page') as HTMLElement;

  const childOrder = (container: HTMLElement): string[] =>
    [...pageElement(container).children].map((child) => child.className.split(' ')[0]!);

  test('zOrder="back" paints the frame before the page content', () => {
    const order = childOrder(painted(docBody(allSides(SINGLE_1PT, 'w:zOrder="back"'))));
    expect(order.indexOf('docx-page-borders')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('docx-page-borders')).toBeLessThan(order.indexOf('docx-page-content'));
  });

  test('zOrder defaults to front, painting the frame after the page content', () => {
    const order = childOrder(painted(docBody(allSides())));
    expect(order.indexOf('docx-page-borders')).toBeGreaterThan(order.indexOf('docx-page-content'));
    const explicit = childOrder(painted(docBody(allSides(SINGLE_1PT, 'w:zOrder="front"'))));
    expect(explicit.indexOf('docx-page-borders')).toBeGreaterThan(
      explicit.indexOf('docx-page-content')
    );
  });

  test('each stroke paints at its published box, in its authored colour', () => {
    const container = painted(
      docBody(allSides('w:val="single" w:sz="16" w:space="24"', 'w:offsetFrom="page"'))
    );
    const top = container.querySelector('.docx-page-border-top') as HTMLElement;
    expect(top.style.left).toBe('24px');
    expect(top.style.top).toBe('24px');
    expect(top.style.height).toBe('2px');
    expect(top.style.backgroundColor).toBe('#000000');
    const right = container.querySelector('.docx-page-border-right') as HTMLElement;
    expect(right.style.left).toBe(`${PAGE_WIDTH - 24 - 2}px`);
    expect(right.style.width).toBe('2px');

    const red = painted(docBody(allSides('w:val="single" w:sz="16" w:color="FF0000"')));
    expect((red.querySelector('.docx-page-border-top') as HTMLElement).style.backgroundColor).toBe(
      '#FF0000'
    );
  });

  test('the ST_Border style mapping is the one paragraph rules use', () => {
    const dotted = painted(docBody(allSides('w:val="dotted" w:sz="8" w:space="24"')));
    const dottedTop = dotted.querySelector('.docx-page-border-top') as HTMLElement;
    expect(dottedTop.style.backgroundImage).toContain('linear-gradient');
    // The gaps are the gradient's transparent stops: an ink-coloured fill under them would
    // close every gap. `scripts/check-border-pattern-rendering.mjs` checks the pixels.
    expect(dottedTop.style.backgroundColor).toBe('transparent');
    const dashed = painted(docBody(allSides('w:val="dashed" w:sz="8" w:space="24"')));
    const dashedTop = dashed.querySelector('.docx-page-border-top') as HTMLElement;
    expect(dashedTop.style.backgroundImage).toContain('linear-gradient');
    expect(dashedTop.style.backgroundColor).toBe('transparent');

    const dbl = painted(docBody(allSides('w:val="double" w:sz="24" w:space="24"')));
    const doubleTop = dbl.querySelector('.docx-page-border-top') as HTMLElement;
    expect(doubleTop.style.borderTop).toBe('');
    expect(doubleTop.style.borderBottom).toBe('');
    expect(doubleTop.style.backgroundImage).toContain('linear-gradient(to bottom');
    expect(doubleTop.style.backgroundColor).toBe('transparent');
  });

  test('a hairline rule snaps to a visible pixel and grows inward', () => {
    // w:sz="2" is ¼pt — 0.25 CSS px at scale 1, which paints as nothing at all.
    const container = painted(
      docBody(allSides('w:val="single" w:sz="2" w:space="24"', 'w:offsetFrom="page"'))
    );
    const top = container.querySelector('.docx-page-border-top') as HTMLElement;
    expect(top.style.height).toBe('1px');
    expect(top.style.top).toBe('24px');
    const bottom = container.querySelector('.docx-page-border-bottom') as HTMLElement;
    expect(bottom.style.height).toBe('1px');
    // Pinned by its far face: 792 − 24 − 1 (snapped), never past the sheet edge.
    expect(bottom.style.top).toBe(`${PAGE_HEIGHT - 24 - 1}px`);
  });

  test('the frame is inert chrome: aria-hidden and not a pointer target', () => {
    const container = painted(docBody(allSides()));
    const layer = container.querySelector('.docx-page-borders') as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.getAttribute('contenteditable')).toBe('false');
    expect(layer.style.pointerEvents).toBe('none');
  });

  test('a document with no pgBorders paints no frame', () => {
    expect(painted(docBody('')).querySelector('.docx-page-borders')).toBeNull();
  });
});
