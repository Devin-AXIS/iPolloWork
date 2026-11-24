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
const run = '<w:r><w:t>keep</w:t></w:r>';
function load(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const numbering = '<w:numPr><w:ins w:author="Grace" w:id="2"/></w:numPr>';
const format = '<w:pPrChange w:author="Ada" w:id="1"><w:pPr/></w:pPrChange>';
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: a retained paragraph mark does not own its paragraph properties`, () => {
    const kind = action === 'accept' ? 'ins' : 'del';
    const part = load(
      `<w:p><w:pPr>${numbering}<w:rPr><w:${kind} w:author="Ada" w:id="1"/></w:rPr></w:pPr>${run}</w:p><w:p>${run}</w:p>`
    );
    const plan = planRevisionBatch(part, action);
    expect(plan.result.resolved).toHaveLength(1);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toContain(numbering);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
  });
  test(`${action}: formatting resolution preserves excluded live section revisions`, () => {
    const section =
      '<w:sectPr><w:sectPrChange w:author="Grace" w:id="2"><w:sectPr/></w:sectPrChange></w:sectPr>';
    const part = load(`<w:p><w:pPr>${section}${format}</w:pPr>${run}</w:p>`);
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.result.resolved).toHaveLength(1);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toContain(section);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
  });
  test(`${action}: formatting resolution preserves an excluded live paragraph mark`, () => {
    const mark = '<w:ins w:author="Grace" w:id="2"/>';
    const part = load(`<w:p><w:pPr><w:rPr>${mark}</w:rPr>${format}</w:pPr>${run}</w:p><w:p/>`);
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.result.resolved).toHaveLength(1);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toContain(mark);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
  });
  test(`${action}: deleting the last rows cannot consume an excluded table revision`, () => {
    const kind = action === 'accept' ? 'del' : 'ins';
    const row = (id: number) =>
      `<w:tr><w:trPr><w:${kind} w:author="Ada" w:id="${id}"/></w:trPr><w:tc><w:tcPr><w:cell${kind === 'ins' ? 'Ins' : 'Del'} w:author="Ada" w:id="${id}"/></w:tcPr><w:p>${run}</w:p></w:tc></w:tr>`;
    const part = load(
      `<w:tbl><w:tblPr><w:tblPrChange w:author="Grace" w:id="3"><w:tblPr/></w:tblPrChange></w:tblPr>${row(1)}${row(2)}</w:tbl><w:p/>`
    );
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.ops).toEqual([]);
    expect(plan.result.skipped).toHaveLength(2);
    // Removing only one row leaves the table and its pending properties intact.
    const key = reviewItemKey(revisionItemsOf(part).find((item) => item.author === 'Ada')!);
    const partial = planRevisionBatch(part, action, [key]);
    expect(partial.result.resolved).toHaveLength(1);
    const applied = applyTreeOp(part, partial.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toHaveLength(partial.result.remaining);
    expect(serializeOoxmlPart(applied.part)).toContain('w:tblPrChange');
  });
}
test('accepting paragraph formatting preserves unsupported numbering; rejecting still protects it', () => {
  const part = load(`<w:p><w:pPr>${numbering}${format}</w:pPr>${run}</w:p>`);
  const accept = planRevisionBatch(part, 'accept');
  expect(accept.result.resolved).toHaveLength(1);
  const applied = applyTreeOp(part, accept.ops[0]!);
  if (!applied.ok) throw new Error(applied.reason);
  expect(serializeOoxmlPart(applied.part)).toContain(numbering);
  expect(planRevisionBatch(part, 'reject').ops).toEqual([]);
});

for (const action of ['accept', 'reject'] as const) {
  for (const boundary of ['', '<w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt><w:p/>']) {
    test(`${action}: a paragraph mark at boundary ${boundary || 'end'} preserves properties`, () => {
      const kind = action === 'accept' ? 'del' : 'ins';
      const part = load(
        `<w:p><w:pPr>${numbering}<w:rPr><w:${kind} w:author="Ada" w:id="1"/></w:rPr></w:pPr>${run}</w:p>${boundary}`
      );
      const plan = planRevisionBatch(part, action);
      expect(plan.result.resolved).toHaveLength(1);
      const applied = applyTreeOp(part, plan.ops[0]!);
      if (!applied.ok) throw new Error(applied.reason);
      expect(serializeOoxmlPart(applied.part)).toContain(numbering);
      expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
    });
  }
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: a blocked row keeps the table alive without blocking another row`, () => {
    const kind = action === 'accept' ? 'del' : 'ins';
    const row = (id: number, properties = '') =>
      `<w:tr><w:trPr><w:${kind} w:author="Ada" w:id="${id}"/></w:trPr><w:tc><w:tcPr><w:cell${kind === 'ins' ? 'Ins' : 'Del'} w:author="Ada" w:id="${id}"/>${properties}</w:tcPr><w:p>${run}</w:p></w:tc></w:tr>`;
    const unsupported = '<w:cellMerge w:author="Grace" w:id="3" w:vMerge="invalid"/>';
    const part = load(`<w:tbl>${row(1)}${row(2, unsupported)}</w:tbl><w:p/>`);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.resolved).toHaveLength(1);
    expect(plan.result.skipped).toHaveLength(2);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
    expect(serializeOoxmlPart(applied.part)).toContain(unsupported);
  });
}
