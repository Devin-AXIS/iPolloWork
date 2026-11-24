import { afterEach, expect, spyOn, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import * as growth from '../table-row-growth.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { measurer, styleCascade, W } from './table-row-keep-fixtures.ts';

// A footnote reserve shortens the body band of its page. A grown last row must stay inside
// that band, as the paginator keeps it, including in a later section, whose pages carry no
// note area while the body is laid out.
//
// Page body: 310pt wide, 170pt tall. Exact 14pt lines; a one-line row is 14.5pt tall.

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SECT =
  '<w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" ' +
  'w:left="400" w:right="400" w:header="0" w:footer="0" w:gutter="0"/>';

const p = (runs: string, pPr = '') =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  `<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>${pPr}</w:pPr>${runs}</w:p>`;
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const tc = (content: string) => `<w:tc><w:tcPr></w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const row = (name: string) =>
  tr([tc(p(text(`${name}c0`))), tc(p(text(`${name}c1`))), tc(p(text(`${name}c2`)))]);
/** Three lines in its first cell, kept whole: 42.5pt. */
const tallRow = tr(
  [tc(p(text('n1')) + p(text('n2')) + p(text('n3'))), tc(p(text('n'))), tc(p(text('n')))],
  '<w:cantSplit/>'
);
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const table = (count: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  [...Array.from({ length: count }, (_, i) => row(`r${i}`)), tallRow].join('') +
  Array.from({ length: 6 }, (_, i) => row(`t${i}`)).join('') +
  '</w:tbl>';
/** Wraps the edited cell once its column stops widening. */
const WRAPPING = ' Supercalifragilistic expialidocious more words here';

/**
 * A footnote reference in the paragraph above the table, then `count` one-line rows, a
 * whole three-line row, and six more rows. `sections` puts a first section before it.
 */
function notedTable(count: number, sections: 1 | 2) {
  const first =
    sections === 2 ? p(text('a'), `<w:sectPr><w:type w:val="nextPage"/>${SECT}</w:sectPr>`) : '';
  const body =
    first + p(text('b') + '<w:r><w:footnoteReference w:id="1"/></w:r>') + table(count) + p('');
  const note = (id: number, type: string, content: string) =>
    `<w:footnote${type ? ` w:type="${type}"` : ''} w:id="${id}">${p(content)}</w:footnote>`;
  const entries = {
    '[Content_Types].xml':
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr>${SECT}</w:sectPr></w:body></w:document>`,
    'word/footnotes.xml':
      `<w:footnotes xmlns:w="${W}">` +
      note(-1, 'separator', '<w:r><w:separator/></w:r>') +
      note(0, 'continuationSeparator', '<w:r><w:continuationSeparator/></w:r>') +
      note(1, '', text('c')) +
      '</w:footnotes>',
  };
  const loaded = readOoxmlPackage(
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))
  );
  if (!loaded.ok) throw Error(loaded.reason);
  const footnotes = resolveFootnoteProperties(undefined, undefined);
  const endnotes = resolveEndnoteProperties(undefined, undefined);
  return {
    part: loaded.package.parts.get(loaded.package.mainDocumentPart)!,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: footnotes,
      footnotePropsBySection: Array.from({ length: sections }, () => footnotes),
      documentEndnoteProps: endnotes,
      endnotePropsBySection: Array.from({ length: sections }, () => endnotes),
      measurer,
      producer: 'table-row-growth-notes',
    },
  };
}

const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const tableNode = (part: OoxmlPart) =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')!;
const rowHeights = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) =>
      page.fragments
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .map((fragment) =>
          fragment.rows.map((placed) => [placed.id, placed.box.y, placed.box.height])
        )
    )
  );

afterEach(() => {
  growthAccepted.mockClear();
});
// Read only for an accepted grown row, when the lane counts its lines.
const growthAccepted = spyOn(growth, 'rowLineCount');

/**
 * Type into the last one-line row before the whole row. Every retained-session layout must
 * equal a cold layout: pages, note areas and line counter. Returns the steps whose row
 * heights changed and how many grown rows the direct lane accepted.
 */
function typeBurst(count: number, sections: 1 | 2) {
  const { part: start, notes } = notedTable(count, sections);
  const options = { measurer, styleCascade, compatibilityMode: 15, notes };
  const paragraphId = readTableStructure(tableNode(start), 310, 0, styleCascade)!.rows[count - 1]!
    .cells[1]!.blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let part = start;
  let previous = layoutSemanticDocument(part, 1, { ...options, session, cache });
  let grew = 0;
  for (const [index, character] of [...WRAPPING].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: `r${count - 1}c1`.length + index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const updated = layoutSemanticDocument(part, 1, { ...options, session, cache });
    const coldSession = createLayoutSession();
    const cold = layoutSemanticDocument(reparsed(part), 1, { ...options, session: coldSession });
    expect(updated.pages).toEqual(cold.pages);
    expect(session.endLineCounter).toBe(coldSession.endLineCounter);
    if (rowHeights(previous) !== rowHeights(cold)) grew += 1;
    previous = updated;
  }
  // Every growth step ends with the edited row's second line, on the noted page.
  const notedPage = previous.pages.find((page) => page.footnotes)!;
  expect(notedPage.footnotes).toBeDefined();
  return { grew, accepted: growthAccepted.mock.calls.length / 2 };
}

test('a later section keeps a grown row above the footnote reserve', () => {
  // The grown row ends at 144.5pt, below the 142pt the reserve leaves: the row splits.
  expect(typeBurst(8, 2)).toEqual({ grew: 1, accepted: 0 });
});

test('a later section grows a row that still ends above the footnote reserve', () => {
  expect(typeBurst(7, 2)).toEqual({ grew: 1, accepted: 1 });
});

test('a page with a footnote area grows a row inside the reserved band only', () => {
  expect(typeBurst(8, 1)).toEqual({ grew: 1, accepted: 0 });
  expect(typeBurst(7, 1)).toEqual({ grew: 1, accepted: 1 });
});
