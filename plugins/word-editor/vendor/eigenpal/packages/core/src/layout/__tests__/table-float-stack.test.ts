// Adjacent floating tables with identical positions stack into one table: the later one starts
// at the bottom of the earlier one. Tables with different positions, or with a paragraph between
// them, keep their own placement.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const AT = (x = 0) =>
  `<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpX="${x}" w:tblpY="38"/>`;
/** A 150pt-wide floating table of `rows` exact 30pt rows labelled `label`1, `label`2, ... */
const table = (label: string, rows: number, tblpPr = AT()) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:w="3000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
  '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
  Array.from(
    { length: rows },
    (_, index) =>
      `<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr><w:tc>${p(`${label}${index + 1}`)}</w:tc></w:tr>`
  ).join('') +
  '</w:tbl>';
const lines = (count: number) => Array.from({ length: count }, (_, i) => p(`L${i}`)).join('');
const document = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const lay = (body: string) =>
  layoutSemanticDocument(document(body), 0, { measurer: createFixedMeasurer(6, 12) });

/** Each table row as `page:label@top`, in page order. */
function rows(layout: SemanticLayout): string[] {
  return layout.pages.flatMap((page, index) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows.map((row) => {
            const cell = row.cells[0]!.blocks[0]!;
            const text =
              cell.kind === 'paragraph' ? cell.lines[0]!.spans.map((s) => s.text).join('') : '';
            return `${index}:${text}@${row.box.y.toFixed(1)}`;
          })
        : []
    )
  );
}

test('three adjacent tables with the same position stack into one', () => {
  const stacked = rows(
    lay(lines(20) + table('R', 1) + table('S', 2) + table('U', 2) + p('Anchor'))
  );
  // 20 lines end at 240pt; the offset puts the first row about 1.9pt below; rows are 30pt.
  expect(stacked).toEqual(['0:R1@241.8', '0:S1@271.9', '0:S2@301.9', '0:U1@331.9', '0:U2@361.9']);
});

test('a stacked table that breaks across pages takes the table above it into the flow', () => {
  // The second table does not fit the page, so it breaks; the first goes into the flow right
  // above it rather than waiting for the anchor and covering it.
  const broken = rows(lay(lines(45) + table('R', 1) + table('S', 7) + p('Anchor')));
  expect(broken.slice(0, 3)).toEqual(['0:R1@541.9', '0:S1@571.9', '0:S2@601.9']);
  expect(broken.at(-1)!.startsWith('1:S7@')).toBe(true);
});

test('tables with different positions keep their own places', () => {
  const beside = rows(lay(lines(20) + table('R', 1) + table('S', 2, AT(3000)) + p('Anchor')));
  expect(beside).toEqual(['0:R1@241.8', '0:S1@241.8', '0:S2@271.9']);
});

test('a paragraph between two tables keeps them apart', () => {
  const apart = rows(lay(lines(20) + table('R', 1) + p('Between') + table('S', 1) + p('Anchor')));
  expect(apart).toEqual(['0:R1@241.8', '0:S1@253.8']);
});

test('margin-positioned and aligned tables stack too', () => {
  const margin = '<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpY="2000"/>';
  const top = '<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpYSpec="top"/>';
  for (const [pr, first] of [
    [margin, 100],
    [top, 0],
  ] as const) {
    const stacked = rows(lay(lines(20) + table('R', 1, pr) + table('S', 2, pr) + p('Anchor')));
    const tops = stacked.map((row) => Number(row.split('@')[1]));
    expect(tops[0]).toBeCloseTo(first, 0);
    expect(tops[1]! - tops[0]!).toBeCloseTo(30, 0);
    expect(tops[2]! - tops[1]!).toBeCloseTo(30, 0);
  }
});

test('a stack of raised tables moves the earlier lines it covers below the whole stack', () => {
  const raised = '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="-1200"/>';
  const wide = (label: string, count: number) =>
    table(label, count, raised).replace(/w:w="3000"/g, 'w:w="9360"');
  const layout = lay(lines(20) + wide('R', 1) + wide('S', 2) + p('Anchor'));
  const stacked = rows(layout);
  const tops = stacked.map((row) => Number(row.split('@')[1]));
  // The stack keeps the place its anchor had: 60pt above the 240pt anchor top.
  expect(tops[0]).toBeCloseTo(180, 0);
  expect(tops[1]! - tops[0]!).toBeCloseTo(30, 0);
  // The lines it covers start below the last row, and none stays under the stack.
  const moved = layout.pages[0]!.fragments.filter(
    (fragment) => fragment.kind === 'paragraph' && fragment.box.y >= tops[0]! - 12
  ).map((fragment) => fragment.box.y);
  expect(Math.min(...moved)).toBeCloseTo(tops[2]! + 30, 0);
});

test('in a stack of three, a breaking last table takes both waiting tables into the flow', () => {
  const chain = rows(lay(lines(45) + table('R', 1) + table('S', 1) + table('U', 7) + p('Anchor')));
  expect(chain.slice(0, 3)).toEqual(['0:R1@541.9', '0:S1@571.9', '0:U1@601.9']);
});

test('a warm pass lays out stacked tables like a cold one', () => {
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(6, 12), session };
  layoutSemanticDocument(document(lines(45) + table('R', 1) + table('S', 7) + p('A')), 0, options);
  const edited = document(p('Z') + lines(45) + table('R', 1) + table('S', 7) + p('A'));
  const warm = rows(layoutSemanticDocument(edited, 1, options));
  const cold = rows(layoutSemanticDocument(edited, 1, { measurer: createFixedMeasurer(6, 12) }));
  expect(warm).toEqual(cold);
});

test('foreign position properties cannot change table stacking', () => {
  const foreign = '<x:tblpPr xmlns:x="urn:extension" w:tblpX="6000"/>';
  const plain = lines(20) + table('R', 1) + table('S', 1) + p('Anchor');
  const extended = lines(20) + table('R', 1, foreign + AT()) + table('S', 1) + p('Anchor');
  expect(rows(lay(extended))).toEqual(rows(lay(plain)));
});

test('foreign table property containers and position attributes preserve stacking', () => {
  const foreign = '<x:tblPr xmlns:x="urn:extension"><w:tblpPr w:tblpY="2000"/></x:tblPr>';
  const first = table('R', 1).replace('<w:tblPr>', foreign + '<w:tblPr>');
  const second = table(
    'S',
    1,
    AT().replace('<w:tblpPr ', '<w:tblpPr xmlns:x="urn:extension" x:offset="different" ')
  );
  expect(rows(lay(lines(20) + first + second + p('Anchor')))).toEqual(
    rows(lay(lines(20) + table('R', 1) + table('S', 1) + p('Anchor')))
  );
});
