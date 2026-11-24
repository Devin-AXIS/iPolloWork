// Table cell break keys are kept as immutable chunks. Their concatenation must equal the flat
// list the registry kept before: the same keys, in order, with repeats, and the same removals.
// A flat reference model runs beside the registry over long seeded sequences; session layouts
// then exercise the full, width and text paths.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createTableCellBreakKeyCollector,
  registerEditedTableCellBreakKeys,
  registerTableCellBreakKeys,
  tableCellBreakKeyChunksOf,
  tableCellBreakKeysOf,
} from '../table-cell-break-keys.ts';
import { createParagraphLayoutCache, retainLiveBreakKeys } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { readTableStructure } from '../semantic-table.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

const MAX_CHUNK_KEYS = 512;
const MIN_CHUNK_KEYS = 64;

/** A deterministic generator, so a failure names its step. */
function generator(seed: number) {
  let state = seed;
  return (bound: number): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state % bound;
  };
}

/** The registry's chunk bounds: no empty chunk, none too long, no two short neighbours. */
function expectBounded(node: object): void {
  const chunks = tableCellBreakKeyChunksOf(node)!;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  expect(chunks.length).toBeLessThanOrEqual(2 * Math.ceil(total / MIN_CHUNK_KEYS) + 1);
  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_KEYS);
    const next = chunks[index + 1];
    if (next) expect(chunk.length >= MIN_CHUNK_KEYS || next.length >= MIN_CHUNK_KEYS).toBe(true);
  }
}

/** The flat registry's text-edit rule. */
const editedFlat = (
  before: readonly string[] | undefined,
  removed: ReadonlySet<string>,
  added: ReadonlySet<string>
): string[] => [...(before ?? []).filter((key) => !removed.has(key)), ...added];

test('chunks flatten to the flat registry over a long seeded sequence', () => {
  const next = generator(7);
  const sizes = [0, 1, 3, 63, 64, 65, 511, 512, 513, 1100, 2600];
  const revisions: { node: object; flat: readonly string[] }[] = [];
  let current: { node: object; flat: readonly string[] } | undefined;
  for (let step = 0; step < 1500; step += 1) {
    const node = {};
    const choice = next(100);
    let flat: string[];
    if (!current || choice < 12) {
      // A full or width registration: any length, keys repeating across the list.
      const length = sizes[next(sizes.length)]!;
      const keys = Array.from({ length }, () => `k${next(300)}`);
      registerTableCellBreakKeys(node, keys);
      flat = keys.slice();
    } else {
      // A text edit: drop present and absent keys everywhere, append a new row's keys.
      const removed = new Set<string>();
      for (let i = next(9); i > 0; i -= 1)
        removed.add(
          current.flat.length && next(4)
            ? current.flat[next(current.flat.length)]!
            : `k${next(300)}`
        );
      const added = new Set<string>();
      for (let i = next(12); i > 0; i -= 1) added.add(next(3) ? `n${step}:${i}` : `k${next(300)}`);
      // Sometimes the previous node has no recorded keys at all.
      const before = choice < 15 ? {} : current.node;
      registerEditedTableCellBreakKeys(node, before, removed, added);
      flat = editedFlat(before === current.node ? current.flat : undefined, removed, added);
    }
    expect(tableCellBreakKeysOf(node)).toEqual(flat);
    expectBounded(node);
    current = { node, flat };
    revisions.push(current);
    // Undo liveness: every earlier revision still answers its own list.
    if (step % 250 === 249)
      for (const revision of revisions)
        expect(tableCellBreakKeysOf(revision.node)).toEqual(revision.flat);
  }
  expect(tableCellBreakKeysOf({})).toBeUndefined();
});

test('typing in one row keeps the chunk count; scattered edits stay within the bounds', () => {
  const base = {};
  const keys = Array.from({ length: 5000 }, (_, index) => `b${index}`);
  registerTableCellBreakKeys(base, keys);
  // The same row edited again and again: its last keys go, its new keys come.
  let node = base;
  let flat: readonly string[] = keys;
  let rowKeys = new Set(['b2500', 'b2501', 'b2502']);
  const counts: number[] = [];
  for (let edit = 0; edit < 400; edit += 1) {
    const added = new Set([`t${edit}:0`, `t${edit}:1`, `t${edit}:2`]);
    const after = {};
    registerEditedTableCellBreakKeys(after, node, rowKeys, added);
    flat = editedFlat(flat, rowKeys, added);
    counts.push(tableCellBreakKeyChunksOf(after)!.length);
    node = after;
    rowKeys = added;
  }
  expect(tableCellBreakKeysOf(node)).toEqual(flat);
  expect(new Set(counts.slice(1)).size).toBe(1);
  // Many rows edited once each: appended keys merge, removals shrink chunks, bounds hold.
  const next = generator(11);
  for (let edit = 0; edit < 2000; edit += 1) {
    const removed = new Set(
      Array.from({ length: 7 }, () => flat[next(flat.length)]!).filter(Boolean)
    );
    const added = new Set(Array.from({ length: 7 }, (_, i) => `s${edit}:${i}`));
    const after = {};
    registerEditedTableCellBreakKeys(after, node, removed, added);
    flat = editedFlat(flat, removed, added);
    node = after;
    expectBounded(node);
  }
  expect(tableCellBreakKeysOf(node)).toEqual(flat);
});

test('an edit shares every chunk it does not touch', () => {
  const before = {};
  registerTableCellBreakKeys(
    before,
    Array.from({ length: 3000 }, (_, index) => `c${index}`)
  );
  const chunks = tableCellBreakKeyChunksOf(before)!;
  expect(chunks.map((chunk) => chunk.length)).toEqual([512, 512, 512, 512, 512, 440]);
  const after = {};
  registerEditedTableCellBreakKeys(after, before, new Set(['c1100']), new Set(['x', 'y']));
  const edited = tableCellBreakKeyChunksOf(after)!;
  expect(edited).toHaveLength(7);
  for (const index of [0, 1, 3, 4, 5]) expect(edited[index]).toBe(chunks[index]!);
  expect(edited[2]).toHaveLength(511);
  expect(edited[6]).toEqual(['x', 'y']);
  // The earlier node is untouched.
  expect(tableCellBreakKeyChunksOf(before)).toBe(chunks);
});

test('retention names the union of block keys and every chunk', () => {
  const tables = [{}, {}, {}];
  registerTableCellBreakKeys(tables[0]!, ['a', 'b', 'a']);
  registerTableCellBreakKeys(
    tables[1]!,
    Array.from({ length: 1300 }, (_, index) => `w${index % 900}`)
  );
  registerEditedTableCellBreakKeys(tables[2]!, tables[1]!, new Set(['w5', 'w899']), ['z']);
  const collector = new Set<string>();
  retainLiveBreakKeys(createParagraphLayoutCache(), collector, ['block'], tables);
  const expected = new Set([
    'block',
    ...tables.flatMap((table) => tableCellBreakKeysOf(table) ?? []),
  ]);
  expect(collector).toEqual(expected);
  expect(collector.has('w5')).toBe(true);
  expect(collector.has('z')).toBe(true);
});

// Session layouts. Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text: string) => `<w:tc><w:tcPr/>${p(text)}</w:tc>`;
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
function tableXml(rows: number, columns: number, fixed: boolean): string {
  const width = Math.floor(6000 / columns);
  const layout = fixed ? '<w:tblLayout w:type="fixed"/>' : '';
  const body = Array.from(
    { length: rows },
    (_, row) =>
      `<w:tr>${Array.from({ length: columns }, (_, c) => tc(`r${row}c${c}`)).join('')}</w:tr>`
  ).join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${layout}${ZERO_MARGINS}</w:tblPr>` +
    `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>${body}</w:tbl>`
  );
}
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

interface Revision {
  readonly table: OoxmlElement;
  readonly keys: readonly string[];
  readonly shared: number;
}

/** Type `text` into one cell through a retained session; each layout must equal a cold one. */
function typeInto(
  xml: string,
  row: number,
  column: number,
  text: string
): { readonly revisions: Revision[]; readonly part: OoxmlPart } {
  let part = load(xml);
  const paragraphId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[
    column
  ]!.blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout: SemanticLayout = lay(part, 15, { session, cache });
  const revisions: Revision[] = [
    { table: tableNode(part), keys: [...tableCellBreakKeysOf(tableNode(part))!], shared: 0 },
  ];
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: `r${row}c${column}`.length + index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    const previous = tableCellBreakKeyChunksOf(tableNode(part)) ?? [];
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    expect(layout.pages).toEqual(lay(reparsed(part)).pages);
    const chunks = tableCellBreakKeyChunksOf(tableNode(part))!;
    revisions.push({
      table: tableNode(part),
      keys: [...tableCellBreakKeysOf(tableNode(part))!],
      shared: chunks.filter((chunk) => previous.includes(chunk)).length,
    });
  }
  // Undo liveness: every revision's table still answers the keys it recorded.
  for (const revision of revisions)
    expect(tableCellBreakKeysOf(revision.table)).toEqual(revision.keys);
  return { revisions, part };
}

/** The cell keys a cold full layout of the same tree records. */
function coldKeys(part: OoxmlPart): Set<string> {
  // Keep canonical node identities: reparsing assigns different paragraph cache tokens.
  const cold = part;
  lay(cold, 15, { cache: createParagraphLayoutCache() });
  return new Set(tableCellBreakKeysOf(tableNode(cold)));
}

test('text edits in a fixed table share untouched chunks and keep every live key', () => {
  // 100 rows of 6 cells: 600 keys, more than one chunk.
  const { revisions, part } = typeInto(tableXml(100, 6, true), 3, 2, 'ab');
  for (const revision of revisions.slice(1)) {
    // Shared chunks show the text update recorded the list from the one before it.
    expect(revision.shared).toBeGreaterThan(0);
    expect(revision.keys.length).toBeGreaterThanOrEqual(600);
  }
  // The text update's list names the same keys as a cold layout of the final tree.
  expect(new Set(revisions.at(-1)!.keys)).toEqual(coldKeys(part));
});

test('width edits and full table layouts record exact lists per revision', () => {
  // AutoFit: typing widens a column, so the width update records the keys.
  const widened = typeInto(tableXml(30, 3, false), 13, 1, 'wider').revisions;
  expect(widened.length).toBe(6);
  // Fixed and narrow: the cell wraps, the row grows, and the table is laid out again.
  const wrapped = typeInto(tableXml(30, 6, true), 4, 1, ' grows past its column').revisions;
  expect(wrapped.length).toBe(23);
  for (const revision of [...widened, ...wrapped]) expect(revision.keys.length).toBeGreaterThan(0);
});

test('an interrupted table keeps its own keys after a floating table completes or fails', () => {
  const collector = createTableCellBreakKeyCollector();
  collector.add('outside');
  collector.begin();
  collector.add('outer-before');
  const outer = collector.keys();
  collector.begin();
  collector.add('floating');
  const floating = collector.keys();
  collector.end();
  expect(collector.keys()).toBe(outer);
  collector.add('outer-after');
  try {
    collector.begin();
    collector.add('failed');
    throw new Error('placement refused');
  } catch {
    // A failed placement still closes its collector in the caller's finally block.
  } finally {
    collector.end();
  }
  collector.add('outer-last');
  collector.end();
  collector.add('outside-after');
  expect(outer).toEqual(['outer-before', 'outer-after', 'outer-last']);
  expect(floating).toEqual(['floating']);
  expect(() => collector.keys()).toThrow('No active table break-key collector');
});
