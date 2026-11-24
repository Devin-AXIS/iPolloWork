// A negative `w:top` or `w:bottom` lets a tall header or footer paint over body lines. The band
// is painted after the body, so in a browser it is the event target over those lines unless it
// is transparent to the pointer. These tests model that: `browserTarget` walks the layers
// painted after the body element, topmost first, and returns the first element whose painted
// box contains the point and whose `pointer-events` (inline style plus the real stylesheet) is
// not `none`. Events go to that element, not to the pages root. This is a model of browser
// hit testing (inline boxes, DOM paint order, stylesheet cascade), not a browser check.
//
// Element assertions compare identity as booleans. A failing `toBe(element)` prints the whole
// DOM and window graph, which is slow and uses gigabytes of memory.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import postcss from 'postcss';
import type {
  HeaderFooterStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  StyleSpanRecord,
} from '../../layout/semantic-records.ts';
import type { HyperlinkActivation } from '../surface-navigation.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  W_NS,
  inlinePicture,
  picture,
} from './image-decode-harness.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const EMU_PER_POINT = 12700;

// ---------------------------------------------------------------------------------------------
// Pointer-events cascade from the shipped stylesheet
// ---------------------------------------------------------------------------------------------

interface PointerRule {
  readonly selector: string;
  readonly value: string;
  readonly important: boolean;
  readonly specificity: number;
  readonly order: number;
}

function specificity(selector: string): number {
  const flattened = selector.replace(/:not\(([^)]*)\)/g, ' $1 ');
  const ids = flattened.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (flattened.match(/\.[\w-]+/g)?.length ?? 0) +
    (flattened.match(/\[[^\]]+\]/g)?.length ?? 0) +
    (flattened.match(/:[\w-]+/g)?.length ?? 0);
  const elements = flattened.match(/(^|[\s>~+])[a-z][\w-]*/g)?.length ?? 0;
  return ids * 10_000 + classes * 100 + elements;
}

/** Screen `pointer-events` rules. State selectors never match an idle hit test. */
const POINTER_RULES: readonly PointerRule[] = (() => {
  const cssPath = resolve(import.meta.dir, '../../styles/editor.css');
  const rules: PointerRule[] = [];
  let order = 0;
  postcss.parse(readFileSync(cssPath, 'utf8'), { from: cssPath }).walkRules((rule) => {
    if (rule.parent?.type === 'atrule') return;
    rule.walkDecls('pointer-events', (decl) => {
      for (const selector of rule.selectors) {
        if (/:(hover|focus|active)|::/.test(selector)) continue;
        rules.push({
          selector,
          value: decl.value,
          important: decl.important,
          specificity: specificity(selector),
          order: (order += 1),
        });
      }
    });
  });
  return rules;
})();

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

const strongest = (rules: PointerRule[]): PointerRule | undefined =>
  rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order).at(-1);

/** Computed `pointer-events`: important sheet rules, inline style, sheet rules, inheritance. */
function pointerEvents(element: Element): string {
  const matching = POINTER_RULES.filter((rule) => matches(element, rule.selector));
  const important = strongest(matching.filter((rule) => rule.important));
  if (important) return important.value;
  const inline = (element as HTMLElement).style?.pointerEvents;
  if (inline && inline !== 'inherit') return inline;
  const normal = strongest(matching.filter((rule) => !rule.important));
  if (normal && normal.value !== 'inherit') return normal.value;
  return element.parentElement ? pointerEvents(element.parentElement) : 'auto';
}

// ---------------------------------------------------------------------------------------------
// Painted boxes and the browser's event target
// ---------------------------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}

const px = (value: string): number | null => (value.endsWith('px') ? parseFloat(value) : null);

/** Sheet-local offset of `element`, from the inline positions of it and its ancestors. */
function sheetOffset(element: HTMLElement, sheet: HTMLElement): Point {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = element; node && node !== sheet; node = node.parentElement) {
    if (node.style.position !== 'absolute' && node.style.position !== 'relative') continue;
    x += px(node.style.left) ?? 0;
    y += px(node.style.top) ?? 0;
  }
  return { x, y };
}

/**
 * The painted box of `element` or of its nearest sized ancestor. Flow content without its own
 * size answers with its container, which over-covers: a pointer-active child of a covering
 * layer always counts.
 */
function paintedBox(element: HTMLElement, sheet: HTMLElement) {
  for (let node: HTMLElement | null = element; node && node !== sheet; node = node.parentElement) {
    const width = px(node.style.width);
    const height = px(node.style.height);
    if (width === null || height === null) continue;
    const { x, y } = sheetOffset(node, sheet);
    return { x, y, width, height };
  }
  return null;
}

function contains(box: { x: number; y: number; width: number; height: number }, point: Point) {
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}

/** The topmost pointer-active element of `layer` whose painted box contains `point`. */
function layerTarget(layer: HTMLElement, sheet: HTMLElement, point: Point): HTMLElement | null {
  const nodes = [layer, ...layer.querySelectorAll<HTMLElement>('*')].reverse();
  for (const node of nodes) {
    if (pointerEvents(node) === 'none') continue;
    const box = paintedBox(node, sheet);
    if (box && contains(box, point)) return node;
  }
  return null;
}

/**
 * The element a browser gives the event to at `point`, given the body element under it.
 *
 * Layers painted after the one holding `under` are searched first, then `under` itself, then
 * the layers painted before it (the header and footer layer sits under the body). A press
 * nothing takes lands on the sheet.
 */
function browserTarget(sheet: HTMLElement, under: HTMLElement, point: Point): HTMLElement {
  const layers = [...sheet.children] as HTMLElement[];
  const host = layers.findIndex((layer) => layer.contains(under));
  expect(host).toBeGreaterThanOrEqual(0);
  for (let index = layers.length - 1; index > host; index -= 1) {
    const hit = layerTarget(layers[index]!, sheet, point);
    if (hit) return hit;
  }
  // The caller names the body element under the point. A whole sheet layer (the content box)
  // only takes the press inside its own box.
  const underBox = under === layers[host] ? paintedBox(under, sheet) : null;
  if (pointerEvents(under) !== 'none' && (!underBox || contains(underBox, point))) return under;
  for (let index = host - 1; index >= 0; index -= 1) {
    const hit = layerTarget(layers[index]!, sheet, point);
    if (hit) return hit;
  }
  return sheet;
}

// ---------------------------------------------------------------------------------------------
// Fixture: Letter, top -1296, bottom -1152, a 12-line header and an 8-line footer
// ---------------------------------------------------------------------------------------------

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const right = (text: string) =>
  `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function checkbox(name: string): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/>` +
    '<w:checkBox><w:size w:val="24"/><w:default w:val="0"/><w:checked w:val="0"/></w:checkBox>' +
    '</w:ffData></w:fldChar></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

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

interface FixtureOptions {
  /** `w:pgMar/@w:top` in twips; negative for an exact inset. */
  readonly top?: number;
  /** Extra header content after the right-aligned lines. */
  readonly headerExtra?: string;
  /** Extra body content before the first paragraph. */
  readonly bodyExtra?: string;
}

const PARAGRAPH = { cite: 1, picture: 2, link: 3, checkbox: 4 } as const;

function overlapDocx(options: FixtureOptions = {}): Uint8Array {
  const header = Array.from({ length: 12 }, (_, i) => right(`H${i + 1}`)).join('');
  const footer = Array.from({ length: 8 }, (_, i) => right(`F${i + 1}`)).join('');
  const body =
    (options.bodyExtra ?? '') +
    para('Body word 1') +
    '<w:p><w:r><w:t>Cite</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
    '<w:footnoteReference w:id="1"/></w:r></w:p>' +
    `<w:p>${inlinePicture(31)}</w:p>` +
    '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>Linked</w:t></w:r></w:hyperlink></w:p>' +
    `<w:p><w:r><w:t xml:space="preserve">Tick: </w:t></w:r>${checkbox('cb')}</w:p>` +
    Array.from({ length: 60 }, (_, i) => para(`Tail ${i + 1}`)).join('');
  const footnotes =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Note text</w:t></w:r></w:p></w:footnote>';
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
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
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
        `<Relationship Id="rIdHdr" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
        `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr ${DRAWING_NS}>${header}${options.headerExtra ?? ''}</w:hdr>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr ${DRAWING_NS}>${footer}</w:ftr>`),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W_NS}">${footnotes}</w:footnotes>`),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W_NS}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/_rels/header1.xml.rels': imageRels,
    'word/media/image1.png': PNG_1X1,
  });
}

// ---------------------------------------------------------------------------------------------
// Mounting and pressing
// ---------------------------------------------------------------------------------------------

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  /** The first sheet as painted now; opening a story can repaint it. */
  readonly sheet: HTMLElement;
  readonly page: PageRecord;
  readonly popovers: string[];
}

function mount(options: FixtureOptions = {}): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const popovers: string[] = [];
  const result = mountPaginatedSurface(container, overlapDocx(options), {
    scale: 1,
    onHyperlinkPopover: (activation: HyperlinkActivation) =>
      popovers.push(activation.link.href ?? ''),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // happy-dom has no layout. With the pages layer at the client origin and scale 1, a client
  // point is a sheet point on the first page.
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 2000, bottom: 4000, width: 2000, height: 4000 }),
  });
  pages.focus();
  const page = result.surface.layout().pages[0]!;
  expect(page.box.x).toBe(0);
  expect(page.box.y).toBe(0);
  return {
    surface: result.surface,
    container,
    get sheet() {
      return container.querySelector<HTMLElement>('.docx-page[data-page-index="0"]')!;
    },
    page,
    popovers,
  };
}

function pointerInit(point: Point) {
  return {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: point.x,
    clientY: point.y,
  };
}

/** A press and release on `target`, then the click the browser sends to the same target. */
function press(target: HTMLElement, point: Point): void {
  target.dispatchEvent(new PointerEvent('pointerdown', pointerInit(point)));
  document.dispatchEvent(new PointerEvent('pointerup', pointerInit(point)));
  target.dispatchEvent(new MouseEvent('click', pointerInit(point)));
}

const paragraphs = (blocks: readonly { kind: string }[]): ParagraphFragmentRecord[] =>
  blocks.filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');

/** The centre of a span of body paragraph `index` on the first page, in sheet coordinates. */
function bodySpanPoint(
  page: PageRecord,
  index: number,
  pick: (spans: readonly StyleSpanRecord[]) => StyleSpanRecord | undefined
): Point {
  const fragment = paragraphs(page.fragments)[index]!;
  for (const line of fragment.lines) {
    const span = pick(line.spans);
    if (!span) continue;
    return {
      x: page.contentBox.x + span.box.x + span.box.width / 2,
      y: page.contentBox.y + line.box.y + line.box.height / 2,
    };
  }
  throw new Error(`no matching span in body paragraph ${index}`);
}

const lastSpan = (spans: readonly StyleSpanRecord[]) => spans.at(-1);

const insideBox = (box: { x: number; y: number; width: number; height: number }, p: Point) =>
  p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height;

function band(mounted: Mounted, kind: 'header' | 'footer'): HTMLElement {
  return mounted.sheet.querySelector<HTMLElement>(
    `:scope > .docx-hf[data-docx-hf="${kind}"]:not(.docx-hf--placeholder)`
  )!;
}

/** A body point under the header box and inside the body's content box. */
function underHeader(mounted: Mounted, point: Point): void {
  expect(insideBox(mounted.page.header!.box, point)).toBe(true);
  expect(insideBox(mounted.page.contentBox, point)).toBe(true);
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('a closed header over body lines passes body presses through', () => {
  test('the model sees the band as the target when the band is not transparent', () => {
    const mounted = mount();
    const cite = mounted.container.querySelector<HTMLElement>('[data-docx-note-ref]')!;
    const point = bodySpanPoint(mounted.page, PARAGRAPH.cite, lastSpan);
    underHeader(mounted, point);
    const header = band(mounted, 'header');
    expect(header.hasAttribute('data-docx-hf-over-body')).toBe(true);
    expect(browserTarget(mounted.sheet, cite, point) === cite).toBe(true);
    // The band paints under the body, so the citation stays on top without the marker too.
    const layers = [...mounted.sheet.children];
    const body = mounted.sheet.querySelector(':scope > .docx-page-content')!;
    expect(layers.indexOf(header)).toBeLessThan(layers.indexOf(body));
    header.removeAttribute('data-docx-hf-over-body');
    expect(browserTarget(mounted.sheet, cite, point) === cite).toBe(true);
    mounted.surface.destroy();
  });

  test('a click on a body footnote citation opens the note', () => {
    const mounted = mount();
    const cite = mounted.container.querySelector<HTMLElement>('[data-docx-note-ref]')!;
    const point = bodySpanPoint(mounted.page, PARAGRAPH.cite, lastSpan);
    underHeader(mounted, point);
    press(browserTarget(mounted.sheet, cite, point), point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    mounted.surface.destroy();
  });

  test('a click on a body picture selects the picture', () => {
    const mounted = mount();
    const picture = mounted.container.querySelector<HTMLElement>(
      '.docx-page-content [data-drawing-node-id]'
    )!;
    const line = paragraphs(mounted.page.fragments)[PARAGRAPH.picture]!.lines[0]!;
    const drawing = line.drawings![0]!;
    const point = {
      x: mounted.page.contentBox.x + drawing.x + drawing.width / 2,
      y: mounted.page.contentBox.y + line.box.y + line.box.height / 2,
    };
    underHeader(mounted, point);
    const target = browserTarget(mounted.sheet, picture, point);
    expect(target === picture).toBe(true);
    press(target, point);
    expect(mounted.surface.drawingSelectionIntent().kind).toBe('pointer');
    mounted.surface.destroy();
  });

  test('a click on a body hyperlink opens the link popover', () => {
    const mounted = mount();
    const anchor = mounted.container.querySelector<HTMLElement>(
      '.docx-page-content a.docx-hyperlink'
    )!;
    const point = bodySpanPoint(mounted.page, PARAGRAPH.link, lastSpan);
    underHeader(mounted, point);
    const target = browserTarget(mounted.sheet, anchor, point);
    expect(target === anchor).toBe(true);
    press(target, point);
    expect(mounted.popovers).toEqual(['https://example.com/']);
    mounted.surface.destroy();
  });

  test('a click on a body legacy check box toggles it', () => {
    const mounted = mount();
    const box = (): HTMLElement =>
      mounted.container.querySelector<HTMLElement>('[data-docx-form-checkbox]')!;
    const point = bodySpanPoint(mounted.page, PARAGRAPH.checkbox, (spans) =>
      spans.find((span) => span.fieldAtom?.formControl)
    );
    underHeader(mounted, point);
    const target = browserTarget(mounted.sheet, box(), point);
    expect(target === box()).toBe(true);
    press(target, point);
    expect(box().dataset.checked).toBe('true');
    mounted.surface.destroy();
  });

  test('no element in the closed band takes the pointer, including explicit auto children', () => {
    // An inline picture in the header gets `pointer-events: auto` from the `.docx-drawing` rule.
    const mounted = mount({ headerExtra: `<w:p>${inlinePicture(41)}</w:p>` });
    const header = band(mounted, 'header');
    const nodes = [header, ...header.querySelectorAll<HTMLElement>('*')];
    expect(header.querySelector('.docx-drawing') !== null).toBe(true);
    // Class names only: a failing element assertion would print the whole DOM graph.
    const live = nodes.filter((node) => pointerEvents(node) !== 'none');
    expect(live.map((node) => node.className || node.tagName)).toEqual([]);
    mounted.surface.destroy();
  });
});

describe('hover over a band that overlaps the body', () => {
  test('the hover box covers only the margin part and is painted under the band', () => {
    const mounted = mount();
    const header = band(mounted, 'header');
    const hover = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-hover="header"]')!;
    expect(hover.nextElementSibling === header).toBe(true);
    const story = mounted.page.header!;
    expect(px(hover.style.top)).toBeCloseTo(story.box.y, 5);
    expect(px(hover.style.top)! + px(hover.style.height)!).toBeCloseTo(
      mounted.page.contentBox.y,
      5
    );
    expect(pointerEvents(hover)).toBe('auto');
    // The pill follows the hover box and belongs to its kind only.
    const selector = [
      ...postcss.parse(readFileSync(resolve(import.meta.dir, '../../styles/editor.css'), 'utf8'))
        .nodes,
    ]
      .flatMap((node) => (node.type === 'rule' ? node.selectors : []))
      .map((candidate) => candidate.replace(/\s+/g, ' '))
      .find((candidate) => candidate.includes("[data-docx-hf-hover='header']:hover ~"))!;
    const idle = selector.replace(':hover', '');
    const headerHint = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-hint="header"]')!;
    const footerHint = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-hint="footer"]')!;
    expect(headerHint.matches(idle)).toBe(true);
    expect(footerHint.matches(idle)).toBe(false);
    expect(px(headerHint.style.top)).toBeCloseTo(mounted.page.contentBox.y, 5);
    const footerHover = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-hover="footer"]')!;
    const contentBottom = mounted.page.contentBox.y + mounted.page.contentBox.height;
    expect(px(footerHover.style.top)).toBeCloseTo(contentBottom, 5);
    mounted.surface.destroy();
  });

  test('a double click on the hover box in the margin opens the header', () => {
    const mounted = mount();
    const hover = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-hover="header"]')!;
    const story = mounted.page.header!;
    const point = { x: story.box.x + 8, y: (story.box.y + mounted.page.contentBox.y) / 2 };
    const body = mounted.sheet.querySelector<HTMLElement>(':scope > .docx-page-content')!;
    const target = browserTarget(mounted.sheet, body, point);
    expect(target === hover).toBe(true);
    press(target, point);
    press(target, point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdHdr' });
    mounted.surface.destroy();
  });

  test('a band that stays in its margin keeps the old hover chrome', () => {
    const mounted = mount({ top: 4000 });
    const header = band(mounted, 'header');
    expect(mounted.page.contentBox.y).toBeGreaterThanOrEqual(
      mounted.page.header!.box.y + mounted.page.header!.box.height
    );
    expect(header.hasAttribute('data-docx-hf-over-body')).toBe(false);
    // The footer still overlaps (negative bottom); only the header stays in its margin.
    expect(mounted.sheet.querySelector('[data-docx-hf-hover="header"]') === null).toBe(true);
    // The pill is painted after the body, so body text never covers it.
    const layers = [...mounted.sheet.children];
    const hint = mounted.sheet.querySelector(':scope > [data-docx-hf-hint="header"]')!;
    const body = mounted.sheet.querySelector(':scope > .docx-page-content')!;
    expect(layers.indexOf(hint)).toBeGreaterThan(layers.indexOf(body));
    expect(pointerEvents(header)).toBe('auto');
    mounted.surface.destroy();
  });
});

describe('an open header or footer over body lines', () => {
  test('the open header takes the pointer again, drawings included, and closing restores it', () => {
    const mounted = mount({ headerExtra: floatingPicture(51, 300, 120) });
    expect(pointerEvents(band(mounted, 'header'))).toBe('none');
    expect(mounted.surface.enterHeaderFooter({ rId: 'rIdHdr', pageIndex: 0 })).toBe(true);
    const open = band(mounted, 'header');
    expect(open.hasAttribute('data-docx-hf-active')).toBe(true);
    expect(pointerEvents(open)).toBe('auto');
    // A page-relative picture paints in the header's own front layer, after the band.
    const drawing = mounted.sheet.querySelector<HTMLElement>('[data-docx-hf-front="header"] > *')!;
    expect(pointerEvents(drawing)).toBe('auto');
    // A press on its own text lands on the band and keeps editing it.
    const story = mounted.page.header!;
    const lines = paragraphs(story.fragments);
    const line = lines[8]!.lines[0]!;
    const span = line.spans.at(-1)!;
    const point = {
      x: story.box.x + span.box.x + span.box.width - 1,
      y: story.box.y + line.box.y + line.box.height / 2,
    };
    expect(insideBox(mounted.page.contentBox, point)).toBe(true);
    const body = mounted.sheet.querySelector<HTMLElement>(':scope > .docx-page-content')!;
    const target = browserTarget(mounted.sheet, body, point);
    expect(open.contains(target)).toBe(true);
    press(target, point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdHdr' });
    expect(mounted.surface.state().selection.head.paragraphId).toBe(lines[8]!.paragraphId);
    mounted.surface.exitHeaderFooter();
    expect(pointerEvents(band(mounted, 'header'))).toBe('none');
    mounted.surface.destroy();
  });

  test('a body drawing over the open header does not take its presses', () => {
    // The body paints over the header layer, so its drawings sit over the open story.
    const mounted = mount({ bodyExtra: floatingPicture(61, 300, 120) });
    expect(mounted.surface.enterHeaderFooter({ rId: 'rIdHdr', pageIndex: 0 })).toBe(true);
    const open = band(mounted, 'header');
    const drawing = mounted.sheet.querySelector<HTMLElement>(
      ':scope > .docx-drawing-layer-front:not([data-docx-hf-front]) > *'
    )!;
    expect(drawing === null).toBe(false);
    const layers = [...mounted.sheet.children];
    expect(layers.indexOf(open)).toBeLessThan(layers.indexOf(drawing.parentElement!));
    expect(pointerEvents(drawing)).toBe('none');
    const story = mounted.page.header!;
    const lines = paragraphs(story.fragments);
    const line = lines[8]!.lines[0]!;
    const span = line.spans.at(-1)!;
    const point = {
      x: story.box.x + span.box.x + span.box.width - 1,
      y: story.box.y + line.box.y + line.box.height / 2,
    };
    const body = mounted.sheet.querySelector<HTMLElement>(':scope > .docx-page-content')!;
    expect(open.contains(browserTarget(mounted.sheet, body, point))).toBe(true);
    mounted.surface.exitHeaderFooter();
    expect(pointerEvents(drawing)).toBe('auto');
    mounted.surface.destroy();
  });

  test('a click on footnote text under the open footer leaves the footer for the note', () => {
    const mounted = mount();
    const footer = mounted.page.footer! as HeaderFooterStoryRecord;
    const note = mounted.page.footnotes!.notes[0]!;
    const line = paragraphs(note.fragments)[0]!.lines[0]!;
    const span = line.spans.at(-1)!;
    const point = {
      x: note.box.x + span.box.x + span.box.width / 2,
      y: note.box.y + line.box.y + line.box.height / 2,
    };
    expect(insideBox(footer.box, point)).toBe(true);
    expect(mounted.surface.enterHeaderFooter({ rId: 'rIdFtr', pageIndex: 0 })).toBe(true);
    const noteEl = mounted.sheet.querySelector<HTMLElement>('.docx-note[data-docx-note-id="1"]')!;
    const target = browserTarget(mounted.sheet, noteEl, point);
    // The note area belongs to the main document, which paints over the open footer.
    expect(target === noteEl || noteEl.contains(target)).toBe(true);
    press(target, point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    mounted.surface.destroy();
  });

  test('a click on the note mark under the closed footer returns to the body', () => {
    const mounted = mount();
    const footer = mounted.page.footer!;
    const mark = mounted.sheet.querySelector<HTMLElement>('[data-docx-note-mark-back]')!;
    const note = mounted.page.footnotes!.notes[0]!;
    const line = paragraphs(note.fragments)[0]!.lines[0]!;
    const span = line.spans[0]!;
    const point = {
      x: note.box.x + span.box.x + span.box.width / 2,
      y: note.box.y + line.box.y + line.box.height / 2,
    };
    expect(insideBox(footer.box, point)).toBe(true);
    const cite = mounted.container.querySelector<HTMLElement>('[data-docx-note-ref]')!;
    const citePoint = bodySpanPoint(mounted.page, PARAGRAPH.cite, lastSpan);
    press(browserTarget(mounted.sheet, cite, citePoint), citePoint);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    const target = browserTarget(mounted.sheet, mark, point);
    expect(target === mark).toBe(true);
    press(target, point);
    expect(mounted.surface.activeScope()).toEqual({ kind: 'body' });
    mounted.surface.destroy();
  });
});
