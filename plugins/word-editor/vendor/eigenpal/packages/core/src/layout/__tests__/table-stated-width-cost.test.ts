import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// An autofit table whose stated cell widths pass its stated width gives way above each
// column's content minimum, so its widths depend on content. Typing that leaves every
// column minimum alone must stay incremental.
const ROWS = 300;
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
// Unequal content minimums, so the columns do not keep equal shares.
const row = (i: number) =>
  `<w:tr>${tc(`r${i} a`)}${tc(`row ${i} wide words`)}${tc(`r${i} b`)}${tc(`extraordinary ${i}`)}</w:tr>`;
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  `<w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(4)}</w:tblGrid>` +
  `${Array.from({ length: ROWS }, (_, i) => row(i)).join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const paragraphAt = (part: OoxmlPart, rowIndex: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[rowIndex]!.cells[cell]!.blocks[0]!
    .id;
const edges = (layout: SemanticLayout) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .map((fragment) => fragment.columnEdges);

test('typing that keeps every column minimum re-lays out only the edited paragraph', () => {
  let part = load(table);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const first = lay(part, 15, { session, cache });
  const columns = edges(first)[0]!;
  // The refit gives the columns unequal widths: the stated 120pt cells pass the 250pt width.
  expect(columns[1]! - columns[0]!).not.toBeCloseTo(columns[2]! - columns[1]!, 1);
  const paragraph = paragraphAt(part, ROWS / 2, 1);
  for (let keystroke = 0; keystroke < 10; keystroke++) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph,
      offset: 3,
      text: ' a',
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const misses = cache.stats.misses;
    const updated = lay(part, 15, { session, cache });
    // Budget: the edited paragraph, plus one probe for its row's height.
    expect(cache.stats.misses - misses).toBeLessThanOrEqual(2);
    expect(edges(updated)[0]).toEqual(columns);
  }
  expect(edges(lay(part))).toEqual(edges(lay(part, 15, { session, cache })));
});

test('typing inside a word stays incremental until the word passes its column minimum', () => {
  let part = load(table);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const columns = edges(lay(part, 15, { session, cache }))[0]!;
  // "extraordinary 150": the number grows inside itself, below the 13-letter word, then past it.
  const paragraph = paragraphAt(part, ROWS / 2, 3);
  let changedAt = -1;
  for (let keystroke = 0; keystroke < 20 && changedAt < 0; keystroke++) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph,
      offset: 15 + keystroke,
      text: 'x',
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const misses = cache.stats.misses;
    const updated = edges(lay(part, 15, { session, cache }))[0];
    if (JSON.stringify(updated) !== JSON.stringify(columns)) changedAt = keystroke;
    else expect(cache.stats.misses - misses).toBeLessThanOrEqual(2);
  }
  // Ten letters make the number as long as the word; the eleventh widens the minimum.
  expect(changedAt).toBe(10);
  expect(edges(lay(part))).toEqual(edges(lay(part, 15, { session, cache })));
});
