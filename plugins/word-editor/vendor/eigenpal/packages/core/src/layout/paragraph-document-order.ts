import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { createSubtreeAggregateMemo } from '../store/package/subtree-memo-policy.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionDisplayMode, RevisionAuthorFilter } from './revision-projection.ts';
import { readTableStructure } from './semantic-table.ts';

/**
 * Each table's paragraph ids in reading order, per table node and per input set. An edit
 * outside a table shares the table node, so a pass does not walk every row of every table
 * again to number paragraphs that did not move.
 */
const tableParagraphIds = createSubtreeAggregateMemo<{
  readonly key: string;
  readonly ids: readonly string[];
}>();

/** Walk top-level prepared blocks and table cell paragraphs in document order. */
export function paragraphDocumentOrderOf(
  prepared: readonly {
    readonly kind: 'paragraph' | 'table';
    readonly paragraph?: OoxmlElement;
    readonly table?: OoxmlElement;
  }[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number
): ReadonlyMap<string, number> {
  const key = [
    contentWidth,
    styleCascade?.cacheToken ?? '',
    displayMode,
    authorFilter?.cacheKey ?? '',
    compatibilityMode ?? '',
  ].join('|');
  const collect = (table: OoxmlElement, ids: string[]): void => {
    const structure = readTableStructure(
      table,
      contentWidth,
      0,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    );
    if (!structure) return;
    for (const row of structure.rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) {
          if (block.localName === 'p') ids.push(block.id);
          else if (block.localName === 'tbl') collect(block, ids);
        }
      }
    }
  };
  const order = new Map<string, number>();
  let index = 0;
  const walkTable = (table: OoxmlElement): void => {
    let cached = tableParagraphIds.get(table);
    if (cached?.key !== key) {
      const ids: string[] = [];
      collect(table, ids);
      tableParagraphIds.set(table, (cached = { key, ids }), ids.length);
    }
    for (const id of cached.ids) order.set(id, index++);
  };
  for (const block of prepared) {
    if (block.kind === 'paragraph' && block.paragraph) {
      order.set(block.paragraph.id, index++);
    } else if (block.kind === 'table' && block.table) {
      walkTable(block.table);
    }
  }
  return order;
}
