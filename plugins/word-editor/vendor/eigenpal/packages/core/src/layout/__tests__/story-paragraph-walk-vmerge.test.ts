// A vertical merge continuation cell shows nothing, so the story walk (and the list numbers
// it feeds) skips its paragraphs. A continuation with no merged cell above it starts its own
// merge and keeps its content.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { storyRowParagraphs, walkStoryParagraphs } from '../story-paragraph-walk.ts';
import { load } from './table-row-keep-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, vMerge?: string): string =>
  `<w:tc>${vMerge === undefined ? '' : `<w:tcPr><w:vMerge${vMerge}/></w:tcPr>`}${p(text)}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;

function walkedText(xml: string): string[] {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const blocks = body.children.filter((node): node is OoxmlElement => node.kind !== 'textValue');
  const text = (node: OoxmlElement): string =>
    node.children
      .map((child) =>
        child.kind === 'textValue' ? child.value : text(child as unknown as OoxmlElement)
      )
      .join('');
  return walkStoryParagraphs(blocks, 8, true).map(text);
}

test('the walk skips paragraphs in a continuation cell below a merged cell', () => {
  const xml = table(
    row(cell('head', ' w:val="restart"'), cell('a')),
    row(cell('hidden', ''), cell('b')),
    row(cell('hidden too', ' w:val="continue"'), cell('c')),
    row(cell('shown'), cell('d'))
  );
  expect(walkedText(xml)).toEqual(['head', 'a', 'b', 'c', 'shown', 'd', '']);
});

test('a continuation with nothing merged above keeps its paragraphs', () => {
  const xml = table(row(cell('first', ''), cell('a')), row(cell('under', ''), cell('b')));
  // Row 0 has nothing above; row 1 continues row 0's merge.
  expect(walkedText(xml)).toEqual(['first', 'a', 'b', '']);
});

test('a spanned cell moves the grid column of the cells after it', () => {
  const xml =
    '<w:tbl><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>' +
    row(
      '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc>',
      cell('top', ' w:val="restart"')
    ) +
    row(cell('x'), cell('y'), cell('below', '')) +
    '</w:tbl>';
  expect(walkedText(xml)).toEqual(['', 'top', 'x', 'y', '']);
});

test('plain and merged walks keep independent answers for unchanged rows', () => {
  const part = load(
    table(row(cell('head', ' w:val="restart"'), cell('a')), row(cell('hidden', ''), cell('b')))
  );
  const body = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const source = body.children[0] as OoxmlElement;
  const rows = source.children.filter((node) => node.kind === 'tableRow');
  rows.forEach((node) => storyRowParagraphs(node, 8));
  const before = rows.map((node) => storyRowParagraphs(node, 8));
  for (let index = 0; index < 3; index++) {
    expect(walkStoryParagraphs([source], 8, true)).toHaveLength(3);
    expect(walkStoryParagraphs([source], 8, false)).toHaveLength(4);
    rows.forEach((node, at) => expect(storyRowParagraphs(node, 8)).toBe(before[at]!));
  }
  expect(walkStoryParagraphs([source], 0, true)).toEqual([]);
});
