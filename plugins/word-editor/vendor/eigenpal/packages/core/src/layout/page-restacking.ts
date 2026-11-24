import { remapPage } from './hf-layout.ts';
import { SHEET_GUTTER_PT } from './section-page-furniture.ts';
import type { PageRecord } from './semantic-records.ts';

/** Reindex pages and move every absolute page box into one non-overlapping sheet stack. */
export function reindexAndRestackPages(pages: readonly PageRecord[]): PageRecord[] {
  let sheetY = 0;
  return pages.map((page, index) => {
    const id = `page-${index}`;
    const unchanged = page.index === index && page.id === id && page.box.y === sheetY;
    const reindexed = unchanged ? page : remapPage(page, index, sheetY);
    sheetY += page.box.height + SHEET_GUTTER_PT;
    return reindexed;
  });
}
