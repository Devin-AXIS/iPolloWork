// A `w:vMerge` continuation only continues a cell above it that carries `w:vMerge`
// (17.4.85). Below an unmerged cell, or in a table's first row, it has nothing to continue:
// it starts its own merge and paints its own content. Such a cell appears in files, and a
// row deletion merged with a concurrent edit can leave one behind.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableCellFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const cell = (text: string, merge = ''): string =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${merge}</w:tcPr>` +
  (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>') +
  `</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

function layoutTable(...rows: string[]): TableFragmentRecord {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:tbl>` +
    '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    rows.map((row) => `<w:tr>${row}</w:tr>`).join('') +
    '</w:tbl><w:p/></w:body></w:document>';
  const read = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer() });
  const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table');
  return table;
}

function text(cell: TableCellFragmentRecord): string {
  return cell.blocks
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

/** First column of each row: text, row span, and whether it continues a merge. */
function firstColumn(table: TableFragmentRecord): string[] {
  return table.rows.map((row) => {
    const first = row.cells[0]!;
    return `${text(first)}|${first.rowSpan ?? 1}|${first.vMergeContinue ? 'C' : '-'}`;
  });
}

describe('orphan vertical-merge continuations', () => {
  test('a continuation below an unmerged cell starts its own merge', () => {
    const table = layoutTable(
      cell('Party') + cell('Amount'),
      cell('Orphan', CONTINUE) + cell('USD 300'),
      cell('', CONTINUE) + cell('USD 400')
    );
    expect(firstColumn(table)).toEqual(['Party|1|-', 'Orphan|2|-', '|1|C']);
  });

  test('a continuation in the first row starts its own merge', () => {
    const table = layoutTable(cell('Top', CONTINUE) + cell('a'), cell('', CONTINUE) + cell('b'));
    expect(firstColumn(table)).toEqual(['Top|2|-', '|1|C']);
  });

  test('a continuation below a merged cell still continues it', () => {
    const table = layoutTable(
      cell('Party') + cell('Amount'),
      cell('Supplier', RESTART) + cell('USD 100'),
      cell('', CONTINUE) + cell('USD 200')
    );
    expect(firstColumn(table)).toEqual(['Party|1|-', 'Supplier|2|-', '|1|C']);
  });
});
