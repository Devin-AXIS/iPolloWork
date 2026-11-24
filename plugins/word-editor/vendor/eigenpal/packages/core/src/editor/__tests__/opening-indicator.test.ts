// While a large open lays out its remaining pages, the loading indicator is a real element on
// the first page: the packaged spinner, or the host's own content through
// `setOpeningIndicatorHost`. It goes away, and the host hears so, when the open ends.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { setOpeningIndicatorHost } from '../surface-opening-indicator.ts';
import { continueProgressiveOpen } from '../surface-progressive-open.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Enough paragraphs for several slices; `filler` pushes the file past the open-yield size. */
function docx(filler = false): Uint8Array {
  const paragraphs: string[] = [];
  for (let index = 0; index < 900; index += 1) {
    paragraphs.push(`<w:p><w:r><w:t>Body paragraph ${index}</w:t></w:r></w:p>`);
  }
  const lines: string[] = [];
  for (let total = 0; filler && total < 700 * 1024;) {
    const line = `<l>filler line ${lines.length} carrying a little ordinary sentence text.</l>`;
    lines.push(line);
    total += line.length;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
    ...(filler ? { 'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`) } : {}),
  });
}

function slicedMount() {
  const container = document.createElement('div');
  const mounted = mountPaginatedSurface(container, docx(), {
    progressiveOpen: true,
  } as Parameters<typeof mountPaginatedSurface>[2]);
  if (!mounted.ok) throw new Error(mounted.reason);
  return { container, surface: mounted.surface };
}

const indicatorOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(':scope > .docx-opening-indicator');

async function until(check: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('the loading indicator on the first page', () => {
  test('shows the packaged spinner below the laid-out pages until the open ends', () => {
    const { container, surface } = slicedMount();
    try {
      const indicator = indicatorOf(container);
      expect(indicator).not.toBeNull();
      // A sibling of the pages, so the page painter keeps it, in the band below the last
      // laid-out page, where the next pages appear.
      const pages = container.querySelector<HTMLElement>(':scope > .docx-pages')!;
      const page = container.querySelector<HTMLElement>('.docx-page[data-page-index="0"]')!;
      expect(indicator!.hidden).toBe(false);
      expect(indicator!.style.width).toBe(page.style.width);
      expect(indicator!.style.left).toBe(page.style.left);
      expect(indicator!.style.top).toBe(pages.style.height);
      expect(indicator!.querySelector('.docx-editor__loading-spinner')).not.toBeNull();
      while (!continueProgressiveOpen(surface, 0)) {
        // One slice at a time.
      }
      expect(indicatorOf(container)).toBeNull();
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('hands its content to a host and back', () => {
    const { container, surface } = slicedMount();
    try {
      const published: (HTMLElement | null)[] = [];
      const host = { publish: (element: HTMLElement | null) => published.push(element) };
      setOpeningIndicatorHost(surface, host);
      const status = published[0]!;
      expect(status.parentElement).toBe(indicatorOf(container));
      // The host's element is empty: the host renders into it.
      expect(status.childElementCount).toBe(0);
      expect(status.getAttribute('role')).toBe('status');
      // `null` gives the indicator back to the packaged spinner, and tells the host.
      setOpeningIndicatorHost(surface, null);
      expect(published).toEqual([status, null]);
      expect(status.querySelector('.docx-editor__loading-spinner')).not.toBeNull();
      setOpeningIndicatorHost(surface, host);
      while (!continueProgressiveOpen(surface, 0)) {
        // One slice at a time.
      }
      expect(published).toEqual([status, null, status, null]);
      expect(indicatorOf(container)).toBeNull();
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('the editor applies a host set before the document opens', async () => {
    const editor = createDocxEditor({ document: docx(true) });
    const published: (HTMLElement | null)[] = [];
    editor.setOpeningIndicatorHost({ publish: (element) => published.push(element) });
    const container = document.createElement('div');
    editor.attach(container);
    // Recorded at the call: the slices are queued tasks that can end the open before a poll.
    // The indicator stays until the last page is laid out, after `isOpening` turned false.
    await until(
      () => editor.surface !== null && !container.hasAttribute('data-docx-layout-pending')
    );
    expect(published.length).toBe(2);
    expect(published[0]!.closest('.docx-opening-indicator')).not.toBeNull();
    expect(published[1]).toBeNull();
    expect(indicatorOf(container)).toBeNull();
    // A host set after the open has nothing to receive.
    const late: (HTMLElement | null)[] = [];
    editor.setOpeningIndicatorHost({ publish: (element) => late.push(element) });
    expect(late).toEqual([]);
    editor.destroy();
  }, 60_000);
});
