// A table's row-reuse aggregate answers with the latest string found through its first row
// when every piece is equal, instead of joining an equal copy for each new table node. Each
// case compares with the flat walk; the recorder shows whether the latest string answered.

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import {
  aggregateParagraphTokensForTableBlock,
  createTableRowTokenStore,
  tableAggregateReuseTestRecorder,
} from '../table-paragraph-tokens.ts';
import {
  drawingTokenForTableBlock,
  drawingTokenForTableBlockMemo,
} from '../inline-drawing-source.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (...blocks: string[]): string => `<w:tc>${blocks.join('')}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;
const sdt = (content: string): string => `<w:sdt><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function firstTable(xml: string): OoxmlElement {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const found = body.children.find((node) => node.kind === 'table');
  if (!found || found.kind === 'textValue') throw new Error('no table');
  return found as OoxmlElement;
}

/** Direct rows a, b (nested table), d; row c sits inside a row content control. */
function fixture(texts: { readonly a?: string; readonly d?: string } = {}): OoxmlElement {
  return firstTable(
    table(
      row(cell(p(texts.a ?? 'a1')), cell(p('a2'))),
      row(cell(p('b1'), table(row(cell(p('n1')), cell(p('n2')))), p('')), cell(p('b2'))),
      sdt(row(cell(p('c1')), cell(p('c2')))),
      row(cell(p(texts.d ?? 'd1'), p('d1x')), cell(p('d2')))
    )
  );
}
const directRows = (source: OoxmlElement): OoxmlElement[] =>
  source.children.filter((child): child is OoxmlElement => child.kind === 'tableRow');
/** Copy-on-write edit: a new table node whose `index`-th direct row is `replacement`. */
function withRow(source: OoxmlElement, index: number, replacement: OoxmlNode): OoxmlElement {
  const target = directRows(source)[index]!;
  return {
    ...source,
    children: source.children.map((child) => (child === target ? replacement : child)),
  } as OoxmlElement;
}
const textOf = (node: OoxmlNode): string =>
  node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');

/** Token shapes with at least one non-empty token in the fixture. */
const SHAPES: readonly ((paragraph: OoxmlNode) => string)[] = [
  (paragraph) => (textOf(paragraph).startsWith('b') ? `drawing:${textOf(paragraph)}` : ''),
  // Digits, colons and separators inside a token cannot move a frame boundary.
  (paragraph) => `1:${textOf(paragraph)};0:`,
  (paragraph) => (textOf(paragraph) === '' ? 'empty' : ''),
];
const store = (epoch = 'e', scope?: object) => ({
  rows: createTableRowTokenStore(),
  scope,
  epoch,
});

let recorder = tableAggregateReuseTestRecorder();
beforeEach(() => {
  recorder = tableAggregateReuseTestRecorder();
});
afterEach(() => recorder.dispose());

test('an edit that keeps every token answers with the latest string, equal to the flat walk', () => {
  for (const shape of SHAPES) {
    const reuse = store();
    const before = fixture();
    // The same text in new nodes: the row segment is recomputed and equal by value.
    const after = withRow(before, 2, directRows(fixture())[2]!);
    const joined = recorder.joined;
    const reused = recorder.reused;
    expect(aggregateParagraphTokensForTableBlock(before, shape, reuse)).toBe(
      aggregateParagraphTokensForTableBlock(before, shape)
    );
    expect(aggregateParagraphTokensForTableBlock(after, shape, reuse)).toBe(
      aggregateParagraphTokensForTableBlock(after, shape)
    );
    expect([recorder.joined - joined, recorder.reused - reused]).toEqual([1, 1]);
  }
});

test('a changed token joins again; only the latest value answers', () => {
  const shape = (paragraph: OoxmlNode) => `t:${textOf(paragraph)}`;
  const reuse = store();
  const first = fixture();
  const changed = withRow(first, 2, directRows(fixture({ d: 'd1 typed' }))[2]!);
  const restored = withRow(changed, 2, directRows(fixture())[2]!);
  for (const node of [first, changed, restored])
    expect(aggregateParagraphTokensForTableBlock(node, shape, reuse)).toBe(
      aggregateParagraphTokensForTableBlock(node, shape)
    );
  // `restored` equals `first`, but the anchor keeps one value: `changed` replaced it.
  expect([recorder.joined, recorder.reused]).toEqual([3, 0]);
  const again = withRow(restored, 2, directRows(fixture())[2]!);
  expect(aggregateParagraphTokensForTableBlock(again, shape, reuse)).toBe(
    aggregateParagraphTokensForTableBlock(again, shape)
  );
  expect([recorder.joined, recorder.reused]).toEqual([3, 1]);
});

test('a new epoch or scope reads every row again and answers by value', () => {
  const steady = (paragraph: OoxmlNode) => `s:${textOf(paragraph)}`;
  const node = fixture();
  const rows = createTableRowTokenStore();
  const flat = aggregateParagraphTokensForTableBlock(node, steady);
  const scopeA = {};
  const scopeB = {};
  for (const [epoch, scope] of [
    ['e1', scopeA],
    ['e2', scopeA],
    ['e2', scopeB],
  ] as const)
    expect(aggregateParagraphTokensForTableBlock(node, steady, { rows, scope, epoch })).toBe(flat);
  // Equal pieces under another epoch or scope: the latest string answers.
  expect([recorder.joined, recorder.reused]).toEqual([1, 2]);
  // Tokens that follow the epoch differ, so the aggregate joins again.
  for (const epoch of ['e3', 'e4']) {
    const moving = (paragraph: OoxmlNode) => `${epoch}:${textOf(paragraph)}`;
    expect(
      aggregateParagraphTokensForTableBlock(node, moving, { rows, scope: scopeB, epoch })
    ).toBe(aggregateParagraphTokensForTableBlock(node, moving));
  }
  expect([recorder.joined, recorder.reused]).toEqual([3, 2]);
});

test('independent documents and separate kinds never answer each other', () => {
  const shape = SHAPES[1]!;
  const reuse = store();
  const one = fixture();
  const two = fixture();
  expect(aggregateParagraphTokensForTableBlock(one, shape, reuse)).toBe(
    aggregateParagraphTokensForTableBlock(two, shape, reuse)
  );
  // Same text, other nodes: another first row, so no latest value is found.
  expect([recorder.joined, recorder.reused]).toEqual([2, 0]);
  // Another kind keeps its own latest values, even for the same table.
  const other = store();
  expect(aggregateParagraphTokensForTableBlock(one, shape, other)).toBe(
    aggregateParagraphTokensForTableBlock(one, shape)
  );
  expect([recorder.joined, recorder.reused]).toEqual([3, 0]);
});

test('an edit in the first row changes the anchor; the next edit reuses through it', () => {
  const shape = SHAPES[1]!;
  const reuse = store();
  const first = fixture();
  aggregateParagraphTokensForTableBlock(first, shape, reuse);
  const anchorEdited = withRow(first, 0, directRows(fixture({ a: 'a1 typed' }))[0]!);
  expect(aggregateParagraphTokensForTableBlock(anchorEdited, shape, reuse)).toBe(
    aggregateParagraphTokensForTableBlock(anchorEdited, shape)
  );
  // Equal text in a new first row is still another anchor.
  const sameText = withRow(first, 0, directRows(fixture())[0]!);
  expect(aggregateParagraphTokensForTableBlock(sameText, shape, reuse)).toBe(
    aggregateParagraphTokensForTableBlock(first, shape)
  );
  expect([recorder.joined, recorder.reused]).toEqual([3, 0]);
  const later = withRow(anchorEdited, 2, directRows(fixture())[2]!);
  expect(aggregateParagraphTokensForTableBlock(later, shape, reuse)).toBe(
    aggregateParagraphTokensForTableBlock(later, shape)
  );
  expect([recorder.joined, recorder.reused]).toEqual([3, 1]);
});

test('no token joins nothing, and an oversized aggregate is not kept', () => {
  const reuse = store();
  expect(aggregateParagraphTokensForTableBlock(fixture(), () => '', reuse)).toBe('');
  expect([recorder.joined, recorder.reused]).toEqual([0, 0]);
  // Twelve paragraphs of 25,000 characters exceed the memo ceiling of 2^18.
  const long = (paragraph: OoxmlNode) => `${textOf(paragraph)}${'x'.repeat(25_000)}`;
  const first = fixture();
  const next = withRow(first, 2, directRows(fixture())[2]!);
  const flat = aggregateParagraphTokensForTableBlock(first, long);
  expect(flat.length).toBeGreaterThan(1 << 18);
  expect(aggregateParagraphTokensForTableBlock(first, long, reuse)).toBe(flat);
  expect(aggregateParagraphTokensForTableBlock(next, long, reuse)).toBe(flat);
  expect([recorder.joined, recorder.reused]).toEqual([2, 0]);
});

test('the drawing token memo shares the latest aggregate across table revisions', () => {
  const shape = SHAPES[0]!;
  let node = fixture();
  expect(drawingTokenForTableBlockMemo(node, 'epoch', shape)).toBe(
    drawingTokenForTableBlock(node, shape)
  );
  for (let revision = 0; revision < 5; revision += 1) {
    node = withRow(node, 2, directRows(fixture())[2]!);
    expect(drawingTokenForTableBlockMemo(node, 'epoch', shape)).toBe(
      drawingTokenForTableBlock(node, shape)
    );
  }
  expect([recorder.joined, recorder.reused]).toEqual([1, 5]);
});
