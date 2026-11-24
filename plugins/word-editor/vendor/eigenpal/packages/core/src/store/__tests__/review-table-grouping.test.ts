import wordBulkReferences from './fixtures/word-bulk-content-reference.json';
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  planRevisionBatch,
  serializeOoxmlPart,
} from '../index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';

// Counts recorded from native Microsoft Word's Reviewing Pane, 2026-09-18.
const wordCounts: Record<string, number> = {
  'one-row-ins': 1,
  'one-row-del': 1,
  'two-rows-ins': 1,
  'two-rows-del': 1,
  'paragraph-marks-ins': 1,
  'paragraph-marks-del': 1,
  'separated-rows-ins': 2,
  'separated-rows-del': 2,
  'different-row-authors-ins': 2,
  'different-row-authors-del': 2,
  'different-row-dates-ins': 1,
  'different-row-dates-del': 1,
  'plain-row-text-ins': 1,
  'plain-row-text-del': 1,
  'different-text-author-ins': 1,
  'different-text-author-del': 1,
  'different-text-date-ins': 1,
  'different-text-date-del': 1,
  'cell-markers-ins': 4,
  'cell-markers-del': 4,
  'row-and-cell-markers-ins': 3,
  'row-and-cell-markers-del': 3,
  'untracked-row-inserted-text': 2,
  'row-insert-with-deletion': 2,
  'row-insert-with-format': 2,
  'adjacent-tables': 2,
  'nested-table-ins': 3,
  'nested-table-del': 3,
  'nested-only-ins': 3,
  'nested-only-del': 3,
  'nested-other-author-ins': 4,
  'nested-other-author-del': 4,
  'nested-plain-ins': 1,
  'nested-plain-del': 1,
  'row-opposite-text-ins': 2,
  'row-opposite-text-del': 2,
  'format-adjacent-cells': 1,
  'format-cell-authors': 1,
  'format-cell-dates': 1,
  'format-adjacent-rows': 1,
  'format-row-authors': 2,
  'format-separated-rows': 2,
  'format-nested-cells': 2,
  'format-grid-and-cells': 1,
  'format-grid-with-gap': 2,
  'format-grid-row-authors': 2,
  'format-row-and-cells': 1,
  'format-row-exceptions': 1,
  'row-insert-with-inserted-format': 2,
  'adjacent-identical-format': 1,
  'separated-identical-format': 2,
  'inserted-format-outside-table': 2,
  'row-insert-with-paragraph-format': 2,
  'row-multiple-paragraphs-ins': 1,
  'row-multiple-paragraphs-del': 1,
  'format-one-cell': 1,
  'format-table-property': 0,
  'format-grid-only': 0,
  'format-separate-tables': 2,
  'adjacent-format-authors': 2,
  'adjacent-format-dates': 1,
  'adjacent-format-different-current': 2,
  'adjacent-format-different-previous': 2,
  'adjacent-format-different-baseline': 1,
  'format-across-paragraphs': 2,
  'format-across-cells': 2,
  'nested-opposite-row-ins': 4,
  'nested-opposite-row-del': 4,
  'nested-partial-rows-ins': 6,
  'nested-partial-rows-del': 6,
  'nested-deep-ins': 5,
  'nested-deep-del': 5,
  'nested-two-rows-ins': 5,
  'nested-last-unchanged-ins': 4,
  'nested-only-two-rows-ins': 5,
  'nested-two-tables-ins': 5,
  'nested-following-gap-ins': 4,
  'nested-following-gap-del': 4,
  'move-range-insertion': 2,
  'move-range-deletion': 2,
  'move-range-pair': 4,
  'move-range-multiple-insertions': 2,
  'move-wrapper-destination': 1,
  'move-range-wrapper-destination': 2,
  'move-range-wrapper-pair': 2,
  'word-created-nested-row-ins': 1,
  'word-created-nested-row-del': 1,
  'word-created-table-width': 1,
  'word-created-row-height': 1,
  'word-created-table-alignment': 1,
};
function fixture(name: string) {
  const c = reviewTableGroupingCases.find((c) => c.name === name)!;
  const read = readOoxmlPart(reviewTableGroupingParts(c)['word/document.xml']!, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error('Invalid fixture');
  return read.part;
}
for (const action of ['accept', 'reject'] as const) {
  test(`${action} a complete nested row leaves a following independent insertion pending`, () => {
    const source = reviewTableGroupingCases.find(
      (entry) => entry.name === 'word-created-nested-row-ins'
    )!;
    const body = source.body.replace(
      '<w:r><w:t>First A</w:t></w:r>',
      '<w:ins w:id="99" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:r><w:t>First A</w:t></w:r></w:ins>'
    );
    expect(body).not.toBe(source.body);
    const parsed = readOoxmlPart(
      reviewTableGroupingParts({ name: 'following-insertion', body })['word/document.xml']!,
      {
        name: '/word/document.xml',
        contentType: 'application/xml',
      }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    let part = parsed.part;
    const group = revisionItemsOf(part).find((item) => item.revisionKind === 'structural')!;
    const plan = planRevisionBatch(part, action, [reviewItemKey(group)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part).map((item) => [item.address.id, item.text])).toEqual([
      ['99', 'First A'],
    ]);
  });
  test(`${action} a Word-created nested row deletion preserves the other rows`, () => {
    let part = fixture('word-created-nested-row-del');
    const items = revisionItemsOf(part);
    expect(items).toHaveLength(1);
    expect(items[0]!.addresses.map((address) => address.id).sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    const plan = planRevisionBatch(part, action, [reviewItemKey(items[0]!)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(revisionItemsOf(part)).toEqual([]);
    expect(xml).not.toMatch(/<w:(?:ins|del)\b/);
    expect(xml.match(/<w:tr[\s>]/g)).toHaveLength(action === 'accept' ? 2 : 3);
    expect(xml.includes('First A')).toBe(action === 'reject');
    expect(xml.includes('First B')).toBe(action === 'reject');
    for (const text of ['Second A', 'Second B', 'Outer', 'Neighbour']) expect(xml).toContain(text);
  });
  test(`${action} a Word-created nested row includes its cell paragraphs and text`, () => {
    let part = fixture('word-created-nested-row-ins');
    const items = revisionItemsOf(part);
    expect(items).toHaveLength(1);
    expect(items[0]!.addresses.map((address) => address.id).sort()).toEqual(['0', '1', '2', '3']);
    const plan = planRevisionBatch(part, action, [reviewItemKey(items[0]!)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(revisionItemsOf(part)).toEqual([]);
    expect(xml).not.toMatch(/<w:(?:ins|del)\b/);
    expect(xml.match(/<w:tr[\s>]/g)).toHaveLength(action === 'accept' ? 4 : 3);
    expect(xml.includes('Word added cell')).toBe(action === 'accept');
    for (const text of ['First A', 'First B', 'Second A', 'Second B', 'Outer', 'Neighbour'])
      expect(xml).toContain(text);
  });
}
for (const direction of ['ins', 'del']) {
  for (const action of ['accept', 'reject'] as const) {
    test(`${action} nested ${direction} row does not consume an edit beyond unchanged text`, () => {
      let part = fixture(`nested-following-gap-${direction}`);
      const items = revisionItemsOf(part);
      const destructive = (direction === 'ins') === (action === 'reject');
      // Removing the row also requires its independent nested text decisions.
      const selected = items.filter((item) =>
        destructive ? item.text !== 'Following' : item.revisionKind === 'structural'
      );
      const plan = planRevisionBatch(part, action, selected.map(reviewItemKey));
      expect(plan.result.skipped).toEqual([]);
      for (const op of plan.ops) {
        const result = applyTreeOp(part, op);
        if (!result.ok) throw new Error(result.reason);
        part = result.part;
      }
      expect(revisionItemsOf(part).some((item) => item.text === 'Following')).toBe(true);
    });
  }
}
test('Word attributes mixed-author cell formatting to the last cell history', () => {
  const items = revisionItemsOf(fixture('format-cell-authors'));
  expect(items).toHaveLength(1);
  expect(items[0]!.author).toBe('Bob');
});
test('nested row grouping preserves its inferred membership, not just the count', () => {
  const items = revisionItemsOf(fixture('nested-two-rows-ins'));
  expect(items.map((item) => item.revisionKind)).toEqual([
    'insert',
    'insert',
    'structural',
    'insert',
    'structural',
  ]);
  expect(items.filter((item) => item.revisionKind === 'insert').map((item) => item.text)).toEqual([
    'First A',
    'First B',
    'Second B',
  ]);
  const groups = items.filter((item) => item.revisionKind === 'structural');
  expect(groups.map((item) => item.addresses.length).sort()).toEqual([2, 4]);
  const following = groups.find((item) => item.addresses.length === 2)!;
  expect(following.text).toContain('Second A');
  const firstA = items.find((item) => item.revisionKind === 'insert' && item.text === 'First A')!;
  expect(
    groups
      .flatMap((item) => item.ranges)
      .some((range) => range.start.paragraphId === firstA.ranges[0]!.start.paragraphId)
  ).toBe(false);
  expect(following.ranges).toHaveLength(2);
  expect(following.ranges[0]!.start).toEqual(following.ranges[0]!.end);
  let part = fixture('nested-two-rows-ins');
  const plan = planRevisionBatch(part, 'accept', [reviewItemKey(following)]);
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    part = result.part;
  }
  const remaining = revisionItemsOf(part);
  expect(remaining).toHaveLength(4);
  expect(
    remaining.filter((item) => item.revisionKind === 'insert').map((item) => item.text)
  ).toEqual(['First A', 'First B', 'Second B']);
});
for (const action of ['accept', 'reject'] as const) {
  test(`${action} adjacent formatting preserves each run's separate baseline`, () => {
    let part = fixture('adjacent-format-different-baseline');
    const items = revisionItemsOf(part);
    expect(items).toHaveLength(1);
    expect(items[0]!.addresses).toHaveLength(2);
    const plan = planRevisionBatch(part, action, [reviewItemKey(items[0]!)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    const xml = serializeOoxmlPart(part);
    expect(revisionItemsOf(part)).toHaveLength(0);
    expect(xml.includes('<w:b/>')).toBe(action === 'accept');
    expect(xml).toContain('<w:i/>');
  });
}
for (const action of ['accept', 'reject'] as const) {
  test(`${action} grouped table formats does not consume an unrelated format sharing its address`, () => {
    const source = reviewTableGroupingCases.find((c) => c.name === 'format-row-and-cells')!;
    const body =
      source.body.replace(/w:id="\d+"/g, 'w:id="7"') +
      '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="7" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:rPr/></w:rPrChange></w:rPr><w:t>Outside</w:t></w:r></w:p>';
    const read = readOoxmlPart(
      reviewTableGroupingParts({ name: 'reused-format-address', body })['word/document.xml']!,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    let part = read.part;
    const items = revisionItemsOf(part);
    expect(items).toHaveLength(2);
    const table = items.find((item) => item.formattingKind !== 'rPrChange')!;
    expect(table.addresses).toHaveLength(1);
    const plan = planRevisionBatch(part, action, [reviewItemKey(table)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part).map((item) => item.formattingKind)).toEqual(['rPrChange']);
    expect(serializeOoxmlPart(part)).toContain('<w:b/>');
  });
}
for (const direction of ['ins', 'del']) {
  test(`nested ${direction} row markers share the outer decision without consuming nested text`, () => {
    let part = fixture(`nested-table-${direction}`);
    const items = revisionItemsOf(part);
    const group = items.find((item) => item.revisionKind === 'structural')!;
    expect(group.addresses).toHaveLength(4);
    const action = direction === 'ins' ? 'accept' : 'reject';
    const plan = planRevisionBatch(part, action, [reviewItemKey(group)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part).map((item) => item.text)).toEqual(['Nested A', 'Nested B']);
    expect(serializeOoxmlPart(part)).not.toMatch(/<w:trPr>\s*<w:(?:ins|del)\b/);
    // Removing an outer row would also remove its independent nested text.
    // Keep the existing explicit dependency guard for this destructive action.
    const original = fixture(`nested-table-${direction}`);
    const destructive = planRevisionBatch(original, direction === 'ins' ? 'reject' : 'accept', [
      reviewItemKey(group),
    ]);
    expect(destructive.ops).toEqual([]);
    expect(destructive.result.skipped[0]?.reason).toBe('incomplete-group');
  });
}
for (const [name, count] of Object.entries(wordCounts)) {
  test(`Word review grouping: ${name}`, () => {
    expect(revisionItemsOf(fixture(name))).toHaveLength(count);
  });
}
for (const entry of reviewTableGroupingCases.filter((candidate) =>
  candidate.name.startsWith('nested-')
)) {
  for (const action of ['accept', 'reject'] as const) {
    test(`${action} all nested decisions preserves the native remaining count: ${entry.name}`, () => {
      let part = fixture(entry.name);
      const plan = planRevisionBatch(part, action);
      const remaining =
        wordBulkReferences.find((r) => r.name === entry.name && r.action === action)?.remaining ??
        0;
      expect(plan.result.skipped).toHaveLength(remaining);
      for (const op of plan.ops) {
        const result = applyTreeOp(part, op);
        if (!result.ok) throw new Error(result.reason);
        part = result.part;
      }
      expect(revisionItemsOf(part)).toHaveLength(remaining);
      const xml = serializeOoxmlPart(part);
      expect(xml.match(/<w:(?:ins|del)\b/g) ?? []).toHaveLength(remaining);
      const reopened = readOoxmlPart(xml, {
        name: '/word/document.xml',
        contentType: 'application/xml',
      });
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(revisionItemsOf(reopened.part)).toHaveLength(remaining);
    });
  }
}
// Engine safety checks, not Word grouping expectations: the native entry
// boundaries for these fixtures still need to be recorded separately.
for (const entry of reviewTableGroupingCases.filter((c) => c.name.startsWith('format-'))) {
  for (const action of ['accept', 'reject'] as const) {
    test(`${action} all formatting histories: ${entry.name}`, () => {
      let part = fixture(entry.name);
      if (['format-table-property', 'format-grid-only'].includes(entry.name))
        expect(revisionItemsOf(part)).toHaveLength(0);
      else expect(revisionItemsOf(part).length).toBeGreaterThan(0);
      const plan = planRevisionBatch(part, action);
      expect(plan.result.skipped).toEqual([]);
      for (const op of plan.ops) {
        const result = applyTreeOp(part, op);
        if (!result.ok) throw new Error(result.reason);
        part = result.part;
      }
      const xml = serializeOoxmlPart(part);
      expect(revisionItemsOf(part)).toEqual([]);
      expect(xml).not.toMatch(/<w:(?:tcPr|trPr|tblPr|tblGrid|tblPrEx)Change\b/);
      // Accept retains current properties; reject restores the earlier snapshot.
      for (const property of ['<w:shd', '<w:trHeight', '<w:jc']) {
        if (entry.body.includes(property))
          expect(xml.includes(property)).toBe(
            action === 'accept' || entry.name === 'format-table-property'
          );
      }
      if (entry.name === 'format-grid-and-cells') {
        expect(xml.includes('w:w="1800"')).toBe(action === 'reject');
        expect(xml.includes('w:w="2200"')).toBe(action === 'reject');
      }
      if (entry.name === 'format-row-exceptions') {
        expect(xml.includes('w:w="3600"')).toBe(action === 'reject');
      }
      const reopened = readOoxmlPart(xml, {
        name: '/word/document.xml',
        contentType: 'application/xml',
      });
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(revisionItemsOf(reopened.part)).toEqual([]);
    });
  }
}
for (const direction of ['ins', 'del']) {
  for (const action of ['accept', 'reject'] as const) {
    test(`${action} grouped ${direction} rows resolves every constituent marker`, () => {
      let part = fixture(`paragraph-marks-${direction}`);
      const items = revisionItemsOf(part);
      expect(items).toHaveLength(1);
      expect(items[0]!.addresses.length).toBeGreaterThan(4);
      expect(new Set(items[0]!.ranges.map((r) => r.start.paragraphId)).size).toBe(4);
      const plan = planRevisionBatch(part, action, [reviewItemKey(items[0]!)]);
      expect(plan.result.skipped).toEqual([]);
      expect(plan.result.resolved).toHaveLength(1);
      for (const op of plan.ops) {
        const result = applyTreeOp(part, op);
        expect(result.ok).toBe(true);
        if (result.ok) part = result.part;
      }
      expect(revisionItemsOf(part)).toHaveLength(0);
    });
  }
}
test('accepting an inserted row leaves independent deletion and formatting pending', () => {
  for (const name of ['row-insert-with-deletion', 'row-insert-with-format']) {
    let part = fixture(name);
    const items = revisionItemsOf(part);
    const row = items.find((i) => i.structuralChanges?.includes('rowInsert'))!;
    const independent = items.find((i) => i !== row)!;
    const plan = planRevisionBatch(part, 'accept', [reviewItemKey(row)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      expect(result.ok).toBe(true);
      if (result.ok) part = result.part;
    }
    expect(revisionItemsOf(part).map((i) => i.id)).toEqual([independent.id]);
  }
});

test('a reused text identity outside a row is not silently absorbed into it', () => {
  const source = reviewTableGroupingCases.find((c) => c.name === 'one-row-ins')!;
  const firstId = source.body.match(/<w:ins w:id="(\d+)"/g)![1]!.match(/\d+/)![0]!;
  const outside = `<w:p><w:ins w:id="${firstId}" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:r><w:t>Outside</w:t></w:r></w:ins></w:p>`;
  const parts = reviewTableGroupingParts({ name: 'shared-id', body: source.body + outside });
  const read = readOoxmlPart(parts['word/document.xml']!, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error('Invalid fixture');
  const items = revisionItemsOf(read.part);
  const textItem = items.find((i) => i.text.includes('Outside'))!;
  expect(textItem.revisionKind).toBe('insert');
  const rowItem = items.find((i) => i.structuralChanges?.includes('rowInsert'))!;
  expect(rowItem.addresses.some((a) => a.id === firstId)).toBe(false);
  const plan = planRevisionBatch(read.part, 'reject', [reviewItemKey(rowItem)]);
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped[0]?.reason).toBe('incomplete-group');
});
