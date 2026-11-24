import { expect, test } from 'bun:test';
import { collectRevisionSites } from '../store/tree-op-revisions.ts';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../index.ts';
import { wordCreatedTableAlignment } from './fixtures/word-created-table-alignment.ts';
const load = (body = wordCreatedTableAlignment) => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
};
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: native table alignment is one decision and restores implicit row alignment`, () => {
    let part = load();
    expect(revisionItemsOf(part)).toHaveLength(1);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(xml).not.toMatch(/<w:\w+Change\b/);
    expect([...xml.matchAll(/<w:jc\b[^>]*w:val="([^"]+)"/g)].map((m) => m[1])).toEqual(
      action === 'accept' ? ['center', 'center'] : []
    );
  });
}
for (const [name, alter] of [
  ['missing cell history', (s: string) => s.replace(/<w:tcPrChange\b.*?<\/w:tcPrChange>/, '')],
  ['other cell author', (s: string) => s.replace(/(<w:tcPrChange[^>]*w:author=")Ada/, '$1Grace')],
  ['independent row property', (s: string) => s.replace('<w:trPr>', '<w:trPr><w:cantSplit/>')],
  [
    'unknown alignment attribute',
    (s: string) => s.replace('<w:trPr><w:jc ', '<w:trPr><w:jc w:unknown="keep" '),
  ],
] as const) {
  test(`reject does not infer old row alignment with ${name}`, () => {
    const body = alter(wordCreatedTableAlignment);
    expect(body).not.toBe(wordCreatedTableAlignment);
    let part = load(body);
    for (const op of planRevisionBatch(part, 'reject').ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    expect(serializeOoxmlPart(part)).toMatch(/<w:trPr>.*?<w:jc/);
  });
}
test('rejecting implicit alignment checks locked cell descendants', () => {
  const body = wordCreatedTableAlignment
    .replace(
      '<w:p>',
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p>'
    )
    .replace('</w:p>', '</w:p></w:sdtContent></w:sdt>');
  const part = load(body);
  const plan = planRevisionBatch(part, 'reject');
  // The plan skips what the op's own guard would refuse, and the guard still refuses it.
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
  const siteNodeIds = collectRevisionSites(part).map((site) => site.node.id);
  expect(applyTreeOp(part, { op: 'rejectAllRevisions', siteNodeIds })).toMatchObject({
    ok: false,
    reason: 'locked',
  });
});

const standalone = `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:jc w:val="center"/><w:tblPrChange w:id="10" w:author="Ada"><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Content</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: standalone alignment is metadata and retains current formatting`, () => {
    const part = load(standalone);
    expect(revisionItemsOf(part)).toHaveLength(0);
    expect(planRevisionBatch(part, action, []).ops).toHaveLength(0);
    const plan = planRevisionBatch(part, action);
    expect(plan.result).toEqual({ resolved: [], skipped: [], remaining: 0 });
    expect(plan.ops).toHaveLength(1);
    const result = applyTreeOp(part, {
      op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
    });
    if (!result.ok) throw Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).not.toContain('tblPrChange');
    expect(xml).toContain('w:val="center"');
  });
}
for (const [name, body] of [
  ['missing author', standalone.replace(' w:author="Ada"', '')],
  ['unknown alignment attribute', standalone.replace('<w:jc ', '<w:jc w:unknown="keep" ')],
  [
    'cell formatting history',
    standalone.replace(
      '<w:tc><w:p>',
      '<w:tc><w:tcPr><w:shd w:val="clear" w:fill="FFFF00"/><w:tcPrChange w:id="12" w:author="Ada"><w:tcPr/></w:tcPrChange></w:tcPr><w:p>'
    ),
  ],
  [
    'shared identity outside the table',
    standalone +
      '<w:p><w:ins w:id="10" w:author="Ada"><w:r><w:t>Independent</w:t></w:r></w:ins></w:p>',
  ],
  ['a different table property', standalone.replace('<w:tblW w:w="4000"', '<w:tblW w:w="5000"')],
] as const) {
  test(`standalone ${name} stays visible`, () => {
    expect(revisionItemsOf(load(body)).length).toBeGreaterThan(0);
  });
}

// A row or text change elsewhere in the table is not formatting history of the table.
for (const [name, change] of [
  ['an inserted row', '<w:trPr><w:ins w:id="11" w:author="Ada"/></w:trPr>'],
  ['a deleted row', '<w:trPr><w:del w:id="11" w:author="Ada"/></w:trPr>'],
] as const)
  test(`standalone alignment beside ${name} stays metadata when the row is rejected`, () => {
    let part = load(
      standalone.replace(
        '</w:tbl>',
        `<w:tr>${change}<w:tc><w:p><w:r><w:t>Row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
      )
    );
    expect(revisionItemsOf(part).map((item) => item.revisionKind)).toEqual(['structural']);
    for (const op of planRevisionBatch(part, 'reject').ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(xml).not.toContain('tblPrChange');
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

// An inserted cell's own width history goes with the cell, not with the table's alignment.
test('rejecting an inserted cell with its own width history beside an alignment change', () => {
  const inserted =
    '<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:cellIns w:id="20" w:author="Ann"/>' +
    '<w:tcPrChange w:id="21" w:author="Ann"><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr></w:tcPrChange>' +
    '</w:tcPr><w:p><w:r><w:t>New</w:t></w:r></w:p></w:tc>';
  let part = load(standalone.replace('</w:tc></w:tr>', `</w:tc>${inserted}</w:tr>`));
  const cell = revisionItemsOf(part).find((item) => item.revisionKind === 'structural')!;
  expect(cell).toBeDefined();
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(cell)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  expect(serializeOoxmlPart(part)).not.toContain('>New<');
});

// Cell formatting history by another author and the alignment are one entry, named after the
// cell history's author.
test("the alignment and another author's cell shading are one card that rejects both", () => {
  let part = load(
    standalone.replace(
      '<w:tc><w:p>',
      '<w:tc><w:tcPr><w:shd w:val="clear" w:fill="FFFF00"/><w:tcPrChange w:id="12" w:author="Grace"><w:tcPr/></w:tcPrChange></w:tcPr><w:p>'
    )
  );
  const cards = revisionItemsOf(part);
  expect(cards.map((item) => [item.author, item.formattingKind])).toEqual([
    ['Grace', 'tblPrChange'],
  ]);
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(cards[0]!)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  const xml = serializeOoxmlPart(part);
  expect(revisionItemsOf(part)).toEqual([]);
  expect(xml).not.toMatch(/tblPrChange|w:shd|<w:jc w:val="center"/);
});
