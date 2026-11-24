import { expect, test } from 'bun:test';
import { TreeDocumentStore } from '../../store/store/tree-store.ts';
import { bodyReviewAnchors } from '../body-review-anchors.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf, type PageRecord } from '../semantic-records.ts';
import { anchorLineY, reviewAnchorIndex } from '../review-support.ts';
import { lay, load } from './table-row-keep-fixtures.ts';

function compare(page: PageRecord, fresh = page) {
  const compact = bodyReviewAnchors(page);
  const expected = reviewAnchorIndex({ pages: [fresh] }, paragraphFragmentsOf);
  expect([...compact.keys()]).toEqual([...expected.keys()]);
  for (const [id, anchor] of compact) {
    const original = expected.get(id)!;
    expect([anchor.pageIndex, anchor.contentY, anchor.fragmentY]).toEqual([
      original.pageIndex,
      original.contentY,
      original.fragmentY,
    ]);
    for (const offset of [0, 1, 2, 5, 1000])
      expect(anchorLineY(anchor, id, offset)).toBe(anchorLineY(original, id, offset));
  }
}

test('compact body anchors preserve mixed paragraph span extents', () => {
  const page = lay(load('<w:p><w:r><w:t>AB</w:t></w:r></w:p>')).pages[0]!;
  const paragraph = paragraphFragmentsOf(page)[0]!;
  const line = paragraph.lines[0]!;
  const span = line.spans[0]!;
  const mixed = {
    ...paragraph,
    lines: [
      {
        ...line,
        spans: [
          { ...span, range: { ...span.range, end: 1 } },
          { ...span, range: { ...span.range, paragraphId: 'absorbed', end: 4 } },
        ],
      },
    ],
  };
  const changed = { ...page, fragments: [mixed] };
  compare(changed);
  const anchors = bodyReviewAnchors(changed);
  expect(anchors.has('absorbed')).toBe(true);
  expect(anchors.get(paragraph.paragraphId)!.lines![0]).not.toBe(mixed.lines[0]);
  expect(anchors.get(paragraph.paragraphId)!.lines![0]!.spans![0]).not.toBe(span);
  const custom = reviewAnchorIndex({ pages: [changed] }, () => [
    {
      paragraphId: 'custom',
      box: { y: 123 },
    },
  ]);
  expect([...custom.keys()]).toEqual(['custom']);
  expect(custom.get('custom')!.fragmentY).toBe(123);
});

test('tracked width edits reuse unchanged body anchors without reading table rows', () => {
  const cell = '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>';
  const part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid>' +
      '<w:gridCol w:w="1000"/>'.repeat(3) +
      '</w:tblGrid>' +
      '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
      cell.repeat(3) +
      '</w:tr>' +
      ('<w:tr>' + cell.repeat(3) + '</w:tr>').repeat(36) +
      '</w:tbl>'
  );
  const store = new TreeDocumentStore(part);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  const id = paragraphFragmentsOf(layout.pages[0]!)[3]!.paragraphId;
  let reused = 0;
  for (const author of ['Alice', 'Bob', 'Carol']) {
    const before = layout;
    const previous = before.pages.map(bodyReviewAnchors);
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
    for (const [index, page] of layout.pages.entries()) {
      const known = bodyReviewAnchors(page);
      compare(page, fresh.pages[index]!);
      if (page !== before.pages[index] && known === previous[index]) {
        reused++;
        const table = page.fragments.find((block) => block.kind === 'table')!;
        const descriptor = Object.getOwnPropertyDescriptor(table, 'rows')!;
        Object.defineProperty(table, 'rows', {
          configurable: true,
          get() {
            throw Error('Unexpected rows read');
          },
        });
        try {
          expect(bodyReviewAnchors(page)).toBe(previous[index]);
        } finally {
          Object.defineProperty(table, 'rows', descriptor);
        }
      }
    }
  }
  expect(reused).toBeGreaterThan(0);
  expect(
    store.transact((tx) => tx.apply({ op: 'splitParagraph', paragraphId: id, offset: 2 })).ok
  ).toBe(true);
  const split = lay(store.part, 15, { session, cache });
  const fresh = lay(store.part, 15);
  for (const [index, page] of split.pages.entries()) compare(page, fresh.pages[index]!);
});
