// A floating table in a header or footer that reaches into the body area: body text wraps
// around it as around a floating body table, on every page that shows that variant.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import type { LineRecord, PageRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const ML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** A 60pt-high one-cell table at page y `top` (points), `width` twips wide. */
function floatingTable(top: number, width: number, xSpec = 'center'): string {
  return (
    `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="page" ` +
    `w:horzAnchor="margin" w:tblpXSpec="${xSpec}" w:tblpY="${top * 20 + 1}"/>` +
    `<w:tblW w:w="${width}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr><w:tc><w:tcPr>` +
    `<w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>` +
    '</w:tr></w:tbl>'
  );
}

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const LONG = Array.from({ length: 12 }, () => 'Body words flow here.').join(' ');

interface Options {
  readonly header?: string;
  readonly footer?: string;
  /** A first-page header without the table. */
  readonly firstPage?: boolean;
  readonly paragraphs?: number;
}

function docx(options: Options): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  let refs = '';
  let rels = '';
  let overrides = '';
  const story = (kind: 'hdr' | 'ftr', id: string, type: string, body: string) => {
    const name = `${kind === 'hdr' ? 'header' : 'footer'}${id}.xml`;
    refs += `<w:${kind === 'hdr' ? 'header' : 'footer'}Reference w:type="${type}" r:id="r${id}${kind}"/>`;
    rels += `<Relationship Id="r${id}${kind}" Type="${R}/${kind === 'hdr' ? 'header' : 'footer'}" Target="${name}"/>`;
    overrides += `<Override PartName="/word/${name}" ContentType="${ML}.${kind === 'hdr' ? 'header' : 'footer'}+xml"/>`;
    parts[`word/${name}`] = strToU8(`<w:${kind} xmlns:w="${W}" xmlns:r="${R}">${body}</w:${kind}>`);
  };
  if (options.header) story('hdr', '1', 'default', options.header);
  if (options.firstPage) story('hdr', '2', 'first', para('First header'));
  if (options.footer) story('ftr', '3', 'default', options.footer);
  const body = Array.from({ length: options.paragraphs ?? 30 }, (_, i) => para(`P${i} ${LONG}`));
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${ML}.document.main+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${ML}.settings+xml"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rS" Type="${R}/settings" Target="settings.xml"/>${rels}</Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" ` +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}<w:sectPr>${refs}` +
        '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" ' +
        `w:left="1134" w:header="1077" w:footer="709" w:gutter="0"/>${options.firstPage ? '<w:titlePg/>' : ''}` +
        '</w:sectPr></w:body></w:document>'
    ),
    ...parts,
  });
}

/** Body lines of one page, with tops relative to the sheet. */
function bodyLines(page: PageRecord): { readonly top: number; readonly line: LineRecord }[] {
  const sheetTop = page.box.y;
  return page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) => ({ top: page.contentBox.y + line.box.y - sheetTop, line }))
      : []
  );
}

function withPages(bytes: Uint8Array, run: (pages: readonly PageRecord[]) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface.layout().pages);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const crosses = (top: number, line: LineRecord, bandTop: number, bandBottom: number) =>
  top < bandBottom - 0.01 && top + line.box.height > bandTop + 0.01;

describe('body text wraps around a floating header or footer table', () => {
  test('a table as wide as the column moves body lines below it', () => {
    withPages(docx({ header: floatingTable(150, 9638) + para('Header') }), (pages) => {
      for (const page of pages.slice(0, 2)) {
        const lines = bodyLines(page);
        expect(lines.some(({ top, line }) => crosses(top, line, 150, 210))).toBe(false);
        expect(lines.some(({ top }) => Math.abs(top - 210) < 0.05)).toBe(true);
      }
    });
  });

  test('a narrow table keeps body lines beside it', () => {
    withPages(docx({ header: floatingTable(150, 2000, 'left') + para('Header') }), (pages) => {
      // The default 1.08 multiple adds its extra below the text, and a band ignores that extra.
      const beside = bodyLines(pages[0]!).filter(({ top, line }) =>
        crosses(
          top,
          { ...line, box: { ...line.box, height: (line.box.height * 240) / 259 } },
          150,
          210
        )
      );
      expect(beside.length).toBeGreaterThan(0);
      // The table is 100pt wide with 9pt to its right.
      for (const { line } of beside) expect(line.contentX).toBeGreaterThanOrEqual(108.9);
    });
  });

  test('a footer table wraps the body above the footer too', () => {
    withPages(docx({ footer: floatingTable(650, 9638) + para('Footer') }), (pages) => {
      const lines = bodyLines(pages[0]!);
      expect(lines.some(({ top, line }) => crosses(top, line, 650, 710))).toBe(false);
    });
  });

  test('a first-page header without the table leaves the first page unwrapped', () => {
    const bytes = docx({ header: floatingTable(150, 9638) + para('Header'), firstPage: true });
    withPages(bytes, (pages) => {
      const first = bodyLines(pages[0]!);
      expect(first.some(({ top, line }) => crosses(top, line, 150, 210))).toBe(true);
      const second = bodyLines(pages[1]!);
      expect(second.some(({ top, line }) => crosses(top, line, 150, 210))).toBe(false);
    });
  });
});
