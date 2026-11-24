import { openDocumentForExport } from '../export/export-session.ts';
import type { SemanticLayout, BlockFragmentRecord } from '../layout/semantic-records.ts';
import { formatPageNumber } from '../layout/field-page-furniture.ts';
import type { HeadlessDocumentView } from '../store/headless-document-view.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';

/** Measured page positions used by field updates; no guessed page counts. @public */
export interface AutomationPaginationSnapshot {
  readonly pageCount: number;
  readonly ranges: readonly {
    readonly paragraphId: string;
    readonly start: number;
    readonly end: number;
    readonly pageNumber: number;
    readonly pageNumberText: string;
  }[];
}
/** A host settles fonts/images and paginates the supplied canonical view. @public */
export type AutomationPaginationProvider = (
  view: HeadlessDocumentView
) => Promise<AutomationPaginationSnapshot>;

/** Convert actual semantic pages into field-update positions. @public */
export function paginationSnapshotOf(layout: SemanticLayout): AutomationPaginationSnapshot {
  const ranges: AutomationPaginationSnapshot['ranges'][number][] = [];
  for (const page of layout.pages) {
    const pageNumber = page.pageFieldSource?.pageNumber ?? page.index + 1;
    const pageNumberText = formatPageNumber(pageNumber, page.pageFieldSource?.format);
    const visit = (blocks: readonly BlockFragmentRecord[]): void => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          for (const line of block.lines)
            ranges.push({ ...line.range, pageNumber, pageNumberText });
        } else for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
      }
    };
    visit(page.fragments);
    if (page.header) visit(page.header.fragments);
    if (page.footer) visit(page.footer.fragments);
    for (const note of page.footnotes?.notes ?? []) visit(note.fragments);
    for (const note of page.endnotes?.notes ?? []) visit(note.fragments);
  }
  return { pageCount: layout.pages.length, ranges };
}

export function paginationContextFor(
  snapshot: AutomationPaginationSnapshot | undefined,
  part: OoxmlPart,
  paragraphId: string,
  fieldNodeId: string
): { pageNumber: number; pageNumberText: string; pageCount: number } | null {
  if (!snapshot || !Number.isInteger(snapshot.pageCount) || snapshot.pageCount < 1) return null;
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const segment = segmentsOf(paragraph).find((segment) => segment.node.id === fieldNodeId);
  if (!segment) return null;
  const found = snapshot.ranges.find(
    (range) =>
      range.paragraphId === paragraphId && range.start <= segment.start && range.end > segment.start
  );
  if (!found || !Number.isInteger(found.pageNumber) || found.pageNumber < 1) return null;
  // Repeating header/footer fields keep the first rendered occurrence as their saved cache.
  // Word and the engine project the same field separately on each physical page.
  return {
    pageNumber: found.pageNumber,
    pageNumberText: found.pageNumberText,
    pageCount: snapshot.pageCount,
  };
}

/** Explicit measurement inputs for headless field calculation. @public */
export interface AutomationPaginationOptions {
  readonly measurer: import('../layout/semantic-records.ts').TextMeasurer;
  readonly producer?: string;
}
/** Create a DOM-free pagination provider using the engine's measured export layout. @public */
export function createAutomationPaginationProvider(
  options: AutomationPaginationOptions
): AutomationPaginationProvider {
  return async (view) => {
    const opened = openDocumentForExport(view, {
      measurer: options.measurer,
      producer: options.producer,
      displayMode: 'proposed',
    });
    if (!opened.ok) throw new Error('field pagination could not open the document');
    try {
      return paginationSnapshotOf(await opened.session.layout());
    } finally {
      opened.session.dispose();
    }
  };
}
