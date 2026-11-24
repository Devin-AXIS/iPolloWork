// Scrolling to a page or a block, from the LAYOUT rather than from the DOM.
//
// `scrollToPage`/`scrollToBlock` were declared on the editor contract and stubbed to
// `false`, so the outline could select a heading twenty pages down and leave the user
// looking at page one. The geometry has to come from the records: the page a reveal is
// asked for is usually one that has not been materialized yet, so there is no element to
// measure — which is exactly why reaching into the DOM cannot answer this.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { caretAt } from '../../layout/semantic-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Enough paragraphs to paginate well past one screen. */
const BODY = Array.from(
  { length: 120 },
  (_, index) => `<w:p><w:r><w:t>paragraph ${index}</w:t></w:r></w:p>`
).join('');

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

/** A mounted editor inside a real scroll container, sized so pages fall out of view. */
function mount(): { editor: DocxEditorInstance; scroller: HTMLElement; host: HTMLElement } {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  // happy-dom reports 0 for layout metrics, so the scroll geometry is stated here the way
  // a real viewport would report it.
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrollTop = options.top ?? 0;
  }) as HTMLElement['scrollTo'];
  const editor = createDocxEditor({ container, document: docx() });
  if (!editor.surface) throw new Error('surface failed to mount');
  // The mounted container rides along so DOM queries stay scoped to THIS editor: a
  // document-wide query picks up a surface an earlier test in the same process left behind.
  return { editor, scroller, host: container };
}

describe('scrollToPage / scrollToBlock actually scroll', () => {
  test('a later page scrolls into view and reports that it did', () => {
    const { editor, scroller } = mount();
    expect(editor.getTotalPages()).toBeGreaterThan(1);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.scrollToPage(2)).toBe(true);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    editor.destroy();
  });

  test('page numbers are 1-based, and an out-of-range one is refused rather than clamped', () => {
    const { editor, scroller } = mount();
    // Page 1 is the top of the document, so it is a real target that scrolls to zero.
    expect(editor.scrollToPage(1)).toBe(true);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.scrollToPage(0)).toBe(false);
    expect(editor.scrollToPage(-1)).toBe(false);
    expect(editor.scrollToPage(9999)).toBe(false);
    expect(editor.scrollToPage(1.5)).toBe(false);
    editor.destroy();
  });

  test('a block on a later page scrolls to its own line, not merely its page', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(last)).toBe(true);
    const atLast = scroller.scrollTop;
    expect(atLast).toBeGreaterThan(0);
    // A paragraph EARLIER in the same document scrolls somewhere earlier — proving the
    // target is the block's own position rather than a constant.
    expect(editor.scrollToBlock(ids[Math.floor(ids.length / 2)]!)).toBe(true);
    expect(scroller.scrollTop).toBeLessThan(atLast);
    editor.destroy();
  });

  test('a block can be centred instead of put near the top', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const target = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(target)).toBe(true);
    const atStart = scroller.scrollTop;
    scroller.scrollTop = 0;
    expect(editor.scrollToBlock(target, { block: 'center' })).toBe(true);
    // Centring a line in a 600px viewport scrolls less than putting it near the top.
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBeLessThan(atStart);
    editor.destroy();
  });

  test("'nearest' scrolls the minimum, and less than 'start' or 'center'", () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const target = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(target, { block: 'center' })).toBe(true);
    const atCenter = scroller.scrollTop;
    scroller.scrollTop = 0;
    expect(editor.scrollToBlock(target, { block: 'nearest' })).toBe(true);
    const atNearest = scroller.scrollTop;
    // From above, the minimum scroll parks the line at the bottom edge.
    expect(atNearest).toBeGreaterThan(0);
    expect(atNearest).toBeLessThan(atCenter);
    // Already in view: 'nearest' does not move.
    expect(editor.scrollToBlock(target, { block: 'nearest' })).toBe(true);
    expect(scroller.scrollTop).toBe(atNearest);
    editor.destroy();
  });

  test("'centerIfNeeded' keeps a visible block still and centres one off screen", () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const target = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(target, { block: 'center' })).toBe(true);
    const atCenter = scroller.scrollTop;
    scroller.scrollTop = 0;
    expect(editor.scrollToBlock(target, { block: 'centerIfNeeded' })).toBe(true);
    expect(scroller.scrollTop).toBe(atCenter);
    // On screen now, so a second call leaves the viewport where it is.
    scroller.scrollTop = atCenter + 40;
    expect(editor.scrollToBlock(target, { block: 'centerIfNeeded' })).toBe(true);
    expect(scroller.scrollTop).toBe(atCenter + 40);
    editor.destroy();
  });

  test('offsetPx moves a start placement, and invalid scroll options are refused', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const target = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(target)).toBe(true);
    const atDefault = scroller.scrollTop;
    scroller.scrollTop = 0;
    expect(editor.scrollToBlock(target, { offsetPx: 124 })).toBe(true);
    expect(scroller.scrollTop).toBe(atDefault - 100);
    scroller.scrollTop = 0;
    const badBehavior = { behavior: 'slow' } as unknown as { behavior: 'smooth' };
    expect(editor.scrollToBlock(target, badBehavior)).toBe(false);
    expect(editor.scrollToBlock(target, { offsetPx: -1 })).toBe(false);
    expect(scroller.scrollTop).toBe(0);
    editor.destroy();
  });

  test('an unknown placement is refused rather than read as the default', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const options = { block: 'middle' } as unknown as { block: 'center' };
    expect(editor.scrollToBlock(ids[ids.length - 1]!, options)).toBe(false);
    expect(scroller.scrollTop).toBe(0);
    editor.destroy();
  });

  test('an unknown block is refused, so a caller can tell "no such target" from "done"', () => {
    const { editor } = mount();
    expect(editor.scrollToBlock('no-such-paragraph')).toBe(false);
    expect(editor.scrollToBlock('')).toBe(false);
    editor.destroy();
  });

  test('with no scroll container the surface refuses rather than pretending', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx() });
    expect(editor.scrollToPage(2)).toBe(false);
    editor.destroy();
  });
});

describe('revealPosition and the setSelection command scroll without focus', () => {
  test('revealPosition scrolls to an exact offset and refuses an unknown paragraph', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    expect(editor.surface!.revealPosition({ paragraphId: last, offset: 3 })).toBe(true);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(editor.surface!.revealPosition({ paragraphId: 'no-such-paragraph', offset: 0 })).toBe(
      false
    );
    editor.destroy();
  });

  test('a programmatic selection paints its highlight even with focus outside the pages', () => {
    // The highlight IS the browser's own selection, and the mirror refuses to write it
    // whenever the DOM selection lives outside these pages — the normal state when the
    // request came from the host's chrome (a review card takes focus on mousedown). The
    // model then held a range that nothing on screen showed, which is "setSelection does
    // not highlight" as a user sees it.
    const { editor, host } = mount();
    // The host's own chrome holds BOTH focus and the browser's selection — the state a
    // review card leaves behind when it focuses itself on mousedown.
    const outside = document.createElement('div');
    outside.textContent = 'host chrome';
    outside.tabIndex = 0;
    document.body.append(outside);
    outside.focus();
    const hostRange = document.createRange();
    hostRange.selectNodeContents(outside);
    const domSelection = document.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(hostRange);
    expect(domSelection.anchorNode && outside.contains(domSelection.anchorNode)).toBe(true);

    const ids = editor.surface!.session.paragraphIds();
    const target = ids[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: target, offset: 0 },
      head: { paragraphId: target, offset: 5 },
    });

    const dom = document.getSelection()!;
    expect(dom.rangeCount).toBeGreaterThan(0);
    // The selection has to have MOVED into THIS editor's pages — left in the host's chrome
    // it highlights the host's own text and the document shows nothing.
    expect(dom.anchorNode && host.contains(dom.anchorNode)).toBe(true);
    expect(dom.isCollapsed).toBe(false);

    outside.remove();
    editor.destroy();
  });

  test('the setSelection command reveals its head even with focus outside the pages', () => {
    const { editor, scroller } = mount();
    // The realistic host state: a toolbar button or automation call holds focus, which is
    // exactly what kept the caret-follow scroll from ever firing for this command.
    expect(document.activeElement?.closest('.docx-pages') ?? null).toBeNull();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    const result = editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: last, offset: 0 },
        head: { paragraphId: last, offset: 4 },
      },
    });
    expect(result.ok).toBe(true);
    // A RANGE selection: the internal caret-follow explicitly sits those out, so a moved
    // viewport proves the command scrolled on its own.
    expect(scroller.scrollTop).toBeGreaterThan(0);
    editor.destroy();
  });
});

describe('a reveal frames its target rather than merely moving the viewport', () => {
  /**
   * Where the target actually IS, in the scroller's own coordinates.
   *
   * Derived from the layout records rather than from the reveal, so it cannot agree with
   * the bug it exists to catch: caret geometry is CONTENT-BOX relative (the painter parents
   * the caret into `.docx-page-content`, one top margin down the sheet), and the reveal used
   * to add it to `page.box.y` — the top of the SHEET — which undershot every jump by exactly
   * that margin and left the target just under the fold.
   */
  function targetTop(editor: DocxEditorInstance, paragraphId: string): number {
    const layout = editor.surface!.layout();
    const caret = caretAt(layout, { paragraphId, offset: 0 })!;
    const page = layout.pages.find((entry) => entry.index === caret.pageIndex)!;
    // Records are POINTS; `scrollTop` is CSS PIXELS. The surface's default scale, and the
    // container sits at the top of the scroller in this harness.
    return (page.contentBox.y + caret.y) * (96 / 72);
  }

  test('the revealed line lands inside the viewport, not one page margin below it', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    expect(editor.surface!.revealPosition({ paragraphId: last, offset: 0 })).toBe(true);

    const top = targetTop(editor, last);
    // The whole point of a reveal: the caller can now SEE the thing.
    expect(top).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(top).toBeLessThanOrEqual(scroller.scrollTop + scroller.clientHeight);
    editor.destroy();
  });

  test('centerIfNeeded centres a target it has to travel to', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    expect(
      editor.surface!.revealPosition({ paragraphId: last, offset: 0 }, { block: 'centerIfNeeded' })
    ).toBe(true);

    const middle = scroller.scrollTop + scroller.clientHeight / 2;
    // Within a line of centre. `'nearest'` parks the target flush against the bottom edge,
    // which is a legal reveal and a poor one: the reader arrives looking at the last line of
    // the window rather than at what they asked to see.
    expect(Math.abs(targetTop(editor, last) - middle)).toBeLessThan(24);
    editor.destroy();
  });

  test('centerIfNeeded leaves a target that is already on screen alone', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    editor.surface!.revealPosition({ paragraphId: last, offset: 0 }, { block: 'centerIfNeeded' });
    const settled = scroller.scrollTop;

    // Re-revealing the same position must not move anything — a rail whose cards re-activate
    // on every selection change would otherwise jerk the page on each click.
    editor.surface!.revealPosition({ paragraphId: last, offset: 0 }, { block: 'centerIfNeeded' });
    expect(scroller.scrollTop).toBe(settled);
    editor.destroy();
  });
});
