import { expect, test } from 'bun:test';
import { carryTableAutofitScope } from '../table-autofit-context.ts';
import { registerTableWidthReuseScope, tableWidthReuseScope } from '../table-width-reuse-scope.ts';
import { bodyLineId } from '../body-line-id.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import { measurer, styleCascade } from './table-row-keep-fixtures.ts';

const base: TableFlowDeps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: bodyLineId,
};

function first() {
  const section = {};
  const deps = { ...base };
  carryTableAutofitScope(null, section, false, deps);
  registerTableWidthReuseScope(deps, false);
  expect(tableWidthReuseScope(deps)).toBeUndefined();
  return { section, deps };
}

function advance(previous: object, deps: TableFlowDeps, equal = true, onlyListsDiffer = false) {
  const section = {};
  const same = carryTableAutofitScope(previous, section, equal, deps, onlyListsDiffer);
  registerTableWidthReuseScope(deps, same);
  return { section, deps, key: tableWidthReuseScope(deps) };
}

test('verified section revisions share a scalar group key without retaining flow callbacks', () => {
  const initial = first();
  const firstRevision = advance(initial.section, { ...base });
  expect(typeof firstRevision.key).toBe('string');
  const second = advance(firstRevision.section, {
    ...base,
    nextLineId: (...args) => bodyLineId(...args),
    onCellBreakKey: () => {},
  });
  expect(second.key).toBe(firstRevision.key);
  expect(tableWidthReuseScope({ ...second.deps })).toBeUndefined();
});

test('projection changes and list-only carries cannot authorize grouped geometry reuse', () => {
  const initial = first();
  const verified = advance(initial.section, { ...base });
  const projectionChange = advance(verified.section, { ...base }, false);
  expect(projectionChange.key).toBeUndefined();
  const afterProjection = advance(projectionChange.section, { ...base });
  expect(afterProjection.key).toBeDefined();
  expect(afterProjection.key).not.toBe(verified.key);
  const listChange = advance(
    afterProjection.section,
    { ...base, listItems: new Map() },
    false,
    true
  );
  expect(listChange.key).toBeUndefined();
  registerTableWidthReuseScope(verified.deps, false);
  expect(tableWidthReuseScope(verified.deps)).toBeUndefined();
});

test('changed measurement and field inputs withdraw the group proof', () => {
  const initial = first();
  const verified = advance(initial.section, { ...base });
  for (const change of [
    { measurer: { ...measurer } },
    { producer: 'changed' },
    { defaultTabStopPt: 23 },
    { compatibilityMode: 14 },
    { showFieldCodes: true },
    { documentProperties: { title: 'changed' } },
  ]) {
    expect(advance(verified.section, { ...base, ...change }).key).toBeUndefined();
  }
});

test('placement inputs invalidate the key even when measurement scope remains equal', () => {
  const initial = first();
  const verified = advance(initial.section, { ...base });
  for (const change of [
    { styleCascade: { ...styleCascade } },
    { listItems: new Map() },
    { outOfCellFloatParagraphs: new Set<string>() },
    { paragraphLineUnitPt: 12 },
    { displayMode: 'original' as const },
    { anchorsWrapText: false },
    { tableNestingOffset: 1 as const },
    { textBoxStory: true as const },
  ]) {
    const changed = advance(verified.section, { ...base, ...change });
    expect(changed.key).toBeDefined();
    expect(changed.key).not.toBe(verified.key);
  }
});
