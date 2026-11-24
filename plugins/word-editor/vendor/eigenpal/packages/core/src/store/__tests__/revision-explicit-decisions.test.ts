// One decision on a change that sits inside, beside, or across another change (fixes #1459).
// An explicit decision names the changes themselves: it takes the other half of a move or a
// vertical merge with it, and changes inside content it removes go along. A filtered
// selection, such as one author's changes, keeps the stricter rules in `revision-batch.test.ts`.
import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const DATE = '2026-10-01T10:00:00Z';
let nextId = 1;
const stamp = (author: string) => `w:id="${nextId++}" w:author="${author}" w:date="${DATE}"`;
const BOLD = '<w:b/><w:bCs/>';
const change = (author = 'Ada') => `<w:rPrChange ${stamp(author)}><w:rPr/></w:rPrChange>`;
const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const deleted = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (author: string, content: string) => `<w:ins ${stamp(author)}>${content}</w:ins>`;
const del = (author: string, content: string) => `<w:del ${stamp(author)}>${content}</w:del>`;
const deletedParagraph = (author: string, text: string, properties = '') =>
  `<w:p><w:pPr>${properties}<w:rPr><w:del ${stamp(author)}/></w:rPr></w:pPr>${del(author, deleted(text))}</w:p>`;
const plain = (text: string) => `<w:p>${run(text)}</w:p>`;
const cell = (content: string, properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${properties}</w:tcPr>${content}</w:tc>`;
const table = (...rows: string[]) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

function part(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Decide the first item of `kind` explicitly, apply it, and answer what stays pending. */
function decide(body: string, kind: string, action: 'accept' | 'reject') {
  const document = part(body);
  const target = revisionItemsOf(document).find((item) => item.revisionKind === kind)!;
  const plan = planRevisionBatch(document, action, [reviewItemKey(target)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  const applied = applyTreeOp(document, plan.ops[0]!);
  if (!applied.ok) throw new Error(applied.reason);
  return {
    pending: revisionItemsOf(applied.part).map((item) => item.revisionKind),
    xml: serializeOoxmlPart(applied.part),
  };
}

describe('formatting inside an insertion', () => {
  const body = `<w:p>${run('Hi', BOLD + change())}${ins('Grace', run('Hello', BOLD + change()))}</w:p>`;
  for (const action of ['accept', 'reject'] as const)
    test(`${action}: the grouped formatting resolves alone`, () => {
      expect(decide(body, 'format', action).pending).toEqual(['insert']);
    });
  for (const action of ['accept', 'reject'] as const)
    test(`${action}: the insertion resolves alone`, () => {
      const only = `<w:p>${ins('Grace', run('Hello', BOLD + change()))}</w:p>`;
      // Rejecting the insertion takes its text, and the formatting on it, away.
      expect(decide(only, 'insert', action).pending).toEqual(action === 'accept' ? ['format'] : []);
    });
});

describe('a filtered selection keeps nested changes together', () => {
  for (const action of ['accept', 'reject'] as const)
    test(`${action}: another author's formatting inside the selected change skips the group`, () => {
      const wrapper = action === 'accept' ? del : ins;
      const text = action === 'accept' ? deleted('Hello') : run('Hello');
      const document = part(
        `<w:p>${wrapper('Ada', text.replace('<w:r>', `<w:r><w:rPr>${BOLD}${change('Grace')}</w:rPr>`))}</w:p>`
      );
      const keys = revisionItemsOf(document)
        .filter((item) => item.author === 'Ada')
        .map(reviewItemKey);
      const plan = planRevisionBatch(document, action, keys);
      expect(plan.result.skipped.map((skip) => skip.reason)).toEqual(['incomplete-group']);
      expect(plan.swept).toBeUndefined();
    });
});

describe('changes inside removed content', () => {
  test('accepting a deleted paragraph takes another author’s paragraph change along', () => {
    const body =
      plain('Keep') +
      deletedParagraph(
        'Ada',
        'Gone',
        `<w:jc w:val="center"/><w:pPrChange ${stamp('Grace')}><w:pPr/></w:pPrChange>`
      ) +
      plain('After');
    const { pending, xml } = decide(body, 'delete', 'accept');
    expect(pending).toEqual([]);
    expect(xml).not.toContain('Gone');
  });

  test('accepting a deleted row takes another author’s insertion in it along', () => {
    const body =
      table(
        `<w:tr>${cell(plain('a'))}${cell(plain('b'))}</w:tr>`,
        `<w:tr><w:trPr><w:del ${stamp('Ada')}/></w:trPr>${cell(deletedParagraph('Ada', 'd1'))}` +
          cell(
            `<w:p><w:pPr><w:rPr><w:del ${stamp('Ada')}/></w:rPr></w:pPr>${del('Ada', deleted('d2 '))}${ins('Grace', run('new'))}</w:p>`
          ) +
          '</w:tr>'
      ) + plain('After');
    const { pending, xml } = decide(body, 'structural', 'accept');
    expect(pending).toEqual([]);
    expect(xml).not.toMatch(/d1|new/);
  });

  test('accepting a deleted cell resolves its text deletion with it', () => {
    const row = (text: string) =>
      `<w:tr>${cell(plain('keep'))}${cell(deletedParagraph('Ada', text), `<w:cellDel ${stamp('Ada')}/>`)}</w:tr>`;
    const document = part(table(row('x'), row('y')) + plain('After'));
    const structural = revisionItemsOf(document).filter(
      (item) => item.revisionKind === 'structural'
    );
    const plan = planRevisionBatch(document, 'accept', [reviewItemKey(structural[0]!)], undefined, {
      explicit: true,
    });
    expect(plan.result.skipped).toEqual([]);
  });
});

describe('changes that resolve in pairs', () => {
  test('a decision on one half of a move decides the move', () => {
    const half = (kind: 'moveFrom' | 'moveTo', id: number, author: string) =>
      `<w:p><w:${kind}RangeStart w:id="${id}" w:name="move"/><w:${kind} w:id="${id + 1}" w:author="${author}">${run('moved')}</w:${kind}><w:${kind}RangeEnd w:id="${id}"/></w:p>`;
    const { pending, xml } = decide(
      half('moveFrom', 90, 'Ada') + half('moveTo', 92, 'Grace'),
      'moveFrom',
      'accept'
    );
    expect(pending).toEqual([]);
    expect(xml.match(/moved/g)).toHaveLength(1);
  });

  for (const action of ['accept', 'reject'] as const)
    test(`${action}: a decision on one half of a vertical merge decides the merge`, () => {
      const merge = (value: 'rest' | 'cont', text: string) =>
        `<w:tr>${cell(plain(text), `<w:cellMerge ${stamp('Ada')} w:vMerge="${value}"/>`)}${cell(plain('b'))}</w:tr>`;
      const { pending } = decide(
        table(merge('rest', 'top'), merge('cont', 'below')) + plain('After'),
        'structural',
        action
      );
      expect(pending).toEqual([]);
    });
});

test('a skipped removal reports nothing it would have taken along', () => {
  // A deletion with no author cannot be resolved, so the change inside it stays pending.
  const document = part(
    `<w:p><w:del w:id="${nextId++}" w:date="${DATE}">` +
      deleted('Hello').replace('<w:r>', `<w:r><w:rPr>${BOLD}${change('Grace')}</w:rPr>`) +
      '</w:del></w:p>'
  );
  const deletion = revisionItemsOf(document).find((item) => item.revisionKind === 'delete')!;
  const plan = planRevisionBatch(document, 'accept', [reviewItemKey(deletion)], undefined, {
    explicit: true,
  });
  expect(plan.result.resolved).toEqual([]);
  expect(plan.result.skipped.map((skip) => skip.reason)).toEqual(['unsupported-revision']);
  expect(plan.swept).toBeUndefined();
});

test('rejecting a paragraph formatting change takes the changes inside the replaced properties', () => {
  const document = part(
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/><w:ins ${stamp('Grace')}/></w:numPr>` +
      `<w:jc w:val="center"/><w:pPrChange ${stamp('Ada')}><w:pPr/></w:pPrChange></w:pPr>` +
      run('Item') +
      '</w:p>'
  );
  const format = revisionItemsOf(document).find((item) => item.author === 'Ada')!;
  const plan = planRevisionBatch(document, 'reject', [reviewItemKey(format)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  expect(plan.result.resolved.map((entry) => entry.author).sort()).toEqual(['Ada', 'Grace']);
  // A filtered selection keeps the other author's change and skips instead.
  const filtered = planRevisionBatch(document, 'reject', [reviewItemKey(format)]);
  expect(filtered.result.skipped.map((skip) => skip.reason)).toEqual(['incomplete-group']);
});

test("deleting every cell of a row takes the row and another author's row change along", () => {
  const deletedCell = (text: string) => cell(plain(text), `<w:cellDel ${stamp('Ada')}/>`);
  const document = part(
    table(
      `<w:tr>${cell(plain('keep'))}${cell(plain('keep'))}</w:tr>`,
      `<w:tr><w:trPr><w:ins ${stamp('Bob')}/></w:trPr>${deletedCell('a')}${deletedCell('b')}</w:tr>`
    ) + plain('After')
  );
  const ada = revisionItemsOf(document)
    .filter((item) => item.author === 'Ada')
    .map(reviewItemKey);
  const explicit = planRevisionBatch(document, 'accept', ada, undefined, { explicit: true });
  expect(explicit.result.skipped).toEqual([]);
  expect(explicit.result.resolved.some((entry) => entry.author === 'Bob')).toBe(true);
  // A filtered selection keeps Bob's change and skips instead.
  const filtered = planRevisionBatch(document, 'accept', ada);
  expect(filtered.result.skipped.map((skip) => skip.reason)).toContain('incomplete-group');
  expect(filtered.result.resolved.some((entry) => entry.author === 'Bob')).toBe(false);
});

test.each([
  ['accept', 'cellDel'],
  ['reject', 'cellIns'],
] as const)('%s decides one %s alone when a neighbour cell has its own', (action, marker) => {
  // Each cell's text carries the change too, as a cell change records it.
  const content = (text: string) =>
    `<w:p>${marker === 'cellDel' ? del('Ada', deleted(text)) : ins('Ada', run(text))}</w:p>`;
  const changed = (text: string) => cell(content(text), `<w:${marker} ${stamp('Ada')}/>`);
  const document = part(table(`<w:tr>${changed('a')}${changed('b')}</w:tr>`) + plain('After'));
  const cells = revisionItemsOf(document).filter((item) => item.revisionKind === 'structural');
  expect(cells).toHaveLength(2);
  const plan = planRevisionBatch(document, action, [reviewItemKey(cells[0]!)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  const applied = applyTreeOp(document, plan.ops[0]!);
  if (!applied.ok) throw new Error(applied.reason);
  const left = revisionItemsOf(applied.part).filter((item) => item.revisionKind === 'structural');
  expect(left).toHaveLength(1);
});

test("removing one half of another author's move refuses rather than orphan the other half", () => {
  const half = (kind: 'moveFrom' | 'moveTo', id: number) =>
    `<w:p><w:${kind}RangeStart w:id="${id}" w:name="move"/><w:${kind} w:id="${id + 1}" w:author="Grace">${run('moved')}</w:${kind}><w:${kind}RangeEnd w:id="${id}"/></w:p>`;
  // Ada deletes a row whose cell holds the origin of Grace's move.
  const document = part(
    table(
      `<w:tr>${cell(plain('keep'))}${cell(plain('keep'))}</w:tr>`,
      `<w:tr><w:trPr><w:del ${stamp('Ada')}/></w:trPr>${cell(half('moveFrom', 90))}${cell(plain('x'))}</w:tr>`
    ) +
      half('moveTo', 92) +
      plain('After')
  );
  const row = revisionItemsOf(document).find(
    (item) => item.revisionKind === 'structural' && item.author === 'Ada'
  )!;
  const plan = planRevisionBatch(document, 'accept', [reviewItemKey(row)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([
    expect.objectContaining({ reason: 'incomplete-group', detail: 'paired-change' }),
  ]);
  expect(plan.ops).toEqual([]);
});
