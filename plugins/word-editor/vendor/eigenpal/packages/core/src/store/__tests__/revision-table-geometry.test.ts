import { expect, test } from 'bun:test';
import { collectRevisionSites } from '../store/tree-op-revisions.ts';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { createNodeIdAllocator, findNode, nodeIndexTestRecorder } from '../package/ooxml-edit.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const marker = (name: string, id = 1, extra = '') =>
  `<w:${name} w:id="${id}" w:author="Ada" ${extra}/>`;
const cell = (text: string, width = 2000, pr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${pr}</w:tcPr>${p(text)}</w:tc>`;
const row = (cells: string, pr = '') => `<w:tr><w:trPr>${pr}</w:trPr>${cells}</w:tr>`;
const table = (rows: string, widths = [1000, 2000, 3000]) =>
  `<w:tbl><w:tblPr/><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
function load(body: string) {
  const r = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!r.ok) throw Error(r.reason);
  return r.part;
}
function resolve(body: string, action: 'accept' | 'reject') {
  const part = load(body),
    batch = planRevisionBatch(part, action);
  expect(batch.result.skipped).toEqual([]);
  const result = applyTreeOp(part, batch.ops[0]!);
  if (!result.ok) throw Error(result.reason);
  expect(revisionItemsOf(result.part)).toHaveLength(batch.result.remaining);
  const xml = serializeOoxmlPart(result.part);
  const parsed = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
  if (!parsed.ok) throw Error(parsed.reason);
  expect(revisionItemsOf(parsed.part)).toHaveLength(batch.result.remaining);
  return xml;
}
for (const action of ['accept', 'reject'] as const) {
  const name = action === 'accept' ? 'cellDel' : 'cellIns';
  for (const position of [0, 1, 2])
    for (const wholeColumn of [false, true]) {
      test(`${action}: ${wholeColumn ? 'column' : 'cell'} ${position} transfers width and compacts unused grid boundaries`, () => {
        const cells = (tracked: boolean) =>
          [1000, 2000, 3000]
            .map((width, i) =>
              cell(`c${i}`, width, tracked && i === position ? marker(name, i + 1) : '')
            )
            .join('');
        const xml = resolve(table(row(cells(true)) + row(cells(wholeColumn))), action);
        const rows = xml.match(/<w:tr>.*?<\/w:tr>/g)!;
        const widths = position === 2 ? [1000, 5000] : [3000, 3000];
        expect([...rows[0]!.matchAll(/<w:tcW[^>]*w:w="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(
          widths
        );
        expect(rows[0]).not.toContain(`>${'c' + position}<`);
        expect(xml.match(/<w:gridCol\b/g)).toHaveLength(wholeColumn ? 2 : 3);
        expect(rows[0]!.includes('gridSpan')).toBe(!wholeColumn);
      });
    }
  test(`${action}: a continuation merge clears its content and protects an excluded revision`, () => {
    const attrs = action === 'accept' ? 'w:vMerge="cont"' : 'w:vMergeOrig="cont"';
    const tracked = cell('hidden', 2000, marker('cellMerge', 1, attrs)).replace(
      p('hidden'),
      '<w:p><w:ins w:id="2" w:author="Grace"><w:r><w:t>hidden</w:t></w:r></w:ins></w:p>'
    );
    const body = table(
      row(cell('top', 2000, '<w:vMerge w:val="restart"/>')) + row(tracked),
      [2000]
    );
    const part = load(body);
    const keys = revisionItemsOf(part)
      .filter((i) => i.author === 'Ada')
      .map(reviewItemKey);
    const selected = planRevisionBatch(part, action, keys);
    expect(selected.ops).toEqual([]);
    expect(selected.result.skipped[0]?.reason).toBe('incomplete-group');
    const xml = resolve(body, action);
    expect(xml).toContain('top');
    expect(xml).not.toContain('hidden');
  });
  test(`${action}: named orphan move destinations remain, matching Word`, () => {
    const xml = resolve(
      `<w:p><w:pPr><w:rPr>${marker('moveTo')}</w:rPr></w:pPr><w:moveToRangeStart w:id="7" w:author="Ada" w:name="orphan"/><w:moveTo w:id="1" w:author="Ada"><w:r><w:t>destination</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="7"/></w:p>${p('next')}`,
      action
    );
    expect(xml).not.toContain('moveTo');
    expect(xml).toContain('destination');
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
  });
  test(`${action}: removing the merge head makes the surviving cell independent`, () => {
    const xml = resolve(
      table(
        row(
          cell('head', 2000, '<w:vMerge w:val="restart"/>'),
          marker(action === 'accept' ? 'del' : 'ins')
        ) + row(cell('survivor', 2000, '<w:vMerge/>')),
        [2000]
      ),
      action
    );
    expect(xml).not.toContain('vMerge');
    expect(xml).toContain('survivor');
  });
}
test('rejecting a cell insertion and its neighbour properties restores the recorded width once', () => {
  const prior =
    '<w:tcPrChange w:id="2" w:author="Ada"><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr></w:tcPrChange>';
  const xml = resolve(
    table(
      row(
        cell('old', 1000, prior) + cell('inserted', 2000, marker('cellIns')) + cell('other', 3000)
      )
    ),
    'reject'
  );
  expect(xml).not.toContain('inserted');
  expect(xml).toContain('w:w="3000"');
  expect(xml).not.toContain('w:w="5000"');
});

for (const action of ['accept', 'reject'] as const) {
  const removed = action === 'accept' ? 'del' : 'ins';
  const cellMarker = action === 'accept' ? 'cellDel' : 'cellIns';
  const sdt = (content: string) =>
    `<w:sdt><w:sdtPr/><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  test(`${action}: wrapped rows and cells preserve surviving controls`, () => {
    const body = table(
      sdt(row(cell('gone'), marker(removed))) +
        row(sdt(cell('left')) + sdt(cell('gone', 2000, marker(cellMarker, 2))))
    );
    const xml = resolve(body, action);
    expect(xml).not.toContain('gone');
    expect(xml).toContain('left');
    expect(xml.match(/<w:sdt>/g)).toHaveLength(1);
    expect(xml).toContain('w:w="4000"');
  });
  test(`${action}: duplicated property histories refuse atomically`, () => {
    const pr = '<w:tcPrChange w:id="1" w:author="Ada"><w:tcPr/></w:tcPrChange>';
    const part = load(table(row(cell('keep', 2000, pr + pr))));
    const before = serializeOoxmlPart(part);
    const batch = planRevisionBatch(part, action);
    expect(batch.ops).toEqual([]);
    expect(batch.result.skipped[0]?.reason).toBe('unsupported-revision');
    expect(serializeOoxmlPart(part)).toBe(before);
  });
  test(`${action}: a merge cannot clear a locked descendant control`, () => {
    const attrs = action === 'accept' ? 'w:vMerge="cont"' : 'w:vMergeOrig="cont"';
    const locked =
      '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>' +
      p('protected') +
      '</w:sdtContent></w:sdt>';
    const body = table(
      row(cell('head', 2000, '<w:vMerge w:val="restart"/>')) +
        row(cell('replace', 2000, marker('cellMerge', 1, attrs)).replace(p('replace'), locked)),
      [2000]
    );
    const part = load(body);
    const batch = planRevisionBatch(part, action);
    expect(batch.ops).toEqual([]);
    expect(batch.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
    const siteNodeIds = collectRevisionSites(part).map((site) => site.node.id);
    const op = action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions';
    expect(applyTreeOp(part, { op, siteNodeIds }).ok).toBe(false);
    expect(serializeOoxmlPart(part)).toContain('protected');
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: pending merge heads cannot be omitted from a selected continuation decision`, () => {
    const current = action === 'accept' ? 'w:vMerge' : 'w:vMergeOrig';
    const part = load(
      table(
        row(cell('top', 2000, marker('cellMerge', 1, `${current}="rest"`))) +
          row(cell('bottom', 2000, marker('cellMerge', 2, `${current}="cont"`))),
        [2000]
      )
    );
    const continuation = revisionItemsOf(part)[1]!;
    const selected = planRevisionBatch(part, action, [reviewItemKey(continuation)]);
    expect(selected.ops).toEqual([]);
    expect(selected.result.skipped[0]?.reason).toBe('incomplete-group');
    const direct = applyTreeOp(part, {
      op: action === 'accept' ? 'acceptRevision' : 'rejectRevision',
      revision: continuation.address,
    });
    expect(direct.ok).toBe(false);
  });
  test(`${action}: deleting a merge head preserves a surviving multi-row merge`, () => {
    const xml = resolve(
      table(
        row(
          cell('head', 2000, '<w:vMerge w:val="restart"/>'),
          marker(action === 'accept' ? 'del' : 'ins')
        ) +
          row(cell('next', 2000, '<w:vMerge/>')) +
          row(cell('', 2000, '<w:vMerge/>')),
        [2000]
      ),
      action
    );
    expect(xml).toContain('w:val="restart"');
    expect(xml.match(/<w:vMerge/g)).toHaveLength(2);
  });
  test(`${action}: deleting a merge head keeps nonempty legacy continuations visible`, () => {
    const xml = resolve(
      table(
        row(
          cell('head', 2000, '<w:vMerge w:val="restart"/>'),
          marker(action === 'accept' ? 'del' : 'ins')
        ) +
          row(cell('next', 2000, '<w:vMerge/>')) +
          row(cell('visible', 2000, '<w:vMerge/>')),
        [2000]
      ),
      action
    );
    expect(xml).toContain('visible');
    expect(xml.match(/<w:vMerge/g)).toHaveLength(1);
  });
  test(`${action}: cell deletion cannot change a neighbour inside a locked cell control`, () => {
    const body = table(
      row(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          cell('protected') +
          '</w:sdtContent></w:sdt>' +
          cell('gone', 2000, marker(action === 'accept' ? 'cellDel' : 'cellIns'))
      ),
      [2000, 2000]
    );
    const part = load(body);
    const before = serializeOoxmlPart(part);
    const batch = planRevisionBatch(part, action);
    expect(batch.ops).toEqual([]);
    expect(batch.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
    const siteNodeIds = collectRevisionSites(part).map((site) => site.node.id);
    const op = action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions';
    expect(applyTreeOp(part, { op, siteNodeIds }).ok).toBe(false);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
}

test('accepting a horizontal merge does not expand an already combined span twice', () => {
  const pr =
    '<w:gridSpan w:val="2"/><w:tcPrChange w:id="2" w:author="Ada"><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr></w:tcPrChange>';
  const xml = resolve(
    table(row(cell('combined', 4000, pr) + cell('deleted', 2000, marker('cellDel'))), [2000, 2000]),
    'accept'
  );
  expect(xml).not.toContain('deleted');
  expect(xml).not.toContain('6000');
  expect(xml.match(/<w:gridCol/g)).toHaveLength(1);
  expect(xml).toContain('w:w="4000"');
});

test('partial planning preserves the original node index and allocator state', () => {
  const body =
    table(
      row(cell('top', 2000, '<w:vMerge w:val="restart"/>')) +
        row(cell('hidden', 2000, marker('cellMerge', 1, 'w:vMerge="cont"'))),
      [2000]
    ) + '<w:p><w:ins w:id="8" w:author="Grace"><w:r><w:t>pending</w:t></w:r></w:ins></w:p>';
  const part = load(body);
  const original = serializeOoxmlPart(part);
  findNode(part, part.root.id);
  const recorder = nodeIndexTestRecorder();
  const key = reviewItemKey(revisionItemsOf(part).find((item) => item.author === 'Ada')!);
  const first = planRevisionBatch(part, 'accept', [key]);
  const second = planRevisionBatch(part, 'accept', [key]);
  recorder.reset();
  findNode(part, part.root.id);
  expect(recorder.completeBuilds).toBe(0);
  expect(createNodeIdAllocator(part)()).toBe(createNodeIdAllocator(load(body))());
  const applied = applyTreeOp(part, first.ops[0]!);
  if (!applied.ok) throw Error(applied.reason);
  expect(serializeOoxmlPart(applied.part)).not.toContain('hidden');
  expect(first).toEqual(second);
  expect(first.result.remaining).toBe(1);
  expect(first.result.skipped).toEqual([]);
  expect(serializeOoxmlPart(part)).toBe(original);
});
