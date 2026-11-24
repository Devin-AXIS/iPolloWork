import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { caretAt } from '../semantic-interaction.ts';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { offerPreviousRows, takePreviousRows } from '../table-row-placement-reuse.ts';
import { movedRowsTestRecorder, shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import {
  captureDeferredWidthRecipe,
  deferredWidthRecipe,
  deferredWidthRecipeHolds,
  sameWidthHeaderInsets,
} from '../table-deferred-width-fragment.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines. Token text is 6pt per character.
/** `pPr` holds properties that precede `w:spacing` in `CT_PPr`, `trailing` those after it. */
const p = (text: string, pPr = '', trailing = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/>${pPr}` +
  `<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>${trailing}</w:pPr>` +
  (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p>';
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const MARGINS =
  '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="60" w:type="dxa"/>' +
  '<w:bottom w:w="20" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[], columns = 3) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>${rows.join('')}</w:tbl>`;

// Alignments, indents and vertical centring that a moved line must reproduce exactly.
const FORMATS = [
  '',
  '<w:jc w:val="center"/>',
  '<w:jc w:val="right"/>',
  '<w:jc w:val="both"/>',
  '<w:ind w:left="120" w:right="80" w:firstLine="100"/>',
  '<w:ind w:left="200" w:hanging="100"/><w:jc w:val="center"/>',
];
const tokenRow = (i: number) =>
  tr(
    [0, 1, 2].map((c) =>
      tc(
        // Some empty cells: an empty line places its content edge from the line indent.
        p((i * 3 + c) % 7 === 0 ? '' : `R${i}C${c}`, '', FORMATS[(i + c) % FORMATS.length]),
        c === 1 ? '<w:vAlign w:val="center"/>' : c === 2 ? '<w:vAlign w:val="bottom"/>' : ''
      )
    ),
    i % 4 === 0 ? '<w:trHeight w:val="400" w:hRule="atLeast"/>' : ''
  );

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const edges = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .map((fragment) => [fragment.box.x, fragment.columnEdges])
  );
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;

let recorder = movedRowsTestRecorder();
afterEach(() => {
  recorder.dispose();
  recorder = movedRowsTestRecorder();
});

/** Type `text` into a cell through a retained session, checking every step against cold. */
function burst(
  start: OoxmlPart,
  paragraphId: string,
  text: string,
  retained?: {
    session: ReturnType<typeof createLayoutSession>;
    cache: ReturnType<typeof createParagraphLayoutCache>;
  }
) {
  const session = retained?.session ?? createLayoutSession();
  const cache = retained?.cache ?? createParagraphLayoutCache();
  let part = start;
  let previous = lay(part, 15, { session, cache });
  let widthChanges = 0;
  const compactBefore = recorder.compact;
  let deferredFragments = 0;
  let deferredUnread = 0;
  const moved: number[] = [];
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const before = recorder.moved;
    const reads: { count: number }[] = [];
    for (const page of previous.pages)
      for (const fragment of page.fragments) {
        if (fragment.kind !== 'table') continue;
        const descriptor = Object.getOwnPropertyDescriptor(fragment, 'rows');
        if (!descriptor?.get) continue;
        const counter = { count: 0 };
        reads.push(counter);
        Object.defineProperty(fragment, 'rows', {
          ...descriptor,
          get() {
            counter.count++;
            return descriptor.get!.call(fragment);
          },
        });
      }
    const updated = lay(part, 15, { session, cache });
    deferredUnread += reads.filter((counter) => counter.count === 0).length;
    for (const page of updated.pages)
      for (const fragment of page.fragments)
        if (fragment.kind === 'table' && Object.getOwnPropertyDescriptor(fragment, 'rows')?.get)
          deferredFragments++;
    expect(updated.pages).toEqual(lay(reparsed(part)).pages);
    if (edges(previous) !== edges(updated)) {
      widthChanges += 1;
      moved.push(recorder.moved - before);
    }
    previous = updated;
  }
  return {
    widthChanges,
    deferredFragments,
    deferredUnread,
    moved,
    part,
    session,
    cache,
    compactMoved: recorder.compact - compactBefore,
  };
}

test('ordinary single-line rows move to new widths with cold-layout geometry', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => tokenRow(i))));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(2);
  // Every body row except the edited one moves; header-less, so 29 rows per width change.
  expect(result.moved.every((count) => count >= 29)).toBe(true);
  // Moved cells report their placement's break keys, so retention keeps those entries.
  const keys = new Set(tableCellBreakKeysOf(tableNode(result.part)));
  expect(keys.size).toBeGreaterThanOrEqual(30 * 3 - 1);
});

test('empty cells and repeated header rows', () => {
  const header = tr([tc(p('Head0')), tc(p('Head1')), tc(p('Head2'))], '<w:tblHeader/>');
  const rows = Array.from({ length: 40 }, (_, i) =>
    tr([0, 1, 2].map((c) => tc(p((i + c) % 3 === 0 ? '' : `R${i}C${c}`))))
  );
  const part = load(autofit([header, ...rows]));
  const result = burst(part, paragraphAt(part, 21, 1), 'WIDTHWIDTHWIDTH');
  expect(result.widthChanges).toBeGreaterThan(1);
  // Body rows move; header rows and their repeats are placed again.
  expect(result.moved.every((count) => count >= 38)).toBe(true);
});

test('cached complete body groups preserve geometry and break keys across width revisions', () => {
  const headers = [
    tr([tc(p('Head'), '<w:vMerge w:val="restart"/>'), tc(p('A')), tc(p('B'))], '<w:tblHeader/>'),
    tr([tc(p(''), '<w:vMerge/>'), tc(p('C')), tc(p('D'))], '<w:tblHeader/>'),
  ];
  const rows = Array.from({ length: 60 }, (_, index) =>
    tr([0, 1, 2].map((cell) => tc(p(`R${index}C${cell}`))))
  );
  const part = load(autofit([...headers, ...rows]));
  const result = burst(part, paragraphAt(part, 31, 1), 'WIDTHWIDTHWIDTH');
  expect(result.widthChanges).toBeGreaterThan(3);
  expect(result.deferredFragments).toBeGreaterThan(0);
  expect(result.deferredUnread).toBeGreaterThan(0);
  expect(result.moved[0]).toBeGreaterThan(50);
  expect(result.moved.slice(1).some((count) => count < 30)).toBe(true);
  const keys = new Set(tableCellBreakKeysOf(tableNode(result.part)));
  expect(keys.size).toBeGreaterThanOrEqual(60 * 3 - 1);
  const retained = lay(result.part, 15, { session: result.session, cache: result.cache });
  const fragment = retained.pages
    .flatMap((page) => page.fragments)
    .find(
      (fragment): fragment is TableFragmentRecord =>
        fragment.kind === 'table' && !!deferredWidthRecipe(fragment)
    )!;
  const recipe = deferredWidthRecipe(fragment)!;
  expect(recipe).toBeDefined();
  const structure = {
    ...readTableStructure(tableNode(result.part), 310, 0, styleCascade)!,
    columnWidthsPt: fragment
      .columnEdges!.slice(1)
      .map((edge, index) => edge - fragment.columnEdges![index]!),
  };
  const sourceMap = new Map(recipe.sources.map((row) => [row.id, row]));
  const scope = recipe.body.dependencyKey;
  expect(deferredWidthRecipeHolds(recipe, sourceMap, structure, fragment.box.x, scope)).toBe(true);
  expect(
    deferredWidthRecipeHolds(recipe, sourceMap, structure, fragment.box.x, scope + 'changed')
  ).toBe(false);
  const changedSources = new Map(sourceMap);
  changedSources.set(recipe.sources[0]!.id, { ...recipe.sources[0]! });
  expect(deferredWidthRecipeHolds(recipe, changedSources, structure, fragment.box.x, scope)).toBe(
    false
  );
  for (const columnWidthsPt of [
    [0, 100, 100],
    [Infinity, 100, 100],
    [100, 100],
  ])
    expect(
      deferredWidthRecipeHolds(
        recipe,
        sourceMap,
        { ...structure, columnWidthsPt },
        fragment.box.x,
        scope
      )
    ).toBe(false);
  const header = recipe.headers[0]!;
  const insets = new Map([['cell', { top: 1, right: 2, bottom: 3, left: 4 }]]);
  const sample = { ...header, insets };
  expect(sameWidthHeaderInsets(sample, { ...header, insets: new Map(insets) })).toBe(true);
  for (const side of ['top', 'right', 'bottom', 'left'] as const)
    expect(
      sameWidthHeaderInsets(sample, {
        ...header,
        insets: new Map([['cell', { ...insets.get('cell')!, [side]: 9 }]]),
      })
    ).toBe(false);
  expect(sameWidthHeaderInsets(sample, { ...header, insets: undefined })).toBe(false);
  for (const height of [Infinity, -Infinity, NaN]) {
    const candidate = { ...fragment };
    const badHeaders = recipe.headers.map((value, index) =>
      index
        ? value
        : {
            ...value,
            record: { ...value.record, box: { ...value.record.box, height } },
          }
    );
    captureDeferredWidthRecipe(
      candidate,
      recipe.body,
      badHeaders,
      recipe.sources.slice(0, recipe.headers.length),
      structure
    );
    expect(deferredWidthRecipe(candidate)).toBeUndefined();
  }
  const undone = lay(part, 15, { session: result.session, cache: result.cache });
  expect(undone.pages).toEqual(lay(reparsed(part)).pages);
});

test('undo moves rows back to the original widths', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => tokenRow(i))));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDE');
  const before = recorder.moved;
  const undone = lay(part, 15, { session: result.session, cache: result.cache });
  expect(undone.pages).toEqual(lay(part).pages);
  expect(recorder.moved - before).toBeGreaterThan(20);
});

for (const [name, content] of [
  ['a trailing space', (i: number) => p(`A${i} `)],
  ['two paragraphs', (i: number) => p(`P${i}`) + p('Q')],
  ['paragraph shading', (i: number) => p(`S${i}`, '<w:shd w:val="clear" w:fill="FFEE00"/>')],
] as const)
  test(`cells with ${name} are placed again, not moved`, () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      tr([tc(content(i)), tc(p(`R${i}C1`)), tc(p(`R${i}C2`))])
    );
    const part = load(autofit(rows));
    const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
    expect(result.widthChanges).toBeGreaterThan(0);
    expect(result.moved.every((count) => count === 0)).toBe(true);
  });

test('cells with ordinary inner spaces move like token cells', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([tc(p(`Item ${i} (net) 1.5`)), tc(p(`R${i} C1`)), tc(p(` R${i}  C2`))])
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(0);
  expect(result.moved.every((count) => count >= 29)).toBe(true);
});

test('a line that wraps at the new width is not moved', () => {
  // The long token in row 5 fits only while its column keeps its share of the table.
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([tc(p(i === 5 ? 'L'.repeat(16) : `R${i}C0`)), tc(p(`R${i}C1`)), tc(p(`R${i}C2`))])
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'MUCHWIDERTEXTHERE');
  expect(result.widthChanges).toBeGreaterThan(0);
});

test('a moved row equals a fresh placement, and every break input change refuses it', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { createFixedMeasurer } = await import('../semantic-layout.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit(Array.from({ length: 6 }, (_, i) => tokenRow(i))));
  const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
  const deps = {
    measurer,
    styleCascade,
    // The move reads the placed line back from the break cache.
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const narrow = [90, 100, 110];
  const wide = [100.5, 95.25, 104.125];
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, narrow, 3, 40, false, 0, deps).record;
    // Before any fresh placement at the new width: that one moves the cache entry to its key.
    const moved = moveRowToWidths(row, placed, wide, 2.5, deps);
    expect(moved).toEqual(layoutRowFragment(row, wide, 2.5, 40, false, 0, deps).record);
    const again = layoutRowFragment(row, narrow, 3, 40, false, 0, deps).record;
    // Each input of the break key, and each dependency of the line, must still match.
    for (const changed of [
      { producer: 'another-font' },
      { measurer: createFixedMeasurer(6, 14) },
      { styleCascade: undefined },
      { displayMode: 'proposed' as const },
      { compatibilityMode: 14 },
      { projectionTokenForParagraph: () => 'field-value' },
      { drawingTokenForParagraph: () => 'picture' },
      { listItems: new Map(row.cells.map((cell) => [cell.blocks[0]!.id, {} as never])) },
      { cache: createParagraphLayoutCache<never>() },
      { cache: undefined },
    ])
      expect(moveRowToWidths(row, again, wide, 2.5, { ...deps, ...changed })).toBeNull();
    // A width that no longer holds the line needs a fresh break.
    expect(moveRowToWidths(row, again, [20, 20, 20], 0, deps)).toBeNull();
    expect(moveRowToWidths(row, again, wide, 2.5, deps)).not.toBeNull();
  }
});

test('a row whose paragraph changed, or whose line inputs changed, is not moved', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit([tokenRow(1), tokenRow(2)]));
  const deps = {
    measurer,
    styleCascade,
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const before = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[0]!;
  const placed = layoutRowFragment(before, [90, 100, 110], 3, 40, false, 0, deps).record;
  expect(moveRowToWidths(before, placed, [100, 95, 105], 2.5, deps)).not.toBeNull();
  // Same formatting, new text: the old line must not be moved under the new paragraph.
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: before.cells[1]!.blocks[0]!.id,
    offset: 0,
    text: 'X',
  });
  if (!edit.ok) throw Error(edit.reason);
  const after = readTableStructure(tableNode(edit.part), 310, 0, styleCascade)!.rows[0]!;
  expect(moveRowToWidths(after, placed, [100, 95, 105], 2.5, deps)).toBeNull();
  // Same paragraph, a line-grid unit that changes its line inputs.
  const gridded = { ...deps, paragraphLineUnitPt: 18 };
  expect(moveRowToWidths(before, placed, [100, 95, 105], 2.5, gridded)).toBeNull();
});

test('saved pagination markers preserve moved rows and caret geometry', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    tokenRow(i).replaceAll('<w:t ', '<w:lastRenderedPageBreak/><w:t ')
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(2);
  expect(result.moved.every((count) => count >= 29)).toBe(true);
  const retained = lay(result.part, 15, { session: result.session, cache: result.cache });
  const cold = lay(reparsed(result.part));
  const paragraphId = paragraphAt(result.part, 7, 2);
  for (const offset of [0, 1, 4]) {
    const position = { paragraphId, offset };
    expect(caretAt(retained, position)).not.toBeNull();
    expect(caretAt(retained, position)).toEqual(caretAt(cold, position));
  }
});

test('captured width recipes reproduce moved cells without live layout dependencies', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { captureCellWidthPlacement, placeCellFromWidthRecipe } =
    await import('../table-cell-width-placement.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit(Array.from({ length: 12 }, (_, i) => tokenRow(i))));
  const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
  const deps = {
    measurer,
    styleCascade,
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  let captured = 0;
  let empty = 0;
  let refused = 0;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, [90, 100, 110], 3, 40, false, 0, deps).record;
    const recipes: (import('../table-cell-width-placement.ts').CellWidthPlacement | null)[] = [];
    const moved = moveRowToWidths(row, placed, [100.5, 95.25, 104.125], 2.5, deps, (recipe) =>
      recipes.push(recipe)
    );
    expect(moved).not.toBeNull();
    expect(recipes).toHaveLength(row.cells.length);
    for (let cell = 0; cell < recipes.length; cell++) {
      const recipe = recipes[cell];
      if (!recipe) {
        refused++;
        continue;
      }
      captured++;
      if (!recipe.pending.spans.length) empty++;
      expect(placeCellFromWidthRecipe(recipe, [100.5, 95.25, 104.125], 2.5)).toEqual(
        moved!.cells[cell]
      );
      expect(Object.keys(recipe)).toEqual([
        'breakKey',
        'baseline',
        'pending',
        'firstLineOffset',
        'alignment',
        'constraint',
      ]);
      for (const columns of [
        [110.125, 102.375, 117.25],
        [125, 130, 135],
      ]) {
        const fresh = layoutRowFragment(row, columns, -3.125, 40, false, 0, deps).record;
        const pure = placeCellFromWidthRecipe(recipe, columns, -3.125);
        expect(pure).toEqual(fresh.cells[cell]);
        expect(JSON.stringify(pure)).toBe(JSON.stringify(fresh.cells[cell]));
      }
      expect(placeCellFromWidthRecipe(recipe, [Infinity, 100, 100], 0)).toBeNull();
      expect(placeCellFromWidthRecipe(recipe, [-1, 100, 100], 0)).toBeNull();
      if (recipe.pending.spans.length) {
        for (const metadata of [
          { fieldAtom: { formField: false } },
          { noteNav: { scopeId: 'note', direction: 'to-note' as const } },
          { noteSeparator: 'separator' as const },
        ]) {
          const pending = {
            ...recipe.pending,
            spans: recipe.pending.spans.map((span) => ({ ...span, ...metadata })),
          };
          expect(
            captureCellWidthPlacement(
              recipe.baseline,
              pending,
              recipe.constraint,
              recipe.firstLineOffset,
              recipe.alignment
            )
          ).toBeNull();
        }
      }
    }
  }
  expect(captured).toBeGreaterThan(20);
  expect(empty).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(0);
});

test('a body-group certificate rebuilds exact finalized rows from its original recipes', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { finalizeTableRows } = await import('../table-fragment-finalize.ts');
  const { createBodyWidthGroup, bodyWidthGroupHolds, materializeBodyWidthGroup } =
    await import('../table-body-width-group.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(
    autofit(
      Array.from({ length: 35 }, (_, row) =>
        tr([0, 1, 2].map((cell) => tc(p((row + cell) % 7 ? `R${row}C${cell}` : '', FORMATS[cell]))))
      )
    )
  );
  const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
  const deps = {
    measurer,
    styleCascade,
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const narrow = [90, 100, 110];
  const place = (columns: number[], left: number) =>
    structure.rows.map(
      (row, index) => layoutRowFragment(row, columns, left, 40 + index * 20, false, 0, deps).record
    );
  const baseline = finalizeTableRows(
    place(narrow, 3),
    { ...structure, columnWidthsPt: narrow },
    structure.rows
  );
  const captured: import('../table-body-width-group.ts').BodyWidthRow[] = [];
  for (let index = 0; index < structure.rows.length; index++) {
    const source = structure.rows[index]!;
    const cells: import('../table-cell-width-placement.ts').CellWidthPlacement[] = [];
    expect(
      moveRowToWidths(source, baseline[index]!, [100, 110, 120], 2.5, deps, (recipe) => {
        expect(recipe).not.toBeNull();
        cells.push(recipe!);
      })
    ).not.toBeNull();
    captured.push({ source, baseline: baseline[index]!, cells });
  }
  for (const field of ['gridColumn', 'gridSpan'] as const) {
    const first = captured[0]!;
    const cells = first.cells.map((cell, index) =>
      index
        ? cell
        : {
            ...cell,
            constraint: { ...cell.constraint, [field]: cell.constraint[field] + 1 },
          }
    );
    expect(createBodyWidthGroup([{ ...first, cells }], 3, 'dependencies')).toBeNull();
  }
  const group = createBodyWidthGroup(captured, 3, 'dependencies')!;
  expect(group.fit.cellCount).toBe(105);
  expect(group.fit.groups.length).toBeLessThanOrEqual(3);
  for (const columns of [[100.5, 110.25, 120.125], [125, 130, 135], narrow]) {
    const rebuilt = materializeBodyWidthGroup(
      group,
      structure.rows,
      columns,
      -3.125,
      'dependencies'
    )!;
    expect(rebuilt).not.toBeNull();
    const finalized = finalizeTableRows(
      rebuilt,
      { ...structure, columnWidthsPt: columns },
      structure.rows
    );
    const fresh = finalizeTableRows(
      place(columns, -3.125),
      { ...structure, columnWidthsPt: columns },
      structure.rows
    );
    expect(finalized).toEqual(fresh);
    expect(JSON.stringify(finalized)).toBe(JSON.stringify(fresh));
    expect(group.rows[0]!.baseline.cells).toHaveLength(0);
    const template = group.rows[0]!.cells[0]!.baseline.blocks[0]!;
    expect(template.kind).toBe('paragraph');
    if (template.kind === 'paragraph') expect(template.lines[0]!.spans).toHaveLength(0);
  }
  expect(bodyWidthGroupHolds(group, structure.rows, [100, 110, 120], 0, 'changed')).toBe(false);
  expect(
    bodyWidthGroupHolds(
      group,
      [{ ...structure.rows[0]! }, ...structure.rows.slice(1)],
      [100, 110, 120],
      0,
      'dependencies'
    )
  ).toBe(false);
  expect(bodyWidthGroupHolds(group, structure.rows, [1, 1, 1], 0, 'dependencies')).toBe(false);
  expect(
    createBodyWidthGroup(
      [{ ...captured[0]!, source: { ...captured[0]!.source, isHeader: true } }],
      3,
      'dependencies'
    )
  ).toBeNull();
});

test('numeric multiline cells move only while every automatic cut remains unchanged', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit([tr([tc(p('123456789')), tc(p('Short')), tc(p('End'))])]));
  const row = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[0]!;
  const deps = {
    measurer,
    styleCascade,
    cache: createParagraphLayoutCache<never>(),
    producer: 'numeric-test',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const baseline = layoutRowFragment(row, [27, 100, 100], 3, 40, false, 0, deps).record;
  const block = baseline.cells[0]!.blocks[0]!;
  expect(block.kind).toBe('paragraph');
  if (block.kind !== 'paragraph') throw Error('Expected paragraph');
  expect(block.lines.length).toBeGreaterThan(1);
  for (const columns of [
    [27.125, 100, 100],
    [27.5, 100, 100],
    [28, 100, 100],
  ]) {
    const moved = moveRowToWidths(row, baseline, columns, 2.5, deps);
    expect(moved).not.toBeNull();
    expect(moved).toEqual(
      layoutRowFragment(row, columns, 2.5, 40, false, 0, {
        ...deps,
        cache: createParagraphLayoutCache<never>(),
      }).record
    );
  }
  expect(moveRowToWidths(row, baseline, [100, 100, 100], 2.5, deps)).toBeNull();
  expect(moveRowToWidths(row, baseline, [10, 100, 100], 2.5, deps)).toBeNull();
});

test('numeric multiline movement preserves horizontal and vertical alignment after finalization', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths, moveRowToTop } = await import('../table-row-geometry-reuse.ts');
  const { createBodyWidthGroup, materializeBodyWidthGroup, bodyWidthGroupHolds } =
    await import('../table-body-width-group.ts');
  const { placeCellFromWidthRecipe } = await import('../table-cell-width-placement.ts');
  const { finalizeTableRows } = await import('../table-fragment-finalize.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  for (const alignment of ['left', 'center', 'right'])
    for (const vertical of ['top', 'center', 'bottom']) {
      const part = load(
        autofit([
          tr(
            [
              tc(
                p('123456789', '', `<w:ind w:left="-15"/><w:jc w:val="${alignment}"/>`).replace(
                  'w:before="0" w:after="0" w:line="280"',
                  'w:before="13" w:after="17" w:line="277"'
                ),
                `<w:vAlign w:val="${vertical}"/>`
              ),
              tc(p('Short')),
              tc(p('End')),
            ],
            '<w:trHeight w:val="1600" w:hRule="atLeast"/>'
          ),
        ])
      );
      const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
      const row = structure.rows[0]!;
      const deps = {
        measurer,
        styleCascade,
        cache: createParagraphLayoutCache<never>(),
        producer: 'numeric-test',
        nextLineId: bodyLineId,
        compatibilityMode: 15,
        displayMode: 'all-markup' as const,
      };
      const oldStructure = { ...structure, columnWidthsPt: [27, 100, 100] };
      const raw = layoutRowFragment(row, oldStructure.columnWidthsPt, 3, 40, false, 0, deps).record;
      const baseline = finalizeTableRows([raw], oldStructure, structure.rows)[0]!;
      const columns = [27.5, 100, 100];
      const recipes: import('../table-cell-width-placement.ts').CellWidthPlacement[] = [];
      const moved = moveRowToWidths(row, baseline, columns, 2.5, deps, (recipe) => {
        expect(recipe).not.toBeNull();
        recipes.push(recipe!);
      });
      expect(moved).not.toBeNull();
      expect(recipes).toHaveLength(3);
      expect(recipes[0]!.numericLines!.length).toBeGreaterThan(1);
      for (let index = 0; index < recipes.length; index++)
        expect(placeCellFromWidthRecipe(recipes[index]!, columns, 2.5)).toEqual(
          moved!.cells[index]
        );
      const group = createBodyWidthGroup(
        [{ source: row, baseline, cells: recipes }],
        3,
        'numeric'
      )!;
      expect(group).not.toBeNull();
      const compact = group.rows[0]!.cells[0]!.baseline.blocks[0]!;
      if (compact.kind !== 'paragraph') throw Error('Expected paragraph');
      expect(compact.lines.every((line) => line.spans.length === 0)).toBe(true);
      for (const refused of [
        [10, 100, 100],
        [100, 100, 100],
      ])
        expect(bodyWidthGroupHolds(group, [row], refused, 2.5, 'numeric')).toBe(false);
      const grouped = materializeBodyWidthGroup(group, [row], columns, 2.5, 'numeric')!;
      expect(grouped).not.toBeNull();
      const nextStructure = { ...structure, columnWidthsPt: columns };
      const compactRow = group.rows[0]!;
      const compactBaseline = {
        ...compactRow.baseline,
        cells: compactRow.cells.map((cell) => cell.baseline),
      };
      for (const top of [0, 0.1, 41.17, 311.125]) {
        const freshShifted = layoutRowFragment(row, columns, 2.5, top, false, 0, {
          ...deps,
          cache: createParagraphLayoutCache<never>(),
        });
        const expectedShifted = finalizeTableRows(
          [freshShifted.record],
          nextStructure,
          structure.rows
        );
        for (const compact of [false, true]) {
          const shifted = moveRowToTop(
            row,
            compact ? compactBaseline : baseline,
            columns,
            2.5,
            top,
            deps,
            compact ? compactRow.cells : undefined
          );
          expect(shifted).not.toBeNull();
          expect(shifted!.bottom).toBe(freshShifted.bottom);
          expect(finalizeTableRows([shifted!.record], nextStructure, structure.rows)).toEqual(
            expectedShifted
          );
        }
      }

      const actual = finalizeTableRows(
        [moved!],
        nextStructure,
        structure.rows,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new Set([moved!])
      );
      const fresh = layoutRowFragment(row, columns, 2.5, 40, false, 0, {
        ...deps,
        cache: createParagraphLayoutCache<never>(),
      }).record;
      const expected = finalizeTableRows([fresh], nextStructure, structure.rows);
      expect(actual).toEqual(expected);
      expect(
        finalizeTableRows(
          grouped,
          nextStructure,
          structure.rows,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          new Set(grouped)
        )
      ).toEqual(expected);
    }
});

test('deferred body groups preserve wrapped numeric cells through typing and undo', () => {
  const headers = [
    tr([tc(p('Head'), '<w:vMerge w:val="restart"/>'), tc(p('A')), tc(p('B'))], '<w:tblHeader/>'),
    tr([tc(p(''), '<w:vMerge/>'), tc(p('C')), tc(p('D'))], '<w:tblHeader/>'),
  ];
  const rows = Array.from({ length: 60 }, (_, index) =>
    tr(
      [
        tc(p('1234567890123456789012345678901234567890', '', '<w:ind w:left="-15"/>')),
        tc(p('9876543210987654321098765432109876543210')),
        tc(index === 9 ? p('End').replace('w:line="280"', 'w:line="560"') : p('End')),
      ],
      '<w:cantSplit/>'
    )
  );
  const part = load(autofit([...headers, ...rows]));
  const initial = burst(part, paragraphAt(part, 31, 2), 'WIDTHWIDTHWIDTH');
  expect(initial.widthChanges).toBeGreaterThan(3);
  expect(initial.deferredFragments).toBeGreaterThan(0);
  expect(initial.deferredUnread).toBeGreaterThan(0);
  const retained = lay(initial.part, 15, { session: initial.session, cache: initial.cache });
  const recipes = retained.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .map(deferredWidthRecipe)
    .filter((recipe) => recipe !== undefined);
  expect(
    recipes.some((recipe) =>
      recipe.body.rows.some((row) => row.cells.some((cell) => (cell.numericLines?.length ?? 0) > 1))
    )
  ).toBe(true);
  const deferred = retained.pages
    .flatMap((page) => page.fragments)
    .filter(
      (fragment): fragment is TableFragmentRecord =>
        fragment.kind === 'table' && !!Object.getOwnPropertyDescriptor(fragment, 'rows')?.get
    );
  expect(deferred.length).toBeGreaterThan(0);
  const descriptors = deferred.map((fragment) =>
    Object.getOwnPropertyDescriptor(fragment, 'rows')!
  );
  try {
    for (const fragment of deferred)
      Object.defineProperty(fragment, 'rows', {
        configurable: true,
        enumerable: true,
        get() {
          throw Error('An offer must not materialize deferred rows');
        },
      });
    offerPreviousRows(tableNode(initial.part), retained.pages);
    const offered = takePreviousRows(tableNode(initial.part));
    for (const fragment of deferred)
      for (const row of deferredWidthRecipe(fragment)!.body.rows) {
        const candidate = offered?.get(row.source.id);
        expect(candidate && 'compact' in candidate).toBe(true);
      }
    const repeatedPage = retained.pages.find((page) => page.fragments.includes(deferred[0]!))!;
    offerPreviousRows(tableNode(initial.part), [...retained.pages, repeatedPage]);
    const repeatedOffer = takePreviousRows(tableNode(initial.part));
    for (const row of deferredWidthRecipe(deferred[0]!)!.body.rows)
      expect(repeatedOffer?.has(row.source.id) ?? false).toBe(false);
  } finally {
    deferred.forEach((fragment, index) =>
      Object.defineProperty(fragment, 'rows', descriptors[index]!)
    );
  }
  const shifted = shiftedRowsTestRecorder();
  try {
    const result = burst(initial.part, paragraphAt(initial.part, 11, 2), 'WWWWWWWWWW', initial);
    expect(result.compactMoved).toBeGreaterThan(0);
    expect(shifted.compact).toBeGreaterThan(0);
    const undone = lay(part, 15, { session: result.session, cache: result.cache });
    expect(undone.pages).toEqual(lay(reparsed(part)).pages);
  } finally {
    shifted.dispose();
  }
});
