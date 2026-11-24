import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { caretAt } from '@docx-editor.dev/core/layout';
import { formatDefaultsDocx as docx, paragraph } from './paginated-surface-fixtures.ts';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';

function mount(body: string): {
  readonly surface: PaginatedSurface;
  readonly scroller: HTMLElement;
} {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  document.body.append(scroller);
  const host = document.createElement('div');
  scroller.append(host);
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
  const opened = mountPaginatedSurface(host, docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, scroller };
}

describe('bookmark navigation', () => {
  test('a bookmark jump after rescaling uses the current scale', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(
      filler +
        `<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Destination</w:t></w:r></w:p>`
    );
    const target = surface.bookmarks().get('target');
    expect(target).not.toBeUndefined();

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);
    expect(surface.navigation.goToBookmark('target')).toBe(true);

    const bookmark = surface.bookmarks().get('target')!;
    const caret = caretAt(surface.layout(), {
      paragraphId: bookmark.paragraphId,
      offset: bookmark.offset,
    });
    expect(caret).not.toBeNull();
    const page = surface.layout().pages[caret!.pageIndex]!;
    const sheetY = page.box.y + (page.contentBox.y - page.box.y) + caret!.y;
    expect(scroller.scrollTop).toBeCloseTo(Math.max(0, sheetY * 2 - 24), 5);
    expect(surface.state().selection.head.paragraphId).toBe(bookmark.paragraphId);

    surface.destroy();
    scroller.remove();
  });
});

describe('caret following', () => {
  test('scrolls the nearest edge into view when a collapsed caret changes page', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(filler);
    surface.focus();

    const targetId = surface.session.paragraphIds().find((paragraphId) => {
      const caret = caretAt(surface.layout(), { paragraphId, offset: 0 });
      return caret !== null && caret.pageIndex > 0;
    });
    expect(targetId).toBeDefined();

    surface.setSelection({
      anchor: { paragraphId: targetId!, offset: 0 },
      head: { paragraphId: targetId!, offset: 0 },
    });

    const caret = caretAt(surface.layout(), { paragraphId: targetId!, offset: 0 })!;
    const page = surface.layout().pages[caret.pageIndex]!;
    const sheetY = page.box.y + (page.contentBox.y - page.box.y) + caret.y;
    expect(scroller.scrollTop).toBeCloseTo(
      Math.max(0, sheetY + caret.height + 24 - scroller.clientHeight),
      5
    );

    surface.destroy();
    scroller.remove();
  });

  test('does not follow a range selection', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(filler);
    surface.focus();
    const ids = surface.session.paragraphIds();

    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[ids.length - 1]!, offset: 0 },
    });

    expect(scroller.scrollTop).toBe(0);
    surface.destroy();
    scroller.remove();
  });
});
