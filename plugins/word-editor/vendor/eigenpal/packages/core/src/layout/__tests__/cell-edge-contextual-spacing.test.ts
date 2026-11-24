// `w:contextualSpacing` (17.3.1.9) at the edges of a table cell. The property compares a
// paragraph with the paragraphs before and after it in document order, and a cell edge
// does not stop that walk. At a cell edge the neighbour is:
//
// - the last paragraph of the previous cell in the row, or the first paragraph of the next;
// - the row end mark (17.4.78 `w:tr`) before a row's first cell and after its last cell,
//   which is in the default paragraph style (17.7.4.17 `w:default`);
// - the paragraph before the table, before the first cell of a body table's first row.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const styles = (defaultStyle = true) =>
  buildStyleCascadeTable(
    read(
      `<w:styles xmlns:w="${W}">` +
        `<w:style w:type="paragraph"${defaultStyle ? ' w:default="1"' : ''} w:styleId="Normal">` +
        '<w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Child"><w:name w:val="Child"/>' +
        '<w:basedOn w:val="Normal"/></w:style>' +
        '<w:style w:type="table" w:styleId="Spaced"><w:name w:val="Spaced"/>' +
        '<w:pPr><w:spacing w:before="0" w:after="200"/><w:contextualSpacing/></w:pPr></w:style>' +
        '</w:styles>',
      '/word/styles.xml'
    ).root
  );

const CS = '<w:contextualSpacing/>';
const NONE = '<w:spacing w:before="0" w:after="0"/>';
const AFTER = '<w:spacing w:before="0" w:after="200"/>';
const BEFORE = '<w:spacing w:before="200" w:after="0"/>';

/** One paragraph: a style id (`''` for none) and its paragraph properties. */
type Para = readonly [style: string, pPr: string];
type Rows = readonly (readonly (readonly Para[])[])[];
const N = (pPr: string): Para => ['', pPr];
const O = (pPr: string): Para => ['Other', pPr];

function paragraph([style, pPr]: Para): string {
  const pStyle = style ? `<w:pStyle w:val="${style}"/>` : '';
  return `<w:p><w:pPr>${pStyle}${pPr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
}

interface Options {
  readonly tblStyle?: string;
  readonly defaultStyle?: boolean;
  /** The paragraph before the table; `null` for none. Default: an unstyled one. */
  readonly lead?: Para | null;
  /** Empty paragraphs before the lead. */
  readonly filler?: number;
}

/**
 * Lay out one table with zero cell margins. For each row: how far the first line of each
 * cell sits below the row top, then the row height.
 */
function offsets(
  rows: Rows,
  options: Options = {},
  session?: ReturnType<typeof createLayoutSession>
): number[][] {
  const cells = (row: Rows[number]) =>
    row.map((cell) => `<w:tc>${cell.map(paragraph).join('')}</w:tc>`).join('');
  const table =
    '<w:tbl><w:tblPr>' +
    (options.tblStyle ? `<w:tblStyle w:val="${options.tblStyle}"/>` : '') +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="3000"/>'.repeat(rows[0]!.length)}</w:tblGrid>` +
    rows.map((row) => `<w:tr>${cells(row)}</w:tr>`).join('') +
    '</w:tbl>';
  const lead = options.lead === undefined ? N(NONE) : options.lead;
  const body =
    paragraph(N(NONE)).repeat(options.filler ?? 0) + (lead ? paragraph(lead) : '') + table;
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:p/></w:body></w:document>`,
    '/word/document.xml'
  );
  const result = layoutSemanticDocument(document, 1, {
    measurer,
    styleCascade: styles(options.defaultStyle ?? true),
    geometry: { width: 400, height: 600, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    ...(session ? { session } : {}),
  });
  return result.pages.at(-1)!.fragments.flatMap((fragment) =>
    fragment.kind === 'table'
      ? fragment.rows.map((row) => [
          ...row.cells.map((cell) => {
            const first = cell.blocks[0];
            const line = first?.kind === 'paragraph' ? first.lines[0] : undefined;
            return round((line?.box.y ?? Number.NaN) - row.box.y);
          }),
          round(row.box.height),
        ])
      : []
  );
}

const round = (value: number) => Math.round(value * 100) / 100;
/** One line of the fixed measurer. */
const LINE = offsets([[[N(NONE)]]])[0]![1]!;
/** {@link offsets} with each row height given as the space beyond `lines` lines. */
const extra = (rows: Rows, options?: Options, lines = 1) =>
  offsets(rows, options).map((row) => [...row.slice(0, -1), round(row.at(-1)! - LINE * lines)]);
/** A one-column table of `count` rows, each holding `cell`. */
const column = (cell: readonly Para[], count = 2): Rows =>
  Array.from({ length: count }, () => [cell]);

describe('contextual spacing at the start and end of a row compares with the row end mark', () => {
  test('a paragraph in the default style drops its space after in the last cell', () => {
    expect(extra(column([N(AFTER)]))).toEqual([
      [0, 10],
      [0, 10],
    ]);
    expect(extra(column([N(AFTER + CS)]))).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(extra(column([['Normal', AFTER + CS]]))).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  test('a table style can switch it on', () => {
    expect(extra(column([N('')]), { tblStyle: 'Spaced' })).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  test('any other style keeps the space, even one based on the default style', () => {
    expect(extra(column([O(AFTER + CS)]))).toEqual([
      [0, 10],
      [0, 10],
    ]);
    expect(extra(column([['Child', AFTER + CS]]))).toEqual([
      [0, 10],
      [0, 10],
    ]);
  });

  test('with no default paragraph style there is nothing to match', () => {
    expect(extra(column([N(AFTER + CS)]), { defaultStyle: false })).toEqual([
      [0, 10],
      [0, 10],
    ]);
  });

  test('a later row compares its first cell with the row end mark, not the cell above', () => {
    // Every cell `Other` after an `Other` lead: only a later row's first cell keeps it.
    const row = [[O(BEFORE + CS)], [O(BEFORE + CS)]];
    expect(extra([row, row], { lead: O(NONE) })).toEqual([
      [0, 0, 0],
      [10, 0, 10],
    ]);
  });
});

describe('contextual spacing between the cells of a row compares the neighbouring cells', () => {
  test('a cell compares its first paragraph with the last paragraph of the cell before', () => {
    // `Other`, then `Normal`: the second cell keeps its space before.
    expect(extra([[[O(BEFORE + CS)], [N(BEFORE + CS)]]], { lead: null })).toEqual([[10, 10, 10]]);
    // The first cell ends `Other` and the second opens `Other`: the second drops it.
    expect(extra([[[N(NONE), O(NONE)], [O(BEFORE + CS)]]], { lead: null }, 2)).toEqual([[0, 0, 0]]);
    // All `Normal` after an `Other` lead: only the first cell keeps it.
    expect(extra([[[N(BEFORE + CS)], [N(BEFORE + CS)]]], { lead: O(NONE) })).toEqual([[10, 0, 10]]);
  });

  test('a cell compares its last paragraph with the first paragraph of the next cell', () => {
    // `Normal` before a cell that opens `Other` keeps its space after; that cell ends
    // `Normal` at the row end mark, so it drops its own.
    expect(extra([[[N(AFTER + CS)], [O(NONE), N(AFTER + CS)]]], {}, 2)).toEqual([[0, 0, 0]]);
    expect(extra([[[N(AFTER + CS)], [O(NONE)]]])).toEqual([[0, 0, 10]]);
    // Every cell `Other`: the first drops its space after, the last keeps it.
    expect(
      extra(
        [
          [
            [O(AFTER + CS), O(NONE)],
            [O(NONE), O(NONE)],
          ],
        ],
        {},
        2
      )
    ).toEqual([[0, 0, 0]]);
    expect(extra([[[O(NONE), O(AFTER + CS)], [O(NONE)]]], {}, 2)).toEqual([[0, 0, 0]]);
    expect(extra([[[O(NONE)], [O(NONE), O(AFTER + CS)]]], {}, 2)).toEqual([[0, 0, 10]]);
  });
});

describe('contextual spacing at the top of a body table compares with the paragraph before', () => {
  test('a lead paragraph in the same style drops the space before of the first row', () => {
    expect(extra(column([N(BEFORE + CS)]))).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(extra(column([N(BEFORE + CS)]), { lead: ['Normal', NONE] })).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  test('a lead paragraph in another style keeps it', () => {
    expect(extra(column([N(BEFORE + CS)]), { lead: O(NONE) })).toEqual([
      [10, 10],
      [0, 0],
    ]);
  });

  test('a table that opens the story keeps it', () => {
    expect(extra(column([N(BEFORE + CS)]), { lead: null })).toEqual([
      [10, 10],
      [0, 0],
    ]);
  });

  test('the lead style decides, not the default style', () => {
    expect(extra(column([O(BEFORE + CS)]), { lead: O(NONE) })).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(extra(column([O(BEFORE + CS)]))).toEqual([
      [10, 10],
      [10, 10],
    ]);
  });

  test('restyling the paragraph before the table re-places the table', () => {
    // The lead paragraph closes a full first page, so the table opens page two at the same
    // place in both passes: an incremental pass must still give the fresh answer.
    const session = createLayoutSession();
    const rows = column([N(BEFORE + CS)]);
    const other = { lead: O(NONE), filler: 41 };
    const normal = { lead: N(NONE), filler: 41 };
    const [kept, dropped] = [offsets(rows, other), offsets(rows, normal)];
    expect(kept[0]![0]! - dropped[0]![0]!).toBeCloseTo(10);
    expect(offsets(rows, other, session)).toEqual(kept);
    expect(offsets(rows, normal, session)).toEqual(dropped);
    expect(offsets(rows, other, session)).toEqual(kept);
  });
});
