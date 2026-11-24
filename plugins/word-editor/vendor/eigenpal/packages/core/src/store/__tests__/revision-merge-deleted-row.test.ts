// A vertical merge change whose continuation sits in a deleted row: on accept the head decides
// apart from the continuation, and the row's decision takes the continuation away.
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
const stamp = (id: number, author: string) => `w:id="${id}" w:author="${author}"`;
const cell = (pr: string, body: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${pr}</w:tcPr>${body}</w:tc>`;
const deleted = (id: number, author: string, text: string) =>
  `<w:p><w:pPr><w:rPr><w:del ${stamp(id, author)}/></w:rPr></w:pPr>` +
  `<w:del ${stamp(id + 1, author)}><w:r><w:delText>${text}</w:delText></w:r></w:del></w:p>`;

function load(rowAuthor: string): OoxmlPart {
  const head = cell(
    `<w:cellMerge ${stamp(1, 'Ada')} w:vMerge="rest"/>`,
    '<w:p><w:r><w:t>a</w:t></w:r></w:p>'
  );
  const plain = (text: string) => cell('', `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
  const continuation = cell(
    `<w:cellMerge ${stamp(2, 'Ada')} w:vMerge="cont"/>`,
    deleted(10, rowAuthor, 'x')
  );
  const body =
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
    `<w:tr>${head}${plain('b')}</w:tr>` +
    `<w:tr><w:trPr><w:del ${stamp(20, rowAuthor)}/></w:trPr>${continuation}${cell('', deleted(30, rowAuthor, 'y'))}</w:tr>` +
    `</w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function apply(part: OoxmlPart, plan: ReturnType<typeof planRevisionBatch>): OoxmlPart {
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return part;
}

const headOf = (part: OoxmlPart) => serializeOoxmlPart(part).match(/<w:tc>.*?<\/w:tc>/)![0];

for (const rowAuthor of ['Ada', 'Grace'])
  test(`accepting the merge head alone leaves the deleted row pending (row by ${rowAuthor})`, () => {
    let part = load(rowAuthor);
    const head = revisionItemsOf(part).find((item) => item.revisionKind === 'structural')!;
    const plan = planRevisionBatch(part, 'accept', [reviewItemKey(head)], undefined, {
      explicit: true,
    });
    expect(plan.result.skipped).toEqual([]);
    part = apply(part, plan);
    // The head stays merged while its continuation waits for the row's decision.
    expect(headOf(part)).toContain('<w:vMerge w:val="restart"/>');
    expect(headOf(part)).not.toContain('cellMerge');
    const row = revisionItemsOf(part).find((item) => item.text.includes('y'))!;
    const rest = planRevisionBatch(part, 'accept', [reviewItemKey(row)], undefined, {
      explicit: true,
    });
    expect(rest.result.skipped).toEqual([]);
    part = apply(part, rest);
    expect(revisionItemsOf(part)).toEqual([]);
    expect(serializeOoxmlPart(part).match(/<w:tr[ >]/g)).toHaveLength(1);
    // The row took the continuation, so the head merges nothing.
    expect(headOf(part)).not.toMatch(/vMerge|cellMerge/);
  });

test('accept all removes the merge with the deleted row that held its continuation', () => {
  const part = load('Ada');
  const plan = planRevisionBatch(part, 'accept');
  expect(plan.result.skipped).toEqual([]);
  const after = apply(part, plan);
  expect(serializeOoxmlPart(after)).not.toMatch(/vMerge|cellMerge|<w:del /);
  expect(headOf(after)).toContain('>a<');
});

test('rejecting the merge head still decides its continuation with it', () => {
  let part = load('Ada');
  const head = revisionItemsOf(part).find((item) => item.revisionKind === 'structural')!;
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(head)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  part = apply(part, plan);
  expect(serializeOoxmlPart(part)).not.toContain('cellMerge');
  expect(revisionItemsOf(part)).toHaveLength(1);
});

for (const order of [
  ['Bob', 'Grace'],
  ['Grace', 'Bob'],
])
  test(`a live merge keeps its pending continuation whatever decides first (${order.join(' then ')})`, () => {
    const plain = (text: string) => cell('', `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
    const body =
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
      `<w:tr>${cell('<w:vMerge w:val="restart"/>', '<w:p><w:r><w:t>h</w:t></w:r></w:p>')}${plain('a')}</w:tr>` +
      `<w:tr><w:trPr><w:del ${stamp(20, 'Bob')}/></w:trPr>${cell('<w:vMerge/>', '<w:p/>')}${cell('', deleted(30, 'Bob', 'y'))}</w:tr>` +
      `<w:tr>${cell(`<w:cellMerge ${stamp(3, 'Grace')} w:vMerge="cont"/>`, '<w:p/>')}${plain('c')}</w:tr>` +
      `</w:tbl><w:p/>`;
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw Error(read.reason);
    const all = apply(read.part, planRevisionBatch(read.part, 'accept'));
    let part = read.part;
    for (const author of order) {
      const keys = revisionItemsOf(part)
        .filter((item) => item.author === author)
        .map(reviewItemKey);
      const plan = planRevisionBatch(part, 'accept', keys, undefined, { explicit: true });
      expect(plan.result.skipped).toEqual([]);
      part = apply(part, plan);
    }
    expect(serializeOoxmlPart(part)).toBe(serializeOoxmlPart(all));
    expect(serializeOoxmlPart(all)).toMatch(/w:val="restart".*w:val="continue"/);
  });

test('a merge chain through a deleted middle row resolves card by card as accept all does', () => {
  const merge = (id: number, author: string, value: string, body: string) =>
    cell(`<w:cellMerge ${stamp(id, author)} w:vMerge="${value}"/>`, body);
  const plain = (text: string) => cell('', `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
  const body =
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
    `<w:tr>${merge(1, 'Ada', 'rest', '<w:p><w:r><w:t>h</w:t></w:r></w:p>')}${plain('a')}</w:tr>` +
    `<w:tr><w:trPr><w:del ${stamp(20, 'Bob')}/></w:trPr>${merge(2, 'Ada', 'cont', deleted(10, 'Bob', 'x'))}${cell('', deleted(30, 'Bob', 'y'))}</w:tr>` +
    `<w:tr>${merge(3, 'Grace', 'cont', '<w:p/>')}${plain('c')}</w:tr>` +
    `</w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  const all = apply(read.part, planRevisionBatch(read.part, 'accept'));
  let part = read.part;
  const single = (target: OoxmlPart, key: string) =>
    planRevisionBatch(target, 'accept', [key], undefined, { explicit: true });
  for (let step = 0; step < 4 && revisionItemsOf(part).length; step++) {
    const item = revisionItemsOf(part).find((candidate) => {
      const plan = single(part, reviewItemKey(candidate));
      return !plan.result.skipped.length && plan.ops.length;
    });
    expect(item).toBeDefined();
    part = apply(part, single(part, reviewItemKey(item!)));
  }
  expect(revisionItemsOf(part)).toEqual([]);
  expect(serializeOoxmlPart(part)).toBe(serializeOoxmlPart(all));
  expect(serializeOoxmlPart(all)).toMatch(/w:val="restart".*w:val="continue"/);
});
