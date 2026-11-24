import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import {
  carryParagraphPageRoutes,
  paragraphLinesFor,
  paragraphLinesIndex,
  paragraphLinesPageTraversals,
} from '../paragraph-lines.ts';
import { lay, load } from './table-row-keep-fixtures.ts';

test('width-only table edits route caret reads to fresh lines on the same pages', () => {
  const row = '<w:tr>' + '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'.repeat(3) + '</w:tr>';
  let part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
      row.repeat(24) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  expect(layout.pages.length).toBeGreaterThan(1);
  const id = paragraphFragmentsOf(layout.pages[0]!)[0]!.paragraphId;
  let previous = paragraphLinesFor(layout, id);
  let narrowed = 0;
  for (let offset = 0; offset < 6; offset++) {
    // A no-change publication between edits must retain routes read by the surface.
    layout = lay(part, 15, { session, cache });
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset, text: 'W' });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    const before = paragraphLinesPageTraversals();
    const answer = paragraphLinesFor(layout, id);
    const visits = paragraphLinesPageTraversals() - before;
    if (visits < layout.pages.length) narrowed++;
    expect(answer).not.toBe(previous);
    expect(answer).toEqual(paragraphLinesIndex(lay(part, 15)).get(id));
    previous = answer;
  }
  expect(narrowed).toBeGreaterThan(0);
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 3 });
  if (!split.ok) throw Error(split.reason);
  const after = lay(split.part, 15, { session, cache });
  const cold = paragraphLinesIndex(lay(split.part, 15));
  for (const [paragraphId, lines] of cold) {
    expect(paragraphLinesFor(after, paragraphId)).toEqual(lines);
  }
});

test('a routed paragraph pushed to the next page is still found after a height edit', () => {
  const row = '<w:tr>' + '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'.repeat(3) + '</w:tr>';
  let part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
      row.repeat(24) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  expect(layout.pages.length).toBeGreaterThan(1);
  const first = paragraphFragmentsOf(layout.pages[0]!)[0]!.paragraphId;
  const onFirst = paragraphFragmentsOf(layout.pages[0]!);
  const last = onFirst[onFirst.length - 1]!.paragraphId;
  const watched = [first, last];
  let routed = 0;
  const check = () => {
    const before = paragraphLinesPageTraversals();
    paragraphLinesFor(layout, last);
    if (paragraphLinesPageTraversals() - before < layout.pages.length) routed++;
    const cold = paragraphLinesIndex(lay(part, 15));
    for (const id of watched) expect(paragraphLinesFor(layout, id)).toEqual(cold.get(id) ?? []);
  };
  for (const id of watched) paragraphLinesFor(layout, id);
  // Width-only edits carry routes for both paragraphs.
  for (let offset = 0; offset < 3; offset++) {
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: first, offset, text: 'W' });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    check();
  }
  expect(routed).toBeGreaterThan(0);
  const pageOfLast = paragraphLinesFor(layout, last)[0]!.pageIndex;
  // A height edit above `last` pushes it down; its old route must not survive.
  const grow = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: first,
    offset: 0,
    text: ' word'.repeat(60),
  });
  if (!grow.ok) throw Error(grow.reason);
  part = grow.part;
  layout = lay(part, 15, { session, cache });
  check();
  expect(paragraphLinesFor(layout, last)[0]!.pageIndex).toBeGreaterThan(pageOfLast);
  // And a width edit after the refusal starts a fresh, correct route chain.
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId: last, offset: 0, text: 'WWW' });
  if (!edit.ok) throw Error(edit.reason);
  part = edit.part;
  layout = lay(part, 15, { session, cache });
  check();
});

for (const readAfterCarry of [false, true]) {
  test(`complete-index reads preserve routes through wrappers, late=${readAfterCarry}`, () => {
    const layout = lay(load('<w:p><w:r><w:t>A</w:t></w:r></w:p>'.repeat(80)));
    expect(layout.pages.length).toBeGreaterThan(2);
    const all = paragraphLinesIndex(layout);
    const id = [...all.keys()].at(-1)!;
    const next = { ...layout, pages: layout.pages.map((page) => ({ ...page })) };
    if (!readAfterCarry) paragraphLinesFor(layout, id);
    carryParagraphPageRoutes(layout, next);
    if (readAfterCarry) paragraphLinesFor(layout, id);
    const before = paragraphLinesPageTraversals();
    expect(paragraphLinesFor(next, id)).toEqual(all.get(id));
    expect(paragraphLinesPageTraversals() - before).toBe(1);
  });
}
