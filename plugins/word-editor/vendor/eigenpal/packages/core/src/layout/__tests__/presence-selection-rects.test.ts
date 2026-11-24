// Remote-presence highlights must not walk every line of the document per paint.

import { describe, expect, test } from 'bun:test';
import { everyStoryOrder } from '../document-order.ts';
import { presenceSelectionRects, presenceWalkRecorder } from '../selection-rects.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../semantic-records.ts';
import type { SemanticSelection } from '../semantic-interaction.ts';

const LINES_PER_PAGE = 8;
const HEADER_ID = 'header-0';

function lineOf(paragraphId: string, index: number): LineRecord {
  return {
    id: `${paragraphId}-l${index}`,
    range: { paragraphId, start: 0, end: 10 },
    spans: [],
    box: { x: 0, y: index * 14, width: 400, height: 14 },
    contentX: 0,
    baseline: 11,
    leading: 0,
  } as LineRecord;
}

function paragraphOf(paragraphId: string, lineCount: number): ParagraphFragmentRecord {
  const lines: LineRecord[] = [];
  for (let index = 0; index < lineCount; index += 1) lines.push(lineOf(paragraphId, index));
  return {
    kind: 'paragraph',
    id: `${paragraphId}-frag`,
    paragraphId,
    fragmentIndex: 0,
    lines,
    box: { x: 0, y: 0, width: 400, height: lineCount * 14 },
    range: { paragraphId, start: 0, end: 10 },
  } as unknown as ParagraphFragmentRecord;
}

function headerOf(paragraphId: string): HeaderFooterStoryRecord {
  return {
    kind: 'header',
    variant: 'default',
    partName: '/word/header1.xml',
    box: { x: 72, y: 36, width: 468, height: 28 },
    fragments: [paragraphOf(paragraphId, 1)],
  } as HeaderFooterStoryRecord;
}

function tableWithCell(paragraphId: string): BlockFragmentRecord {
  return {
    kind: 'table',
    rows: [{ isHeaderRepeat: false, cells: [{ blocks: [paragraphOf(paragraphId, 1)] }] }],
  } as unknown as BlockFragmentRecord;
}

function pageOf(
  index: number,
  bodyId: string,
  extras?: { header?: boolean; tableCellId?: string }
): PageRecord {
  const fragments: BlockFragmentRecord[] = [paragraphOf(bodyId, LINES_PER_PAGE)];
  if (extras?.tableCellId) fragments.push(tableWithCell(extras.tableCellId));
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: index * 792, width: 612, height: 792 },
    contentBox: { x: 72, y: 72, width: 468, height: 648 },
    fragments,
    ...(extras?.header ? { header: headerOf(HEADER_ID) } : {}),
  } as PageRecord;
}

function layoutOf(
  pageCount: number,
  extras?: { header?: boolean; tableCellId?: string }
): SemanticLayout {
  const pages: PageRecord[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pages.push(
      pageOf(index, `body-${index}`, {
        ...(extras?.header && index === 0 ? { header: true } : {}),
        ...(extras?.tableCellId && index === 0 ? { tableCellId: extras.tableCellId } : {}),
      })
    );
  }
  return { revision: 1, pages };
}

function selectAll(layout: SemanticLayout): SemanticSelection {
  const first = `body-0`;
  const last = `body-${layout.pages.length - 1}`;
  return {
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: last, offset: 10 },
  };
}

function measure(
  layout: SemanticLayout,
  selection: SemanticSelection,
  pages?: ReadonlySet<number>
): { pages: number; lines: number; rects: number } {
  const recorder = presenceWalkRecorder();
  recorder.reset();
  const rects = presenceSelectionRects(layout, selection, everyStoryOrder(layout), pages);
  return { pages: recorder.pages, lines: recorder.lines, rects: rects.length };
}

describe('presenceSelectionRects cost', () => {
  test('an unbounded select-all walks every body line', () => {
    const layout = layoutOf(80);
    const walked = measure(layout, selectAll(layout));
    expect(walked.pages).toBe(80);
    expect(walked.lines).toBe(80 * LINES_PER_PAGE);
  });

  test('a materialized-page bound stays O(visible pages), not O(document)', () => {
    const visible = new Set([0, 1, 2]);
    const small = layoutOf(80);
    const large = layoutOf(160);
    const smallWalk = measure(small, selectAll(small), visible);
    const largeWalk = measure(large, selectAll(large), visible);
    expect(smallWalk.pages).toBe(3);
    expect(smallWalk.lines).toBe(3 * LINES_PER_PAGE);
    expect(largeWalk.pages).toBe(smallWalk.pages);
    expect(largeWalk.lines).toBe(smallWalk.lines);
    expect(smallWalk.lines).toBeLessThan((80 * LINES_PER_PAGE) / 4);
  });

  test('bounded rects match the unbounded walk filtered to those pages', () => {
    const layout = layoutOf(40);
    const selection = selectAll(layout);
    const order = everyStoryOrder(layout);
    const visible = new Set([0, 1, 2]);
    const bounded = presenceSelectionRects(layout, selection, order, visible);
    const unbounded = presenceSelectionRects(layout, selection, order);
    expect(bounded).toEqual(unbounded.filter((rect) => visible.has(rect.pageIndex)));
  });

  test('a header selection still paints when its page is materialized', () => {
    const layout = layoutOf(40, { header: true });
    const selection: SemanticSelection = {
      anchor: { paragraphId: HEADER_ID, offset: 0 },
      head: { paragraphId: HEADER_ID, offset: 10 },
    };
    const onPage = measure(layout, selection, new Set([0]));
    const offPage = measure(layout, selection, new Set([5]));
    expect(onPage.rects).toBeGreaterThan(0);
    expect(onPage.lines).toBe(LINES_PER_PAGE + 1);
    expect(offPage.rects).toBe(0);
    expect(offPage.lines).toBe(LINES_PER_PAGE);
  });

  test('a table-cell selection still paints when its page is materialized', () => {
    const cellId = 'cell-0';
    const layout = layoutOf(40, { tableCellId: cellId });
    const selection: SemanticSelection = {
      anchor: { paragraphId: cellId, offset: 0 },
      head: { paragraphId: cellId, offset: 10 },
    };
    const onPage = measure(layout, selection, new Set([0]));
    const offPage = measure(layout, selection, new Set([5]));
    expect(onPage.rects).toBeGreaterThan(0);
    expect(onPage.lines).toBe(LINES_PER_PAGE + 1);
    expect(offPage.rects).toBe(0);
    expect(offPage.lines).toBe(LINES_PER_PAGE);
  });
});
