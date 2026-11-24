// Entering a header must not replace painted page sheets (#355 cause 3).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function headeredPages(pageCount: number): Uint8Array {
  const pages: string[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pages.push(p(`body page ${index + 1}`));
    if (index < pageCount - 1) pages.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('HEADER')}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${pages.join('')}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

describe('header entry keeps painted pages', () => {
  test('enterHeaderFooter and crossing copies retint chrome without replacing sheets', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mounted = mountPaginatedSurface(container, headeredPages(6), { scale: 1 });
    if (!mounted.ok) throw new Error(`${mounted.reason}: ${mounted.detail ?? ''}`);
    const { surface } = mounted;
    const before = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    expect(before.length).toBe(6);

    expect(surface.enterHeaderFooter({ rId: 'rId10', pageIndex: 0 })).toBe(true);
    const entered = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    expect(entered).toHaveLength(before.length);
    for (let index = 0; index < before.length; index += 1) {
      expect(entered[index]).toBe(before[index]);
    }
    expect(before[0]!.querySelector('[data-docx-hf-active]')?.getAttribute('data-docx-hf')).toBe(
      'header'
    );
    expect(before[1]!.querySelector('[data-docx-hf-active]')).toBeNull();
    expect(container.querySelector('.docx-page-content')?.getAttribute('contenteditable')).toBe(
      'false'
    );

    expect(surface.enterHeaderFooter({ rId: 'rId10', pageIndex: 1 })).toBe(true);
    const moved = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    for (let index = 0; index < before.length; index += 1) {
      expect(moved[index]).toBe(before[index]);
    }
    expect(before[0]!.querySelector('[data-docx-hf-active]')).toBeNull();
    expect(before[1]!.querySelector('[data-docx-hf-active]')).not.toBeNull();

    surface.exitHeaderFooter();
    const exited = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    for (let index = 0; index < before.length; index += 1) {
      expect(exited[index]).toBe(before[index]);
    }
    expect(container.querySelector('[data-docx-hf-active]')).toBeNull();
    surface.destroy();
  });
});

describe('header typing keeps painted bodies', () => {
  test('a header edit repaints the header on every page and keeps each body block', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mounted = mountPaginatedSurface(container, headeredPages(4), { scale: 1 });
    if (!mounted.ok) throw new Error(`${mounted.reason}: ${mounted.detail ?? ''}`);
    const { surface } = mounted;
    const sheets = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    const blocks = sheets.map((sheet) => [
      ...sheet.querySelectorAll<HTMLElement>('.docx-page-content > *'),
    ]);
    expect(surface.enterHeaderFooter({ rId: 'rId10', pageIndex: 1 })).toBe(true);
    surface.type('X');
    const after = [...container.querySelectorAll<HTMLElement>('.docx-page')];
    for (const [index, sheet] of sheets.entries()) {
      expect(after[index]).toBe(sheet);
      const bands = sheet.querySelectorAll('.docx-hf[data-docx-hf="header"]');
      expect(bands).toHaveLength(1);
      expect(bands[0]!.textContent).toContain('XHEADER');
      // The body blocks are the same elements: only the header layer was rebuilt.
      expect([...sheet.querySelectorAll<HTMLElement>('.docx-page-content > *')]).toEqual(
        blocks[index]!
      );
      expect(sheet.querySelectorAll('[data-docx-hf-hint="header"]').length).toBeLessThanOrEqual(1);
    }
    expect(after[1]!.querySelector('[data-docx-hf-active]')).not.toBeNull();
    expect(after[0]!.querySelector('[data-docx-hf-active]')).toBeNull();
    surface.destroy();
  });
});
