import { expect } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableRowFragmentRecord } from '../semantic-records.ts';

// Letter page, 1in margins: a 648pt band. Outer rules 1.5pt, inside rules 0.5pt, cell margins 0.
// Every case opens with a 12pt line and an exact spacer, so the table rows land where a case
// needs them. Heights are multiples of 1.25 twips.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const line = (text: string, twips = 240) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips}" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

export interface Row {
  readonly tag: string;
  readonly twips?: number;
  readonly rule?: 'exact' | 'atLeast';
  readonly header?: boolean;
  readonly cantSplit?: boolean;
  readonly lines?: number;
  /** The exact height of the first line in each cell, in twips (default 240). */
  readonly firstLineTwips?: number;
  /** Raw content for each cell, which replaces the generated lines. */
  readonly cellContent?: readonly [string, string];
}

export function letterDocument(
  spacerPt: number,
  rows: readonly Row[],
  options: { align?: 'top' | 'center' | 'bottom'; insideH?: boolean } = {}
) {
  const side = (name: string, size: number) => `<w:${name} w:val="single" w:sz="${size}"/>`;
  const borders =
    ['top', 'left', 'bottom', 'right'].map((name) => side(name, 12)).join('') +
    (options.insideH === false ? '<w:insideH w:val="nil"/>' : side('insideH', 4)) +
    side('insideV', 4);
  const margins = ['top', 'left', 'bottom', 'right']
    .map((name) => `<w:${name} w:w="0" w:type="dxa"/>`)
    .join('');
  let table =
    `<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblCellMar>${margins}</w:tblCellMar></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
  for (const row of rows) {
    const height = row.twips
      ? `<w:trHeight w:val="${row.twips}" w:hRule="${row.rule ?? 'exact'}"/>`
      : '';
    table +=
      `<w:tr><w:trPr>${row.cantSplit === false ? '' : '<w:cantSplit/>'}` +
      `${row.header ? '<w:tblHeader/>' : ''}${height}</w:trPr>`;
    for (const column of [1, 2]) {
      const text =
        row.cellContent?.[column - 1] ??
        Array.from({ length: row.lines ?? 1 }, (_, index) =>
          index === 0
            ? line(`${row.tag}c${column}`, row.firstLineTwips)
            : line(`${row.tag}l${index}`)
        ).join('');
      table += `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:vAlign w:val="${options.align ?? 'center'}"/></w:tcPr>${text}</w:tc>`;
    }
    table += '</w:tr>';
  }
  const section =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
    'w:bottom="1440" w:left="1440" w:header="0" w:footer="0"/></w:sectPr>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${line('LEAD')}${line('SPACER', spacerPt * 20)}` +
      `${table}</w:tbl>${line('AFTER')}${section}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

export function layOut(part: ReturnType<typeof letterDocument>, compatibilityMode?: number) {
  const source = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(5, 12),
    compatibilityMode,
  });
  expect(serializeOoxmlPart(part)).toBe(source);
  return result;
}

export type Placed = { readonly page: number; readonly row: TableRowFragmentRecord };
export function rowsOf(result: ReturnType<typeof layOut>): Map<string, Placed> {
  const rows = new Map<string, Placed>();
  result.pages.forEach((page, index) => {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        const block = row.cells[0]!.blocks[0];
        const text = block?.kind === 'paragraph' ? block.lines[0]!.spans[0]!.text : '';
        rows.set(`${text}${row.isHeaderRepeat ? '@repeat' : ''}`, { page: index, row });
      }
    }
  });
  return rows;
}

export const textTop = (placed: Placed | undefined) => {
  const block = placed?.row.cells[0]!.blocks[0];
  if (!block || block.kind !== 'paragraph') throw new Error('The cell text is missing');
  return block.lines[0]!.box.y;
};

/** The page index of the body paragraph whose first span is `text`. */
export function pageOf(result: ReturnType<typeof layOut>, text: string): number {
  return result.pages.findIndex((page) =>
    page.fragments.some(
      (fragment) => fragment.kind === 'paragraph' && fragment.lines[0]?.spans[0]?.text === text
    )
  );
}
