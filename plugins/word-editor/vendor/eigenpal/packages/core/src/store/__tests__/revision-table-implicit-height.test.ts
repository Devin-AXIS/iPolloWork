import { collectRevisionSites } from '../store/tree-op-revisions.ts';
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../index.ts';
import {
  wordCreatedNewRowHeight,
  wordCreatedExistingRowHeight,
} from './fixtures/word-created-row-height.ts';
const load = (body: string) => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
};
const resolve = (body: string, action: 'accept' | 'reject') => {
  let part = load(body);
  const plan = planRevisionBatch(part, action);
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const r = applyTreeOp(part, op);
    if (!r.ok) throw Error(r.reason);
    part = r.part;
  }
  return serializeOoxmlPart(part);
};
for (const action of ['accept', 'reject'] as const) {
  for (const [name, body, old] of [
    ['absent', wordCreatedNewRowHeight, undefined],
    ['existing', wordCreatedExistingRowHeight, '400'],
  ] as const) {
    test(`${action}: Word-created height restores ${name} prior row properties`, () => {
      expect(revisionItemsOf(load(body))).toHaveLength(1);
      const xml = resolve(body, action);
      expect(xml).not.toMatch(/<w:\w+Change\b/);
      expect([...xml.matchAll(/<w:trHeight[^>]*w:val="(\d+)"/g)].map((m) => m[1])).toEqual(
        action === 'accept' ? ['800'] : old ? [old] : []
      );
    });
  }
}
for (const [name, alter] of [
  [
    'missing table history',
    (s: string) => s.replace(/<w:tblPrChange\b[^>]*>.*?<\/w:tblPrChange>/, ''),
  ],
  [
    'missing grid history',
    (s: string) => s.replace(/<w:tblGridChange\b[^>]*>.*?<\/w:tblGridChange>/, ''),
  ],
  [
    'missing cell history',
    (s: string) => s.replace(/<w:tcPrChange\b[^>]*>.*?<\/w:tcPrChange>/, ''),
  ],
  [
    'independent row property',
    (s: string) =>
      s.replace('<w:trHeight w:val="800" />', '<w:trHeight w:val="800" /><w:cantSplit/>'),
  ],
  [
    'unknown height metadata',
    (s: string) =>
      s.replace('<w:trHeight w:val="800" />', '<w:trHeight w:val="800" w:unknown="keep" />'),
  ],
  [
    'different cell author',
    (s: string) => s.replace(/(<w:tcPrChange\b[^>]*w:author=")Ada/, '$1Grace'),
  ],
] as const)
  test(`reject: ${name} does not imply an absent old height`, () => {
    const body = alter(wordCreatedNewRowHeight);
    expect(body).not.toBe(wordCreatedNewRowHeight);
    expect(resolve(body, 'reject')).toContain('<w:trHeight');
  });
test('a locked containing control keeps implicit row restoration pending', () => {
  const part = load(
    `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${wordCreatedNewRowHeight}</w:sdtContent></w:sdt>`
  );
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped.every((entry) => entry.detail === 'locked-content')).toBe(true);
});

test('implicit row restoration checks locked descendants outside the property snapshots', () => {
  const paragraph = wordCreatedNewRowHeight.match(/<w:p>.*?<\/w:p>/)![0];
  const body = wordCreatedNewRowHeight.replace(
    paragraph,
    `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${paragraph}</w:sdtContent></w:sdt>`
  );
  const part = load(body);
  // The plan skips what the op's own guard would refuse, and the guard still refuses it.
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
  const siteNodeIds = collectRevisionSites(part).map((site) => site.node.id);
  expect(applyTreeOp(part, { op: 'rejectAllRevisions', siteNodeIds })).toMatchObject({
    ok: false,
    reason: 'locked',
  });
});

test('an explicit partial cell-history operation does not reset the row height', () => {
  const part = load(wordCreatedNewRowHeight);
  const site = collectRevisionSites(part).find((site) => site.node.localName === 'tcPrChange')!;
  const result = applyTreeOp(part, { op: 'rejectAllRevisions', siteNodeIds: [site.node.id] });
  if (!result.ok) throw Error(result.reason);
  expect(serializeOoxmlPart(result.part)).toContain('<w:trHeight');
});
