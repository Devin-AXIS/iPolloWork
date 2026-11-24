// Which moves of the selection may move the paper, and which may not.
//
// One entry point decided it for everybody — `setSelection` forced the caret into view,
// because its callers are programmatic: an outline jump, a search hit, a review card asking
// to SHOW a position. Two lanes wanted a different answer, and each was wrong in its own
// direction.
//
// A POINTER press must not scroll. A press in the blank footer margin resolves to the
// nearest body line, which on a new document is the only line, at the top of the page. The
// scroll moved the paper under the reader's hand, so the SECOND press of a double click
// landed on body content, and the footer that gesture asks for was never created — with no
// refusal reported anywhere. Declining the scroll is not the same as declining the CALL:
// the follower is the only writer of the caret's last page index, and skipping it for a
// CARET left that stale, which made the next repaint read a page change that never happened.
//
// A SHIFT-EXTENDED keyboard move must scroll, and did not: the follower sat out every range,
// so Shift+ArrowDown, Shift+PageDown and Shift+Ctrl+End all selected off screen with the
// view parked. The mirror cannot paint a range whose head is on a page virtualization never
// built, so the reader saw no selection at all. Select All is the range that must NOT move
// the view, which is why the mode is asked for rather than inferred.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { blankDocumentBytes } from '../blank-document.ts';
import { caretAt } from '@docx-editor.dev/core/layout';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Viewport geometry happy-dom does not compute: enough of a scroller to scroll. */
const VIEWPORT_HEIGHT_PX = 600;
const SCROLL_HEIGHT_PX = 40_000;
/** Scrolled well past the first line, so a caret at the top of page 1 is above the viewport. */
const SCROLLED_TO_PX = 400;

/** A body long enough to paginate, so a caret can sit on a page the reader scrolled away from. */
function longDocument(paragraphs: number): Uint8Array {
  return documentOf(
    Array.from(
      { length: paragraphs },
      (_, index) => `<w:p><w:r><w:t>Paragraph ${index + 1}</w:t></w:r></w:p>`
    ).join('')
  );
}

/**
 * The same, with a plain text content control at each end — far enough apart that tabbing
 * between them has to move the viewport.
 *
 * `placement` picks which of the two shapes the control takes, because the code that selects
 * one reads them on separate branches: an `inline` control sits inside a paragraph and is
 * addressed as a UTF-16 range within it, a `block` control wraps whole paragraphs and is
 * addressed as the span from the first to the last.
 */
function documentWithControlsFarApart(
  paragraphs: number,
  placement: 'inline' | 'block',
  /** Paragraphs inside the trailing control, to make it taller than the viewport. */
  controlParagraphs = 1
): Uint8Array {
  const properties = (label: string) =>
    `<w:sdtPr><w:alias w:val="${label}"/><w:tag w:val="${label}"/><w:text/></w:sdtPr>`;
  const lines = (label: string, count: number) =>
    Array.from(
      { length: count },
      (_, index) => `<w:p><w:r><w:t>${label} ${index}</w:t></w:r></w:p>`
    ).join('');
  const control = (label: string, count: number) =>
    placement === 'inline'
      ? `<w:p><w:sdt>${properties(label)}<w:sdtContent>` +
        `<w:r><w:t>${label}</w:t></w:r></w:sdtContent></w:sdt></w:p>`
      : `<w:sdt>${properties(label)}<w:sdtContent>${lines(label, count)}</w:sdtContent></w:sdt>`;
  const filler = Array.from(
    { length: paragraphs },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index + 1}</w:t></w:r></w:p>`
  ).join('');
  return documentOf(`${control('First', 1)}${filler}${control('Last', controlParagraphs)}`);
}

/** A long document that OPENS with a placeholder prompt control. */
function documentStartingWithAPrompt(paragraphs: number, promptParagraphs = 1): Uint8Array {
  const properties = '<w:sdtPr><w:alias w:val="Prompt"/><w:showingPlcHdr/><w:text/></w:sdtPr>';
  const promptLines = Array.from(
    { length: promptParagraphs },
    (_, index) => `<w:p><w:r><w:t>Click here to enter text ${index}</w:t></w:r></w:p>`
  ).join('');
  const prompt =
    promptParagraphs === 1
      ? `<w:p><w:sdt>${properties}<w:sdtContent>` +
        '<w:r><w:t>Click here to enter text</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      : `<w:sdt>${properties}<w:sdtContent>${promptLines}</w:sdtContent></w:sdt>`;
  const filler = Array.from(
    { length: paragraphs },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index + 1}</w:t></w:r></w:p>`
  ).join('');
  return documentOf(`${prompt}${filler}`);
}

/**
 * A long document with a control in the BODY and another in a header.
 *
 * Form-fill Tab enumerates the controls of every story, so a body reader can land on the
 * header one — and one header paragraph is laid out on every page that uses it.
 */
function documentWithAHeaderControl(
  paragraphs: number,
  headerHolds: 'text' | 'nothing'
): Uint8Array {
  const control = (label: string, text: string) =>
    `<w:p><w:sdt><w:sdtPr><w:alias w:val="${label}"/><w:tag w:val="${label}"/><w:text/>` +
    `</w:sdtPr><w:sdtContent>${text}</w:sdtContent></w:sdt></w:p>`;
  const filler = Array.from(
    { length: paragraphs },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index + 1}</w:t></w:r></w:p>`
  ).join('');
  // An EMPTY control is addressed as a COLLAPSED range, which the ordinary caret rule
  // follows — the case the story test has to cover as much as the range one.
  const headerContent = headerHolds === 'text' ? '<w:r><w:t>InHeader</w:t></w:r>' : '';
  return documentOf(`${control('Body', '<w:r><w:t>Body</w:t></w:r>')}${filler}`, {
    headerXml: `<w:hdr xmlns:w="${W}">${control('InHeader', headerContent)}</w:hdr>`,
  });
}

function documentOf(body: string, options: { headerXml?: string } = {}): Uint8Array {
  const header = options.headerXml;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (header
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        '<w:sectPr>' +
        (header ? '<w:headerReference w:type="default" r:id="rId10"/>' : '') +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" ' +
        'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  };
  if (header) {
    entries['word/header1.xml'] = strToU8(header);
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    );
  }
  return zipSync(entries);
}

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly scroller: HTMLElement;
  readonly pages: HTMLElement;
}

/**
 * Torn down after each test, pass or FAIL: the surface binds document-level scroll and
 * pointer listeners, and a failing assertion in the middle of a test would otherwise leave
 * them — and the scroller — on `document` for every test after it.
 */
const mounted: Mounted[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.surface.destroy();
    entry.scroller.remove();
  }
});

function mount(bytes: Uint8Array): Mounted {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    value: VIEWPORT_HEIGHT_PX,
  });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: SCROLL_HEIGHT_PX });
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // The layer rides the scroll, as it does in a browser: that is what makes a scroll between
  // two presses land the second one on different content, which is the whole defect.
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: -scroller.scrollTop,
      right: 2000,
      bottom: SCROLL_HEIGHT_PX - scroller.scrollTop,
      width: 2000,
      height: SCROLL_HEIGHT_PX,
      x: 0,
      y: -scroller.scrollTop,
    }),
  });
  const entry: Mounted = { surface: result.surface, scroller, pages };
  mounted.push(entry);
  return entry;
}

function pressAt(target: EventTarget, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX,
      clientY,
    })
  );
  document.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' })
  );
}

/** The sheet point of the blank footer margin — below the content box, inside the paper. */
function footerBandSheetPoint(surface: PaginatedSurface): { x: number; y: number } {
  const page = surface.layout().pages[0]!;
  return {
    x: page.contentBox.x + 20,
    y: page.contentBox.y + page.contentBox.height + 20,
  };
}

/** The sheet point of the first line painted on `pageIndex`. */
function firstLineSheetPoint(
  surface: PaginatedSurface,
  pageIndex: number
): { x: number; y: number } | null {
  const page = surface.layout().pages[pageIndex];
  if (!page) return null;
  return { x: page.contentBox.x + 10, y: page.contentBox.y + 6 };
}

/** The scroll-driven repaint, which is what re-reads the caret's page. */
async function repaintAfterScroll(scroller: HTMLElement, to: number): Promise<void> {
  scroller.scrollTop = to;
  scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a pointer press never scrolls the viewport', () => {
  test('pressing the blank footer margin leaves the scroll position alone', () => {
    const { surface, scroller, pages } = mount(blankDocumentBytes());
    scroller.scrollTop = SCROLLED_TO_PX;
    const sheet = footerBandSheetPoint(surface);

    pressAt(pages, sheet.x, sheet.y - SCROLLED_TO_PX);

    // The caret went to the only body line, which is above the viewport — and stayed there.
    expect(scroller.scrollTop).toBe(SCROLLED_TO_PX);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
  });

  test('a double press in the blank footer margin creates and opens the footer', () => {
    const { surface, scroller, pages } = mount(blankDocumentBytes());
    scroller.scrollTop = SCROLLED_TO_PX;
    const band = pages.querySelector<HTMLElement>('[data-docx-hf="footer"]')!;
    expect(band.classList.contains('docx-hf--placeholder')).toBe(true);
    const sheet = footerBandSheetPoint(surface);
    const clientY = sheet.y - SCROLLED_TO_PX;

    // The browser resolves the element under the pointer afresh on EVERY press, so a scroll
    // between the two hands the second one whatever slid under it. Resolving from the live
    // scroll offset here is what makes this test see the gesture the way a reader does.
    const underPointer = (): HTMLElement => {
      const page = surface.layout().pages[0]!;
      const sheetY = clientY + scroller.scrollTop;
      return sheetY >= page.contentBox.y + page.contentBox.height ? band : pages;
    };

    pressAt(underPointer(), sheet.x, clientY);
    pressAt(underPointer(), sheet.x, clientY);

    const scope = surface.activeScope();
    expect(scope.kind).toBe('headerFooter');
    const state = surface.headerFooterState();
    expect(state?.editing).toBe('footer');
    expect(state?.variant).toBe('default');
    expect(state?.inherited).toBe(false);
  });

  test('a press onto a page nothing has built still does not scroll', () => {
    // The repaint `setSelection` runs to BUILD that page reaches the follower on its own
    // terms, and a caret on an unbuilt page reads as a page change — enough to scroll.
    const { surface, scroller, pages } = mount(longDocument(400));
    const start = firstLineSheetPoint(surface, 0)!;
    pressAt(pages, start.x, start.y);
    // Moved WITHOUT a scroll event, so the page under the pointer is still a shell.
    const farPage = surface.layout().pages[6]!;
    scroller.scrollTop = farPage.box.y;
    // Near the BOTTOM edge, where the follower's 24px band is what decides to scroll.
    const sheetY = farPage.box.y + VIEWPORT_HEIGHT_PX - 30;

    pressAt(pages, farPage.contentBox.x + 30, sheetY - farPage.box.y);

    expect(scroller.scrollTop).toBe(farPage.box.y);
  });

  test('a press still records the caret page, so no repaint chases it', async () => {
    const { surface, scroller, pages } = mount(longDocument(400));
    expect(surface.layout().pages.length).toBeGreaterThan(6);

    // Press once on page 1, the way an ordinary session starts: the repaint that follows
    // records page 1 as where the caret is.
    const onFirstPage = firstLineSheetPoint(surface, 0)!;
    pressAt(pages, onFirstPage.x, onFirstPage.y);

    // Scroll to a later page and press there. A press that declined the scroll but skipped
    // the RECORD leaves page 1 on file, and the repaint reads a page change that never
    // happened.
    const laterPage = surface.layout().pages[2]!;
    await repaintAfterScroll(scroller, laterPage.box.y);
    const onLaterPage = firstLineSheetPoint(surface, 2)!;
    // Clear of the first press by more than the multi-click slop, or the two read as a double
    // click at one point and the second press selects a word instead of placing a caret.
    pressAt(pages, onLaterPage.x + 40, onLaterPage.y - laterPage.box.y);
    expect(scroller.scrollTop).toBe(laterPage.box.y);

    // And the reader can still scroll away from their own caret: the repaint that builds the
    // pages they scrolled to must not read a page change and pull them back.
    const farPage = surface.layout().pages[6]!;
    await repaintAfterScroll(scroller, farPage.box.y);
    expect(scroller.scrollTop).toBe(farPage.box.y);
  });
});

describe('a shift-extended keyboard move brings its head into view', () => {
  /** A caret on page 1 of a long document, focused, with the viewport at the top. */
  function caretOnFirstPage(): { surface: PaginatedSurface; scroller: HTMLElement } {
    const { surface, scroller, pages } = mount(longDocument(400));
    const start = firstLineSheetPoint(surface, 0)!;
    pressAt(pages, start.x, start.y);
    scroller.scrollTop = 0;
    return { surface, scroller };
  }

  test('extending down past the viewport scrolls after the head', () => {
    const { surface, scroller } = caretOnFirstPage();

    for (let step = 0; step < 80; step += 1) surface.navigate('down', true);

    expect(scroller.scrollTop).toBeGreaterThan(0);
    const { anchor, head } = surface.state().selection;
    expect(anchor.paragraphId === head.paragraphId && anchor.offset === head.offset).toBe(false);
  });

  test('extending to the end of the document scrolls to it', () => {
    const { surface, scroller } = caretOnFirstPage();

    surface.navigate('documentEnd', true);

    const lastPage = surface.layout().pages.at(-1)!;
    expect(scroller.scrollTop).toBeGreaterThan(lastPage.box.y / 2);
  });

  test('plain navigation still follows the caret', () => {
    const { surface, scroller } = caretOnFirstPage();

    surface.navigate('documentEnd');

    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  test('plain navigation onto a placeholder prompt still follows it', () => {
    // Landing on a prompt absorbs the whole control, so the move ends on a RANGE — which the
    // caret rule refuses. Ctrl+Home onto a prompt at the top left the view where it started.
    const { surface, scroller, pages } = mount(documentStartingWithAPrompt(400));
    const start = firstLineSheetPoint(surface, 0)!;
    pressAt(pages, start.x, start.y);
    surface.navigate('documentEnd');
    expect(scroller.scrollTop).toBeGreaterThan(0);

    surface.navigate('documentStart');

    // Back at the top of the document, with the absorbed prompt on screen.
    expectStartOfSelectionVisible(surface, scroller);
    expect(scroller.scrollTop).toBeLessThan(VIEWPORT_HEIGHT_PX);
  });

  test('a prompt taller than the viewport is revealed by its start, not its end', () => {
    const { surface, scroller, pages } = mount(documentStartingWithAPrompt(400, 60));
    const start = firstLineSheetPoint(surface, 0)!;
    pressAt(pages, start.x, start.y);
    surface.navigate('documentEnd');
    expect(scroller.scrollTop).toBeGreaterThan(0);

    // Backwards into the prompt: the absorbed range's head is its END, and revealing that
    // would scroll the reader PAST the text the next keystroke replaces.
    surface.navigate('documentStart');

    expectStartOfSelectionVisible(surface, scroller);
  });

  for (const headerHolds of ['text', 'nothing'] as const) {
    test(`form-fill Tab onto a control in another story holding ${headerHolds} leaves the view alone`, async () => {
      const { surface, scroller, pages } = mount(documentWithAHeaderControl(400, headerHolds));
      const start = firstLineSheetPoint(surface, 0)!;
      pressAt(pages, start.x, start.y);
      const farPage = surface.layout().pages[6]!;
      // Through a real scroll, so the page the reader is on is BUILT and the caret's recorded
      // page is current — the state in which a follow would read a page change and scroll.
      await repaintAfterScroll(scroller, farPage.box.y);
      surface.contentControls.setFormFill(true);

      // The next control is in the header, which is laid out on EVERY page: travelling to it
      // resolved the page-1 copy and threw the reader to the top of the document.
      surface.contentControls.navigate('next');
      surface.contentControls.navigate('next');

      expect(scroller.scrollTop).toBe(farPage.box.y);
    });
  }

  test('Select All leaves the view where the reader put it', () => {
    const { surface, scroller } = caretOnFirstPage();

    surface.selectAll();

    // Word does not travel to the end of the document on Ctrl+A, and neither does this.
    expect(scroller.scrollTop).toBe(0);
  });

  for (const placement of ['inline', 'block'] as const) {
    test(`form-fill Tab reveals the start of the ${placement} control it moves to`, () => {
      const { surface, scroller } = tabbedToTheFarControl(placement);
      expectStartOfSelectionVisible(surface, scroller);
    });
  }

  test('form-fill Tab reveals the start of a control taller than the viewport', () => {
    // The whole content is selected and the next keystroke replaces it from the beginning,
    // so revealing the control by its last line leaves the reader at the wrong end of it.
    const { surface, scroller } = tabbedToTheFarControl('block', 60);
    expectStartOfSelectionVisible(surface, scroller);
  });
});

/** A caret on page 1, form-fill on, then Shift+Tab onto the control at the far end. */
function tabbedToTheFarControl(
  placement: 'inline' | 'block',
  controlParagraphs = 1
): { surface: PaginatedSurface; scroller: HTMLElement } {
  const { surface, scroller, pages } = mount(
    documentWithControlsFarApart(400, placement, controlParagraphs)
  );
  // The press lands inside the FIRST control, so one step backwards wraps to the last one —
  // which is what puts the target pages below the viewport.
  const start = firstLineSheetPoint(surface, 0)!;
  pressAt(pages, start.x, start.y);
  scroller.scrollTop = 0;
  surface.contentControls.setFormFill(true);
  expect(surface.contentControls.navigate('previous')).toBe(true);
  return { surface, scroller };
}

/** The selection's START — where the replacing keystroke lands — is inside the viewport. */
function expectStartOfSelectionVisible(surface: PaginatedSurface, scroller: HTMLElement): void {
  const { anchor, head } = surface.state().selection;
  expect(anchor.paragraphId === head.paragraphId && anchor.offset === head.offset).toBe(false);
  const caret = caretAt(surface.layout(), anchor);
  expect(caret).not.toBeNull();
  const page = surface.layout().pages[caret!.pageIndex]!;
  const anchorTop = page.contentBox.y + caret!.y;
  expect(scroller.scrollTop).toBeGreaterThan(0);
  expect(anchorTop).toBeGreaterThanOrEqual(scroller.scrollTop);
  expect(anchorTop).toBeLessThan(scroller.scrollTop + VIEWPORT_HEIGHT_PX);
}
