// Header and footer stories share one list count, separate from the body. It runs over every
// section in order and, within a section, over the parts that section references itself:
// even header, default header, even footer, default footer, first-page header, first-page
// footer. A page shows the same numbers for a story on every page.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const items = (tag: string, count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      `<w:r><w:t>${tag}${index + 1}</w:t></w:r></w:p>`
  ).join('');
const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const pages = (count: number, tag = 'body') =>
  Array.from({ length: count }, (_, index) => plain(`${tag}${index + 1}`)).join(pageBreak);

type Refs = Readonly<Record<string, string>>;
/** `refs` maps a `type` (default, first, even) to a part name of `parts`. */
function sectPr(headers: Refs, footers: Refs, extra = ''): string {
  return (
    '<w:sectPr>' +
    Object.entries(headers)
      .map(([type, name]) => `<w:headerReference w:type="${type}" r:id="h_${name}"/>`)
      .join('') +
    Object.entries(footers)
      .map(([type, name]) => `<w:footerReference w:type="${type}" r:id="f_${name}"/>`)
      .join('') +
    `${extra}<w:pgSz w:w="12240" w:h="15840"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    '</w:sectPr>'
  );
}
const sectionBreak = (headers: Refs, footers: Refs) =>
  `<w:p><w:pPr>${sectPr(headers, footers).replace('<w:sectPr>', '<w:sectPr><w:type w:val="nextPage"/>')}</w:pPr></w:p>`;

function docx(options: {
  readonly body: string;
  readonly headers: Refs;
  readonly footers: Refs;
  readonly evenAndOdd?: boolean;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  const rels: string[] = [
    `<Relationship Id="rNum" Type="${R}/numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rSet" Type="${R}/settings" Target="settings.xml"/>`,
  ];
  for (const [kind, parts, root] of [
    ['header', options.headers, 'hdr'],
    ['footer', options.footers, 'ftr'],
  ] as const) {
    for (const [name, inner] of Object.entries(parts)) {
      const file = `${kind}_${name}.xml`;
      files[`word/${file}`] = strToU8(`<w:${root} xmlns:w="${W}">${inner}</w:${root}>`);
      overrides.push(`<Override PartName="/word/${file}" ContentType="${WML}.${kind}+xml"/>`);
      rels.push(`<Relationship Id="${kind[0]}_${name}" Type="${R}/${kind}" Target="${file}"/>`);
    }
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>` +
        `${overrides.join('')}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${options.evenAndOdd ? '<w:evenAndOddHeaders/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${options.body}</w:body></w:document>`
    ),
    ...files,
  });
}

/** Per page: header markers, then `|`, then footer markers. */
function furnitureMarkers(surface: PaginatedSurface): string[] {
  const markersOf = (story: { readonly fragments: readonly unknown[] } | undefined) =>
    (story?.fragments ?? []).flatMap((fragment) => {
      const paragraph = fragment as { kind: string; marker?: { text: string } };
      return paragraph.kind === 'paragraph' && paragraph.marker ? [paragraph.marker.text] : [];
    });
  return surface
    .layout()
    .pages.map((page) => [...markersOf(page.header), '|', ...markersOf(page.footer)].join(' '));
}

function markersFor(bytes: Uint8Array): string[] {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return furnitureMarkers(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

describe('header and footer lists share one count', () => {
  test('the footer continues the header list, with the same numbers on every page', () => {
    const bytes = docx({
      body: pages(3) + sectPr({ default: 'd' }, { default: 'd' }),
      headers: { d: items('HA', 2) },
      footers: { d: items('FA', 2) },
    });
    expect(markersFor(bytes)).toEqual(['1. 2. | 3. 4.', '1. 2. | 3. 4.', '1. 2. | 3. 4.']);
  });

  test('first-page stories count after the default stories of their section', () => {
    const bytes = docx({
      body:
        pages(2) +
        sectPr({ default: 'd', first: 'f' }, { default: 'd', first: 'f' }, '<w:titlePg/>'),
      headers: { d: items('HD', 2), f: items('HF', 1) },
      footers: { d: items('FD', 2), f: items('FF', 2) },
    });
    expect(markersFor(bytes)).toEqual(['5. | 6. 7.', '1. 2. | 3. 4.']);
  });

  test('even-page stories count before the default stories of their section', () => {
    const bytes = docx({
      body: pages(2) + sectPr({ default: 'd', even: 'e' }, { default: 'd', even: 'e' }),
      headers: { d: items('HD', 1), e: items('HE', 3) },
      footers: { d: items('FD', 2), e: items('FE', 2) },
      evenAndOdd: true,
    });
    expect(markersFor(bytes)).toEqual(['4. | 7. 8.', '1. 2. 3. | 5. 6.']);
  });

  test('an even header counts although the pages never show it', () => {
    const bytes = docx({
      body: pages(1) + sectPr({ default: 'd', even: 'e' }, { default: 'd' }),
      headers: { d: items('HD', 1), e: items('HE', 3) },
      footers: { d: items('FD', 1) },
    });
    expect(markersFor(bytes)).toEqual(['4. | 5.']);
  });

  test('a later section continues the count, and an inherited story keeps its numbers', () => {
    const bytes = docx({
      body:
        pages(1, 'one') +
        sectionBreak({ default: 'd' }, { default: 'd' }) +
        pages(1, 'two') +
        sectPr({ default: 's' }, {}),
      headers: { d: items('HA', 2), s: items('HS', 3) },
      footers: { d: items('FA', 2) },
    });
    expect(markersFor(bytes)).toEqual(['1. 2. | 3. 4.', '5. 6. 7. | 3. 4.']);
  });

  test('a part that two sections reference counts at each reference', () => {
    const bytes = docx({
      body:
        pages(1, 'one') +
        sectionBreak({ default: 'h' }, { default: 'f1' }) +
        pages(1, 'two') +
        sectPr({ default: 'h' }, { default: 'f2' }),
      headers: { h: items('HA', 2) },
      footers: { f1: items('FA', 1), f2: items('FB', 1) },
    });
    expect(markersFor(bytes)).toEqual(['1. 2. | 3.', '4. 5. | 6.']);
  });

  test('the body list keeps its own count', () => {
    const bytes = docx({
      body: items('BA', 2) + sectPr({ default: 'd' }, { default: 'd' }),
      headers: { d: items('HA', 1) },
      footers: { d: items('FA', 1) },
    });
    expect(markersFor(bytes)).toEqual(['1. | 2.']);
  });
});
