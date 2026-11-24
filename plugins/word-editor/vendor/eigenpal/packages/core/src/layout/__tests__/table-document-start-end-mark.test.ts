// An empty last paragraph in a `w:hideMark` cell (ECMA-376 Part 1, 17.4.25) takes no row height.
// The first paragraph of the document keeps its end mark: a table that opens the body keeps one
// line in its first row. The same table below a paragraph, or after a page break, does not.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createLayoutSession,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text = '') =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>' +
  `${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const cell = `<w:tc><w:tcPr><w:tcW w:w="960" w:type="dxa"/><w:hideMark/></w:tcPr>${p()}</w:tc>`;
const row = `<w:tr><w:trPr><w:trHeight w:val="40"/></w:trPr>${cell}${cell}</w:tr>`;
/** Two rows of empty `w:hideMark` cells, at least 2 pt tall, without cell margins. */
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="960"/>' +
  `<w:gridCol w:w="960"/></w:tblGrid>${row}${row}</w:tbl>`;
const options = { measurer: createFixedMeasurer(6, 12), compatibilityMode: 15 };

function layout(body: string, session?: ReturnType<typeof createLayoutSession>, revision = 0) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, revision, {
    ...options,
    ...(session ? { session } : {}),
  });
}

/** The row heights of every table, by page. */
function rowHeights(result: SemanticLayout): number[][] {
  return result.pages.map((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table' ? fragment.rows.map((r) => Number(r.box.height.toFixed(2))) : []
    )
  );
}

test('a table that opens the body keeps one line in its first row', () => {
  expect(rowHeights(layout(table + p('After')))).toEqual([[12, 2]]);
});

test('below a paragraph or after a page break, every empty row falls to its minimum', () => {
  expect(rowHeights(layout(p('Before') + table + p('After')))).toEqual([[2, 2]]);
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  expect(rowHeights(layout(p('Before') + pageBreak + table + p('After')))).toEqual([[], [2, 2]]);
});

test('the opening line follows the table when a paragraph is added before it', () => {
  const session = createLayoutSession();
  expect(rowHeights(layout(table + p('After'), session, 0))).toEqual([[12, 2]]);
  expect(rowHeights(layout(p('Before') + table + p('After'), session, 1))).toEqual([[2, 2]]);
  expect(rowHeights(layout(table + p('After'), session, 2))).toEqual([[12, 2]]);
});
