import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number, columns = 3) =>
  tr(Array.from({ length: columns }, (_, c) => tc(p(`r${index}c${c}`))));
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[], tblPr = '', columns = 3) =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="${2000 * columns}" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>${rows.join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const deps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const edges = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .map((fragment) => [fragment.box.x, fragment.columnEdges])
  );
const paragraphAt = (part: OoxmlPart, row: number, cell: number, block = 0): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[block]!
    .id;

interface Burst {
  /** Edits whose column widths changed. */
  readonly widthChanges: number;
  /** Width changes the direct width update accepted. */
  readonly accepted: number;
  readonly part: OoxmlPart;
}

/**
 * Type `text` one character at a time into `paragraphId` through a retained layout session,
 * comparing every intermediate layout with a cold layout of the reparsed part.
 */
function typeBurst(start: OoxmlPart, paragraphId: string, text: string, offset = 0): Burst {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let part = start;
  let previous = lay(part, 15, { session, cache });
  let widthChanges = 0;
  let accepted = 0;
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: offset + index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    const direct = updateTableText(
      tableNode(part),
      tableNode(edit.part),
      previous.pages,
      310,
      deps
    );
    part = edit.part;
    const updated = lay(part, 15, { session, cache });
    const cold = lay(reparsed(part));
    expect(updated.pages).toEqual(cold.pages);
    if (edges(previous) !== edges(updated)) {
      widthChanges += 1;
      if (direct) {
        accepted += 1;
        expect(direct.pages).toEqual(cold.pages);
        expect(direct.lineDelta).toBe(0);
      }
    }
    previous = updated;
  }
  return { widthChanges, accepted, part };
}

test('typing that moves every AutoFit column edge re-places all pages in place', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => body(i))));
  const before = lay(part);
  expect(before.pages.length).toBeGreaterThan(2);
  const burst = typeBurst(part, paragraphAt(part, 13, 1), 'wider ');
  expect(burst.widthChanges).toBeGreaterThan(2);
  expect(burst.accepted).toBe(burst.widthChanges);
});

test('repeated header rows keep their page occurrence ids', () => {
  const header = tr([tc(p('Head A')), tc(p('Head B')), tc(p('Head C'))], '<w:tblHeader/>');
  const part = load(autofit([header, ...Array.from({ length: 40 }, (_, i) => body(i))]));
  const before = lay(part);
  const repeats = before.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((fragment) => fragment.rows.filter((row) => row.isHeaderRepeat));
  expect(repeats.length).toBeGreaterThan(1);
  const burst = typeBurst(part, paragraphAt(part, 20, 2), 'header ');
  expect(burst.widthChanges).toBeGreaterThan(1);
  expect(burst.accepted).toBe(burst.widthChanges);
});

test('a vertical merge inside the repeated header group is planned again', () => {
  const merged = tr(
    // Two lines in the merged head: only the merge plan keeps the first row one line tall.
    [tc(p('Group') + p('Two'), '<w:vMerge w:val="restart"/>'), tc(p('Top B')), tc(p('Top C'))],
    '<w:tblHeader/>'
  );
  const below = tr([tc(p(''), '<w:vMerge/>'), tc(p('Low B')), tc(p('Low C'))], '<w:tblHeader/>');
  const part = load(autofit([merged, below, ...Array.from({ length: 40 }, (_, i) => body(i))]));
  const burst = typeBurst(part, paragraphAt(part, 25, 0), 'merged ');
  expect(burst.widthChanges).toBeGreaterThan(1);
  expect(burst.accepted).toBe(burst.widthChanges);
});

test('a change that rewraps a row falls back to the full table layout', () => {
  // A single long word sets its column's minimum; narrowing another column wraps text.
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 4 ? tr([tc(p('alpha beta gamma delta')), tc(p('x')), tc(p('y'))]) : body(i)
  );
  const part = load(autofit(rows));
  const burst = typeBurst(part, paragraphAt(part, 10, 2), 'Supercalifragilistic', 5);
  expect(burst.widthChanges).toBeGreaterThan(0);
  expect(burst.accepted).toBeLessThan(burst.widthChanges);
});

test('wrapped cells keep their line count when breaks move', () => {
  // Two-line cells: the break moves with the column edge, the row height does not.
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([tc(p(`a${i} b c d e f g h i j k l m n o p q r s t u v w x y z a b c`)), tc(p(`r${i}`))])
  );
  const part = load(autofit(rows, '', 2));
  const burst = typeBurst(part, paragraphAt(part, 7, 1), 'Wide', 2);
  expect(burst.widthChanges).toBeGreaterThan(0);
  expect(burst.accepted).toBeGreaterThan(0);
});

test('the last row of each page keeps its own bottom edge', () => {
  const thick =
    '<w:tblBorders><w:top w:val="single" w:sz="24"/><w:bottom w:val="single" w:sz="48"/>' +
    '<w:insideH w:val="single" w:sz="2"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>';
  const rows = Array.from({ length: 30 }, (_, i) => body(i)).join('');
  const xml =
    `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${thick}${ZERO_MARGINS}</w:tblPr>` +
    `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows}</w:tbl>`;
  const part = load(xml);
  const burst = typeBurst(part, paragraphAt(part, 16, 0), 'bottom ');
  expect(burst.widthChanges).toBeGreaterThan(1);
  expect(burst.accepted).toBe(burst.widthChanges);
});

test('undo restores the original widths through the same lane', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => body(i))));
  const paragraphId = paragraphAt(part, 13, 1);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const original = lay(part, 15, { session, cache });
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'longer ' });
  if (!edit.ok) throw Error(edit.reason);
  const edited = lay(edit.part, 15, { session, cache });
  expect(edges(edited)).not.toBe(edges(original));
  const undo = updateTableText(tableNode(edit.part), tableNode(part), edited.pages, 310, deps);
  expect(undo).not.toBeNull();
  expect(undo!.pages).toEqual(lay(part).pages);
  // The retained session returns to the original part (the history restores that tree).
  expect(lay(part, 15, { session, cache }).pages).toEqual(lay(part).pages);
  const redo = lay(edit.part, 15, { session, cache });
  expect(redo.pages).toEqual(lay(reparsed(edit.part)).pages);
});

const widthOnlyRefusal = (xml: string, row: number, cell: number): void => {
  const part = load(xml);
  const before = lay(part);
  const paragraphId = paragraphAt(part, row, cell);
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text: 'wider ' });
  if (!edit.ok) throw Error(edit.reason);
  const after = lay(edit.part);
  expect(edges(after)).not.toBe(edges(before));
  expect(
    updateTableText(tableNode(part), tableNode(edit.part), before.pages, 310, deps)
  ).toBeNull();
  const session = createLayoutSession();
  lay(part, 15, { session });
  expect(lay(edit.part, 15, { session }).pages).toEqual(lay(reparsed(edit.part)).pages);
};

test('a vertical merge among body rows is refused', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 5
      ? tr([tc(p('m'), '<w:vMerge w:val="restart"/>'), tc(p('a')), tc(p('b'))])
      : i === 6
        ? tr([tc(p(''), '<w:vMerge/>'), tc(p('c')), tc(p('d'))])
        : body(i)
  );
  widthOnlyRefusal(autofit(rows), 12, 1);
});

test('a right-to-left table is refused', () => {
  widthOnlyRefusal(
    autofit(
      Array.from({ length: 30 }, (_, i) => body(i)),
      '<w:bidiVisual/>'
    ),
    12,
    1
  );
});

test('a nested table is refused', () => {
  const nested = autofit([body(90), body(91)]).replace(
    'w:w="6000" w:type="dxa"',
    'w:w="0" w:type="auto"'
  );
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 3 ? tr([tc(nested + p('')), tc(p('x')), tc(p('y'))]) : body(i)
  );
  widthOnlyRefusal(autofit(rows), 12, 1);
});

test('a field in any cell is refused', () => {
  const field =
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 20 ? tr([tc(field), tc(p('x')), tc(p('y'))]) : body(i)
  );
  widthOnlyRefusal(autofit(rows), 12, 1);
});

test('a row split across pages is refused', () => {
  const tall = Array.from({ length: 16 }, (_, i) => p(`tall${i}`)).join('');
  const rows = Array.from({ length: 6 }, (_, i) =>
    i === 2 ? tr([tc(tall), tc(p('x')), tc(p('y'))]) : body(i)
  );
  widthOnlyRefusal(autofit(rows), 4, 1);
});
