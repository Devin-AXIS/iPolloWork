// Where the leading `w:tblHeader` rows (ECMA-376 Part 1 §17.4.49) open below content that
// already holds the page: mode 15 moves a group taller than a page to the next page, and earlier
// modes break a group that does not fit between its rows, each kept whole (§17.4.6).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A 200pt content band.
const PAGE: PageGeometry = {
  width: 300,
  height: 220,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const filler = (count: number): string =>
  Array.from({ length: count }, (_, index) => p(`F${index}`)).join('');

/** One row of `twips` exact height; a header row when `header`. */
function row(text: string, header: boolean, twips: number): string {
  const trPr = `<w:trHeight w:val="${twips}" w:hRule="exact"/>${header ? '<w:tblHeader/>' : ''}`;
  return `<w:tr><w:trPr>${trPr}</w:trPr><w:tc>${p(text)}</w:tc></w:tr>`;
}

function table(headers: number, headerTwips: number, bodies: number, bodyTwips: number): string {
  const head = Array.from({ length: headers }, (_, index) => row(`H${index}`, true, headerTwips));
  const body = Array.from({ length: bodies }, (_, index) => row(`B${index}`, false, bodyTwips));
  return `<w:tbl>${head.join('')}${body.join('')}</w:tbl>`;
}

function load(bodyXml: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function lay(bodyXml: string, compatibilityMode: number | undefined): SemanticLayout {
  return layoutSemanticDocument(load(bodyXml), 0, {
    measurer: createFixedMeasurer(),
    geometry: PAGE,
    compatibilityMode,
  });
}

function rowText(row: TableRowFragmentRecord): string {
  return row.cells
    .flatMap((cell) => cell.blocks)
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

/** Per page, the table rows in order; a repeated header row is marked with `*`. */
function rowsByPage(result: SemanticLayout): string[][] {
  return result.pages.map((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((fragment) => fragment.rows)
      .map((placed) => `${rowText(placed)}${placed.isHeaderRepeat ? '*' : ''}`)
  );
}

describe('a header group taller than a page below content', () => {
  // Four 50.05pt header rows: 200.2pt, taller than the 200pt band.
  const tall = (bodies: number) => filler(1) + table(4, 1001, bodies, 1000);

  test('starts the table on the next page from mode 15', () => {
    const pages = rowsByPage(lay(tall(0), 15));
    expect(pages[0]).toEqual([]);
    expect(pages[1]).toEqual(['H0', 'H1', 'H2']);
    expect(pages[2]).toEqual(['H3']);
  });

  test('starts the table on the next page with body rows after the group', () => {
    const pages = rowsByPage(lay(tall(2), 15));
    expect(pages[0]).toEqual([]);
    expect(pages[1]).toEqual(['H0', 'H1', 'H2']);
    // The group lays out as ordinary rows there, so nothing repeats.
    expect(pages[2]).toEqual(['H3', 'B0', 'B1']);
  });

  test('stays below the content before mode 15', () => {
    for (const mode of [undefined, 14]) {
      const pages = rowsByPage(lay(tall(0), mode));
      expect(pages[0]).toEqual(['H0', 'H1', 'H2']);
      expect(pages[1]).toEqual(['H3']);
    }
  });
});

describe('a header group that fits a page but not the room below content', () => {
  // Nine filler lines leave about 85pt: room for two 30pt header rows, not all three.
  const body = filler(9) + table(3, 600, 10, 500);

  test('breaks between whole header rows before mode 15, and repeats after the group', () => {
    for (const mode of [undefined, 12, 14]) {
      const pages = rowsByPage(lay(body, mode));
      expect(pages[0]).toEqual(['H0', 'H1']);
      expect(pages[1]).toEqual(['H2', 'B0', 'B1', 'B2', 'B3', 'B4', 'B5']);
      expect(pages[2]).toEqual(['H0*', 'H1*', 'H2*', 'B6', 'B7', 'B8', 'B9']);
    }
  });

  test('keeps a header row whole before mode 15 instead of splitting it', () => {
    const lines = [0, 1, 2, 3, 4, 5].map((index) => p(`L${index}`)).join('');
    const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${lines}</w:tc></w:tr>`;
    const rows = `${header}${row('B0', false, 500)}`;
    // Fourteen filler lines leave room for two of the header row's six lines.
    const pages = rowsByPage(lay(`${filler(14)}<w:tbl>${rows}</w:tbl>`, 14));
    expect(pages[0]).toEqual([]);
    expect(pages[1]).toEqual(['L0L1L2L3L4L5', 'B0']);
  });

  test('moves the whole group with the body opening from mode 15', () => {
    const pages = rowsByPage(lay(body, 15));
    expect(pages[0]).toEqual([]);
    expect(pages[1]!.slice(0, 3)).toEqual(['H0', 'H1', 'H2']);
  });
});
