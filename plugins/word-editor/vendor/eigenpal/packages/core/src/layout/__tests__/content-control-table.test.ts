// A control around a ROW or a CELL is still a row or a cell.
//
// `CT_SdtRow` and `CT_SdtCell` put the wrapper between the table and its row, or between the row
// and its cell — the same "label on a stretch of a document" the block and inline cases are, but
// at a place the table walk did not expect. A walk that keeps only `tableRow` children of a table
// and only `tableCell` children of a row DROPS a controlled row or cell outright: it is not
// measured, not painted, and not addressable, so a template that locks one row of a form loses
// that row from the page. Fidelity here is not decoration; the row is gone.
//
// The grid is the part that is easy to get half right. A controlled cell has to claim its grid
// column and its `w:gridSpan` in the same pass as its plain siblings, or every cell after it
// shifts and the conditional formats band the wrong columns.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  storyParagraphs,
  bodyStoryRoot,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  SemanticLayout,
  StyleSpanRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { readTableStructure } from '../semantic-table.ts';

type RowFragment = TableRowFragmentRecord;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutOf(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 1, { measurer });
}

/** Every laid-out table's row list, in page order. */
function tableRows(layout: SemanticLayout): RowFragment[] {
  const rows: RowFragment[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      rows.push(...(fragment as unknown as { rows: RowFragment[] }).rows);
    }
  }
  return rows;
}

/** The `w:tbl` in a one-table document, for the reads that are structural, not paginated. */
function tableNodeOf(part: OoxmlPart): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'table') return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const table = find(part.root);
  if (!table) throw new Error('no table');
  return table;
}

function cellText(cell: { readonly blocks: readonly unknown[] }): string {
  const spans: StyleSpanRecord[] = [];
  const walk = (blocks: readonly unknown[]): void => {
    for (const block of blocks as readonly { kind: string }[]) {
      if (block.kind === 'table') {
        for (const row of (block as unknown as { rows: { cells: { blocks: unknown[] }[] }[] })
          .rows) {
          for (const inner of row.cells) walk(inner.blocks);
        }
        continue;
      }
      for (const line of (block as unknown as { lines: { spans: StyleSpanRecord[] }[] }).lines) {
        spans.push(...line.spans);
      }
    }
  };
  walk(cell.blocks);
  return spans.map((span) => span.text).join('');
}

function rowTexts(layout: SemanticLayout): string[][] {
  return tableRows(layout).map((row) => row.cells.map((cell) => cellText(cell)));
}

const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const grid = (columns: number) =>
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>`;
const sdt = (tag: string, inner: string, extra = '') =>
  `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${extra}</w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

describe('a row inside a content control is laid out as a row', () => {
  const doc = () =>
    parseDoc(
      `<w:tbl><w:tblPr/>${grid(2)}` +
        `<w:tr>${cell('a1')}${cell('a2')}</w:tr>` +
        sdt('row', `<w:tr>${cell('b1')}${cell('b2')}</w:tr>`) +
        `<w:tr>${cell('c1')}${cell('c2')}</w:tr>` +
        `</w:tbl>`
    );

  test('the controlled row is one of the table rows, in document order', () => {
    expect(rowTexts(layoutOf(doc()))).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
      ['c1', 'c2'],
    ]);
  });

  test('the wrapper does not change the geometry of the table', () => {
    const wrapped = layoutOf(doc());
    const plain = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(2)}` +
          `<w:tr>${cell('a1')}${cell('a2')}</w:tr>` +
          `<w:tr>${cell('b1')}${cell('b2')}</w:tr>` +
          `<w:tr>${cell('c1')}${cell('c2')}</w:tr>` +
          `</w:tbl>`
      )
    );
    const boxes = (layout: SemanticLayout) =>
      tableRows(layout).map((row) => row.cells.map((one) => one.gridColumn + ':' + one.gridSpan));
    expect(boxes(wrapped)).toEqual(boxes(plain));
  });

  test('a controlled row keeps the row properties it declares', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(1)}` +
        sdt('head', `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${cell('H')}</w:tr>`) +
        `<w:tr>${cell('body')}</w:tr>` +
        `</w:tbl>`
    );
    const table = tableNodeOf(part);
    const structure = readTableStructure(table, 468, 0);
    expect(structure?.rows.map((row) => [row.isHeader, row.cantSplit])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  test('a controlled header row repeats on the page the table continues onto', () => {
    // Enough body rows to force a second page, so the repeat is the thing being observed and
    // not a property read back out of the structure.
    const body = `<w:tr>${cell('body')}</w:tr>`.repeat(60);
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(1)}` +
          sdt('head', `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('H')}</w:tr>`) +
          body +
          `</w:tbl>`
      )
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    const repeats = layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment) => fragment.kind === 'table')
      .flatMap((fragment) => (fragment as unknown as { rows: RowFragment[] }).rows)
      .filter((row) => row.isHeaderRepeat);
    expect(repeats.length).toBeGreaterThan(0);
  });

  test('nesting past the bound loses no row that the bound admits', () => {
    // Two wrappers deep is ordinary in generated forms.
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(1)}` +
          sdt('outer', sdt('inner', `<w:tr>${cell('deep')}</w:tr>`)) +
          `</w:tbl>`
      )
    );
    expect(rowTexts(layout)).toEqual([['deep']]);
  });
});

describe('a cell inside a content control is laid out as a cell', () => {
  test('the controlled cell is in the row, in order', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(3)}` +
          `<w:tr>${cell('one')}${sdt('mid', cell('two'))}${cell('three')}</w:tr>` +
          `</w:tbl>`
      )
    );
    expect(rowTexts(layout)).toEqual([['one', 'two', 'three']]);
  });

  test('its grid column and span are claimed in the same pass as its siblings', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(4)}` +
          `<w:tr>${cell('one')}` +
          sdt('mid', cell('wide', '<w:gridSpan w:val="2"/>')) +
          `${cell('last')}</w:tr>` +
          `</w:tbl>`
      )
    );
    const cells = tableRows(layout)[0]!.cells;
    expect(cells.map((one) => one.gridColumn)).toEqual([0, 1, 3]);
    expect(cells.map((one) => one.gridSpan)).toEqual([1, 2, 1]);
  });

  test('a controlled cell keeps the vMerge semantics of the cell it wraps', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(1)}` +
          `<w:tr>${cell('top', '<w:vMerge w:val="restart"/>')}</w:tr>` +
          `<w:tr>${sdt('cont', cell('', '<w:vMerge/>'))}</w:tr>` +
          `</w:tbl>`
      )
    );
    const rows = tableRows(layout);
    expect(rows[0]!.cells[0]!.vMergeContinue).toBe(false);
    expect(rows[1]!.cells[0]!.vMergeContinue).toBe(true);
  });

  test('a controlled cell inside a controlled row is both', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:tbl><w:tblPr/>${grid(2)}` +
          sdt('row', `<w:tr>${sdt('cell', cell('in'))}${cell('beside')}</w:tr>`) +
          `</w:tbl>`
      )
    );
    expect(rowTexts(layout)).toEqual([['in', 'beside']]);
  });
});

describe('the paragraphs inside a controlled row or cell stay addressable', () => {
  // Each body here ends with its table, so the empty paragraph read after it comes last.
  const addressable = (part: OoxmlPart): string[] => {
    const body = bodyStoryRoot(part);
    return (body ? storyParagraphs(body) : []).map((paragraph) => {
      const text: string[] = [];
      const walk = (node: {
        kind: string;
        value?: string;
        children?: readonly unknown[];
      }): void => {
        if (node.kind === 'textValue') {
          text.push(node.value ?? '');
          return;
        }
        for (const child of node.children ?? []) {
          walk(child as { kind: string; value?: string; children?: readonly unknown[] });
        }
      };
      walk(paragraph as unknown as { kind: string; children: readonly unknown[] });
      return text.join('');
    });
  };

  test('a controlled row contributes its paragraphs to the story', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(1)}` +
        `<w:tr>${cell('plain')}</w:tr>` +
        sdt('row', `<w:tr>${cell('controlled')}</w:tr>`) +
        `</w:tbl>`
    );
    expect(addressable(part)).toEqual(['plain', 'controlled', '']);
  });

  test('a controlled cell contributes its paragraphs to the story', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(2)}` +
        `<w:tr>${cell('plain')}${sdt('cell', cell('controlled'))}</w:tr>` +
        `</w:tbl>`
    );
    expect(addressable(part)).toEqual(['plain', 'controlled', '']);
  });

  test('a controlled cell holding a nested table contributes those too', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(1)}<w:tr>` +
        `<w:sdt><w:sdtPr><w:tag w:val="cell"/></w:sdtPr><w:sdtContent><w:tc><w:tcPr/>` +
        `<w:tbl><w:tblPr/>${grid(1)}<w:tr>${cell('inner')}</w:tr></w:tbl>` +
        `<w:p><w:r><w:t>after</w:t></w:r></w:p>` +
        `</w:tc></w:sdtContent></w:sdt>` +
        `</w:tr></w:tbl>`
    );
    expect(addressable(part)).toEqual(['inner', 'after', '']);
  });
});
