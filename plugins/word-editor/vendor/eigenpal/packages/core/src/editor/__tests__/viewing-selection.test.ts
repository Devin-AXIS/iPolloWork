// VIEWING SELECTS, AND REFUSES EVERY WRITE.
//
// A reader in viewing mode selects text with the pointer and the keyboard and copies it, so a
// host can act on the selection (quote it, comment on it elsewhere). Each lane is pinned here
// beside a write it must still refuse, so a view that let a write through fails as loudly as
// one that froze the selection again.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const BYTES = docx(p('alpha beta') + p('gamma delta'));

async function withViewingSurface(
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void> | void
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, BYTES, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const ids = opened.surface.session.paragraphIds();
    const at = { paragraphId: ids[1]!, offset: 3 };
    opened.surface.setSelection({ anchor: at, head: at });
    opened.surface.setEditingMode('view');
    await run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

function pages(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.docx-pages')!;
}

function key(container: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  pages(container).dispatchEvent(event);
  return event;
}

function clipboard(container: HTMLElement, type: 'copy' | 'cut') {
  const data = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
  pages(container).dispatchEvent(event);
  return { text: data.getData('text/plain'), prevented: event.defaultPrevented };
}

function firstSpan(container: HTMLElement, surface: PaginatedSurface): HTMLElement {
  const first = surface.session.paragraphIds()[0]!;
  return [
    ...pages(container).querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]'),
  ].find((node) => node.dataset.paragraphId === first)!;
}

describe('viewing selects text', () => {
  test('the pages stay focusable while viewing, and editable only while editing', async () => {
    await withViewingSurface((surface, container) => {
      expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(true);
      expect(pages(container).contentEditable).toBe('false');
      expect(pages(container).getAttribute('aria-readonly')).toBe('true');
      expect(pages(container).getAttribute('tabindex')).toBe('0');
      surface.setEditingMode('edit');
      expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(false);
      expect(pages(container).contentEditable).toBe('true');
      expect(pages(container).hasAttribute('tabindex')).toBe(false);
    });
  });

  for (const [name, init] of [
    ['Shift+ArrowRight', { key: 'ArrowRight', shiftKey: true }],
    ['Shift+End', { key: 'End', shiftKey: true }],
    ['Ctrl+Shift+Home', { key: 'Home', ctrlKey: true, shiftKey: true }],
    ['Ctrl+A', { key: 'a', ctrlKey: true }],
  ] as const) {
    test(`${name} selects text`, async () => {
      await withViewingSurface((surface, container) => {
        const before = surface.state().selection;
        key(container, init);
        const after = surface.state().selection;
        expect(after).not.toEqual(before);
        expect(after.anchor).not.toEqual(after.head);
      });
    });
  }

  for (const name of ['ArrowDown', 'ArrowLeft', 'Home', 'End', 'PageDown'] as const) {
    test(`an unshifted ${name} is left to the browser, which scrolls`, async () => {
      await withViewingSurface((surface, container) => {
        const before = surface.state().selection;
        expect(key(container, { key: name }).defaultPrevented).toBe(false);
        expect(surface.state().selection).toEqual(before);
      });
    });
  }

  test('a press places the selection, and a native selection is adopted', async () => {
    await withViewingSurface(async (surface, container) => {
      const ids = surface.session.paragraphIds();
      const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1 };
      firstSpan(container, surface).dispatchEvent(
        new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' })
      );
      document.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      expect(surface.state().selection.head.paragraphId).toBe(ids[0]!);

      // A drag the browser selected, as on touch. Past the mirror's echo guard first.
      surface.setSelection({
        anchor: { paragraphId: ids[1]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 0 },
      });
      await Promise.resolve();
      const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
      firstSpan(container, surface).dispatchEvent(selectStart);
      expect(selectStart.defaultPrevented).toBe(false);
      pages(container).dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' })
      );
      const text = firstSpan(container, surface).firstChild!;
      document.getSelection()!.setBaseAndExtent(text, 0, text, 5);
      document.dispatchEvent(new Event('selectionchange'));
      expect(surface.state().selection).toEqual({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 5 },
      });
    });
  });

  test('copy writes the selected text, and cut and write keys change nothing', async () => {
    await withViewingSurface((surface, container) => {
      const first = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: first, offset: 5 },
      });
      const revision = surface.state().revision;
      const copied = clipboard(container, 'copy');
      expect(copied.text).toBe('alpha');
      expect(copied.prevented).toBe(true);

      const cut = clipboard(container, 'cut');
      expect(cut.text).toBe('');
      expect(cut.prevented).toBe(true);

      key(container, { key: 'Backspace' });
      key(container, { key: 'Enter' });
      key(container, { key: 'b', ctrlKey: true });
      // Tab leaves the pages: nothing here claims it.
      expect(key(container, { key: 'Tab' }).defaultPrevented).toBe(false);
      expect(surface.state().revision).toBe(revision);
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.paragraphIds().length).toBe(2);
    });
  });

  test('paints no caret for a collapsed selection', async () => {
    await withViewingSurface((surface, container) => {
      pages(container).focus();
      const first = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: first, offset: 2 },
        head: { paragraphId: first, offset: 2 },
      });
      expect(document.activeElement).toBe(pages(container));
      expect(container.querySelector('.docx-editor-one-surface__caret')).toBeNull();
    });
  });
});

describe('a document opened for viewing', () => {
  test('reports the selection, keeps the Show/Hide chord, and refuses writes', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: BYTES, mode: 'view' });
    try {
      key(container, { key: 'a', ctrlKey: true });
      expect(editor.query({ type: 'selectedText' })).toBe('alpha beta\ngamma delta');
      expect(editor.snapshot().selectionCollapsed).toBe(false);
      expect(editor.snapshot().selection).not.toBeNull();
      key(container, { key: '8', code: 'Digit8', metaKey: true });
      expect(editor.snapshot().showParagraphMarks).toBe(true);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
        ok: false,
        code: 'locked',
      });
      expect(editor.snapshot().editable).toBe(false);
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});
