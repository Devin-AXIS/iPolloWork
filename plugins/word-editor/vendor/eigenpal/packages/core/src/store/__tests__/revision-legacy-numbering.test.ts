// `w:numberingChange` is the legacy record of a list number's old text. It lists as no change,
// and a bulk decision in either direction drops it and keeps the list.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const body =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>' +
  '<w:numberingChange w:id="1" w:author="Ann" w:original="%1."/></w:numPr></w:pPr>' +
  '<w:r><w:t>Item</w:t></w:r><w:ins w:id="2" w:author="Ann"><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins></w:p>';

for (const action of ['accept', 'reject'] as const)
  test(`${action} all drops the legacy list record and keeps the list`, () => {
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw Error(read.reason);
    let part = read.part;
    expect(revisionItemsOf(part).map((item) => item.revisionKind)).toEqual(['insert']);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(xml).not.toContain('numberingChange');
    expect(xml).toContain('<w:numId w:val="1"/>');
    expect(xml.includes(' added')).toBe(action === 'accept');
  });
