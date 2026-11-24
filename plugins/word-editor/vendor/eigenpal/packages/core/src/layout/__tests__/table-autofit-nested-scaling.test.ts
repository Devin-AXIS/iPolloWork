// A nested table's need is measured once per pass, whatever its depth. Each level asks its
// nested table for two needs (plain and widened); without the pass memo each asked every
// deeper level again, so the work doubled with each level and a deep document never opened.

import { expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  autofitColumnMinimumsPt,
  autofitContextOf,
  narrowNestedReader,
  type AutofitView,
} from '../table-autofit-widths.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

const words = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${content}</w:tc>`;

/** An autofit 2×2 table whose last cell holds the next level, `depth` levels in all. */
function nested(depth: number): string {
  const inner = depth > 1 ? nested(depth - 1) + words('x') : words('deep words here');
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr>${cell(words('a b'))}${cell(words('c d'))}</w:tr>` +
    `<w:tr>${cell(words('e f'))}${cell(inner)}</w:tr>` +
    '</w:tbl>'
  );
}

function nestedReads(depth: number): { reads: number; minimums: readonly number[] } {
  const part = load(nested(depth));
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table') as OoxmlElement;
  const structure = readTableStructure(node, 400, 0, styleCascade)!;
  const read = narrowNestedReader(
    readTableStructure,
    styleCascade,
    'all-markup',
    undefined,
    undefined
  );
  let reads = 0;
  const view: AutofitView = {
    styleCascade,
    displayMode: 'all-markup',
    authorFilter: undefined,
    readNested: (table, level) => {
      reads += 1;
      return read(table, level);
    },
  };
  const minimums = autofitColumnMinimumsPt(structure, autofitContextOf({ measurer }), view);
  return { reads, minimums };
}

test('each nested table is read once per pass, at any depth', () => {
  for (const depth of [2, 6, 12]) {
    const { reads, minimums } = nestedReads(depth);
    // One read per nested level below the measured table.
    expect(reads).toBe(depth - 1);
    expect(minimums.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  }
});

test('the measured needs do not depend on the memo', () => {
  // The same table measured in two fresh passes gives the same minimums.
  expect(nestedReads(8).minimums).toEqual(nestedReads(8).minimums);
});
