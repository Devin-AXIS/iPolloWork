import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../index.ts';
import { collectRevisionSites, collectRevisionSitesTransient } from '../store/tree-op-revisions.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('row revision memos preserve classifications across edits and history', () => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl>
    <w:tblPr/><w:tr><w:trPr><w:ins w:id="1" w:author="A"/></w:trPr><w:tc>
    <w:tcPr><w:cellIns w:id="2" w:author="A"/></w:tcPr>
    <w:p><w:r><w:t>Editable</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:pPr><w:rPr><w:del w:id="3" w:author="A"/></w:rPr></w:pPr>
    <w:ins w:id="4" w:author="A"><w:del w:id="5" w:author="B"><w:r><w:delText>Nested</w:delText></w:r></w:del></w:ins>
    </w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const before = parsed.part;
  const body = before.root.children.find((n) => n.kind === 'body')! as OoxmlElement;
  const table = body.children.find((n) => n.kind === 'table')! as OoxmlElement;
  const row = table.children.find((n) => n.kind === 'tableRow')! as OoxmlElement;
  const cell = row.children.find((n) => n.kind === 'tableCell')! as OoxmlElement;
  const paragraph = cell.children.find((n) => n.kind === 'paragraph')!;
  const cold = collectRevisionSitesTransient(before);
  expect(cold.length).toBeGreaterThan(3);
  expect(collectRevisionSites(before)).toEqual(cold);
  const edited = applyTreeOp(before, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 0,
    text: 'X',
  });
  if (!edited.ok) throw Error(edited.reason);
  for (const part of [edited.part, before, edited.part])
    expect(collectRevisionSites(part)).toEqual(collectRevisionSitesTransient(part));
});
