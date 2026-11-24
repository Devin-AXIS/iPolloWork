import { expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { cachedAutofitCellWidths } from '../table-autofit-cell-cache.ts';
import {
  autofitContextOf,
  carryTableAutofitScope,
  type AutofitView,
} from '../table-autofit-widths.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, row, table, measurer, styleCascade } from './table-row-keep-fixtures.ts';

function fixture() {
  const part = load(table([row('value')]));
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const cell = readTableStructure(node, 310, 0, styleCascade)!.rows[0]!.cells[0]!;
  const view: AutofitView = {
    styleCascade,
    displayMode: 'all-markup',
    authorFilter: undefined,
    readNested: () => null,
  };
  return { cell, view, node };
}
const value = { least: 10, most: 20, left: 1, right: 1, wideLeft: 2, wideRight: 2 };

test('paragraph tokens stay local to one immutable flow context', () => {
  const { cell } = fixture();
  const paragraph = cell.blocks[0] as OoxmlElement;
  let reads = 0;
  const first = autofitContextOf({
    measurer,
    projectionTokenForParagraph: () => {
      reads++;
      return 'first';
    },
  });
  const token = first.paragraphToken!(paragraph);
  expect(first.paragraphToken!(paragraph)).toBe(token);
  expect(reads).toBe(1);
  const second = autofitContextOf({ measurer, projectionTokenForParagraph: () => 'second' });
  expect(second.paragraphToken!(paragraph)).not.toBe(token);
});

test('unchanged cells reuse widths across verified section revisions', () => {
  const { cell, view } = fixture();
  const first = {};
  const deps = { measurer, producer: 'same' };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  expect(cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read)).toBe(value);
  const nextDeps = { ...deps };
  expect(carryTableAutofitScope(first, {}, true, nextDeps)).toBe(true);
  expect(cachedAutofitCellWidths(cell, true, autofitContextOf(nextDeps), view, read)).toBe(value);
  expect(reads).toBe(1);
  cachedAutofitCellWidths({ ...cell }, true, autofitContextOf(nextDeps), view, read);
  expect(reads).toBe(2);
});

test('producer, view, and border-spacing changes invalidate cell widths', () => {
  const { cell, view } = fixture();
  const first = {};
  const deps = { measurer, producer: 'first' };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  const context = autofitContextOf(deps);
  cachedAutofitCellWidths(cell, true, context, view, read);
  cachedAutofitCellWidths(cell, false, context, view, read);
  cachedAutofitCellWidths(cell, false, context, { ...view, displayMode: 'original' }, read);
  const changed = { ...deps, producer: 'second' };
  expect(carryTableAutofitScope(first, {}, true, changed)).toBe(false);
  cachedAutofitCellWidths(cell, false, autofitContextOf(changed), view, read);
  expect(reads).toBe(4);
});

test('unproven contexts and nested tables retain their regular measurement path', () => {
  const { cell, view, node } = fixture();
  const deps = { measurer, producer: 'same' };
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  for (let i = 0; i < 2; i++)
    cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read);
  carryTableAutofitScope(null, {}, false, deps);
  const nested = { ...cell, blocks: [node] };
  for (let i = 0; i < 2; i++)
    cachedAutofitCellWidths(nested, true, autofitContextOf(deps), view, read);
  expect(reads).toBe(4);
});

test('a change to list items alone keeps measurements, and each cell proves its own list', () => {
  const { cell, view } = fixture();
  const paragraphId = (cell.blocks[0] as OoxmlElement).id;
  const item = (cacheToken: string) => ({ cacheToken }) as never;
  const first = {};
  const deps = { measurer, producer: 'same', listItems: new Map([['elsewhere', item('a')]]) };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read);
  // A list toggled elsewhere: a new list map, but this cell's paragraph is not in it.
  const second = {};
  const toggled = { ...deps, listItems: new Map([['elsewhere', item('b')]]) };
  expect(carryTableAutofitScope(first, second, false, toggled, true)).toBe(false);
  cachedAutofitCellWidths(cell, true, autofitContextOf(toggled), view, read);
  expect(reads).toBe(1);
  // This cell's own paragraph becomes a list item: measured again.
  const own = { ...deps, listItems: new Map([[paragraphId, item('c')]]) };
  carryTableAutofitScope(second, {}, false, own, true);
  cachedAutofitCellWidths(cell, true, autofitContextOf(own), view, read);
  expect(reads).toBe(2);
});

test('a reference value that changes elsewhere keeps the measurements of other cells', () => {
  const { cell, view } = fixture();
  const paragraphId = (cell.blocks[0] as OoxmlElement).id;
  const refs = (story: string, own: string) =>
    ({
      valuesToken: story,
      tokenForParagraph: (id: string) => (id === paragraphId ? own : ''),
    }) as never;
  const first = {};
  const deps = { measurer, producer: 'same', refFields: refs('story-1', 'own-1') };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read);
  // Another paragraph's reference moved, so the story token moved; this cell's did not.
  const second = {};
  const elsewhere = { ...deps, refFields: refs('story-2', 'own-1') };
  expect(carryTableAutofitScope(first, second, true, elsewhere)).toBe(true);
  cachedAutofitCellWidths(cell, true, autofitContextOf(elsewhere), view, read);
  expect(reads).toBe(1);
  // This cell's own reference result changed: measured again.
  const own = { ...deps, refFields: refs('story-3', 'own-2') };
  carryTableAutofitScope(second, {}, true, own);
  cachedAutofitCellWidths(cell, true, autofitContextOf(own), view, read);
  expect(reads).toBe(2);
});

test('complete section proofs skip unchanged paragraph tokens across revisions', async () => {
  const { registerTableWidthReuseScope } = await import('../table-width-reuse-scope.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { cell, view } = fixture();
  let tokenReads = 0;
  let measurements = 0;
  const deps = () => ({
    measurer,
    producer: 'same',
    styleCascade,
    nextLineId: bodyLineId,
    projectionTokenForParagraph: () => {
      tokenReads++;
      return 'same';
    },
  });
  const read = () => {
    measurements++;
    return value;
  };
  let previous = {};
  const initial = deps();
  carryTableAutofitScope(null, previous, false, initial);
  registerTableWidthReuseScope(initial, false);
  cachedAutofitCellWidths(cell, true, autofitContextOf(initial), view, read);
  for (let revision = 0; revision < 4; revision++) {
    const next = {};
    const flow = deps();
    const same = carryTableAutofitScope(previous, next, true, flow);
    registerTableWidthReuseScope(flow, same);
    cachedAutofitCellWidths(cell, true, autofitContextOf(flow), view, read);
    previous = next;
  }
  // One initial token and one admission into the complete proof. Later flows skip it.
  expect(tokenReads).toBe(2);
  expect(measurements).toBe(1);
  const changed = deps();
  registerTableWidthReuseScope(changed, carryTableAutofitScope(previous, {}, true, changed));
  cachedAutofitCellWidths({ ...cell }, true, autofitContextOf(changed), view, read);
  expect(measurements).toBe(2);
  expect(tokenReads).toBe(3);
});

test('withdrawing the section proof restores per-paragraph validation', async () => {
  const { registerTableWidthReuseScope } = await import('../table-width-reuse-scope.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { cell, view } = fixture();
  let previous: object | null = null;
  let measurements = 0;
  const read = () => {
    measurements++;
    return value;
  };
  for (const [token, equal, listOnly] of [
    ['before', false, false],
    ['before', true, false],
    ['after', false, true],
  ] as const) {
    const next = {};
    const flow = {
      measurer,
      producer: 'same',
      nextLineId: bodyLineId,
      projectionTokenForParagraph: () => token,
    };
    registerTableWidthReuseScope(
      flow,
      carryTableAutofitScope(previous, next, equal, flow, listOnly)
    );
    cachedAutofitCellWidths(cell, true, autofitContextOf(flow), view, read);
    previous = next;
  }
  expect(measurements).toBe(2);
});

test('changed reference values invalidate a registered complete proof', async () => {
  const { registerTableWidthReuseScope } = await import('../table-width-reuse-scope.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { cell, view } = fixture();
  let previous: object | null = null;
  let measurements = 0;
  const read = () => {
    measurements++;
    return value;
  };
  for (const token of ['one', 'one', 'two']) {
    const next = {};
    const flow = {
      measurer,
      producer: 'same',
      nextLineId: bodyLineId,
      refFields: { valuesToken: token, tokenForParagraph: () => token } as never,
    };
    registerTableWidthReuseScope(
      flow,
      carryTableAutofitScope(previous, next, previous !== null, flow)
    );
    cachedAutofitCellWidths(cell, true, autofitContextOf(flow), view, read);
    previous = next;
  }
  expect(measurements).toBe(2);
});
