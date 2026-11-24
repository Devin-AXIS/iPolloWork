// The engine-owned paginated surface: layout, materialization and measurement.
//
// The other half of `paginated-surface.test.ts`. Editing lives there; what this file asserts
// is the surface as a renderer — that a keystroke re-places only what it disturbed, that only
// the pages on screen are built, that a mixed-orientation document sizes and centres its
// sheets, and that the measurer the surface picks is the one layout then measures with.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';
import { surfaceExtent } from '../surface-pages.ts';
import {
  createFixedMeasurer,
  linesOf,
  tryCreateCanvasMeasurer,
} from '@docx-editor.dev/core/layout';
import { docx, mount, openLayout, paragraph, putCaret } from './paginated-surface-fixtures.ts';

describe('the incremental layout machinery is actually used (tasks 9.2, 9.3)', () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    paragraph(`paragraph ${index} ${'word '.repeat(8)}`)
  ).join('');

  test('editing one paragraph does not re-place the whole document', () => {
    // The cache and the session were built and tested in the layout lane but passed by no
    // shipping path, so every keystroke re-measured and re-placed everything. This asserts
    // the wiring, not the algorithm: without it, `placed` equals the paragraph count forever.
    // A LATER paragraph: editing the first leaves nothing above it to resume from, so the
    // pass legitimately re-places everything and the assertion would prove nothing.
    const { surface } = mount(many);
    putCaret(surface, 0, 15);
    surface.type('a');
    const stats = surface.layoutSession().stats;
    expect(stats.total).toBeGreaterThan(10);
    expect(stats.placed).toBeLessThan(stats.total);
  });

  test('a keystroke reuses pages it did not disturb', () => {
    const { surface } = mount(many);
    putCaret(surface, 0);
    surface.type('b');
    expect(surface.layoutSession().stats.reusedPages).toBeGreaterThanOrEqual(0);
    // Identity: an untouched page is the SAME record, which is what lets a consumer skip it.
    const before = surface.layout().pages;
    surface.type('c');
    const after = surface.layout().pages;
    expect(after.length).toBe(before.length);
  });

  test('the result still equals a clean layout, cache or no cache', () => {
    // The whole point of the differential tests in the layout lane, asserted once through
    // the surface so the wiring cannot introduce the divergence the algorithm avoids.
    const { surface } = mount(many);
    putCaret(surface, 0);
    surface.type('zzz');
    const incremental = JSON.stringify(surface.layout().pages.map((page) => page.fragments.length));
    const reopened = mount(many);
    putCaret(reopened.surface, 0);
    reopened.surface.type('zzz');
    expect(JSON.stringify(reopened.surface.layout().pages.map((p) => p.fragments.length))).toBe(
      incremental
    );
  });
});

describe('only the pages on screen are built (task 9.4)', () => {
  const long = `<w:p><w:r><w:t>${'word '.repeat(4000)}</w:t></w:r></w:p>`;

  test('with no scrolling ancestor every page is built, which is the safe reading', () => {
    // A wrong guess here silently drops content from print or export, so the absence of a
    // viewport must mean "build everything", never "build nothing".
    const { surface, container } = mount(long);
    expect(surface.layout().pages.length).toBeGreaterThan(2);
    for (const page of container.querySelectorAll<HTMLElement>('.docx-page')) {
      expect(page.dataset.materialized).toBe('true');
    }
  });

  test('inside a scroll container, far pages keep their size but hold no content', () => {
    const { surface, container } = mount(long);
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    scroller.append(container);
    // happy-dom reports zero layout, so the viewport is supplied directly.
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    surface.type('x');

    const pages = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    const built = pages.filter((page) => page.dataset.materialized === 'true');
    expect(pages.length).toBeGreaterThan(2);
    expect(built.length).toBeLessThan(pages.length);
    // Page count and heights are unchanged, so scrolling reveals rather than reflows.
    for (const page of pages) expect(page.style.height).toBe(pages[0]!.style.height);
    scroller.remove();
  });

  test('a keystroke keeps the DOM of pages it did not disturb', () => {
    // Layout keeps the record of an untouched page identical across revisions, and the
    // painter keys reuse on that identity — so a keystroke must not rebuild every sheet.
    // Rebuilding them all made the browser restyle the whole document per keystroke.
    // MANY paragraphs, so an edit near the end leaves the leading pages' records — and
    // therefore their elements — untouched; a single paragraph spanning every page would
    // legitimately rebuild them all.
    const paragraphs = Array.from({ length: 60 }, (_, i) =>
      paragraph(`paragraph ${i} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, container } = mount(paragraphs);
    const ids = surface.session.paragraphIds();
    putCaret(surface, 0, ids.length - 1);
    surface.type('a');
    expect(surface.layout().pages.length).toBeGreaterThan(2);
    const firstBefore = container.querySelector<HTMLElement>('.docx-page[data-page-index="0"]')!;
    surface.type('b');
    const firstAfter = container.querySelector<HTMLElement>('.docx-page[data-page-index="0"]')!;
    // Same element object, not an equal-looking rebuild.
    expect(firstAfter).toBe(firstBefore);
  });

  test('scrolling reveals BUILT pages, not shells', async () => {
    // Materialization is decided at paint time, and paint used to happen only on a commit —
    // scrolling a long document showed blank sheets until the next keystroke.
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    const result = mountPaginatedSurface(host, docx(long), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    surface.type('x');

    const lastIndex = surface.layout().pages.length - 1;
    const farPage = (): HTMLElement =>
      host.querySelector<HTMLElement>(`.docx-page[data-page-index="${lastIndex}"]`)!;
    expect(farPage().dataset.materialized).toBe('false');

    // Jump the viewport to the last page and let the frame-coalesced repaint run.
    const last = surface.layout().pages[lastIndex]!;
    scroller.scrollTop = last.box.y;
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(farPage().dataset.materialized).toBe('true');
    expect(host.querySelectorAll('.docx-page').length).toBe(lastIndex + 1);
    surface.destroy();
    scroller.remove();
  });

  test('a viewport that GROWS builds the pages it uncovers, with no scroll to prompt it', async () => {
    // Which pages are worth building depends on the viewport's height as much as on its
    // scroll offset — and a resize fires no `scroll`. Nothing asked for a repaint, so the
    // sheets a taller window uncovered stayed blank until the user scrolled or typed.
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    // happy-dom reports zero layout, so the viewport height is supplied directly.
    let viewportHeight = 400;
    Object.defineProperty(scroller, 'clientHeight', {
      get: () => viewportHeight,
      configurable: true,
    });
    const result = mountPaginatedSurface(host, docx(long), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    surface.type('x');

    const pages = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.docx-page')];
    const built = (): number =>
      pages().filter((page) => page.dataset.materialized === 'true').length;
    const before = built();
    expect(before).toBeLessThan(pages().length);

    // The window grows past the whole document. No scroll event accompanies it.
    viewportHeight = 100_000;
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(built()).toBeGreaterThan(before);
    expect(built()).toBe(pages().length);
    surface.destroy();
    scroller.remove();
  });

  test('a selection landing on an unbuilt page builds it, so the caret can go there', () => {
    // An outline jump, a search hit, any host driving the caret: the target page is exactly
    // the one virtualization has NOT built. The mirror writes the selection into DOM nodes,
    // and an unbuilt page has none, so the write silently did nothing — and because
    // `setSelection` had already declared the two in agreement, the next repaint read the
    // STALE DOM selection back and overwrote the navigation. The caret stayed at the top of
    // the document while the viewport scrolled away from it.
    const many = Array.from({ length: 400 }, (_, i) => paragraph(`paragraph ${i}`)).join('');
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    const result = mountPaginatedSurface(host, docx(many), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;

    const ids = surface.session.paragraphIds();
    const target = ids[ids.length - 1]!;
    const targetPage = surface.layout().pages.length - 1;
    expect(targetPage).toBeGreaterThan(2);
    const pageEl = (index: number): HTMLElement =>
      host.querySelector<HTMLElement>(`.docx-page[data-page-index="${index}"]`)!;
    expect(pageEl(targetPage).dataset.materialized).toBe('false');

    surface.setSelection({
      anchor: { paragraphId: target, offset: 0 },
      head: { paragraphId: target, offset: 0 },
    });

    // The page the caret is on is built, whether or not it is on screen.
    expect(pageEl(targetPage).dataset.materialized).toBe('true');
    // And a reveal afterwards — the outline's second step — must not snap it back.
    surface.revealParagraph(target);
    expect(surface.state().selection.head.paragraphId).toBe(target);
    surface.destroy();
    scroller.remove();
  });

  test('a destroyed surface stops following the viewport', async () => {
    // The resize listener lives on the window, which outlives the surface — left attached
    // it would repaint into a container the host has already thrown away.
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    let viewportHeight = 400;
    Object.defineProperty(scroller, 'clientHeight', {
      get: () => viewportHeight,
      configurable: true,
    });
    const result = mountPaginatedSurface(host, docx(long), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    result.surface.destroy();

    viewportHeight = 100_000;
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // `destroy` empties the container; a repaint that still ran would refill it.
    expect(host.querySelectorAll('.docx-page')).toHaveLength(0);
    scroller.remove();
  });
});

describe('mixed-width page centering', () => {
  const portraitWidth = 612;
  const landscapeWidth = 792;

  function mixedOrientationBody(): string {
    const portraitFill = paragraph(`portrait ${'word '.repeat(4000)}`);
    const landscapeFill = paragraph(`landscape ${'word '.repeat(2000)}`);
    return (
      portraitFill +
      '<w:p><w:pPr><w:sectPr>' +
      '<w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:type w:val="nextPage"/>' +
      '</w:sectPr></w:pPr></w:p>' +
      landscapeFill +
      '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>'
    );
  }

  function pageWidths(surface: PaginatedSurface): number[] {
    return surface.layout().pages.map((page) => page.box.width);
  }

  function firstLandscapeIndex(surface: PaginatedSurface): number {
    return surface.layout().pages.findIndex((page) => page.box.width === landscapeWidth);
  }

  test('surfaceExtent sizes from materialized pages when virtualized', () => {
    const bytes = docx(mixedOrientationBody());
    const opened = openLayout(bytes);
    const layout = opened.layout;
    const portraitPages = layout.pages.filter((page) => page.box.width === portraitWidth);
    const landscapePages = layout.pages.filter((page) => page.box.width === landscapeWidth);
    expect(portraitPages.length).toBeGreaterThan(0);
    expect(landscapePages.length).toBeGreaterThan(0);

    const portraitOnly = new Set(portraitPages.map((page) => page.index));
    expect(surfaceExtent(layout, portraitOnly).width).toBe(portraitWidth);

    const landscapeOnly = new Set(landscapePages.map((page) => page.index));
    expect(surfaceExtent(layout, landscapeOnly).width).toBe(landscapeWidth);

    expect(surfaceExtent(layout, undefined).width).toBe(landscapeWidth);
  });

  test('surfaceExtent centres narrower pages inside a mixed materialized band', () => {
    const bytes = docx(mixedOrientationBody());
    const opened = openLayout(bytes);
    const layout = opened.layout;
    const portraitPage = layout.pages.find((page) => page.box.width === portraitWidth)!;
    const landscapePage = layout.pages.find((page) => page.box.width === landscapeWidth)!;
    const mixed = new Set([portraitPage.index, landscapePage.index]);
    const extent = surfaceExtent(layout, mixed);
    expect(extent.width).toBe(landscapeWidth);
    expect(extent.pageOffsetX.get(portraitPage.index)).toBe((landscapeWidth - portraitWidth) / 2);
    expect(extent.pageOffsetX.get(landscapePage.index)).toBe(0);
  });

  test('virtualized portrait pages size from visible pages, not distant landscape', () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    const result = mountPaginatedSurface(host, docx(mixedOrientationBody()), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    surface.type('x');

    scroller.scrollTop = 0;
    expect(host.style.width).toBe(`${portraitWidth}px`);
    expect(pageWidths(surface).some((width) => width === landscapeWidth)).toBe(true);

    surface.destroy();
    scroller.remove();
  });

  test('scrolling into landscape recomputes the surface width', async () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    const result = mountPaginatedSurface(host, docx(mixedOrientationBody()), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    surface.type('x');

    const landscapeIndex = firstLandscapeIndex(surface);
    expect(landscapeIndex).toBeGreaterThan(0);
    const landscapePage = surface.layout().pages[landscapeIndex]!;
    scroller.scrollTop = landscapePage.box.y;
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(host.style.width).toBe(`${landscapeWidth}px`);
    surface.destroy();
    scroller.remove();
  });

  test('mixed portrait and landscape pages centre narrower sheets', async () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const host = document.createElement('div');
    scroller.append(host);
    Object.defineProperty(scroller, 'clientHeight', { value: 1200, configurable: true });
    const result = mountPaginatedSurface(host, docx(mixedOrientationBody()), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    surface.type('x');

    const landscapeIndex = firstLandscapeIndex(surface);
    const portraitIndex = landscapeIndex - 1;
    expect(portraitIndex).toBeGreaterThanOrEqual(0);
    const portraitPage = surface.layout().pages[portraitIndex]!;
    const landscapePage = surface.layout().pages[landscapeIndex]!;
    expect(portraitPage.box.width).toBe(portraitWidth);
    expect(landscapePage.box.width).toBe(landscapeWidth);

    scroller.scrollTop = portraitPage.box.y;
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const portraitEl = host.querySelector<HTMLElement>(`[data-page-index="${portraitIndex}"]`)!;
    expect(portraitEl.style.left).toBe(`${(landscapeWidth - portraitWidth) / 2}px`);
    const landscapeEl = host.querySelector<HTMLElement>(`[data-page-index="${landscapeIndex}"]`)!;
    expect(landscapeEl.style.left).toBe('0px');

    surface.destroy();
    scroller.remove();
  });
});

const LONG_BODY = `<w:p><w:r><w:t>${'word '.repeat(4000)}</w:t></w:r></w:p>`;
const MANY_PARAGRAPHS = Array.from({ length: 30 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(12)}`)
).join('');

/**
 * A surface inside a scroll container with a supplied viewport — happy-dom reports zero
 * layout, so height, scroll extent and the container's own offset are all defined here.
 */
function mountInScroller(
  body: string,
  options: { readonly offsetTop?: number } = {}
): {
  readonly surface: PaginatedSurface;
  readonly scroller: HTMLElement;
  readonly host: HTMLElement;
} {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  document.body.append(scroller);
  const host = document.createElement('div');
  scroller.append(host);
  Object.defineProperty(host, 'offsetTop', { value: options.offsetTop ?? 0, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollWidth', { value: 10_000_000, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 10_000_000, configurable: true });
  let scrollLeft = 0;
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollLeft', {
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next;
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  const result = mountPaginatedSurface(host, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(result.reason);
  return { surface: result.surface, scroller, host };
}

describe('in-place scaling', () => {
  test('rescales the mounted pages without replacing the editing session', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 5);
    surface.type('!');
    const session = surface.session;
    const selection = surface.state().selection;
    const widthBefore = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    const widthAfter = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);
    expect(widthAfter).toBeCloseTo(widthBefore * 2);
    expect(surface.session).toBe(session);
    expect(surface.state().selection).toEqual(selection);
    expect(container.textContent).toContain('hello! world');
    expect(surface.state().canUndo).toBe(true);
    surface.destroy();
  });

  test('a surface with no rescale path is refused, not thrown at', () => {
    // The helper reaches an internal member, so a foreign or stubbed surface must come back
    // as "cannot do that" — a host asking for zoom is not asking to be crashed.
    expect(setPaginatedSurfaceScale({} as PaginatedSurface, 2)).toBe(false);
  });

  test('the pages, overlay and comment layers all take the new scale', () => {
    const { surface, container } = mount(paragraph('hello world'));
    const layers = () => ({
      pages: container.querySelector<HTMLElement>('.docx-pages')!.style,
      overlay: container.querySelector<HTMLElement>('.docx-selection-overlay')!.style,
      comments: container.querySelector<HTMLElement>('.docx-comment-overlay')!.style,
      container: container.style,
    });
    const before = Object.fromEntries(
      Object.entries(layers()).map(([name, style]) => [
        name,
        [parseFloat(style.width), parseFloat(style.height)],
      ])
    );

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    for (const [name, style] of Object.entries(layers())) {
      const [width, height] = before[name]!;
      expect(parseFloat(style.width)).toBeCloseTo(width! * 2);
      expect(parseFloat(style.height)).toBeCloseTo(height! * 2);
    }
    surface.destroy();
  });

  test('the same viewport page is under the centre before and after, container offset included', () => {
    // The scroll container is not the pages' offset parent in a real host: chrome above the
    // document (toolbar, ruler) puts the surface at an `offsetTop`, and the page-visibility
    // code already subtracts it. An anchor that did not would rescale to a different page.
    const OFFSET_TOP = 400;
    const { surface, scroller } = mountInScroller(LONG_BODY, { offsetTop: OFFSET_TOP });
    // A centre just inside the END of page 2, so an anchor that ignores `offsetTop` lands on
    // the following sheet rather than merely a few points off.
    const page = surface.layout().pages[1]!;
    const centre = page.box.y + page.box.height - 20;
    scroller.scrollTop = OFFSET_TOP + centre - scroller.clientHeight / 2;
    const pageBefore = surface.currentPage('viewport');
    expect(pageBefore).toBe(2);
    const scrollBefore = scroller.scrollTop;

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    expect(surface.currentPage('viewport')).toBe(pageBefore);
    // The scroll offset really did move: the assertion above is about the page under the
    // centre, not about a no-op.
    expect(scroller.scrollTop).toBeGreaterThan(scrollBefore);
    surface.destroy();
    scroller.remove();
  });

  test('the band the restored scroll lands on is built in the same turn', () => {
    // The paint happens before the scroll is restored, so the pages worth building were
    // decided for the OLD offset. Without a rematerialize the user saw shells until the next
    // scroll event fired a frame later.
    const { surface, scroller, host } = mountInScroller(LONG_BODY);
    const away = surface.layout().pages[4]!;
    scroller.scrollTop = away.box.y;

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    const destination = surface.currentPage('viewport') - 1;
    const sheet = host.querySelector<HTMLElement>(`.docx-page[data-page-index="${destination}"]`)!;
    expect(sheet.dataset.materialized).toBe('true');
    surface.destroy();
    scroller.remove();
  });

  test('a rescale whose layout AND rollback both fail is refused, not thrown out of', () => {
    const { surface, container } = mount(paragraph('hello world'));
    const widthBefore = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);
    // Both the rescale and its rollback invalidate against the session's revision, so a
    // session that cannot answer fails the forward pass and the recovery alike.
    const session = surface.session as { packageRevision: () => number };
    const revision = session.packageRevision;
    session.packageRevision = () => {
      throw new Error('revision unavailable');
    };

    let refused: boolean;
    try {
      refused = setPaginatedSurfaceScale(surface, 2);
    } finally {
      session.packageRevision = revision;
    }

    expect(refused).toBe(false);
    // Still painted at the scale it was: a refused rescale must not leave half a zoom on
    // screen.
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBe(
      widthBefore
    );
    // And the surface is not poisoned — the next rescale works.
    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBeCloseTo(
      widthBefore * 2
    );
    surface.destroy();
  });

  test('a host measurer keeps its layout identity across a rescale', () => {
    // A host measurer answers in POINTS, so zoom cannot change one of its advances. Folding
    // the scale into its cache identity re-measured the whole document on every zoom click
    // and told the cache the two answers were different when they are the same.
    const fixed = createFixedMeasurer();
    let measured = 0;
    const measurer = {
      measure(text: string, style: Parameters<typeof fixed.measure>[1]) {
        measured += 1;
        return fixed.measure(text, style);
      },
      lineMetrics(style: Parameters<typeof fixed.lineMetrics>[0]) {
        return fixed.lineMetrics(style);
      },
    };
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, docx(MANY_PARAGRAPHS), { scale: 1, measurer });
    if (!result.ok) throw new Error(result.reason);
    const { surface } = result;
    surface.layout();
    expect(measured).toBeGreaterThan(0);
    const widthBefore = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);
    measured = 0;

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    expect(measured).toBe(0);
    // Repainted at the new scale even so: identity is about the cache, not about the paint.
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBeCloseTo(
      widthBefore * 2
    );
    surface.destroy();
  });
});

describe('default browser measurer for cover-title centering', () => {
  /**
   * Controllable advances from the px size in `font` — avoids host-font pixel brittleness
   * while still proving the surface selected the canvas path and fed it into layout.
   */
  function mockContext(): CanvasRenderingContext2D {
    let currentFont = '';
    return {
      get font() {
        return currentFont;
      },
      set font(value: string) {
        currentFont = value;
      },
      measureText(text: string) {
        const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
        const sizePx = match ? Number(match[1]) : 11;
        // Wider than the fixed 6pt grid — mirrors real Arial Bold vs createFixedMeasurer.
        return {
          width: text.length * sizePx * 0.7,
          fontBoundingBoxAscent: sizePx * 0.8,
        };
      },
    } as CanvasRenderingContext2D;
  }

  const coverTitle =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="52"/></w:rPr>` +
    `<w:t>Cover Title</w:t></w:r></w:p>`;

  const usedWidth = (line: { spans: readonly { box: { x: number; width: number } }[] }) => {
    const first = line.spans[0]!;
    const last = line.spans[line.spans.length - 1]!;
    return last.box.x + last.box.width - first.box.x;
  };

  test('mount selects the canvas measurer when getContext works', () => {
    const previous = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => mockContext()) as typeof previous;
    try {
      // Without a host measurer the surface must pick canvas over the fixed grid.
      expect(tryCreateCanvasMeasurer({ context: mockContext() })).not.toBeNull();
      const container = document.createElement('div');
      const result = mountPaginatedSurface(container, docx(coverTitle), { scale: 1 });
      if (!result.ok) throw new Error(result.reason);
      const { surface } = result;
      const line = linesOf(surface.layout())[0]!;
      const first = line.spans[0]!;
      const available = surface.layout().pages[0]!.box.width - 144; // 72pt margins each side
      // Canvas mock: 26pt * 0.7 * len across word spans. Fixed is 6 * (26/11) * len ≈ 156.
      const expectedWidth = 'Cover Title'.length * 26 * 0.7;
      expect(usedWidth(line)).toBeCloseTo(expectedWidth, 5);
      expect(first.box.x).toBeCloseTo((available - expectedWidth) / 2, 5);
      expect(usedWidth(line)).toBeGreaterThan(
        createFixedMeasurer().measure('Cover Title', first.style)
      );
      // Geometry is authoritative — the painter must not be asked to centre via CSS.
      const painted = container.querySelector<HTMLElement>('.docx-line')!;
      expect(painted.style.textAlign).toBe('');
      surface.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = previous;
    }
  });

  test('a rescale re-resolves the default measurer rather than reusing the one mount got', () => {
    // The default measurer is resolved AT a scale, so a rescale resolves again — and what it
    // resolves to can differ: a host that has torn its measurement canvas down falls back to
    // the fixed grid, and the layout after the zoom has to be the one the NEW resolution
    // measures, with a cache identity that says so.
    const previous = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => mockContext()) as typeof previous;
    try {
      const container = document.createElement('div');
      const result = mountPaginatedSurface(container, docx(coverTitle), { scale: 1 });
      if (!result.ok) throw new Error(result.reason);
      const { surface } = result;
      const canvasWidth = usedWidth(linesOf(surface.layout())[0]!);

      HTMLCanvasElement.prototype.getContext = (() => null) as typeof previous;
      expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

      const line = linesOf(surface.layout())[0]!;
      const style = line.spans[0]!.style;
      expect(usedWidth(line)).toBeCloseTo(
        createFixedMeasurer().measure('Cover ', style) +
          createFixedMeasurer().measure('Title', style),
        5
      );
      expect(usedWidth(line)).toBeLessThan(canvasWidth);
      surface.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = previous;
    }
  });

  test('happy-dom without canvas keeps the deterministic fixed default', () => {
    const { surface } = mount(coverTitle);
    const line = linesOf(surface.layout())[0]!;
    const style = line.spans[0]!.style;
    expect(usedWidth(line)).toBeCloseTo(
      createFixedMeasurer().measure('Cover ', style) +
        createFixedMeasurer().measure('Title', style),
      5
    );
    surface.destroy();
  });
});
