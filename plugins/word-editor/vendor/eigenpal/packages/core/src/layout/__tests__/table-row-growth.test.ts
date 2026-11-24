import { describe, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableRow } from '../semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { updateTableText } from '../table-text-update.ts';
import { growthBandOf, nextRowMovesAt } from '../table-row-growth.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall. Exact 14pt lines; a one-line row is 14.5pt tall.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string) => `<w:tc><w:tcPr></w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const row = (name: string, trPr = '', pPr = '') =>
  tr([tc(p(`${name}c0`, pPr)), tc(p(`${name}c1`, pPr)), tc(p(`${name}c2`))], trPr);
/** Three lines in its first cell: 42.5pt, taller than the room the page leaves it. */
const tallRow = (trPr = '<w:cantSplit/>') =>
  tr([tc(p('n1') + p('n2') + p('n3')), tc(p('n')), tc(p('n'))], trPr);
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
/** Nine one-line rows fill page one to 131pt; the tall row cannot start in the 39pt left. */
const bodyRows = (count = 9, trPr = '', pPr = '') =>
  Array.from({ length: count }, (_, i) => row(`r${i}`, trPr, pPr));
const tail = Array.from({ length: 6 }, (_, i) => row(`t${i}`));
/** Wraps the edited cell once its column stops widening. */
const WRAPPING = ' Supercalifragilistic expialidocious more words here';

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
const paragraphAt = (part: OoxmlPart, rowIndex: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[rowIndex]!.cells[cell]!.blocks[0]!
    .id;

function lineTotal(blocks: readonly BlockFragmentRecord[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.kind === 'paragraph') total += block.lines.length;
    else
      for (const placed of block.rows)
        for (const cell of placed.cells) total += lineTotal(cell.blocks);
  }
  return total;
}
const bodyLines = (layout: SemanticLayout) =>
  layout.pages.reduce((sum, page) => sum + lineTotal(page.fragments), 0);
const rowHeights = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) =>
      page.fragments
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .map((fragment) => fragment.rows.map((placed) => [placed.id, placed.box.height]))
    )
  );

interface Burst {
  /** Edits whose row heights changed. */
  readonly grew: number;
  /** Of those, edits the direct update accepted. */
  readonly accepted: number;
}

/** The body band of each page of `layout`; these pages carry no note reserve. */
const contentBand = (layout: SemanticLayout) => (index: number) =>
  layout.pages[index]!.contentBox.height;

/**
 * Type into `rowIndex`'s middle cell one character at a time. Every retained-session layout
 * and every accepted direct update must equal a cold layout of the reparsed part: pages,
 * line counter, and the lane the session took.
 */
function typeBurst(
  start: OoxmlPart,
  rowIndex: number,
  name: string,
  text = WRAPPING,
  stablePrefix = false
): Burst {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const paragraphId = paragraphAt(start, rowIndex, 1);
  const offset = `${name}c1`.length;
  let part = start;
  let previous = lay(part, 15, { session, cache });
  let grew = 0;
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
      deps,
      contentBand(previous)
    );
    // Without the paginator's band, no row may grow.
    const unbounded = updateTableText(
      tableNode(part),
      tableNode(edit.part),
      previous.pages,
      310,
      deps
    );
    part = edit.part;
    const prefixCheckpoint = session.checkpoints[0];
    const updated = lay(part, 15, { session, cache });
    if (stablePrefix && direct) expect(session.checkpoints[0]).toBe(prefixCheckpoint);
    const coldSession = createLayoutSession();
    const cold = lay(reparsed(part), 15, { session: coldSession });
    expect(updated.pages).toEqual(cold.pages);
    expect(session.endLineCounter).toBe(coldSession.endLineCounter);
    if (direct) {
      expect(direct.pages).toEqual(cold.pages);
      expect(direct.lineDelta).toBe(bodyLines(cold) - bodyLines(previous));
    }
    if (rowHeights(previous) !== rowHeights(cold)) {
      grew += 1;
      if (direct) accepted += 1;
      expect(unbounded).toBeNull();
    } else if (!unbounded && direct) {
      // Split-row width reuse needs the paginator band even when no row grows.
      // The direct result already equals the cold layout above.
      expect(
        previous.pages.some((page) =>
          page.fragments.some(
            (fragment) =>
              fragment.kind === 'table' &&
              fragment.rows.some((row) => row.isContinuation || row.hasContinuation)
          )
        )
      ).toBe(true);
    } else {
      expect(unbounded?.pages ?? null).toEqual(direct?.pages ?? null);
    }
    previous = updated;
  }
  return { grew, accepted };
}

test('the last row of a page grows in place when the next row still starts the next page', () => {
  const part = load(autofit([...bodyRows(), tallRow(), ...tail]));
  const burst = typeBurst(part, 8, 'r8');
  expect(burst.grew).toBe(1);
  expect(burst.accepted).toBe(1);
});

test('repeated header rows above the grown page keep their geometry', () => {
  const header = row('h', '<w:tblHeader/>');
  const part = load(autofit([header, ...bodyRows(8), tallRow(), ...tail, ...tail]));
  const burst = typeBurst(part, 8, 'r7');
  expect(burst.grew).toBe(1);
  expect(burst.accepted).toBe(1);
});

test('an exact-height next row also keeps its page', () => {
  const exact = tallRow('<w:trHeight w:val="850" w:hRule="exact"/>');
  const burst = typeBurst(load(autofit([...bodyRows(), exact, ...tail])), 8, 'r8');
  expect(burst.grew).toBe(1);
  expect(burst.accepted).toBe(1);
});

test('a row that would overflow the page falls back to the full table layout', () => {
  // Eleven rows leave 10pt below the last one: a second line needs 14.
  const part = load(autofit([...bodyRows(11), tallRow(), ...tail]));
  const burst = typeBurst(part, 10, 'r10');
  expect(burst.grew).toBeGreaterThan(0);
  expect(burst.accepted).toBe(0);
});

test('only the first of two growth steps fits the room the page leaves', () => {
  // Ten rows leave 24.5pt: the first added line fits, the second needs 28.
  const part = load(autofit([...bodyRows(10), tallRow(), ...tail]));
  const burst = typeBurst(part, 9, 'r9', `${WRAPPING} and still more text that wraps`);
  expect(burst.grew).toBeGreaterThan(1);
  expect(burst.accepted).toBe(1);
});

describe('nextRowMovesAt', () => {
  const structureOf = (rows: readonly string[]) =>
    readTableStructure(tableNode(load(autofit(rows))), 310, 0, styleCascade)!;
  const measure = (row: SemanticTableRow, top: number, rowDeps: TableFlowDeps): number =>
    layoutRowFragment(row, [100, 100, 100], 0, top, false, 0, rowDeps).record.box.height;
  const movesAt = (trPr: string, top: number) => {
    const structure = structureOf([row('a'), tallRow(trPr)]);
    return nextRowMovesAt(structure, structure.rows[1]!, 0, top, 170, deps, measure);
  };

  test('a row kept whole moves when only the room below the cursor is short', () => {
    expect(movesAt('<w:cantSplit/>', 131)).toBe(true);
    expect(movesAt('<w:cantSplit/>', 100)).toBe(false);
    expect(movesAt('<w:trHeight w:val="850" w:hRule="exact"/>', 131)).toBe(true);
  });

  test('a splittable row moves only when no cell can start', () => {
    expect(movesAt('', 131)).toBe(false);
    expect(movesAt('', 160)).toBe(true);
  });

  test('a row taller than the page, or a cursor at the page top, proves nothing', () => {
    expect(movesAt('<w:cantSplit/>', 0)).toBe(false);
    const structure = structureOf([
      row('a'),
      tr([
        tc(Array.from({ length: 14 }, (_, i) => p(`line${i}`)).join('')),
        tc(p('x')),
        tc(p('y')),
      ]),
    ]);
    expect(nextRowMovesAt(structure, structure.rows[1]!, 0, 131, 170, deps, measure)).toBe(false);
  });
});

test('a next row that splits onto the page refuses the direct update', () => {
  // A splittable tall row starts in the room the page leaves, so the grown row is not last.
  const part = load(autofit([...bodyRows(), tallRow(''), ...tail]));
  const burst = typeBurst(part, 8, 'r8');
  expect(burst.grew).toBeGreaterThan(0);
  expect(burst.accepted).toBe(0);
});

test('a row kept with the grown row refuses the direct update', () => {
  const part = load(
    autofit([...bodyRows(7), row('r7', '', '<w:keepNext/>'), row('r8'), tallRow(), ...tail])
  );
  const burst = typeBurst(part, 8, 'r8');
  expect(burst.grew).toBe(1);
  expect(burst.accepted).toBe(0);
});

test('the table end refuses growth because content after the table would move', () => {
  const part = load(autofit([...bodyRows(), tallRow(), ...tail.slice(0, 1)]) + p('after'));
  const burst = typeBurst(part, 10, 't0');
  expect(burst.grew).toBeGreaterThan(0);
  expect(burst.accepted).toBe(0);
});

test('the growth band is the given paginator band, on a page the table leaves for the next', () => {
  const fragment = (fragmentIndex: number) =>
    ({
      kind: 'table',
      id: `t#f${fragmentIndex}`,
      tableId: 't',
      fragmentIndex,
      rows: [],
      box: { x: 0, y: 0, width: 10, height: 10 },
    }) as unknown as Extract<BlockFragmentRecord, { kind: 'table' }>;
  const own = fragment(0);
  const page = (extra: Partial<PageRecord> = {}): PageRecord =>
    ({
      id: 'page-0',
      index: 0,
      box: { x: 0, y: 0, width: 100, height: 200 },
      contentBox: { x: 0, y: 0, width: 100, height: 170 },
      fragments: [own],
      ...extra,
    }) as PageRecord;
  expect(growthBandOf(page(), own, fragment(1), 170)).toBe(170);
  // The band is the paginator's, not the content box: a footnote reserve shortens it.
  const notes = { box: { x: 0, y: 160, width: 100, height: 10 } };
  expect(growthBandOf(page({ footnotes: notes } as never), own, fragment(1), 142)).toBe(142);
  expect(growthBandOf(page(), own, fragment(1), Number.NaN)).toBeNull();
  expect(growthBandOf(page(), own, fragment(1), 0)).toBeNull();
  expect(growthBandOf(page(), own, undefined, 170)).toBeNull();
  expect(growthBandOf(page(), own, fragment(2), 170)).toBeNull();
  expect(growthBandOf(page({ endnotes: notes } as never), own, fragment(1), 170)).toBeNull();
  expect(growthBandOf(page({ noteStream: {} } as never), own, fragment(1), 170)).toBeNull();
  expect(growthBandOf(page({ columnSeparators: [] }), own, fragment(1), 170)).toBeNull();
  expect(growthBandOf(page({ parityBlank: true }), own, fragment(1), 170)).toBeNull();
  const after = { ...own, id: 'other' } as typeof own;
  expect(growthBandOf(page({ fragments: [own, after] }), own, fragment(1), 170)).toBeNull();
});

test('a growing table keeps its preceding checkpoint and updates the following paragraph checkpoint', () => {
  const part = load(p('before') + autofit([...bodyRows(8), tallRow(), ...tail]) + p('after'));
  const burst = typeBurst(part, 7, 'r7', WRAPPING, true);
  expect(burst.grew).toBe(1);
  expect(burst.accepted).toBe(1);
});
