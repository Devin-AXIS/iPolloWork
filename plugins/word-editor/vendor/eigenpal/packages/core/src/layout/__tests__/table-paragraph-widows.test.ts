import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact" w:before="0" w:after="0"/>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
function layout({
  count = 4,
  prefix = 2,
  cellPrefix = false,
  height = 50,
  widowOff = false,
  exact = false,
  header = false,
  mode = 15 as number | null,
  widowOn = false,
} = {}) {
  const content = Array.from({ length: count }, (_, i) => `line ${i}`).join('</w:t><w:br/><w:t>');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${Array.from({ length: prefix }, () => p('body')).join('')}<w:tbl><w:tblPr><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${header ? `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p('header')}</w:tc></w:tr>` : ''}<w:tr>${exact ? '<w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr>' : ''}<w:tc>${cellPrefix ? p('prefix') : ''}${p(content, widowOff ? '<w:widowControl w:val="0"/>' : widowOn ? '<w:widowControl/>' : '')}</w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const options = {
    compatibilityMode: mode ?? undefined,
    geometry: { width: 120, height, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    measurer: {
      measure: (text: string) => text.length * 4,
      lineMetrics: () => ({ height: 10, baseline: 8 }),
    },
    session: createLayoutSession(),
  };
  const result = layoutSemanticDocument(parsed.part, 0, options);
  expect(layoutSemanticDocument(parsed.part, 0, options).pages).toEqual(result.pages);
  expect(
    layoutSemanticDocument(parsed.part, 0, { ...options, session: createLayoutSession() }).pages
  ).toEqual(result.pages);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  // Pages up to the table's last: the empty paragraph the body reads after it may take one more.
  const last = result.pages.findLastIndex((page) =>
    page.fragments.some((fragment) => fragment.kind === 'table')
  );
  const tablePages = result.pages.slice(0, last + 1);
  const text = tablePages.map((page) =>
    page.fragments
      .flatMap((fragment) =>
        fragment.kind === 'table'
          ? fragment.rows.flatMap((row) =>
              row.cells.flatMap((cell) =>
                cell.blocks.flatMap((block) =>
                  block.kind === 'paragraph'
                    ? block.lines.map((line) =>
                        line.spans
                          .map((span) => span.text)
                          .join('')
                          .trimEnd()
                      )
                    : []
                )
              )
            )
          : []
      )
      .filter((value) => value.startsWith('line'))
  );
  if (!exact) expect(text.flat()).toEqual(Array.from({ length: count }, (_, i) => `line ${i}`));
  return text.map((lines) => lines.length);
}

test('cell paragraphs keep the final two lines together by default', () =>
  expect(layout()).toEqual([2, 2]));
test('an explicit disabled widow control permits a one-line tail', () =>
  expect(layout({ widowOff: true })).toEqual([3, 1]));
test('a first-line orphan moves the row to the next page', () =>
  expect(layout({ prefix: 4 })).toEqual([0, 4]));
test('widows retreat after earlier content in the same cell', () =>
  expect(layout({ prefix: 1, cellPrefix: true })).toEqual([2, 2]));
test('three-line paragraphs move whole when two cannot remain on either side', () =>
  expect(layout({ count: 3, prefix: 3 })).toEqual([0, 3]));
test('a paragraph taller than a fresh page makes progress', () =>
  expect(layout({ count: 3, prefix: 0, height: 20 })).toEqual([2, 1]));
test('one-line pages fail open without losing continuation text', () =>
  expect(layout({ count: 3, prefix: 0, height: 10 })).toEqual([1, 1, 1]));
test('exact rows clip authored content without applying page widow rules', () =>
  expect(layout({ prefix: 0, exact: true })).toEqual([3]));
test('continued paragraphs keep two tail lines below repeated headers', () =>
  expect(layout({ count: 7, prefix: 0, height: 40, header: true })).toEqual([3, 2, 2]));

test('a repeated header yields when a three-line paragraph needs the full page', () => {
  expect(layout({ count: 3, prefix: 0, height: 30, header: true })).toEqual([0, 3]);
});

for (const mode of [null, 12, 14]) {
  test(`legacy table flow ignores widow control (${mode ?? 'unspecified'})`, () => {
    expect(layout({ mode })).toEqual([3, 1]);
    expect(layout({ mode, widowOn: true })).toEqual([3, 1]);
  });
}
