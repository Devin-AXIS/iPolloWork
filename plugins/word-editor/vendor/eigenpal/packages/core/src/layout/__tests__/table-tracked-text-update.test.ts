import { tableTextStructureUnchanged } from '../table-text-change.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { revisionAuthorFilter } from '../revision-projection.ts';
import { documentOrder } from '../document-order.ts';
import { paragraphLinesFor } from '../paragraph-lines.ts';
import type { OoxmlElement, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { TreeDocumentStore } from '../../store/store/tree-store.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { load, lay, row, table, measurer, styleCascade } from './table-row-keep-fixtures.ts';

const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: part.name,
    contentType: part.contentType,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};

// Reopening allocates run identifiers again. Compare paint, geometry, and review metadata.
const rendered = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, item) =>
      ['id', 'runId', 'nodeId'].includes(key) ? undefined : item
    )
  );

const tableOf = (part: OoxmlPart) =>
  (part.root.children.find((node) => node.kind === 'body') as OoxmlElement).children.find(
    (node) => node.kind === 'table'
  ) as OoxmlElement;

for (const action of ['insert', 'delete'] as const) {
  for (const displayMode of ['all-markup', 'proposed', 'original'] as const) {
    test(`tracked table ${action} reuses unchanged pages in ${displayMode}`, () => {
      const part = load(table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`))));
      const session = createLayoutSession();
      const cache = createParagraphLayoutCache();
      const before = lay(part, 15, { session, cache, displayMode });
      const source = tableOf(part);
      const id = readTableStructure(source, 310, 0)!.rows[3]!.cells[0]!.blocks[0]!.id;
      const store = new TreeDocumentStore(part);
      const revision = { author: 'Reviewer', date: '2026-01-01T00:00:00Z' };
      const result = store.transact((tx) =>
        tx.apply(
          action === 'insert'
            ? { op: 'insertText', paragraphId: id, offset: 2, text: 'X', revision }
            : { op: 'deleteText', paragraphId: id, start: 2, end: 3, revision }
        )
      );
      expect(result.ok).toBe(true);
      expect(tableTextStructureUnchanged(source, tableOf(store.part))).toBe(true);
      const updated = updateTableText(source, tableOf(store.part), before.pages, 310, {
        measurer,
        styleCascade,
        producer: 'test',
        nextLineId: () => '',
        displayMode,
        compatibilityMode: 15,
      });
      expect(updated).not.toBeNull();
      expect(updated!.pages).toEqual(lay(store.part, 15, { displayMode }).pages);
      expect(updated!.pages.slice(1).every((page, i) => page === before.pages[i + 1])).toBe(true);
      expect(lay(store.part, 15, { session, cache, displayMode }).pages).toEqual(
        lay(store.part, 15, { displayMode }).pages
      );
      expect(lay(part, 15, { session, cache, displayMode }).pages).toEqual(before.pages);
    });
  }
}

for (const displayMode of ['all-markup', 'proposed', 'original'] as const) {
  test(`successive tracked AutoFit edits equal fresh layouts in ${displayMode}`, () => {
    const initial = load(
      table(Array.from({ length: 40 }, (_, i) => row(`Row${i}`))).replace(
        '<w:tblLayout w:type="fixed"/>',
        ''
      )
    );
    const store = new TreeDocumentStore(initial);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const original = lay(initial, 15, { session, cache, displayMode });
    const id = readTableStructure(tableOf(initial), 310, 0)!.rows[17]!.cells[0]!.blocks[0]!.id;
    documentOrder(original);
    paragraphLinesFor(original, id);
    for (const text of ['X', ' words', ' longer content that changes the line breaks']) {
      const result = store.transact((tx) =>
        tx.apply({
          op: 'insertText',
          paragraphId: id,
          offset: 2,
          text,
          revision: { author: 'Reviewer', date: '2026-01-01T00:00:00Z' },
        })
      );
      expect(result.ok).toBe(true);
      const updated = lay(store.part, 15, { session, cache, displayMode });
      const fresh = lay(store.part, 15, { displayMode });
      expect(documentOrder(updated)).toEqual(documentOrder(fresh));
      expect(paragraphLinesFor(updated, id)).toEqual(paragraphLinesFor(fresh, id));
      expect(lay(store.part, 15, { session, cache, displayMode }).pages).toEqual(
        lay(store.part, 15, { displayMode }).pages
      );
      expect(rendered(lay(store.part, 15, { session, cache, displayMode }).pages)).toEqual(
        rendered(lay(reparsed(store.part), 15, { displayMode }).pages)
      );
    }
    expect(lay(initial, 15, { session, cache, displayMode }).pages).toEqual(original.pages);
  });
}

test('tracked table caches separate reviewer visibility and display modes', () => {
  const part = load(
    table(Array.from({ length: 30 }, (_, i) => row(`Row${i}`, { header: i === 0 })))
  );
  const store = new TreeDocumentStore(part);
  const id = readTableStructure(tableOf(part), 310, 0)!.rows[3]!.cells[0]!.blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  for (const author of ['Alice', 'Bob']) {
    expect(
      store.transact((tx) =>
        tx.apply({
          op: 'insertText',
          paragraphId: id,
          offset: 2,
          text: author,
          revision: { author, date: '2026-01-01T00:00:00Z' },
        })
      ).ok
    ).toBe(true);
    lay(store.part, 15, { session, cache });
  }
  for (const displayMode of ['original', 'proposed', 'all-markup'] as const) {
    for (const authors of [['Alice'], ['Bob'], []]) {
      const view = { displayMode, revisionAuthorFilter: revisionAuthorFilter(authors) };
      expect(lay(store.part, 15, { session, cache, ...view }).pages).toEqual(
        lay(store.part, 15, view).pages
      );
      expect(rendered(lay(store.part, 15, { session, cache, ...view }).pages)).toEqual(
        rendered(lay(reparsed(store.part), 15, view).pages)
      );
    }
  }
});
