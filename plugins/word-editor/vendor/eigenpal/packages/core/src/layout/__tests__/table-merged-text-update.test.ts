// Typing in a table with vertically merged cells takes the one-row fast path, and its pages
// equal a cold layout: in a plain cell beside a merge, and in a row whose merge head stays
// within that row. A head taller than its own row takes the full layout, because only the
// full layout knows whether its span was admitted there.

import { describe, expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { cell, lay, load, measurer, para, styleCascade, table } from './table-row-keep-fixtures.ts';

const SPAN = 4;

/** Rows of two cells; the first column merges every `SPAN` rows, its head `headLines` tall. */
function mergedTable(rows: number, headLines: number): string {
  return table(
    Array.from({ length: rows }, (_, index) => {
      const head = index % SPAN === 0;
      const first = head
        ? cell(para(`H${index}-`, headLines), '<w:vMerge w:val="restart"/>')
        : cell('<w:p/>', '<w:vMerge/>');
      return `<w:tr>${first}${cell(para(`R${index}c2-`))}</w:tr>`;
    })
  );
}

const tableOf = (part: OoxmlPart) =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table') as OoxmlElement;

/** The first paragraph of `row`'s cell `column`. */
function paragraphAt(part: OoxmlPart, row: number, column: number): string {
  const structure = readTableStructure(tableOf(part), 310, 0, styleCascade)!;
  return structure.rows[row]!.cells[column]!.blocks[0]!.id;
}

function edit(part: OoxmlPart, row: number, column: number, text: string): OoxmlPart {
  const result = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraphAt(part, row, column),
    offset: 0,
    text,
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

/** The one-row update of `edited` over `part`'s layout, or null when it refuses. */
function fastPath(part: OoxmlPart, edited: OoxmlPart) {
  return updateTableText(tableOf(part), tableOf(edited), lay(part).pages, 310, {
    measurer,
    styleCascade,
    producer: 'test',
    nextLineId: () => '',
    displayMode: 'all-markup',
    compatibilityMode: 15,
  });
}

const LONG = 'long content '.repeat(4);

describe('typing in a table with merged cells', () => {
  for (const headLines of [1, 2, SPAN, SPAN + 2])
    for (const [label, row, column, text] of [
      ['plain cell beside a head', 8, 1, 'X'],
      ['plain cell beside a continuation', 9, 1, 'X'],
      ['plain cell that wraps', 10, 1, LONG],
      ['head', 8, 0, 'X'],
      ['head that wraps', 8, 0, LONG],
    ] as const)
      test(`${label}, head of ${headLines} lines, equals a cold layout`, () => {
        const part = load(mergedTable(40, headLines));
        const session = createLayoutSession();
        const cache = createParagraphLayoutCache();
        lay(part, 15, { session, cache });
        const edited = edit(part, row, column, text);
        expect(lay(edited, 15, { session, cache }).pages).toEqual(lay(edited).pages);
        // Text that wraps changes the row height. Beside a head, the row is as tall as its
        // head only when the head has one line; beside a continuation, the head is elsewhere.
        const expectFastPath = text === 'X' && (row === 9 || headLines === 1);
        const update = fastPath(part, edited);
        expect(update !== null).toBe(expectFastPath);
        if (update) expect(update.pages).toEqual(lay(edited).pages);
      });
});
