import { expect, test } from 'bun:test';
import { readOoxmlPart, revisionItemsOf } from '../index.ts';
import { locateSites } from '../store/review-site-locations.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const change = (name: string, id: number, body = '') =>
  `<w:${name} w:id="${id}" w:author="Ada">${body}</w:${name}>`;

test('table, row and cell decisions anchor to their own first paragraph', () => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p/><w:tbl><w:tblPr>${change('tblPrChange', 1, '<w:tblPr/>')}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr>${change('ins', 2)}</w:trPr><w:tc><w:p><w:r><w:t>first</w:t></w:r></w:p></w:tc><w:tc><w:tcPr>${change('cellIns', 3)}${change('cellMerge', 4)}${change('tcPrChange', 5, '<w:tcPr/>')}</w:tcPr><w:p><w:r><w:t>second</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  const items = revisionItemsOf(read.part);
  const byId = (id: string) => items.find((i) => i.address.id === id)!;
  const first = byId('1').ranges[0]!.start.paragraphId;
  const second = byId('3').ranges[0]!.start.paragraphId;
  expect(first).not.toBe(second);
  expect(byId('2').ranges[0]!.start.paragraphId).toBe(first);
  expect(byId('4').ranges[0]!.start.paragraphId).toBe(second);
  expect(byId('5').ranges[0]!.start.paragraphId).toBe(second);
  expect(byId('3').structuralChanges).toEqual(['cellInsert']);
  expect(byId('4').structuralChanges).toEqual(['cellMerge']);
  expect(locateSites(read.part)).toBe(locateSites(read.part));
});

for (const kind of ['ins', 'del']) {
  test(`a ${kind} revision inside a simple field anchors to the atomic result`, () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Before</w:t></w:r><w:fldSimple w:instr=" MERGEFIELD audit ">${change(kind, 1, `<w:r><w:${kind === 'del' ? 'delText' : 't'}>Result</w:${kind === 'del' ? 'delText' : 't'}></w:r>`)}</w:fldSimple></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const item = revisionItemsOf(read.part)[0]!;
    expect(item.text).toBe('Result');
    expect(item.ranges).toHaveLength(1);
    expect(item.ranges[0]!.start.offset).toBe(6);
    expect(item.ranges[0]!.end.offset).toBe(7);
  });
}
