import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

// A mode-15 left-aligned AutoFit table with one 6pt side rule on every cell side shares its
// rules with the grid lines only while grid plus rule fits the 468pt column. Typing widens
// the grid past that point: the table moves to x = 0 and its first cells stop publishing
// their own leading side rule. Nothing moves vertically.
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
    .map((edge) => `<w:${edge} w:val="single" w:sz="48"/>`)
    .join('') +
  '</w:tblBorders>';
const documentXml = (rows: readonly string[]) =>
  `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>${BORDERS}` +
  `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>` +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" ' +
  'w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
  '</w:body></w:document>';
const load = (xml: string): OoxmlPart => {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
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
const firstTable = (layout: SemanticLayout): TableFragmentRecord =>
  layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
const deps = {
  measurer,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};

test('a side-rule geometry switch during a width change keeps the width lane exact', () => {
  const header = tr(['Head one', 'Head two', 'Head three'], '<w:tblHeader/>');
  const rows = Array.from({ length: 120 }, (_, i) =>
    tr([`R${i}`, `C${i}x`, i === 60 ? 'ABC' : `D${i}`])
  );
  let part = load(documentXml([header, ...rows]));
  const paragraphId = readTableStructure(tableNode(part), 468, 0)!.rows[61]!.cells[2]!.blocks[0]!
    .id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let previous = lay(part, { session, cache });
  let switched = 0;
  for (const [index, character] of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3)].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    const direct = updateTableText(
      tableNode(part),
      tableNode(edit.part),
      previous.pages,
      468,
      deps
    );
    part = edit.part;
    const updated = lay(part, { session, cache });
    const cold = lay(part);
    expect(JSON.stringify(updated.pages)).toBe(JSON.stringify(cold.pages));
    const before = firstTable(previous).box;
    const after = firstTable(updated).box;
    // The edit that switches the side-rule geometry, while every cell still holds its line.
    if (before.x !== after.x && after.width < 468) {
      switched += 1;
      expect(direct).not.toBeNull();
      expect(direct!.pages).toEqual(cold.pages);
    }
    previous = updated;
  }
  expect(switched).toBe(1);
});
