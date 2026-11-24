import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, revisionItemsOf, serializeOoxmlPart } from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const wrappers = {
  direct: (xml: string) => xml,
  control: (xml: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${xml}</w:sdtContent></w:sdt>`,
  customXml: (xml: string) => `<w:customXml w:element="rows">${xml}</w:customXml>`,
};
for (const action of ['accept', 'reject'] as const) {
  for (const [wrapperName, wrap] of Object.entries(wrappers)) {
    for (let count = 1; count <= 4; count++) {
      for (let mask = 1; mask < 1 << count; mask++) {
        test(`${action}: ${wrapperName}, ${count} rows, removal mask ${mask.toString(2)}`, () => {
          const kind = action === 'accept' ? 'del' : 'ins';
          const rows = Array.from({ length: count }, (_, index) => {
            const marked = (mask & (1 << index)) !== 0;
            return wrap(
              `<w:tr><w:trPr>${marked ? `<w:${kind} w:id="${index}" w:author="Audit"/>` : ''}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4000"/></w:tcPr>${paragraph(`row-${index}`)}</w:tc></w:tr>`
            );
          }).join('');
          // Place the table inside a cell: deleting every row must leave its required paragraph.
          const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${rows}</w:tbl></w:tc></w:tr></w:tbl>${paragraph('outside')}</w:body></w:document>`;
          const read = readOoxmlPart(xml, {
            name: '/word/document.xml',
            contentType: 'application/xml',
          });
          if (!read.ok) throw Error(read.reason);
          const plan = planRevisionBatch(read.part, action);
          expect(plan.result.skipped).toEqual([]);
          let part = read.part;
          for (const op of plan.ops) {
            const result = applyTreeOp(part, op);
            if (!result.ok) throw Error(result.reason);
            part = result.part;
          }
          const output = serializeOoxmlPart(part);
          for (let index = 0; index < count; index++)
            expect(output.includes(`row-${index}`)).toBe((mask & (1 << index)) === 0);
          expect(output).toContain('outside');
          expect(revisionItemsOf(part)).toHaveLength(0);
          const allRemoved = mask === (1 << count) - 1;
          expect(output.match(/<w:tbl>/g)?.length).toBe(allRemoved ? 1 : 2);
          if (allRemoved) expect(output).toContain('<w:tc><w:tcPr/><w:p/></w:tc>');
        });
      }
    }
  }
}
