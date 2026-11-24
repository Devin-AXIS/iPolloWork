import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { movedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import type { SemanticLayout } from '../semantic-records.ts';

// A 468pt column, four AutoFit columns of unbreakable tokens, and one note cell that grows.
// Typing a long spaced note widens the table to the column and then wraps the note: its row
// really grows, so the table is paginated again and only unmoved rows may be reused.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:vAlign w:val="center"/></w:tcPr>${p(text)}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.map(tc).join('')}</w:tr>`;
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ROWS = 120;
const NOTE_ROW = 61;
const documentXml = () =>
  `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${BORDERS}` +
  `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1000"/>'.repeat(4)}</w:tblGrid>` +
  tr(['Head', 'Name', 'Value', 'Note'], '<w:tblHeader/>') +
  Array.from({ length: ROWS }, (_, i) =>
    tr([`R${i}`, `Item${i % 7}`, `${(i * 7919) % 1000}`, i === NOTE_ROW - 1 ? 'x' : `n${i % 5}`])
  ).join('') +
  '</w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" ' +
  'w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
const load = (): OoxmlPart => {
  const read = readOoxmlPart(documentXml(), { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
};
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: object = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, compatibilityMode: 15, ...extra });
const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const rowHeights = (layout: SemanticLayout): string =>
  layout.pages
    .flatMap((page) => page.fragments)
    .flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
    .map((row) => row.box.height)
    .join(',');

let recorder = movedRowsTestRecorder();
afterEach(() => {
  recorder.dispose();
  recorder = movedRowsTestRecorder();
});

test('a text edit that grows a row reuses unmoved rows in the full pagination, exactly', () => {
  let part = load();
  const note = readTableStructure(tableNode(part), 468, 0)!.rows[NOTE_ROW]!.cells[3]!.blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let previous = lay(part, { session, cache });
  const words = ' a long note that keeps growing until the cell has to wrap onto more lines';
  let grown = 0;
  for (const [index, character] of [...words].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: note,
      offset: 1 + index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const before = recorder.moved;
    const updated = lay(part, { session, cache });
    expect(JSON.stringify(updated.pages)).toBe(JSON.stringify(lay(part).pages));
    if (rowHeights(previous) !== rowHeights(updated)) {
      grown += 1;
      // Rows above the note keep their tops, so most of them are reused.
      expect(recorder.moved - before).toBeGreaterThan(NOTE_ROW / 2);
    }
    previous = updated;
  }
  expect(grown).toBeGreaterThan(0);
});

test('a cell property edit offers no previous rows and still lays out exactly', () => {
  let part = load();
  const structure = readTableStructure(tableNode(part), 468, 0)!;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, { session, cache });
  const before = recorder.moved;
  // A moved row keeps its old cell fill; this edit must lay the table out afresh.
  const edit = applyTreeOp(part, {
    op: 'setTableCellFill',
    tableId: tableNode(part).id,
    cellIds: [structure.rows[90]!.cells[1]!.id],
    color: { kind: 'hex', value: 'FFEE00' },
  });
  if (!edit.ok) throw Error(edit.reason);
  part = edit.part;
  const updated = lay(part, { session, cache });
  expect(JSON.stringify(updated.pages)).toBe(JSON.stringify(lay(part).pages));
  expect(recorder.moved - before).toBe(0);
});
