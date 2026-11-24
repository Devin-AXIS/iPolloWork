// How tracked changes divide and resolve around wrappers, fields, equations, block controls and
// tables: where one change ends, and what a decision leaves of the structure around it.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const r = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ann = (id: number) => `w:id="${id}" w:author="Ann" w:date="2026-10-01T10:00:00Z"`;
const ins = (id: number, xml: string) => `<w:ins ${ann(id)}>${xml}</w:ins>`;
const del = (id: number, text: string) =>
  `<w:del ${ann(id)}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const p = (xml: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${xml}</w:p>`;
const markIns = (id: number) => `<w:rPr><w:ins ${ann(id)}/></w:rPr>`;
const markDel = (id: number) => `<w:rPr><w:del ${ann(id)}/></w:rPr>`;
const sdt = (xml: string, extra = '') =>
  `<w:sdt><w:sdtPr><w:id w:val="77"/>${extra}</w:sdtPr><w:sdtContent>${xml}</w:sdtContent></w:sdt>`;
const field = (result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const after = p(r('After.'));

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
function decide(part: OoxmlPart, action: 'accept' | 'reject', keys?: string[]): OoxmlPart {
  const plan = planRevisionBatch(part, action, keys, undefined, { explicit: keys !== undefined });
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return part;
}
const body = (part: OoxmlPart) =>
  serializeOoxmlPart(part)
    .match(/<w:body>(.*)<\/w:body>/s)![1]!
    .replace(/ w:(id|author|date)="[^"]*"/g, '');
const count = (xml: string) => revisionItemsOf(load(xml)).length;

for (const [name, wrap] of [
  ['content control', (x: string) => sdt(x)],
  ['hyperlink', (x: string) => `<w:hyperlink w:anchor="target">${x}</w:hyperlink>`],
  ['simple field', (x: string) => `<w:fldSimple w:instr=" PAGE ">${x}</w:fldSimple>`],
  ['direction wrapper', (x: string) => `<w:dir w:val="rtl">${x}</w:dir>`],
] as const) {
  test(`an insertion across the edge of a ${name} is two changes`, () => {
    expect(count(p(ins(1, r('pre ')) + wrap(ins(1, r('in ')) + r('rest'))))).toBe(2);
  });
  test(`an inserted paragraph around a ${name} is three changes`, () => {
    expect(
      count(p(ins(1, r('Alpha ')) + wrap(ins(1, r('new'))) + ins(1, r(' omega.')), markIns(1)))
    ).toBe(3);
  });
}

test('an insertion across a bookmark is one change', () => {
  expect(
    count(
      p(
        ins(1, r('pre ')) +
          '<w:bookmarkStart w:id="5" w:name="b"/>' +
          ins(1, r('in')) +
          '<w:bookmarkEnd w:id="5"/>'
      )
    )
  ).toBe(1);
});

test('unchanged field characters divide an inserted paragraph; inserted ones do not', () => {
  expect(
    count(p(ins(1, r('Alpha ')) + field(ins(1, r('new'))) + ins(1, r(' omega.')), markIns(1)))
  ).toBe(3);
  expect(count(p(ins(1, r('See ') + field(r('2')) + r('.')), markIns(1)))).toBe(1);
});

test('formatting on each run of a field is one change per run, and every one resolves', () => {
  const bold = `<w:rPr><w:b/><w:rPrChange ${ann(1)}><w:rPr/></w:rPrChange></w:rPr>`;
  const runs = field(r('1')).replace(/<w:r>/g, `<w:r>${bold}`);
  const part = load(p(r('Alpha ') + runs + r(' omega.')));
  const items = revisionItemsOf(part);
  expect(items).toHaveLength(5);
  expect(new Set(items.map(reviewItemKey)).size).toBe(5);
  expect(body(decide(part, 'reject'))).not.toContain('rPrChange');
});

test('the mark that ends a block content control is a change of its own', () => {
  expect(count(sdt(p(r('kept')) + p(del(1, 'removed'), markDel(2))) + after)).toBe(2);
  // A control that closes a table cell ends with the cell instead.
  const cell = `<w:tbl><w:tr><w:tc>${sdt(p(r('x')) + p(ins(1, r('cell')), markIns(2)))}</w:tc></w:tr></w:tbl>`;
  expect(count(cell + after)).toBe(1);
});

test('a tracked row inside a row-level content control is one change', () => {
  const cells = ['d1', 'd2'].map((t) => `<w:tc>${p(del(1, t), markDel(1))}</w:tc>`).join('');
  const table =
    `<w:tbl><w:tr><w:tc>${p(r('a'))}</w:tc><w:tc>${p(r('b'))}</w:tc></w:tr>` +
    `${sdt(`<w:tr><w:trPr><w:del ${ann(1)}/></w:trPr>${cells}</w:tr>`)}</w:tbl>`;
  expect(count(table + after)).toBe(1);
});

test('a deleted paragraph holding an equation is one change', () => {
  const math = `<m:oMath><w:del ${ann(1)}><m:r><m:t>y=2</m:t></m:r></w:del></m:oMath>`;
  expect(count(p(del(1, 'Alpha ') + math + del(1, ' omega.'), markDel(1)))).toBe(1);
});

test('rejecting an inserted paragraph removes its emptied equation', () => {
  const math = `<m:oMathPara><m:oMath><w:ins ${ann(1)}><m:r><m:t>y=2</m:t></m:r></w:ins></m:oMath></m:oMathPara>`;
  expect(
    body(decide(load(p(ins(1, r('Alpha ')) + math, markIns(1)) + after), 'reject'))
  ).not.toContain('oMath');
});

test('two equal tables a decision leaves side by side become one table', () => {
  const table = (text: string) =>
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc>${p(r(text))}</w:tc></w:tr></w:tbl>`;
  const xml = body(
    decide(load(table('a') + p(del(1, 'between'), markDel(1)) + table('x') + after), 'accept')
  );
  expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
  expect(xml.match(/<w:tr>/g)).toHaveLength(2);
});

test('a paragraph a decision empties before a block control goes', () => {
  const xml = body(
    decide(load(p(del(1, 'lead'), markDel(1)) + sdt(p(r('inside'))) + after), 'accept')
  );
  expect(xml).toMatch(/^<w:sdt>/);
});

test('a block content control keeps its emptied last paragraph', () => {
  const xml = body(
    decide(load(sdt(p(r('kept')) + p(del(1, 'removed'), markDel(2))) + after), 'accept')
  );
  expect(xml).toContain('<w:sdtContent><w:p><w:r><w:t>kept</w:t></w:r></w:p><w:p>');
});

for (const order of ['together', 'mark first'] as const)
  test(`a block content control the decision empties joins the next paragraph (${order})`, () => {
    let part = load(sdt(p(del(1, 'only'), markDel(2))) + after);
    if (order === 'together') part = decide(part, 'accept');
    else
      for (let step = 0; step < 2; step++) {
        const items = revisionItemsOf(part);
        const mark = items.find((item) => item.revisionKind === 'paragraphMark') ?? items[0]!;
        part = decide(part, 'accept', [reviewItemKey(mark)]);
      }
    expect(body(part)).toMatch(
      /^<w:p><w:sdt><w:sdtPr><w:id w:val="77"\/><w:showingPlcHdr\/><\/w:sdtPr><w:sdtContent><w:r><w:t xml:space="preserve"> {5}<\/w:t><\/w:r><\/w:sdtContent><\/w:sdt><w:r><w:t>After\.<\/w:t>/
    );
  });

for (const [name, extra] of [
  ['an untyped', ''],
  ['a plain text', '<w:text/>'],
  ['a placeholder', '<w:showingPlcHdr/>'],
] as const)
  test(`a decision that empties ${name} inline control restores its placeholder`, () => {
    const xml = body(
      decide(load(p(r('Alpha ') + sdt(del(1, 'OLD'), extra) + r(' omega.'))), 'accept')
    );
    expect(xml).toContain('<w:showingPlcHdr/>');
    expect(xml).toContain('<w:t xml:space="preserve">     </w:t>');
  });

test('a content lock lets through decisions that keep the content, and keeps the others', () => {
  const locked = (inner: string) =>
    p(sdt(r('in ') + inner + r('end'), '<w:lock w:val="contentLocked"/>'));
  const accepted = decide(load(locked(ins(1, r('NEW ')))), 'accept');
  expect(body(accepted)).not.toContain('<w:ins');
  const plan = planRevisionBatch(load(locked(ins(1, r('NEW ')))), 'reject');
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
  const restored = decide(load(locked(del(1, 'OLD '))), 'reject');
  expect(body(restored)).toContain('<w:t xml:space="preserve">OLD </w:t>');
});

test('a decision that removes a control locked against removal keeps it as an empty shell', () => {
  const control = sdt(r('NEW content'), '<w:lock w:val="sdtLocked"/>');
  const xml = body(decide(load(p(r('Alpha ') + ins(1, control) + r(' omega.'))), 'reject'));
  expect(xml).toContain('<w:lock w:val="sdtLocked"/>');
  expect(xml).not.toContain('NEW content');
  expect(xml).toContain('<w:t xml:space="preserve">     </w:t>');
});

test('rejecting an inserted paragraph removes an equation paragraph left with only its properties', () => {
  const math =
    '<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>' +
    `<m:oMath><w:ins ${ann(1)}><m:r><m:t>y=2</m:t></m:r></w:ins></m:oMath></m:oMathPara>`;
  expect(body(decide(load(p(r('Alpha ') + math) + after), 'reject'))).not.toContain('oMath');
});

test('a stale key of a divided change never decides the next part', () => {
  const bold = `<w:rPr><w:b/><w:rPrChange ${ann(1)}><w:rPr/></w:rPrChange></w:rPr>`;
  const boldRun = (text: string) => `<w:r>${bold}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  let part = load(
    p(boldRun('out ') + `<w:hyperlink w:anchor="target">${boldRun('in')}</w:hyperlink>`)
  );
  const [first, second] = revisionItemsOf(part).map(reviewItemKey);
  expect(first).not.toBe(second);
  part = decide(part, 'accept', [first!]);
  const replay = planRevisionBatch(part, 'accept', [first!], undefined, { explicit: true });
  expect(replay.ops).toEqual([]);
  expect(revisionItemsOf(part).map(reviewItemKey)).toEqual([second]);
});

const bobDeletion =
  '<w:del w:id="9" w:author="Bob" w:date="2026-10-01T10:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del>';

test('reject all skips an insertion holding an sdtContentLocked control and decides the others', () => {
  const control = sdt(r('LOCKED'), '<w:lock w:val="sdtContentLocked"/>');
  const part = load(p(r('a ') + ins(1, control) + bobDeletion));
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.result.resolved.map((entry) => entry.author)).toEqual(['Bob']);
  expect(plan.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
  expect(body(decide(part, 'reject'))).toContain('LOCKED');
});

test('accept all skips an insertion inside a data-bound control and decides the others', () => {
  const bound = sdt(
    r('v ') + ins(1, r('NEW')),
    '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/>'
  );
  const plan = planRevisionBatch(load(p(bound + bobDeletion)), 'accept');
  expect(plan.result.resolved.map((entry) => entry.author)).toEqual(['Bob']);
  expect(plan.result.skipped).toMatchObject([{ detail: 'bound-content' }]);
});
