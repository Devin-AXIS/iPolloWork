import { expect, test } from 'bun:test';
import { TreeDocumentStore } from '../../store/store/tree-store.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { paragraphFragmentsOf } from '../../layout/semantic-records.ts';
import { lay, load } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { blockContentSummary } from '../block-content-summary.ts';
import { authorSlotsOf } from '../revision-presentation.ts';

test('width-only updates retain metadata summaries and preserve tracked format authors', () => {
  const paragraph =
    '<w:p><w:r><w:rPr><w:rPrChange w:id="2" w:author="Reviewer"><w:rPr/></w:rPrChange></w:rPr><w:t>A</w:t></w:r></w:p>';
  const row = '<w:tr>' + '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'.repeat(3) + '</w:tr>';
  let part = load(
    paragraph +
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
      row.repeat(24) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  expect([...authorSlotsOf(layout).keys()]).toContain('Reviewer');
  const id = layout.pages.flatMap((page) => paragraphFragmentsOf(page))[1]!.paragraphId;
  let reused = 0;
  for (let offset = 0; offset < 6; offset++) {
    const before = layout;
    const summaries = before.pages.map((page) => blockContentSummary(page.fragments));
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset, text: 'W' });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    const cold = lay(part, 15);
    expect(authorSlotsOf(layout)).toEqual(authorSlotsOf(cold));
    for (let page = 0; page < layout.pages.length; page++) {
      const summary = blockContentSummary(layout.pages[page]!.fragments);
      expect(summary).toEqual(blockContentSummary(cold.pages[page]!.fragments));
      if (layout.pages[page] !== before.pages[page] && summary === summaries[page]) reused++;
    }
  }
  expect(reused).toBeGreaterThan(0);
  // A structural edit must derive fresh summaries through the ordinary layout path.
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 3 });
  if (!split.ok) throw Error(split.reason);
  const after = lay(split.part, 15, { session, cache });
  expect(authorSlotsOf(after)).toEqual(authorSlotsOf(lay(split.part, 15)));
});

test('tracked table text refreshes author summaries after deletion', () => {
  const plain = '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>';
  const tracked =
    '<w:tc><w:p><w:ins w:id="1" w:author="Reviewer" w:date="2024-01-01T00:00:00Z">' +
    '<w:r><w:t>WWWWWWWW</w:t></w:r></w:ins></w:p></w:tc>';
  const row = (first: string) => '<w:tr>' + first + plain + plain + '</w:tr>';
  let part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
      row(tracked) +
      row(plain).repeat(23) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  expect(blockContentSummary(layout.pages[0]!.fragments).authors).toEqual(['Reviewer']);
  const id = paragraphFragmentsOf(layout.pages[0]!)[0]!.paragraphId;
  // Delete all but one character first, then the last one, so each step may stay text-only.
  for (let step = 0; step < 8; step++) {
    const edit = applyTreeOp(part, { op: 'deleteText', paragraphId: id, start: 0, end: 1 });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    const live = blockContentSummary(layout.pages[0]!.fragments).authors;
    const cold = blockContentSummary(lay(part, 15).pages[0]!.fragments).authors;
    expect(live).toEqual(cold);
  }
});

for (const repeatedHeader of [false, true]) {
  test(`tracked width edits retain unchanged page metadata with headers=${repeatedHeader}`, () => {
    const plain = '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>';
    const header = repeatedHeader
      ? '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + plain.repeat(3) + '</w:tr>'
      : '';
    const part = load(
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
        '<w:tblGrid>' +
        '<w:gridCol w:w="1000"/>'.repeat(3) +
        '</w:tblGrid>' +
        header +
        Array.from({ length: 36 }, (_, index) => {
          const first =
            index === 18
              ? plain
                  .replace('<w:r>', '<w:ins w:id="9" w:author="Existing"><w:r>')
                  .replace('</w:r>', '</w:r></w:ins>')
              : plain;
          return '<w:tr>' + first + plain.repeat(2) + '</w:tr>';
        }).join('') +
        '</w:tbl>'
    );
    const store = new TreeDocumentStore(part);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    let layout = lay(store.part, 15, { session, cache });
    const id = paragraphFragmentsOf(layout.pages[0]!)[repeatedHeader ? 3 : 0]!.paragraphId;
    expect([...authorSlotsOf(layout).keys()]).toContain('Existing');
    let reused = 0;
    for (const author of ['Alice', 'Bob', 'Carol']) {
      const previous = layout;
      const summaries = layout.pages.map((page) => blockContentSummary(page.fragments));
      expect(
        store.transact((tx) =>
          tx.apply({
            op: 'insertText',
            paragraphId: id,
            offset: 0,
            text: 'WW',
            revision: { author, date: '2026-01-01T00:00:00Z' },
          })
        ).ok
      ).toBe(true);
      layout = lay(store.part, 15, { session, cache });
      const fresh = lay(store.part, 15);
      expect(layout.pages).toEqual(fresh.pages);
      expect(authorSlotsOf(layout)).toEqual(authorSlotsOf(fresh));
      expect(blockContentSummary(layout.pages[0]!.fragments).authors).toContain(author);
      for (let index = 0; index < layout.pages.length; index++) {
        const page = layout.pages[index]!;
        const summary = blockContentSummary(page.fragments);
        expect(summary).toEqual(blockContentSummary(fresh.pages[index]!.fragments));
        if (page !== previous.pages[index] && summary === summaries[index]) reused++;
      }
    }
    // The terminal-edge path does not publish a complete reusable body group.
    if (repeatedHeader) expect(reused).toBeGreaterThan(0);
    else expect(reused).toBe(0);
  });
}
