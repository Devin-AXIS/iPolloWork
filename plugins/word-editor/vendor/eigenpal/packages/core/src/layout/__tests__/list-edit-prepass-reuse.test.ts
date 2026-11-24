// A list edit keeps the section's paragraph order and still lays out like a fresh session.
//
// Turning a paragraph into a list item writes a new numbering definition, so the list inputs
// of the section prepass change. The paragraph order reads no list state, so it is carried;
// the pages must still equal a layout from a new session.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;

function read(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function numbering(nums: number) {
  const instances = Array.from(
    { length: nums },
    (_, index) => `<w:num w:numId="${index + 1}"><w:abstractNumId w:val="0"/></w:num>`
  ).join('');
  return buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
        '<w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
        `</w:lvl></w:abstractNum>${instances}</w:numbering>`,
      '/word/numbering.xml'
    ).root
  );
}

test('a list toggle keeps the paragraph order and matches a fresh layout', () => {
  const rows = Array.from(
    { length: 4 },
    (_, index) => `<w:tr>${cell(`r${index}a`)}${cell(`r${index}b`)}</w:tr>`
  ).join('');
  const table = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
  const body =
    Array.from({ length: 30 }, (_, index) => p(`Paragraph ${index}`)).join('') + table + p('After');
  const part = read(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    '/word/document.xml'
  );
  const measurer = createFixedMeasurer(5, 12);
  const session = createLayoutSession();
  layoutSemanticDocument(part, 0, { measurer, session, numberingIndex: numbering(1) });
  const before = (session.prepass as { paragraphDocumentOrder: unknown }).paragraphDocumentOrder;

  const target = part.root.children[0]!;
  if (target.kind === 'textValue') throw new Error('Missing body');
  const listed = applyTreeOp(part, {
    op: 'setListNumbering',
    paragraphId: target.children[3]!.id,
    numId: '2',
  });
  if (!listed.ok) throw new Error(listed.reason);
  const index = numbering(2);
  const live = layoutSemanticDocument(listed.part, 1, { measurer, session, numberingIndex: index });
  const after = (session.prepass as { paragraphDocumentOrder: unknown }).paragraphDocumentOrder;
  expect(after).toBe(before);
  const cold = layoutSemanticDocument(listed.part, 1, {
    measurer,
    session: createLayoutSession(),
    numberingIndex: index,
  });
  expect(live.pages).toEqual(cold.pages);
  expect(JSON.stringify(live.pages)).toContain('"text":"-"');
});
