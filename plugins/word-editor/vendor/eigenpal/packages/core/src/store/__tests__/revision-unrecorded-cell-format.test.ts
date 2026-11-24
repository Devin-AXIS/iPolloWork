import { expect, test } from 'bun:test';
import { collectRevisionSites } from '../store/tree-op-revisions.ts';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';
function load(name: string, alter = (xml: string) => xml) {
  const fixture = reviewTableGroupingCases.find((c) => c.name === name)!;
  const result = readOoxmlPart(alter(reviewTableGroupingParts(fixture)['word/document.xml']!), {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}
function resolve(part: ReturnType<typeof load>, action: 'accept' | 'reject', keys?: string[]) {
  for (const op of planRevisionBatch(part, action, keys).ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return serializeOoxmlPart(part);
}
// Independently confirmed with Word's single-revision and document-wide Reject commands.
test('reject restores unrecorded neighbour formatting to auto width', () => {
  const part = load('format-one-cell');
  const xml = resolve(part, 'reject');
  expect(xml.match(/<w:tcW\b[^>]*>/g)).toEqual([
    '<w:tcW w:type="dxa" w:w="2000"/>',
    '<w:tcW w:type="auto" w:w="0"/>',
  ]);
  expect(xml).not.toContain('w:shd');
  expect(resolve(part, 'accept').match(/w:type="dxa" w:w="2000"/g)).toHaveLength(2);
});
test('reject clears unrecorded shading, alignment, margins and wrapping', () => {
  const part = load('format-one-cell', (xml) => {
    const cells = xml.split('<w:tc>');
    cells[2] = cells[2]!.replace(
      '</w:tcPr>',
      '<w:shd w:fill="FF0000"/><w:vAlign w:val="center"/><w:noWrap/><w:tcMar><w:left w:w="240" w:type="dxa"/></w:tcMar></w:tcPr>'
    );
    return cells.join('<w:tc>');
  });
  const xml = resolve(part, 'reject');
  expect(xml).not.toMatch(/w:(shd|vAlign|noWrap|tcMar)\b/);
});
test('rejecting one author preserves independently recorded cell formatting', () => {
  const part = load('format-cell-authors');
  const result = applyTreeOp(part, {
    op: 'rejectRevision',
    revision: revisionItemsOf(part)[0]!.address,
  });
  if (!result.ok) throw Error(result.reason);
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('w:author="Bob"');
  expect(xml).not.toContain('w:type="auto"');
});
test('rejecting one row does not reset cells in other rows', () => {
  const part = load('format-row-authors');
  const key = reviewItemKey(revisionItemsOf(part).find((r) => r.author === 'Ada')!);
  const xml = resolve(part, 'reject', [key]);
  expect(xml.match(/w:type="auto" w:w="0"/g)).toHaveLength(2);
  expect(xml.match(/w:type="dxa" w:w="2000"/g)).toHaveLength(2);
  expect(xml).toContain('w:author="Bob"');
});
test('unrecorded cell restoration checks protected neighbours', () => {
  const part = load('format-one-cell', (xml) =>
    xml.replace(
      '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>B</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    )
  );
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

for (const fixed of [false, true]) {
  test(`empty row snapshots reconstruct the old grid (${fixed ? 'fixed' : 'autofit'})`, () => {
    const part = load('format-separated-rows', (xml) =>
      fixed ? xml.replace('</w:tblPr>', '<w:tblLayout w:type="fixed"/></w:tblPr>') : xml
    );
    const xml = resolve(part, 'reject');
    // Word's fixed-layout result records these exact boundaries. Autofit recomputes
    // the displayed widths on reopening, retaining the same omitted trailing space.
    expect(xml.match(/<w:gridCol w:w="(\d+)"\/>/g)).toEqual(
      [360, 360, 1280, 2000].map((w) => `<w:gridCol w:w="${w}"/>`)
    );
    expect(xml.match(/<w:gridAfter w:val="2"\/>/g)).toHaveLength(2);
    expect(xml.match(/<w:wAfter w:type="dxa" w:w="3280"\/>/g)).toHaveLength(2);
    expect(xml.match(/<w:gridSpan w:val="3"\/>/g)).toHaveLength(1);
    expect(
      xml.match(fixed ? /<w:tcW w:type="dxa" w:w="360"\/>/g : /<w:tcW w:type="auto" w:w="0"\/>/g)
    ).toHaveLength(4);
  });
}
test('implicit grid restoration checks protected cells in unchanged rows', () => {
  const part = load('format-separated-rows', (xml) =>
    xml.replace(
      '<w:p><w:r><w:t>Existing A</w:t></w:r></w:p>',
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Existing A</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    )
  );
  const plan = planRevisionBatch(part, 'reject');
  // The plan skips what the op's own guard would refuse, and the guard still refuses it.
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped.map((skip) => skip.detail)).toEqual([
    'locked-content',
    'locked-content',
  ]);
  const siteNodeIds = collectRevisionSites(part).map((site) => site.node.id);
  expect(applyTreeOp(part, { op: 'rejectAllRevisions', siteNodeIds })).toMatchObject({
    ok: false,
    reason: 'locked',
  });
});
test('explicit old grids retain priority over inferred row geometry', () => {
  const part = load('format-separated-rows', (xml) =>
    xml.replace(
      '</w:tblGrid>',
      '<w:tblGridChange w:id="10001" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="2200"/></w:tblGrid></w:tblGridChange></w:tblGrid>'
    )
  );
  const xml = resolve(part, 'reject');
  expect(xml).not.toContain('w:gridAfter');
  expect(xml).toContain('<w:gridCol w:w="1800"/>');
  expect(xml).toContain('<w:gridCol w:w="2200"/>');
});
test('unrecorded cell defaults retain unknown extension payloads', () => {
  const part = load('format-one-cell', (xml) => {
    const cells = xml.split('<w:tc>');
    cells[2] = cells[2]!.replace(
      '</w:tcPr>',
      '<w:shd xmlns:custom="urn:audit" w:fill="FF0000" custom:payload="keep"/><custom:metadata xmlns:custom="urn:audit"/></w:tcPr>'
    );
    return cells.join('<w:tc>');
  });
  const xml = resolve(part, 'reject');
  expect(xml).toContain('custom:payload="keep"');
  expect(xml).toContain('custom:metadata');
});
