import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docxFromBody(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('layout revision marker on painted pages', () => {
  test('mountPaginatedSurface stamps `.docx-pages[data-revision]` after paint', () => {
    const body = `<w:p><w:r><w:t>hello</w:t></w:r></w:p>`;
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const pages = container.querySelector('.docx-pages');
      expect(pages).not.toBeNull();
      const raw = pages!.getAttribute('data-revision');
      expect(raw).not.toBeNull();
      expect(Number.isFinite(Number(raw))).toBe(true);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });
});
