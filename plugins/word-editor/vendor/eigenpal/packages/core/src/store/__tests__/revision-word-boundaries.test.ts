import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, pr = '') =>
  `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const mark = (kind: string, id = 1, author = 'Ada') =>
  `<w:${kind} w:id="${id}" w:author="${author}"/>`;
const cell = (text: string) => `<w:tc><w:tcPr/>${p(text, '<w:jc w:val="right"/>')}</w:tc>`;
const row = (text: string, pr = '') => `<w:tr><w:trPr>${pr}</w:trPr>${cell(text)}</w:tr>`;
const table = (rows: string) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
const control = (content: string) =>
  `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
function load(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
for (const action of ['accept', 'reject'] as const) {
  const kind = action === 'accept' ? 'del' : 'ins';
  const lead = (text: string, id = 1, props = '') =>
    p(text, `${props}<w:rPr>${mark(kind, id)}</w:rPr>`);
  const resolve = (body: string) =>
    applyTreeOp(load(body), {
      op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
    });
  test(`${action}: a chain joins the first cell and keeps destination formatting`, () => {
    const result = resolve(lead('A') + lead('B', 2) + table(row('C')) + p('after'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain(
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r><w:r><w:t>C</w:t></w:r></w:p>'
    );
    expect(xml.indexOf('A</w:t>')).toBeGreaterThan(xml.indexOf('<w:tc>'));
    expect(xml).toContain('after');
    expect(revisionItemsOf(result.part)).toHaveLength(0);
  });
  test(`${action}: a locked destination cell refuses the complete operation`, () => {
    const part = load(lead('A') + table(`<w:tr>${control(cell('C'))}</w:tr>`));
    const before = serializeOoxmlPart(part);
    const result = applyTreeOp(part, {
      op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
    });
    expect(result.ok).toBe(false);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
  test(`${action}: removing the first row still guards the actual landing cell`, () => {
    const result = resolve(
      lead('A') + table(row('gone', mark(kind, 2)) + `<w:tr>${control(cell('locked'))}</w:tr>`)
    );
    expect(result.ok).toBe(false);
  });
  test(`${action}: deleting the destination table retains the source paragraph`, () => {
    const result = resolve(lead('A') + table(row('gone', mark(kind, 2))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('A');
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).toContain('<w:p>');
  });
  test(`${action}: excluded paragraph properties cannot disappear into a table`, () => {
    const props = `<w:pPrChange w:id="2" w:author="Grace"><w:pPr/></w:pPrChange>`;
    const part = load(lead('A', 1, props) + table(row('C')));
    const keys = revisionItemsOf(part)
      .filter((i) => i.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.ops).toEqual([]);
    expect(plan.result.remaining).toBe(2);
  });
  test(`${action}: removed tables cannot hide a locked receiving table`, () => {
    const result = resolve(
      lead('A') +
        table(row('gone', mark(kind, 2))) +
        table(`<w:tr>${control(cell('locked'))}</w:tr>`)
    );
    expect(result.ok).toBe(false);
  });
  test(`${action}: batch dependencies follow the surviving first row`, () => {
    const props = `<w:pPrChange w:id="3" w:author="Grace"><w:pPr/></w:pPrChange>`;
    const first = `<w:tr><w:trPr>${mark(kind, 2)}</w:trPr><w:tc><w:sdt><w:sdtPr/><w:sdtContent>${p('gone')}</w:sdtContent></w:sdt></w:tc></w:tr>`;
    const part = load(lead('A', 1, props) + table(first + row('survivor')));
    const keys = revisionItemsOf(part)
      .filter((i) => i.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.result.skipped.some((s) => s.revision?.revisionKind === 'paragraphMark')).toBe(
      true
    );
    let current = part;
    for (const op of plan.ops) {
      const result = applyTreeOp(current, op);
      expect(result.ok).toBe(true);
      if (result.ok) current = result.part;
    }
    expect(serializeOoxmlPart(current)).toContain('w:pPrChange');
    expect(serializeOoxmlPart(current)).toContain('A</w:t>');
  });
  test(`${action}: numbering insertion metadata keeps the list reference, as in Word`, () => {
    const result = resolve(
      p('list', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>${mark('ins')}</w:numPr>`)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeOoxmlPart(result.part)).toContain(
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    );
    expect(revisionItemsOf(result.part)).toHaveLength(0);
  });
  test(`${action}: duplicate numbering insertion markers remain refused`, () => {
    const result = resolve(
      p('list', `<w:numPr><w:numId w:val="1"/>${mark('ins')}${mark('ins', 2)}</w:numPr>`)
    );
    expect(result.ok).toBe(false);
  });
}
test('reject section history restores only recorded attributes, as in Word', () => {
  const part = load(
    p(
      'section',
      '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:cols w:num="2" w:space="360"/><w:sectPrChange w:id="1" w:author="Ada"><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:space="720"/></w:sectPr></w:sectPrChange></w:sectPr>'
    )
  );
  const result = applyTreeOp(part, { op: 'rejectAllRevisions' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('w:orient="landscape"');
  expect(xml).toContain('w:num="2"');
  expect(xml).toContain('w:space="720"');
  expect(xml).toContain('w:val="continuous"');
  expect(xml).not.toContain('sectPrChange');
});
