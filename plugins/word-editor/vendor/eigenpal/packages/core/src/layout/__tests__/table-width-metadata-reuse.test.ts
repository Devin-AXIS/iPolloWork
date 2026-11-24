import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { tableContextAt } from '../semantic-cell-selection.ts';
import { paragraphFragmentsOf, type TableFragmentRecord } from '../semantic-records.ts';
import { fragmentHolding } from '../line-segments.ts';
import { relabelListMarkers } from '../list-marker-reuse.ts';
import { lay, load, measurer } from './table-row-keep-fixtures.ts';

function widthEdit() {
  const row = '<w:tr>' + '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'.repeat(3) + '</w:tr>';
  const part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid>' +
      '<w:gridCol w:w="1000"/>'.repeat(3) +
      '</w:tblGrid>' +
      row.repeat(24) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const before = lay(part, 15, { session, cache });
  const firstId = [...paragraphFragmentsOf(before.pages[0]!)][0]!.paragraphId;
  const otherId = [...paragraphFragmentsOf(before.pages.at(-1)!)][0]!.paragraphId;
  tableContextAt(before, firstId);
  fragmentHolding(before, otherId);
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: firstId,
    offset: 0,
    text: 'WIDER',
  });
  if (!edit.ok) throw Error(edit.reason);
  const after = lay(edit.part, 15, { session, cache });
  const tables = after.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is TableFragmentRecord => block.kind === 'table');
  const original = before.pages[0]!.fragments.find((block) => block.kind === 'table')!;
  expect(tables[0]!.columnEdges).not.toEqual(original.columnEdges);
  return { after, tables, otherId, cold: lay(edit.part) };
}

function observeRows(tables: readonly TableFragmentRecord[]) {
  let reads = 0;
  const descriptors = tables.map((table) => Object.getOwnPropertyDescriptor(table, 'rows')!);
  tables.forEach((table, index) =>
    Object.defineProperty(table, 'rows', {
      configurable: true,
      enumerable: true,
      get() {
        reads++;
        return descriptors[index]!.value;
      },
    })
  );
  return {
    get reads() {
      return reads;
    },
    restore() {
      tables.forEach((table, index) => Object.defineProperty(table, 'rows', descriptors[index]!));
    },
  };
}

test('list-free width updates relabel without reading table rows', () => {
  const { after, tables } = widthEdit();
  const observer = observeRows(tables);
  try {
    // This unrelated item makes relabeling run without supplying any item for a table paragraph.
    const items = new Map([['unrelated', { markerText: '1.', ordinal: 1 } as never]]);
    expect(relabelListMarkers(after, items, measurer)).toBe(after);
    expect(observer.reads).toBe(0);
    const unproven = { ...tables[0]!, rows: tables[0]!.rows };
    const copyObserver = observeRows([unproven]);
    try {
      relabelListMarkers(
        { ...after, pages: [{ ...after.pages[0]!, fragments: [unproven] }] },
        new Map(items),
        measurer
      );
      expect(copyObserver.reads).toBeGreaterThan(0);
    } finally {
      copyObserver.restore();
    }
  } finally {
    observer.restore();
  }
});

test('a new caret lookup after a width edit reuses page membership without reading rows', () => {
  const { after, tables, otherId, cold } = widthEdit();
  const expected = tableContextAt(cold, otherId);
  const observer = observeRows(tables);
  try {
    expect(tableContextAt(after, otherId)).toEqual(expected);
    expect(observer.reads).toBe(0);
  } finally {
    observer.restore();
  }
});

test('paragraph lookup after a width edit reads only its known page', () => {
  const { after, otherId, cold } = widthEdit();
  const expected = fragmentHolding(cold, otherId);
  const unrelated = after.pages
    .slice(0, -1)
    .flatMap((page) => page.fragments)
    .filter((block): block is TableFragmentRecord => block.kind === 'table');
  expect(unrelated.length).toBeGreaterThan(0);
  const observer = observeRows(unrelated);
  try {
    expect(fragmentHolding(after, otherId)).toEqual(expected);
    expect(observer.reads).toBe(0);
  } finally {
    observer.restore();
  }
});
