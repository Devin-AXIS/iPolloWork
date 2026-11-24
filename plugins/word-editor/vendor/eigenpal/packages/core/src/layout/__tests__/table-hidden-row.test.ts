// A row that hides its end mark (`w:trPr/w:hidden`) and shows nothing in any cell takes no space:
// no line box, no `w:trHeight` minimum, no border band. A row that keeps a visible paragraph mark
// or visible text keeps its full height, and so does a row that does not state `w:hidden`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const HIDDEN_MARK = '<w:rPr><w:vanish/></w:rPr>';

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function row(trPr: string, cellContent: string): string {
  return (
    `<w:tr><w:trPr>${trPr}</w:trPr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>` +
    `${cellContent}</w:tc></w:tr>`
  );
}

const VISIBLE_ROW = row('', '<w:p><w:r><w:t>Visible</w:t></w:r></w:p>');

/** The top of the paragraph after a table whose first row is `firstRow`. */
function afterTop(firstRow: string): number {
  const part = parseDoc(
    '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>' +
      '<w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      firstRow +
      VISIBLE_ROW +
      '</w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>'
  );
  const page = layoutSemanticDocument(part, 1, { measurer }).pages[0]!;
  const paragraphs = page.fragments.filter((fragment) => fragment.kind === 'paragraph');
  return (paragraphs.at(-1) as unknown as { box: { y: number } }).box.y;
}

describe('hidden table rows', () => {
  const withoutRow = afterTop('');
  const emptyHiddenMark = `<w:p><w:pPr>${HIDDEN_MARK}</w:pPr></w:p>`;

  test('a hidden row that shows nothing takes no space, even with a height rule', () => {
    expect(afterTop(row('<w:hidden/>', emptyHiddenMark))).toBe(withoutRow);
    expect(afterTop(row('<w:trHeight w:val="2805"/><w:hidden/>', emptyHiddenMark))).toBe(
      withoutRow
    );
    const hiddenText = `<w:p><w:pPr>${HIDDEN_MARK}</w:pPr><w:r>${HIDDEN_MARK}<w:t>x</w:t></w:r></w:p>`;
    expect(afterTop(row('<w:hidden/>', hiddenText))).toBe(withoutRow);
  });

  test('a row keeps its height when its mark, its text, or the row itself is shown', () => {
    expect(afterTop(row('<w:hidden/>', '<w:p/>'))).toBeGreaterThan(withoutRow);
    expect(afterTop(row('<w:hidden/>', '<w:p><w:r><w:t>x</w:t></w:r></w:p>'))).toBeGreaterThan(
      withoutRow
    );
    expect(afterTop(row('<w:trHeight w:val="2805"/>', emptyHiddenMark))).toBeGreaterThan(
      withoutRow + 100
    );
    expect(afterTop(row('<w:hidden w:val="0"/>', emptyHiddenMark))).toBeGreaterThan(withoutRow);
  });

  test('a table whose only row collapses leaves no space', () => {
    const tops = (table: string): number[] =>
      layoutSemanticDocument(
        parseDoc(
          '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
            table +
            '<w:p><w:r><w:t>After</w:t></w:r></w:p>'
        ),
        1,
        { measurer }
      )
        .pages[0]!.fragments.filter((fragment) => fragment.kind === 'paragraph')
        .map((fragment) => (fragment as unknown as { box: { y: number } }).box.y);
    const collapsed =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      row('<w:trHeight w:val="2805"/><w:hidden/>', emptyHiddenMark) +
      '</w:tbl>';
    expect(tops(collapsed)).toEqual(tops(''));
  });
});
