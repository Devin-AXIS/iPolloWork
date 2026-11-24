// A text-anchored floating table raised above its anchor (negative `w:tblpY`, ECMA-376 Part 1,
// 17.4.57) that leaves no passage in its column moves the earlier lines it covers below it, in
// a multi-column section (17.6.4) as in one column. A band that crosses into another column
// moves the lines it covers there too, without moving its own anchor. In balanced columns the
// table follows its anchor since mode 15; before mode 15 it keeps its place from the unbalanced
// layout, and the balanced text wraps around it there.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const COLUMNS =
  '<w:cols w:num="2" w:space="720" w:equalWidth="0"><w:col w:w="5040" w:space="720"/>' +
  '<w:col w:w="5040"/></w:cols>';
const PAGE =
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" ' +
  'w:left="720" w:header="720" w:footer="720" w:gutter="0"/>';
/** A one-row table raised 87 twips above its anchor, page wide or one column wide. */
const table = (width = 10800, anchor = 'margin') =>
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
  `w:horzAnchor="${anchor}" w:tblpY="-87"/><w:tblOverlap w:val="never"/><w:tblW w:w="${width}" ` +
  `w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/>` +
  `</w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${p('T')}` +
  '</w:tc></w:tr></w:tbl>';
const BREAK = '<w:p><w:r><w:br w:type="column"/></w:r></w:p>';
/** Two columns that fill to the page bottom. */
const filled = (body: string) => `${body}<w:sectPr>${PAGE}${COLUMNS}</w:sectPr>`;
/** Two columns that balance before the continuous section after them. */
const balanced = (body: string) =>
  `${body}<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>${PAGE}${COLUMNS}</w:sectPr></w:pPr>` +
  `</w:p>${p('')}<w:sectPr><w:type w:val="continuous"/>${PAGE}</w:sectPr>`;

const part = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const lay = (body: string, compatibilityMode?: number) =>
  layoutSemanticDocument(part(body), 0, {
    measurer: createFixedMeasurer(6, 12),
    ...(compatibilityMode ? { compatibilityMode } : {}),
  });

/** Each line and table on the first page as `text@x,y`, in points rounded to 0.1. */
function placed(layout: SemanticLayout): string[] {
  return layout.pages[0]!.fragments.flatMap((fragment) => {
    const at = (box: { x: number; y: number }) => `@${box.x.toFixed(0)},${box.y.toFixed(1)}`;
    if (fragment.kind === 'table') return [`T${at(fragment.box)}`];
    if (fragment.kind !== 'paragraph') return [];
    return fragment.lines.flatMap((line) => {
      const text = line.spans.map((span) => span.text).join('');
      return text ? [`${text}${at(line.box)}`] : [];
    });
  });
}

const EARLIER = p('C1') + p('C2') + p('C3') + p('C4') + BREAK + p('B1') + p('B2');

test('a page-wide raised table in the second column moves the lines it covers in both', () => {
  const layout = placed(lay(filled(EARLIER + table() + p('B3'))));
  // The table rises 4.35 pt above where B3 stood (32.7); C3, C4 and B2 move below it.
  expect(layout).toEqual(expect.arrayContaining(['T@-1,28.3', 'B2@288,39.2', 'B3@288,50.1']));
  expect(layout).toEqual(expect.arrayContaining(['C2@0,10.9', 'C3@0,39.2', 'C4@0,50.1']));
});

test('a raised table as wide as the second column leaves the first column alone', () => {
  const layout = placed(lay(filled(EARLIER + table(5040, 'text') + p('B3'))));
  expect(layout).toEqual(expect.arrayContaining(['T@288,28.3', 'B2@288,39.2', 'B3@288,50.1']));
  expect(layout).toEqual(expect.arrayContaining(['C3@0,21.8', 'C4@0,32.7']));
});

const SHORT = balanced(p('A1') + p('A2') + table() + p('A3') + p('A4'));

test('since mode 15 a raised table follows its anchor into the balanced column', () => {
  // A3 opens the second column, so the table rises above the page top of the region, and the
  // first lines of both columns move below it.
  expect(placed(lay(SHORT, 15))).toEqual([
    'A1@0,6.5',
    'A2@0,17.4',
    'T@0,-4.4',
    'A3@288,6.5',
    'A4@288,17.4',
  ]);
});

test('before mode 15 a raised table keeps its place from the unbalanced columns', () => {
  // Unbalanced, A3 follows A2 at 21.8, so the table stands at 17.4. Balanced, A3 opens the
  // second column, and A2 and A4 move below the table.
  const expected = ['A1@0,0.0', 'A2@0,28.3', 'T@-1,17.4', 'A3@288,0.0', 'A4@288,28.3'];
  expect(placed(lay(SHORT))).toEqual(expected);
  expect(placed(lay(SHORT, 14))).toEqual(expected);
  expect(placed(lay(SHORT, 12))).toEqual(expected);
});

test('before mode 15 the kept place can lie below all the balanced text', () => {
  const lines = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map(p).join('');
  const layout = placed(lay(balanced(lines + table() + p('B1') + p('B2'))));
  // B1 followed A8 at 87.3 before the columns balanced.
  expect(layout).toContain('T@-1,82.9');
  expect(layout).toEqual(expect.arrayContaining(['A5@0,43.6', 'A6@288,0.0', 'B2@288,43.6']));
});

test('a warm pass after an edit or a deletion lays out like a cold one', () => {
  const body = (lead: string) => balanced(lead + p('A2') + table() + p('A3') + p('A4'));
  for (const mode of [undefined, 15]) {
    for (const edited of [body(p('Z') + p('A1')), body(''), body(p('A1') + p('A1b'))]) {
      const session = createLayoutSession();
      const options = {
        measurer: createFixedMeasurer(6, 12),
        session,
        ...(mode ? { compatibilityMode: mode } : {}),
      };
      layoutSemanticDocument(part(body(p('A1'))), 0, options);
      const warm = placed(layoutSemanticDocument(part(edited), 1, options));
      const cold = placed(
        layoutSemanticDocument(part(edited), 1, {
          measurer: createFixedMeasurer(6, 12),
          ...(mode ? { compatibilityMode: mode } : {}),
        })
      );
      expect(warm).toEqual(cold);
    }
  }
});

test('in two columns the earlier lines a rising top distance crosses wrap beside the table', () => {
  const words = (prefix: string, count: number) =>
    p(
      Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`).join(
        ' '
      )
    );
  // `w:topFromText` of 567 twips raises the band 28.35 pt above the anchor; the table leaves a
  // passage in its column.
  const rising =
    '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="142" w:rightFromText="284" w:topFromText="567" ' +
    'w:bottomFromText="0" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="1"/>' +
    '<w:tblOverlap w:val="never"/><w:tblW w:w="3000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr>' +
    '<w:trHeight w:val="1600"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' +
    `${p('T')}</w:tc></w:tr></w:tbl>`;
  for (const mode of [undefined, 15]) {
    const page = lay(filled(words('a', 60) + rising + words('b', 40)), mode).pages[0]!;
    const lines = page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => ({
            text: line.spans[0]!.text.slice(0, 3),
            x: line.spans[0]!.box.x,
            y: line.box.y,
          }))
        : []
    );
    const table = page.fragments.find((fragment) => fragment.kind === 'table')!;
    // The table keeps its place below the anchor's first line; a34 to a58 wrap beside it.
    expect(table.box.y).toBeCloseTo(65.5, 1);
    for (const line of lines.slice(0, 3)) expect(line.x).toBe(0);
    const beside = lines.filter((line) => line.x > table.box.x + table.box.width);
    expect(beside[0]).toMatchObject({ text: 'a34', y: lines[3]!.y });
    expect(beside.map((line) => line.text)).toContain('a58');
  }
});
