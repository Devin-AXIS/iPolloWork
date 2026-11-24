import { afterEach, expect, test } from 'bun:test';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function unrelatedDocument(paragraphCount: number) {
  const parts = unzipSync(refreshFixture());
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<w:p><w:r><w:t>Asset ${index + 1}: Inspection complete.</w:t></w:r></w:p>`
  ).join('');
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!).replace(
      /<w:body>[\s\S]*?<w:sectPr>/,
      `<w:body>${paragraphs}<w:sectPr>`
    )
  );
  return zipSync(parts);
}

function open() {
  const scroll = document.createElement('div');
  scroll.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroll.append(container);
  document.body.append(scroll);
  let height = 3000;
  let width = 1200;
  Object.defineProperties(scroll, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 500 },
    scrollWidth: { get: () => width },
    clientWidth: { value: 800 },
  });
  const editor = createDocxEditor({ container, document: refreshFixture() });
  const refresh = createDocumentRefresh(editor);
  disposers.push(() => {
    editor.destroy();
    scroll.remove();
  });
  return {
    editor,
    refresh,
    container,
    scroll,
    resize: (h: number, w: number) => {
      height = h;
      width = w;
    },
  };
}

test('accepts unrelated shorter content, clamps both scroll axes, and discards previous change locations', async () => {
  const { editor, refresh, container, scroll, resize } = open();
  const submission = await refresh.capture();
  await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: refreshFixture(1),
    changes: refreshMetadata(),
  });
  refresh.highlightChanges();
  expect(container.querySelector('[data-docx-refresh-highlight]')).not.toBeNull();
  scroll.scrollTop = 1900;
  scroll.scrollLeft = 300;
  resize(600, 820);
  const result = await refresh.applyUpdate({
    submission,
    sequence: 2,
    bytes: unrelatedDocument(2),
  });
  expect(result).toMatchObject({ ok: true, changeInformation: 'unavailable', changes: [] });
  expect(editor.surface!.session.bodyText()).toContain('Asset 1: Inspection complete.');
  expect(editor.surface!.session.bodyText()).not.toContain('Project schedule');
  expect(scroll.scrollTop).toBe(100);
  expect(scroll.scrollLeft).toBe(20);
  expect(refresh.navigateToChange('delivery-date')).toBe(false);
  refresh.highlightChanges({ includePrevious: true });
  expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
});

test('accepts unrelated longer content and keeps offsets without guessing semantic position', async () => {
  const { editor, refresh, scroll, resize } = open();
  const submission = await refresh.capture();
  scroll.scrollTop = 1600;
  scroll.scrollLeft = 150;
  resize(6000, 1600);
  const result = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: unrelatedDocument(90),
  });
  expect(result).toMatchObject({ ok: true, changeInformation: 'unavailable' });
  expect(editor.surface!.session.bodyText()).toContain('Asset 90: Inspection complete.');
  expect(scroll.scrollTop).toBe(1600);
  expect(scroll.scrollLeft).toBe(150);
});

test('accepts a replacement while refusing metadata that describes the previous file', async () => {
  const { refresh, container, scroll, resize } = open();
  const submission = await refresh.capture();
  scroll.scrollTop = 1900;
  resize(300, 600);
  const result = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: unrelatedDocument(1),
    changes: refreshMetadata(),
  });
  expect(result).toMatchObject({ ok: true, changes: [{ id: 'delivery-date', status: 'invalid' }] });
  expect(scroll.scrollTop).toBe(0);
  expect(scroll.scrollLeft).toBe(0);
  refresh.highlightChanges();
  expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
  expect(refresh.navigateToChange('delivery-date')).toBe(false);
});
