// With `allowTextAfterFloatingTableBreak` ([MS-DOCX] 2.3.1) in a modern compatibility mode, the
// text after a text-anchored floating table (ECMA-376 Part 1, 17.4.57) that breaks across pages
// starts beside its first fragment, and each later fragment wraps the text on its page. Without
// the setting, or in an earlier mode, the text starts on the page of the last fragment.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" ' +
  `w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** A 150 pt wide table of 120 pt rows at the left margin; two rows do not fit the 228 pt page. */
const table = (rows = 2) =>
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
  'w:horzAnchor="margin" w:tblpY="1"/><w:tblOverlap w:val="never"/><w:tblW w:w="3000" ' +
  'w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/>' +
  '</w:tblGrid>' +
  Array.from(
    { length: rows },
    (_, index) =>
      `<w:tr><w:trPr><w:trHeight w:val="2400"/></w:trPr><w:tc>${p(`Row ${index + 1}`)}</w:tc></w:tr>`
  ).join('') +
  '</w:tbl>';
const section =
  '<w:sectPr><w:pgSz w:w="12240" w:h="6000"/><w:pgMar w:top="720" w:right="1440" ' +
  'w:bottom="720" w:left="1440" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
const lines = (count: number) => Array.from({ length: count }, (_, index) => p(`Line ${index}`));

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${section}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function cascade(allow: boolean, mode: number) {
  const setting =
    `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/>` +
    (allow
      ? '<w:compatSetting w:name="allowTextAfterFloatingTableBreak" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>'
      : '');
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${setting}</w:compat></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'app/xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return buildStyleCascadeTable(null, undefined, read.part.root);
}

function render(source: OoxmlPart, allow: boolean, compatibilityMode = 15) {
  return layoutSemanticDocument(source, 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode,
    styleCascade: cascade(allow, compatibilityMode),
  });
}

/** Per page: each table fragment's first cell text, and each body line as `text@x,y`. */
function pagesOf(layout: SemanticLayout): string[][] {
  return layout.pages.map((page) =>
    page.fragments.flatMap((fragment) => {
      if (fragment.kind === 'table') {
        const cell = fragment.rows[0]!.cells[0]!.blocks[0]!;
        const text = cell.kind === 'paragraph' ? cell.lines[0]!.spans : [];
        return [`table ${text.map((span) => span.text).join('')}`];
      }
      if (fragment.kind !== 'paragraph') return [];
      return fragment.lines.map(
        (line) =>
          `${line.spans.map((span) => span.text).join('')}@${line.spans[0]!.box.x},${line.box.y}`
      );
    })
  );
}

/** `count` lines from `first`, 12 pt apart from `top`, at `x` while above `besideUntil`. */
const expected = (first: number, count: number, top: number, besideUntil: number) =>
  Array.from({ length: count }, (_, index) => {
    const y = top + index * 12;
    return `Line ${first + index}@${y < besideUntil ? 159 : 0},${y}`;
  });

test('the text starts beside the first fragment and wraps beside the next one', () => {
  expect(pagesOf(render(part(table() + lines(30).join('')), true))).toEqual([
    ['table Row 1', ...expected(0, 19, 0, 120)],
    ['table Row 2', ...expected(19, 11, 0, 120)],
  ]);
});

test('without the setting, or before mode 15, the text starts on the last page', () => {
  const plain = [
    ['table Row 1'],
    ['table Row 2', ...expected(0, 19, 0, 120)],
    expected(19, 11, 0, 0),
  ];
  expect(pagesOf(render(part(table() + lines(30).join('')), false))).toEqual(plain);
  // Legacy modes also place the table a little further left, so compare the pages only.
  for (const mode of [12, 14]) {
    const pages = pagesOf(render(part(table() + lines(30).join('')), true, mode));
    expect(pages.map((page) => page.map((entry) => entry.split('@')[0]))).toEqual(
      plain.map((page) => page.map((entry) => entry.split('@')[0]))
    );
  }
});

test('after an earlier paragraph, the text starts beside the table at its anchor', () => {
  const layout = render(part(p('Lead') + table() + lines(3).join('')), true);
  expect(pagesOf(layout)).toEqual([
    ['Lead@0,0', 'table Row 1', 'Line 0@159,12', 'Line 1@159,24', 'Line 2@159,36'],
    ['table Row 2'],
  ]);
});

test('every later fragment opens its page, also after the text ends', () => {
  const layout = render(part(table(3) + lines(2).join('')), true);
  expect(pagesOf(layout)).toEqual([
    ['table Row 1', 'Line 0@159,0', 'Line 1@159,12'],
    ['table Row 2'],
    ['table Row 3'],
  ]);
});

test('a resumed layout holds the later fragments as a cold layout does', () => {
  const source = (tail: string) => part(table(3) + lines(40).join('') + p(tail));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const options = {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode: 15,
    styleCascade: cascade(true, 15),
  };
  for (const [revision, tail] of ['Tail', 'Edited tail', 'Tail'].entries()) {
    const warm = layoutSemanticDocument(source(tail), revision, { ...options, session, cache });
    expect(pagesOf(warm)).toEqual(pagesOf(render(source(tail), true)));
    expect(warm.pages).toHaveLength(3);
  }
});
