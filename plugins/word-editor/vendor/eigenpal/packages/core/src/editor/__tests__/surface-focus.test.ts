import { afterEach, expect, test } from 'bun:test';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface';
import { semanticSelectionFromDom } from '../dom-selection';
import { docx, paragraph, putCaret } from './paginated-surface-fixtures';

let surface: PaginatedSurface | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  surface?.destroy();
  container?.remove();
});

function mount() {
  container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(paragraph('hello world')), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  surface = opened.surface;
  surface.focus();
  putCaret(surface, 5);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  const text = pages.querySelector('.layout-run-text')!.firstChild!;
  return { surface, pages, text };
}

test('focusing an already focused editor preserves a pending native selection', () => {
  const { surface, pages, text } = mount();
  const native = document.getSelection()!;
  native.setBaseAndExtent(text, 1, text, 4);
  const before = semanticSelectionFromDom(pages, native);
  expect(before?.head.offset).toBe(4);
  expect(document.activeElement).toBe(pages);

  // selectionchange is queued in browsers; the DOM can be newer than the model
  // when a host's event handler redundantly asks the editor to take focus.
  surface.focus();
  expect(semanticSelectionFromDom(pages, native)).toEqual(before);
});

test('focusing an already focused editor does not move the composing caret', () => {
  const { surface, pages, text } = mount();
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  text.textContent = 'hello中 world';
  const native = document.getSelection()!;
  native.setBaseAndExtent(text, 6, text, 6);
  const before = semanticSelectionFromDom(pages, native);
  expect(before?.head.offset).toBe(6);
  expect(document.activeElement).toBe(pages);

  surface.focus();
  expect(semanticSelectionFromDom(pages, native)).toEqual(before);
  expect(text.textContent).toBe('hello中 world');
});

test('document content has a localized name without replacing the editing surface', () => {
  const { surface, pages } = mount();
  expect(pages.getAttribute('aria-label')).toBe('Document content');
  surface.setTranslate((key) => (key === 'editor.documentContent' ? 'Treść dokumentu' : key));
  expect(pages.getAttribute('aria-label')).toBe('Treść dokumentu');
  expect(container!.querySelector('.docx-pages')).toBe(pages);
  expect(document.activeElement).toBe(pages);
  surface.setTranslate(undefined);
  expect(pages.getAttribute('aria-label')).toBe('Document content');
});
