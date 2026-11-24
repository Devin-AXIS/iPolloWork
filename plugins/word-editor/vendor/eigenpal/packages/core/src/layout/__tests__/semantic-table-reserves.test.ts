import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  PageRecord,
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string): string => `<w:tc>${content}</w:tc>`;
const tr = (cells: string, trPr = ''): string => `<w:tr>${trPr}${cells}</w:tr>`;

function loadPart(bodyXml: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function tableFragments(page: PageRecord): TableFragmentRecord[] {
  return page.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

function allRows(result: SemanticLayout): TableRowFragmentRecord[] {
  return result.pages.flatMap(tableFragments).flatMap((fragment) => fragment.rows);
}

function rowText(row: TableRowFragmentRecord): string {
  return row.cells
    .flatMap((cell) => cell.blocks)
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

function authoredHeaderLocation(result: SemanticLayout, text: string): string | undefined {
  for (const page of result.pages) {
    for (const fragment of tableFragments(page)) {
      if (fragment.rows.some((row) => !row.isHeaderRepeat && rowText(row) === text)) {
        return `${page.index}:${fragment.id}`;
      }
    }
  }
  return undefined;
}

function layoutWithReserves(
  part: OoxmlPart,
  pageBottomReserves: ReadonlyMap<number, number>,
  compatibilityMode?: number
): SemanticLayout {
  return layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(),
    geometry: TINY,
    pageBottomReserves,
    compatibilityMode,
  });
}

function expectNoOverflow(result: SemanticLayout): void {
  for (const page of result.pages) {
    for (const fragment of tableFragments(page)) {
      expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(
        page.contentBox.height + 0.001
      );
      for (const row of fragment.rows) {
        expect(row.box.y + row.box.height).toBeLessThanOrEqual(page.contentBox.height + 0.001);
      }
    }
  }
}

test('a note-reserved first page can defer an authored header and repeat it later', () => {
  const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
  const body = tr(tc(Array.from({ length: 16 }, (_, index) => p(`B${index}`)).join('')));

  const result = layoutWithReserves(
    loadPart(`<w:tbl>${header}${body}</w:tbl>`),
    new Map([[0, 70]])
  );

  expectNoOverflow(result);
  const rows = allRows(result);
  expect(rows.filter((row) => !row.isHeaderRepeat).map(rowText)[0]).toBe('HEAD');
  expect(rows.some((row) => row.isHeaderRepeat)).toBe(true);
});

test('initial reserve degradation does not disable useful later header repeats', () => {
  const headers =
    tr(tc(p('H1')), '<w:trPr><w:tblHeader/></w:trPr>') +
    tr(tc(p('H2')), '<w:trPr><w:tblHeader/></w:trPr>');
  const body = tr(tc(Array.from({ length: 18 }, (_, index) => p(`B${index}`)).join('')));

  const result = layoutWithReserves(
    loadPart(`<w:tbl>${headers}${body}</w:tbl>`),
    new Map([[0, 60]])
  );

  expectNoOverflow(result);
  expect(
    allRows(result)
      .filter((row) => !row.isHeaderRepeat)
      .map(rowText)
      .slice(0, 2)
  ).toEqual(['H1', 'H2']);
  expect(authoredHeaderLocation(result, 'H1')).toBe(authoredHeaderLocation(result, 'H2'));
  const authoredPage = Number(authoredHeaderLocation(result, 'H1')?.split(':')[0]);
  expect(
    result.pages
      .slice(0, authoredPage + 1)
      .flatMap(tableFragments)
      .flatMap((fragment) => fragment.rows)
      .some((row) => row.isHeaderRepeat)
  ).toBe(false);
  expect(
    result.pages
      .slice(2)
      .flatMap(tableFragments)
      .flatMap((fragment) => fragment.rows)
      .some((row) => row.isHeaderRepeat)
  ).toBe(true);
});

test('an authored header rechecks a smaller page reached by its atomic move', () => {
  const filler = Array.from({ length: 5 }, (_, index) => p(`F${index}`)).join('');
  const headers =
    tr(tc(p('H1')), '<w:trPr><w:tblHeader/></w:trPr>') +
    tr(tc(p('H2')), '<w:trPr><w:tblHeader/></w:trPr>');
  const body = tr(tc(Array.from({ length: 18 }, (_, index) => p(`B${index}`)).join('')));

  const result = layoutWithReserves(
    loadPart(`${filler}<w:tbl>${headers}${body}</w:tbl>`),
    new Map([[1, 60]]),
    // Mode 15 moves the whole group; earlier modes break it between its rows.
    15
  );

  expectNoOverflow(result);
  expect(
    allRows(result)
      .filter((row) => !row.isHeaderRepeat)
      .map(rowText)
      .slice(0, 2)
  ).toEqual(['H1', 'H2']);
  expect(authoredHeaderLocation(result, 'H1')).toBe(authoredHeaderLocation(result, 'H2'));
  const authoredPage = Number(authoredHeaderLocation(result, 'H1')?.split(':')[0]);
  expect(
    result.pages
      .slice(0, authoredPage + 1)
      .flatMap(tableFragments)
      .flatMap((fragment) => fragment.rows)
      .some((row) => row.isHeaderRepeat)
  ).toBe(false);
  expect(
    result.pages
      .slice(2)
      .flatMap(tableFragments)
      .flatMap((fragment) => fragment.rows)
      .some((row) => row.isHeaderRepeat)
  ).toBe(true);
});
