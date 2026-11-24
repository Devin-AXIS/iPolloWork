// Every `w:num` over one `w:abstractNum` counts on one shared counter. A `w:startOverride`
// restarts it once, and the other `w:num` continues from the restarted count. A list the
// editor starts on a reused template must therefore carry its own restart, or it continues
// the earlier list.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const LEVEL =
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';

function docx(body: string, nums: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${LEVEL}</w:abstractNum>` +
        `${nums}</w:numbering>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const item = (text: string, numId?: string): string =>
  `<w:p>${numId ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` : ''}` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const markers = (surface: PaginatedSurface): (string | undefined)[] =>
  surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? [fragment.marker?.text] : []));

describe('lists that share one abstract definition', () => {
  test('a later item of the first list continues from a restart on another list', () => {
    const nums =
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="0"/>' +
      '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
    const body = item('one', '1') + item('two', '1') + item('restart', '2') + item('after', '1');
    withSurface(docx(body, nums), (surface) => {
      expect(markers(surface)).toEqual(['1.', '2.', '1.', '2.']);
    });
  });

  test('a numbered list started on a reused template begins at one, also after reopen', () => {
    const nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const body = item('one', '1') + item('two', '1') + item('gap') + item('fresh');
    let saved: Uint8Array | null = null;
    withSurface(docx(body, nums), (surface) => {
      const fresh = surface.session.paragraphIds()[3]!;
      surface.setSelection({
        anchor: { paragraphId: fresh, offset: 0 },
        head: { paragraphId: fresh, offset: 0 },
      });
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)).toEqual(['1.', '2.', undefined, '1.']);
      saved = surface.save();
    });
    withSurface(saved!, (reopened) => {
      expect(markers(reopened)).toEqual(['1.', '2.', undefined, '1.']);
    });
  });
});
