// In suggesting mode, turning a list on or off is a paragraph property change: the paragraph
// records its earlier properties in `w:pPrChange`, the change survives save and reopen, and a
// reviewer can accept or reject it. That holds for the List Paragraph style the gesture
// applies with the numbering, and inside a data-bound block content control.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const NUMBERING =
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="160"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr>' +
  '</w:style>';

function docx(body: string, styles = STYLES): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/>` +
        `<Relationship Id="rId8" Type="${STYREL}" Target="styles.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const numbered = (text: string) =>
  '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/>' +
  `<w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const bound = (text: string) =>
  '<w:sdt><w:sdtPr><w:tag w:val="bound"/><w:dataBinding w:storeItemID="{1}" ' +
  'w:xpath="/root/value"/><w:text/></w:sdtPr><w:sdtContent>' +
  `${plain(text)}</w:sdtContent></w:sdt>`;

function open(bytes: Uint8Array): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.surface;
}

function withSuggesting(
  body: string,
  run: (surface: PaginatedSurface) => void,
  styles = STYLES
): void {
  const surface = open(docx(body, styles));
  try {
    surface.setAuthor('Reviewer');
    surface.setEditingMode('suggest');
    run(surface);
  } finally {
    surface.destroy();
  }
}

function select(surface: PaginatedSurface, first: number, last = first): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[first]!, offset: 0 },
    head: { paragraphId: ids[last]!, offset: last === first ? 0 : 1 },
  });
}

const markers = (surface: PaginatedSurface) =>
  surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? [fragment.marker?.text ?? null] : []));

const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
const paragraphProperties = (surface: PaginatedSurface) =>
  [...documentXml(surface.save()).matchAll(/<w:p\b[^>]*>(?:<w:pPr>(.*?)<\/w:pPr>)?/g)].map(
    (match) => match[1] ?? ''
  );
const pendingChanges = (surface: PaginatedSurface) =>
  documentXml(surface.save()).split('<w:pPrChange').length - 1;

const decide = (surface: PaginatedSurface, op: 'acceptAllRevisions' | 'rejectAllRevisions') =>
  expect(surface.applyAutomationOps(() => [{ op }]).rejected).toBe(false);

describe('a suggested list change is a revision', () => {
  test('turning a list on records the earlier properties, and reject restores them', () => {
    withSuggesting(plain('alpha') + plain('bravo'), (surface) => {
      const before = paragraphProperties(surface);
      select(surface, 0);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)).toEqual(['1.', null]);
      const [first] = paragraphProperties(surface);
      expect(first).toMatch(/^<w:pStyle w:val="ListParagraph"\/><w:numPr>/);
      expect(first).toMatch(/<w:pPrChange w:author="Reviewer"[^>]*><w:pPr\/><\/w:pPrChange>$/);

      decide(surface, 'rejectAllRevisions');
      expect(markers(surface)).toEqual([null, null]);
      expect(paragraphProperties(surface)).toEqual(before);
    });
  });

  test('without a List Paragraph style, the numbering alone is the revision', () => {
    const normalOnly = STYLES.slice(0, STYLES.indexOf('<w:style w:type="paragraph" w:styleId'));
    for (const body of [plain('alpha'), bound('alpha')]) {
      withSuggesting(
        body,
        (surface) => {
          select(surface, 0);
          expect(surface.toggleList('ordered')).toBe(true);
          expect(markers(surface)).toEqual(['1.']);
          expect(paragraphProperties(surface)[0]).toMatch(
            /^<w:numPr>.*<\/w:numPr><w:pPrChange w:author="Reviewer"[^>]*><w:pPr\/><\/w:pPrChange>$/
          );
          decide(surface, 'rejectAllRevisions');
          expect(markers(surface)).toEqual([null]);
          expect(paragraphProperties(surface)).toEqual(['']);
        },
        normalOnly
      );
    }
  });

  test('accept keeps the list and its style and clears the revision', () => {
    withSuggesting(plain('alpha'), (surface) => {
      select(surface, 0);
      expect(surface.toggleList('bullet')).toBe(true);
      decide(surface, 'acceptAllRevisions');
      expect(markers(surface)).toEqual(['•']);
      expect(pendingChanges(surface)).toBe(0);
      expect(paragraphProperties(surface)[0]).toMatch(
        /^<w:pStyle w:val="ListParagraph"\/><w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>$/
      );
    });
  });

  test('turning a list off records the numbering, and reject brings the number back', () => {
    withSuggesting(numbered('alpha') + numbered('bravo'), (surface) => {
      const before = paragraphProperties(surface);
      select(surface, 0, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)).toEqual([null, null]);
      expect(pendingChanges(surface)).toBe(2);
      for (const properties of paragraphProperties(surface))
        expect(properties).toMatch(/<w:pPrChange[^>]*><w:pPr>.*<w:numId w:val="1"\/>/);

      decide(surface, 'rejectAllRevisions');
      expect(markers(surface)).toEqual(['1.', '2.']);
      expect(paragraphProperties(surface)).toEqual(before);
    });
  });

  test('the suggested list survives save and reopen and can still be rejected', () => {
    withSuggesting(plain('alpha'), (surface) => {
      select(surface, 0);
      expect(surface.toggleList('bullet')).toBe(true);
      const reopened = open(surface.save());
      try {
        expect(markers(reopened)).toEqual(['•']);
        expect(pendingChanges(reopened)).toBe(1);
        decide(reopened, 'rejectAllRevisions');
        expect(markers(reopened)).toEqual([null]);
        expect(paragraphProperties(reopened)).toEqual(['']);
      } finally {
        reopened.destroy();
      }
    });
  });

  test('undo removes the suggested list and its revision together', () => {
    withSuggesting(plain('alpha'), (surface) => {
      select(surface, 0);
      expect(surface.toggleList('bullet')).toBe(true);
      surface.undo();
      expect(markers(surface)).toEqual([null]);
      expect(paragraphProperties(surface)).toEqual(['']);
    });
  });

  test('a list in a data-bound block control is a revision that keeps the bound text', () => {
    withSuggesting(bound('bound value') + plain('after'), (surface) => {
      select(surface, 0);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)).toEqual(['1.', null]);
      expect(pendingChanges(surface)).toBe(1);

      decide(surface, 'rejectAllRevisions');
      expect(markers(surface)).toEqual([null, null]);
      expect(pendingChanges(surface)).toBe(0);

      expect(surface.toggleList('ordered')).toBe(true);
      decide(surface, 'acceptAllRevisions');
      expect(markers(surface)).toEqual(['1.', null]);
      expect(pendingChanges(surface)).toBe(0);
      const xml = documentXml(surface.save());
      expect(xml).toContain('<w:t>bound value</w:t>');
      expect(xml).toContain('w:dataBinding');
    });
  });
});
