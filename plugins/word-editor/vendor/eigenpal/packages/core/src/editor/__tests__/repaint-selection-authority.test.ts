// WHO OWNS THE CARET AFTER A REPAINT.
//
// The model and the browser each hold a selection, and every repaint has to decide which of
// the two is the newer. A gesture the queued `selectionchange` has not delivered yet is the
// case the DOM wins; everything else the browser does to its own selection — re-resolving it
// onto a container after a paint replaced the nodes it lived in — is not a move anybody made.
//
// The companion of `selection-integrity.test.ts`, which pins what a DOM endpoint MEANS. This
// file pins who is allowed to act on one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { applySelectionToDom, semanticSelectionFromDom } from '../dom-selection.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// The selection belongs to the DOCUMENT, which every suite in this process shares.
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/**
 * A painted paragraph that HAS text: two lines, each with one span.
 *
 * The distinction the write side turns on. A paragraph with painted spans and no place for an
 * offset must refuse; a paragraph with no spans at all still has its one caret position.
 */
function paintedParagraph(paragraphId: string): HTMLElement {
  const root = document.createElement('div');
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = paragraphId;
  for (const source of [
    { id: 'line-1', text: 'alpha ', start: 0 },
    { id: 'line-2', text: 'beta', start: 6 },
  ]) {
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = source.id;
    line.dataset.paragraphId = paragraphId;
    const span = document.createElement('span');
    span.dataset.paragraphId = paragraphId;
    span.dataset.start = String(source.start);
    span.dataset.end = String(source.start + source.text.length);
    span.textContent = source.text;
    line.append(span);
    fragment.append(line);
  }
  root.append(fragment);
  return root;
}

// A REPAINT MAY CARRY A GESTURE; IT MAY NEVER INVENT ONE.
//
// An edit installs its post-edit caret and the first repaint mirrors it out. That repaint is
// not the only one: a settled image, a deferred publish, a scroll all repaint again while the
// caret this edit installed is still the newest thing anybody moved. Those later repaints read
// the browser's selection, and the browser's answer after a page's DOM has been rebuilt under
// it is a container — which reads back as the paragraph START. The reported shape: open the
// header, type there, click back into the body, then type at the end of a paragraph. The first
// character landed, the caret went home to offset 0, and every character after it was inserted
// in front of the one before, so "Hello" arrived as "elloH".
describe('a repaint never invents a selection the user did not make', () => {
  const body =
    '<w:p><w:r><w:t xml:space="preserve">alpha</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">beta</w:t></w:r></w:p>';

  function mounted(): { surface: PaginatedSurface; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    return { surface: opened.surface, container };
  }

  test('a caret the paint cannot express is refused, not landed at the paragraph start', () => {
    // The write side of the same failure. A paragraph that painted text and has no place for
    // this offset — inside a hidden run, or past what the current paint covers — used to
    // answer the line element at child index 0. `applySelectionToDom` then reported success
    // for a caret sitting at the paragraph start, and the next reader took that as the truth.
    const root = paintedParagraph('p1');
    document.body.append(root);
    try {
      const beyond = { paragraphId: 'p1', offset: 40 };
      expect(
        applySelectionToDom(root, { anchor: beyond, head: beyond }, document.getSelection())
      ).toBe(false);
    } finally {
      root.remove();
    }
  });

  test('an empty paragraph still gets its one caret position', () => {
    // The refusal above must not take the case the fallback exists for: a paragraph with no
    // painted spans at all has exactly one caret position, and losing it means no caret after
    // every Enter.
    const root = document.createElement('div');
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = 'line-1';
    line.dataset.paragraphId = 'p9';
    root.append(line);
    document.body.append(root);
    try {
      const caret = { paragraphId: 'p9', offset: 0 };
      expect(
        applySelectionToDom(root, { anchor: caret, head: caret }, document.getSelection())
      ).toBe(true);
    } finally {
      root.remove();
    }
  });

  test('a browser selection nobody gestured for does not move the caret an edit just set', async () => {
    const { surface, container } = mounted();
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      surface.type('!');
      expect(surface.state().selection.head.offset).toBe(6);

      // What a repaint leaves behind: the browser re-resolves its selection onto the line
      // container, which reads back as the paragraph START. No pointerdown, no selectstart —
      // nobody gestured, so this is the DOM being fixed up, not the user moving the caret.
      const line = container.querySelector<HTMLElement>(
        `[data-line-id][data-paragraph-id="${id}"]`
      )!;
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(line, 0);
      range.collapse(true);
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(surface.state().selection.head.offset).toBe(6);

      // The next keystroke arrives the way the browser delivers one, through the same
      // `beforeinput` that reads the DOM selection first. It must land AFTER the character
      // before it, not in front of it.
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: '?',
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paragraphTextOf(surface.session.part(), id)).toBe('alpha!?');
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

// FOCUS IN OTHER CHROME IS NOT A GESTURE IN THE PAGES.
//
// An open context menu holds focus, and a background layout pass can repaint the pages under
// it. The repaint replaces the page the browser's selection sat in, so the browser collapses
// that selection onto the pages layer and queues a `selectionchange`. Adopting it moved the
// caret to the document start, and the claimed write that followed took focus out of the menu
// in one engine, which then closed on the scroll.
describe('a selection change while other chrome holds focus', () => {
  const twoParagraphs =
    '<w:p><w:r><w:t xml:space="preserve">alpha</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">beta</w:t></w:r></w:p>';

  test('keeps the caret and leaves focus where it is', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(twoParagraphs), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    const menu = document.createElement('div');
    menu.tabIndex = -1;
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    try {
      const second = surface.session.paragraphIds()[1]!;
      const caret = { paragraphId: second, offset: 2 };
      surface.setSelection({ anchor: caret, head: caret });
      menu.focus();
      expect(document.activeElement).toBe(menu);
      // A repaint while the menu holds focus. Then a later task, so the echo guard of the
      // last mirror has cleared, as it has when a real layout pass lands.
      surface.contentControls.setShowAll(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // What the repaint leaves behind: the selection collapsed onto the pages layer itself.
      const pages = container.querySelector<HTMLElement>('.docx-pages')!;
      document.getSelection()!.setBaseAndExtent(pages, 0, pages, 0);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(surface.state().selection.head).toEqual(caret);
      expect(document.activeElement).toBe(menu);
    } finally {
      surface.destroy();
      menu.remove();
      container.remove();
      document.getSelection()?.removeAllRanges();
    }
  });
});

const FIELD_PARAGRAPH =
  '<w:p><w:r><w:t xml:space="preserve">alpha </w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF Company </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>Street</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> omega</w:t></w:r></w:p>';

function paint(): HTMLElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${FIELD_PARAGRAPH}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType: 'application/xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, ariaHidden: false });
  document.body.append(root);
  return root;
}

describe('a selection ending at a field start', () => {
  test('round-trips as the range the user made', () => {
    const root = paint();
    try {
      const field = root.querySelector<HTMLElement>('[data-docx-field]')!;
      const paragraphId = field.dataset.paragraphId!;
      const fieldStart = Number(field.dataset.start);
      expect(Number(field.dataset.end) - fieldStart).toBe(1);
      const range = {
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: fieldStart },
      };
      const selection = document.getSelection()!;
      expect(applySelectionToDom(root, range, selection)).toBe(true);
      expect(field.contains(selection.focusNode!)).toBe(false);
      expect(semanticSelectionFromDom(root, selection)).toEqual(range);
    } finally {
      document.getSelection()?.removeAllRanges();
      root.remove();
    }
  });
});

// A BURST IS OLDER THAN THE GESTURE THAT INTERRUPTS IT.
//
// Typing is held on a zero-delay task, and the position a gesture maps to is read from a DOM
// those characters are not in yet. Every other caret mover lands the buffer first; the
// render-time reader cannot, because it runs as the first statement of a render and a flush
// commits — which renders. So it defers instead: the flush is the next task, and its own
// render adopts the gesture with the provenance flag still armed.
describe('a gesture during a typing burst', () => {
  const twoParagraphs =
    '<w:p><w:r><w:t xml:space="preserve">alpha</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">beta</w:t></w:r></w:p>';

  test('the typed characters stay where they were typed', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(twoParagraphs), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 5 },
        head: { paragraphId: ids[0]!, offset: 5 },
      });
      const pages = container.querySelector<HTMLElement>('.docx-pages')!;
      const keystroke = (data: string): void => {
        pages.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data,
          })
        );
      };
      keystroke('X');
      keystroke('Y');

      // A touch tap in the other paragraph, arriving before the buffer flushes. Touch never
      // reaches the engine pointer path, so nothing else lands the buffer for it.
      const target = [
        ...pages.querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]'),
      ].find((span) => span.dataset.paragraphId === ids[1])!;
      pages.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' })
      );
      const text = target.firstChild!;
      document.getSelection()!.setBaseAndExtent(text, 2, text, 2);
      surface.contentControls.setShowAll(true); // a render with no flush of its own

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('alphaXY');
      expect(paragraphTextOf(surface.session.part(), ids[1]!)).toBe('beta');
    } finally {
      surface.destroy();
      container.remove();
      document.getSelection()?.removeAllRanges();
    }
  });
});
