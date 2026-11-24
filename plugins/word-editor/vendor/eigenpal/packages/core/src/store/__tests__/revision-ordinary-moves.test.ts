import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { textUnder } from '../store/review-text.ts';
import references from './fixtures/word-move-action-reference.json';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';

function load(body: string) {
  const parsed = readOoxmlPart(
    reviewTableGroupingParts({ name: 'move-safety', body })['word/document.xml']!,
    {
      name: '/word/document.xml',
      contentType: 'application/xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const pair = reviewTableGroupingCases.find((entry) => entry.name === 'move-range-pair')!.body;
for (const action of ['accept', 'reject'] as const) {
  test(`${action} move destination cannot modify a locked source`, () => {
    const body = pair.replace(
      /^(<w:p>.*?<\/w:p>)/,
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>$1</w:sdtContent></w:sdt>'
    );
    expect(body).not.toBe(pair);
    const part = load(body);
    const item = revisionItemsOf(part).find((item) => item.revisionKind === 'moveTo')!;
    const plan = planRevisionBatch(part, action, [reviewItemKey(item)]);
    expect(plan.ops).toEqual([]);
    expect(plan.result.skipped.length).toBeGreaterThan(0);
    expect(plan.result.skipped.every((entry) => entry.detail === 'locked-content')).toBe(true);
  });
  test(`${action} move cannot split a source revision identity shared outside its range`, () => {
    const deletion = pair.match(/<w:del\b.*?<\/w:del>/)![0];
    const part = load(pair + `<w:p>${deletion}</w:p>`);
    const item = revisionItemsOf(part).find((item) => item.revisionKind === 'moveTo')!;
    const plan = planRevisionBatch(part, action, [reviewItemKey(item)]);
    expect(plan.ops).toEqual([]);
    expect(plan.result.skipped.some((entry) => entry.reason === 'incomplete-group')).toBe(true);
  });
}
test('ordinary move cards retain Word order and nonempty source/destination anchors', () => {
  const items = revisionItemsOf(load(pair));
  expect(items.map((item) => item.revisionKind)).toEqual([
    'moveFrom',
    'delete',
    'moveTo',
    'insert',
  ]);
  for (const item of items) {
    expect(item.ranges).toHaveLength(1);
    expect(item.ranges[0]!.end.offset - item.ranges[0]!.start.offset).toBe(5);
  }
});
test('a malformed paired range keeps both move decisions read-only', () => {
  const part = load(pair.replace(/<w:moveFromRangeEnd[^>]*\/>/, ''));
  expect(
    revisionItemsOf(part)
      .filter((item) => item.revisionKind.startsWith('move'))
      .map((item) => item.readOnly)
  ).toEqual([true, true]);
});

// Independent native Word single-revision results, saved and inspected 2026-09-18.
for (const reference of references) {
  test(`Word ordinary move: ${reference.name} ${reference.action} ${reference.kind}`, () => {
    const fixture = reviewTableGroupingCases.find((entry) => entry.name === reference.name)!;
    const parsed = readOoxmlPart(reviewTableGroupingParts(fixture)['word/document.xml']!, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    let part = parsed.part;
    const item = revisionItemsOf(part).find((item) => item.revisionKind === reference.kind)!;
    expect(item).toBeDefined();
    expect(item.text).toBe(
      reference.name === 'move-range-pair'
        ? 'Moved'
        : reference.name === 'move-range-insertion'
          ? 'Destination'
          : 'Source'
    );
    const plan = planRevisionBatch(part, reference.action as 'accept' | 'reject', [
      reviewItemKey(item),
    ]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(plan.result.remaining).toBe(reference.remaining);
    expect(revisionItemsOf(part)).toHaveLength(reference.remaining);
    const paragraphs: { text: string; markers: string[] }[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') {
        const markers: string[] = [];
        const scan = (node: OoxmlNode): void => {
          if (node.kind === 'textValue') return;
          if (
            [
              'ins',
              'del',
              'moveFromRangeStart',
              'moveFromRangeEnd',
              'moveToRangeStart',
              'moveToRangeEnd',
            ].includes(node.localName)
          )
            markers.push(node.localName);
          for (const child of node.children) scan(child);
        };
        scan(node);
        paragraphs.push({ text: textUnder(node), markers });
      } else for (const child of node.children) visit(child);
    };
    visit(part.root);
    expect(paragraphs).toEqual(reference.paragraphs);
  });
}

test('rejecting a move carries destination run formatting with its pending insertion', () => {
  const styled = pair.replace('<w:t>Moved</w:t>', '<w:rPr><w:b/></w:rPr><w:t>Moved</w:t>');
  const part = load(styled);
  const move = revisionItemsOf(part).find((item) => item.revisionKind === 'moveTo')!;
  expect(move.readOnly).toBe(false);
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(move)]);
  expect(plan.result.skipped).toEqual([]);
  const result = applyTreeOp(part, plan.ops[0]!);
  if (!result.ok) throw new Error(result.reason);
  expect(serializeOoxmlPart(result.part)).toContain('<w:b');
  expect(revisionItemsOf(result.part).map((item) => item.revisionKind)).toEqual(['insert']);
});

test('accepting source deletion cannot clear move metadata in a locked destination', () => {
  const body = pair.replace(
    /(<w:p>(?:(?!<w:p>)[^])*?<\/w:p>)$/,
    '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>$1</w:sdtContent></w:sdt>'
  );
  const part = load(body);
  const deletion = revisionItemsOf(part).find((item) => item.revisionKind === 'delete')!;
  const plan = planRevisionBatch(part, 'accept', [reviewItemKey(deletion)]);
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped.length).toBeGreaterThan(0);
  expect(plan.result.skipped.every((entry) => entry.detail === 'locked-content')).toBe(true);
});

for (const action of ['accept', 'reject'] as const) {
  test(`${action} retains support for wrapper moves whose boundaries cross paragraphs`, () => {
    const half = (direction: 'From' | 'To', id: number) =>
      `<w:p><w:move${direction}RangeStart w:id="${id}" w:name="Across"/><w:move${direction} w:id="${id + 10}" w:author="Ada"><w:r><w:t>Moved</w:t></w:r></w:move${direction}></w:p><w:p><w:move${direction}RangeEnd w:id="${id}"/></w:p>`;
    const part = load(half('From', 1) + half('To', 2));
    const items = revisionItemsOf(part);
    expect(items.map((item) => item.revisionKind)).toEqual(['moveFrom', 'moveTo']);
    expect(items.every((item) => !item.readOnly)).toBe(true);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toEqual([]);
    const result = applyTreeOp(part, plan.ops[0]!);
    if (!result.ok) throw new Error(result.reason);
    expect(revisionItemsOf(result.part)).toEqual([]);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).not.toMatch(/<w:move(?:From|To)/);
    expect(xml.match(/>Moved</g)).toHaveLength(1);
  });
}

test('rejecting destination text cannot bypass a refused move dependency', () => {
  const deletion = pair.match(/<w:del\b.*?<\/w:del>/)![0];
  const part = load(pair + `<w:p>${deletion}</w:p>`);
  const selected = revisionItemsOf(part).filter(
    (item) => item.revisionKind === 'moveTo' || item.revisionKind === 'insert'
  );
  const plan = planRevisionBatch(part, 'reject', selected.map(reviewItemKey));
  expect(plan.ops).toEqual([]);
  expect(plan.result.resolved).toEqual([]);
  expect(plan.result.skipped.some((entry) => entry.reason === 'incomplete-group')).toBe(true);
});
