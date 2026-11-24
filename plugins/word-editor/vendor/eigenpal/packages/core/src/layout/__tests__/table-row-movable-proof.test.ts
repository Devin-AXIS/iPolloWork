import { afterEach, beforeEach, expect, test } from 'bun:test';
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
import {
  moveRowToWidths,
  movedRowsTestRecorder,
  rememberMovableCopy,
  withLines,
} from '../table-row-geometry-reuse.ts';
import { layoutRowFragment } from '../semantic-table-layout.ts';
import { bodyLineId } from '../body-line-id.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// A full layout checks each remembered cell fragment for unmovable fields once. The first
// width change then moves that very fragment without checking its fields again. A copy of
// it is checked separately. Placement records that check for vertically shifted copies too.

// Page body: 310pt wide, 170pt tall, twelve 14pt lines.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/>${pPr}` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number, tcPr = '', trPr = '', pPr = '') =>
  tr(
    [0, 1, 2].map((c) => tc(p(`r${index}c${c}`, pPr), tcPr)),
    trPr
  );
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const structureOf = (part: OoxmlPart) => readTableStructure(tableNode(part), 310, 0, styleCascade)!;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const edges = (layout: SemanticLayout): string =>
  JSON.stringify(tables(layout).map((fragment) => [fragment.box.x, fragment.columnEdges]));
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');

let recorder = movedRowsTestRecorder();
beforeEach(() => {
  recorder = movedRowsTestRecorder();
});
afterEach(() => recorder.dispose());

interface Edit {
  readonly part: OoxmlPart;
  readonly moved: number;
  readonly fieldScans: number;
}

/**
 * Lay `start` out fully through a retained session, then type `text` into row `row`, column
 * 1. Each width-changing edit must equal a cold layout. Returns the counts of each edit.
 */
function typeAfterFullLayout(start: OoxmlPart, row: number, text: string): Edit[] {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const paragraphId = structureOf(start).rows[row]!.cells[1]!.blocks[0]!.id;
  let part = start;
  let previous = lay(part, 15, { session, cache });
  const edits: Edit[] = [];
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const moved = recorder.moved;
    const fieldScans = recorder.fieldScans;
    const updated = lay(part, 15, { session, cache });
    expect(updated.pages).toEqual(lay(reparsed(part)).pages);
    if (edges(updated) !== edges(previous))
      edits.push({
        part,
        moved: recorder.moved - moved,
        fieldScans: recorder.fieldScans - fieldScans,
      });
    previous = updated;
  }
  return edits;
}

test('the first width change moves fully laid out fragments without scanning their fields', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => body(i))));
  const edits = typeAfterFullLayout(part, 13, 'wider ');
  expect(edits.length).toBeGreaterThan(1);
  for (const edit of edits) {
    expect(edit.moved).toBeGreaterThan(0);
    expect(edit.fieldScans).toBe(0);
  }
});

test('vertical placement checks shifted copies before a later width change reads them', () => {
  // Rows taller than their line: the centered cell content is shifted, which copies blocks.
  const rows = Array.from({ length: 20 }, (_, i) =>
    body(i, '<w:vAlign w:val="center"/>', '<w:trHeight w:val="560" w:hRule="atLeast"/>')
  );
  const part = load(autofit(rows));
  const edits = typeAfterFullLayout(part, 9, 'wider ');
  expect(edits.length).toBeGreaterThan(1);
  for (const edit of edits) {
    expect(edit.moved).toBeGreaterThan(0);
    expect(edit.fieldScans).toBe(0);
  }
});

test('paragraph shading is never remembered as movable', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    body(i, '', '', '<w:shd w:val="clear" w:color="auto" w:fill="DDDDDD"/>')
  );
  const part = load(autofit(rows));
  const edits = typeAfterFullLayout(part, 9, 'wider ');
  expect(edits.length).toBeGreaterThan(0);
  for (const edit of edits) {
    expect(edit.moved).toBe(0);
    expect(edit.fieldScans).toBeGreaterThan(0);
  }
});

test('copies keep the proof only through withLines; unmovable fields are refused', () => {
  const part = load(autofit(Array.from({ length: 3 }, (_, i) => body(i))));
  const row = structureOf(part).rows[1]!;
  const deps = {
    measurer,
    styleCascade,
    // The move reads the placed line back from the break cache.
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const narrow = [90, 100, 110];
  const wide = [100.5, 95.25, 104.125];
  const placed = layoutRowFragment(row, narrow, 3, 40, false, 0, deps).record;
  const blockOf = (cell: TableRowFragmentRecord['cells'][number]) =>
    cell.blocks[0] as ParagraphFragmentRecord;
  const withBlocks = (
    change: (block: ParagraphFragmentRecord) => ParagraphFragmentRecord
  ): TableRowFragmentRecord => ({
    ...placed,
    cells: placed.cells.map((cell) => ({ ...cell, blocks: [change(blockOf(cell))] })),
  });
  const scansFor = (record: TableRowFragmentRecord): number | null => {
    const before = recorder.fieldScans;
    const moved = moveRowToWidths(row, record, wide, 2.5, deps);
    return moved ? recorder.fieldScans - before : null;
  };

  // The placed fragments were checked when placement remembered them.
  expect(scansFor(placed)).toBe(0);
  // A line-id restamp keeps the proof.
  expect(scansFor(withBlocks((block) => withLines(block, block.lines.slice())))).toBe(0);
  // Any other copy is checked again, and moves when its fields allow.
  expect(scansFor(withBlocks((block) => ({ ...block })))).toBe(placed.cells.length);
  expect(scansFor(withBlocks((block) => rememberMovableCopy(block, { ...block })))).toBe(0);
  for (const extra of [
    { shadingBox: { x: 0, y: 0, width: 1, height: 1 } },
    { marker: {} },
    { borders: [] },
    { bottomBorder: {} },
  ]) {
    const copy = withBlocks((block) => ({ ...block, ...extra }) as ParagraphFragmentRecord);
    expect(scansFor(copy)).toBeNull();
    expect(
      scansFor(
        withBlocks((block) =>
          rememberMovableCopy(block, { ...block, ...extra } as ParagraphFragmentRecord)
        )
      )
    ).toBeNull();
    // The restamp of an unproven copy carries nothing.
    expect(
      scansFor({
        ...copy,
        cells: copy.cells.map((cell) => ({
          ...cell,
          blocks: [withLines(blockOf(cell), blockOf(cell).lines.slice())],
        })),
      })
    ).toBeNull();
  }
});
