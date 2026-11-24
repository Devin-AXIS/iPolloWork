import { describe, expect, test } from 'bun:test';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { revisionAuthorFilter } from '../../layout/revision-projection.ts';
import { paragraphFragmentsOfBlocks } from '../../layout/semantic-record-queries.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { lay, load } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { authorSlotsOf } from '../revision-presentation.ts';
import { blockContentSummary } from '../block-content-summary.ts';
import { collectUsedDrawingResourceKeys } from '../semantic-paint-drawings.ts';

// The author roster and the drawing-resource walk read one memoised summary per block list.
// These tests hold the summary to a reference walk of the published records, across width
// changes (which rebuild every record but keep property lists), author filters and edits.

/** The roster walk as written before the summary: two passes, no memo. */
function referenceAuthors(blocks: readonly BlockFragmentRecord[]): string[] {
  const found: string[] = [];
  const see = (author: string) => {
    if (author !== '' && !found.includes(author)) found.push(author);
  };
  for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
    for (const property of fragment.props)
      if (property.localName === 'pPrChange') see(property.attributes?.author ?? '');
    for (const line of fragment.lines) {
      for (const revision of line.changeSites ?? []) see(revision.author);
      for (const span of line.spans) {
        for (const revision of span.revisions ?? []) see(revision.author);
        const change = span.props.find(
          (property) => property.localName === 'rPrChange' || property.localName === 'pPrChange'
        );
        if (change) see(change.attributes?.author ?? '');
      }
    }
    for (const line of fragment.lines)
      for (const drawing of line.drawings ?? []) {
        for (const revision of drawing.revisions ?? []) see(revision.author);
        if (drawing.textboxStory && !drawing.accessibility.hidden)
          for (const author of referenceAuthors(drawing.textboxStory.fragments)) see(author);
      }
    for (const revision of fragment.markRevisions ?? []) see(revision.author);
  }
  const cells = (items: readonly BlockFragmentRecord[]): void => {
    for (const block of items) {
      if (block.kind !== 'table') continue;
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.revisionShadingAuthor) see(cell.revisionShadingAuthor);
          cells(cell.blocks);
        }
    }
  };
  cells(blocks);
  return found;
}

function referenceSlots(layout: SemanticLayout): string[] {
  const slots: string[] = [];
  for (const page of layout.pages)
    for (const author of referenceAuthors(page.fragments))
      if (!slots.includes(author)) slots.push(author);
  return slots;
}

const childrenOf = (node: OoxmlNode, kind: string): OoxmlNode[] =>
  'children' in node ? (node.children as OoxmlNode[]).filter((n) => n.kind === kind) : [];

function cellParagraphId(part: OoxmlPart, r: number, c: number): string {
  const body = childrenOf(part.root, 'body')[0]!;
  const row = childrenOf(childrenOf(body, 'table')[0]!, 'tableRow')[r]!;
  return childrenOf(childrenOf(row, 'tableCell')[c]!, 'paragraph')[0]!.id;
}

/** An AutoFit table across several pages with insertions, deletions and format changes. */
function trackedTable(formatAuthor = 'Bob'): string {
  const cell = (r: number, c: number) => {
    const text = `R${r}C${c}`;
    let content = `<w:r><w:t>${text}</w:t></w:r>`;
    if (r % 7 === 2 && c === 1)
      content = `<w:ins w:id="${r}1" w:author="Ann"><w:r><w:t>${text}</w:t></w:r></w:ins>`;
    if (r % 7 === 4 && c === 2)
      content =
        `<w:r><w:rPr><w:b/><w:rPrChange w:id="${r}2" w:author="${formatAuthor}">` +
        `<w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
    if (r === 30 && c === 0)
      content =
        `<w:r><w:t>${text}</w:t></w:r><w:del w:id="${r}3" w:author="Dee">` +
        '<w:r><w:delText>gone</w:delText></w:r></w:del>';
    return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${content}</w:p></w:tc>`;
  };
  const rows = Array.from(
    { length: 40 },
    (_, r) => `<w:tr>${[0, 1, 2].map((c) => cell(r, c)).join('')}</w:tr>`
  ).join('');
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>' +
    `${'<w:gridCol w:w="600"/>'.repeat(3)}</w:tblGrid>${rows}</w:tbl>`
  );
}

describe('the author roster from block summaries', () => {
  test('matches the reference walk across width changes and edits', () => {
    let part = load(trackedTable());
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    let layout = lay(part, 15, { session, cache });
    expect(layout.pages.length).toBeGreaterThan(1);
    expect([...authorSlotsOf(layout).keys()]).toEqual(referenceSlots(layout));
    expect([...authorSlotsOf(layout).keys()]).toEqual(['Ann', 'Bob', 'Dee']);
    for (const text of ['XXXXXXXXXX', 'YYYYYYYYYYYY']) {
      const edges = layout.pages[0]!.fragments.find((block) => block.kind === 'table');
      const op = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: cellParagraphId(part, 1, 0),
        offset: 0,
        text,
      });
      if (!op.ok) throw new Error(op.reason);
      part = op.part;
      layout = lay(part, 15, { session, cache });
      const table = layout.pages[0]!.fragments.find((block) => block.kind === 'table');
      // A width change: every table record is new, its property lists are not.
      expect(table && edges && table.kind === 'table' && edges.kind === 'table').toBe(true);
      if (table?.kind === 'table' && edges?.kind === 'table')
        expect(table.columnEdges).not.toEqual(edges.columnEdges);
      expect([...authorSlotsOf(layout).keys()]).toEqual(referenceSlots(layout));
    }
  });

  test('a changed format author and an author filter are never served from the memo', () => {
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const bob = lay(load(trackedTable('Bob')), 15, { session, cache });
    expect([...authorSlotsOf(bob).keys()]).toContain('Bob');
    const cy = lay(load(trackedTable('Cy')), 15, { session, cache });
    expect([...authorSlotsOf(cy).keys()]).toEqual(referenceSlots(cy));
    expect([...authorSlotsOf(cy).keys()]).toContain('Cy');
    expect([...authorSlotsOf(cy).keys()]).not.toContain('Bob');
    const filtered = lay(load(trackedTable('Bob')), 15, {
      session,
      cache,
      revisionAuthorFilter: revisionAuthorFilter(['Ann']),
    });
    expect([...authorSlotsOf(filtered).keys()]).toEqual(referenceSlots(filtered));
    expect([...authorSlotsOf(filtered).keys()]).not.toContain('Ann');
    const unfiltered = lay(load(trackedTable('Bob')), 15, { session, cache });
    expect([...authorSlotsOf(unfiltered).keys()]).toEqual(referenceSlots(unfiltered));
    expect([...authorSlotsOf(unfiltered).keys()]).toContain('Ann');
  });

  test('shared property lists preserve author order', () => {
    const changed = [{ localName: 'rPrChange', attributes: { author: 'Bob' } }];
    const plain = [{ localName: 'b' }];
    const paragraphOf = (props: readonly object[]) =>
      ({
        kind: 'paragraph',
        props: [],
        lines: [{ spans: [{ props }] }],
      }) as unknown as BlockFragmentRecord;
    expect(blockContentSummary([paragraphOf(changed)]).authors).toEqual(['Bob']);
    expect(blockContentSummary([paragraphOf(changed)]).authors).toEqual(['Bob']);
    expect(blockContentSummary([paragraphOf(plain)]).authors).toEqual([]);
    const anonymous = [{ localName: 'pPrChange', attributes: {} }];
    expect(blockContentSummary([paragraphOf(anonymous)]).authors).toEqual([]);
  });
});

describe('drawing resources stay alive wherever a drawing can sit', () => {
  const ready = (key: string) => ({
    resource: { kind: 'ready', resourceKey: key },
    drawingNodeId: key,
    accessibility: { hidden: false },
  });
  const paragraph = (options: { drawing?: string; bullet?: string } = {}) => ({
    kind: 'paragraph',
    props: [],
    lines: [{ spans: [], ...(options.drawing ? { drawings: [ready(options.drawing)] } : {}) }],
    ...(options.bullet ? { marker: { picture: ready(options.bullet) } } : {}),
  });
  const table = (rows: readonly { repeat?: boolean; blocks: readonly object[] }[]) => ({
    kind: 'table',
    rows: rows.map((row) => ({
      isHeaderRepeat: row.repeat === true,
      cells: [{ blocks: row.blocks }],
    })),
  });
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const layoutOf = (page: object) =>
    ({ pages: [{ index: 0, box, contentBox: box, ...page }] }) as unknown as SemanticLayout;
  const keys = (page: object) => [...collectUsedDrawingResourceKeys(layoutOf(page))].sort();

  test('a drawing-free page reports no keys', () => {
    expect(keys({ fragments: [paragraph(), table([{ blocks: [paragraph()] }])] })).toEqual([]);
  });

  test('a picture in a repeated header row is kept', () => {
    const fragments = [
      table([{ repeat: true, blocks: [paragraph({ drawing: 'repeat-image' })] }, { blocks: [] }]),
    ];
    expect(keys({ fragments })).toEqual(['repeat-image']);
  });

  test('a picture in a nested table is kept', () => {
    const fragments = [
      table([{ blocks: [table([{ blocks: [paragraph({ drawing: 'nested-image' })] }])] }]),
    ];
    expect(keys({ fragments })).toEqual(['nested-image']);
  });

  test('a picture bullet with no drawing beside it is kept', () => {
    const fragments = [table([{ blocks: [paragraph({ bullet: 'bullet-image' })] }])];
    expect(keys({ fragments })).toEqual(['bullet-image']);
  });

  test('anchored drawings on a drawing-free body and in a footer are kept', () => {
    expect(
      keys({
        fragments: [paragraph()],
        anchoredDrawings: [ready('body-anchor')],
        footer: { kind: 'footer', box, fragments: [paragraph({ drawing: 'footer-image' })] },
      })
    ).toEqual(['body-anchor', 'footer-image']);
  });

  test('a removed picture stops being reported on the next layout', () => {
    expect(keys({ fragments: [paragraph({ drawing: 'image' })] })).toEqual(['image']);
    expect(keys({ fragments: [paragraph()] })).toEqual([]);
  });
});
