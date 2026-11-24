import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableRow } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { rowKeepsWithNext, rowStartsPage } from '../table-row-keeps.ts';
import { rowFacts, rowFactsTestRecorder } from '../table-row-facts.ts';
import {
  retargetSharedGridLineSideRules,
  withSharedGridLineSideRules,
  type SideRuleTableShape,
} from '../legacy-table-side-rules.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

// A mode-15 left-aligned AutoFit table with one 6pt side rule on every cell side shares its
// rules with the grid lines only while grid plus rule fits the 468pt column. One character
// widens the grid past that point, so every row and cell becomes a copy without the flags.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(text)}</w:tc>`;
const tr = (cells: readonly string[]) => `<w:tr>${cells.map(tc).join('')}</w:tr>`;
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="48"/>`)
    .join('') +
  '</w:tblBorders>';
const documentXml = (rows: readonly string[]) =>
  `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>${BORDERS}` +
  `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>` +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" ' +
  'w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
  '</w:body></w:document>';
const load = (xml: string): OoxmlPart => {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
};
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: object = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, compatibilityMode: 15, ...extra });
const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
const deps = {
  measurer,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const ROWS = 40;

for (const warm of [false, true]) {
  test(`a side-rule switch reads each row family once (${warm ? 'warm' : 'cold'} rows)`, () => {
    // The 70th character of the edited cell is the first to cross the threshold.
    const seed = warm ? 68 : 69;
    const rows = Array.from({ length: ROWS }, (_, i) =>
      tr([`R${i}`, `C${i}`, i === 20 ? `D${i}${'W'.repeat(seed)}` : `D${i}`])
    );
    let part = load(documentXml(rows));
    const paragraphId = readTableStructure(tableNode(part), 468, 0)!.rows[20]!.cells[2]!.blocks[0]!
      .id;
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    let previous = lay(part, { session, cache });
    const type = (text: string, offset: number) => {
      const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset, text });
      if (!edit.ok) throw Error(edit.reason);
      const reads = rowFactsTestRecorder();
      const direct = updateTableText(
        tableNode(part),
        tableNode(edit.part),
        previous.pages,
        468,
        deps
      );
      reads.dispose();
      part = edit.part;
      const updated = lay(part, { session, cache });
      expect(JSON.stringify(updated.pages)).toBe(JSON.stringify(lay(part).pages));
      const before = tables(previous)[0]!.box;
      previous = updated;
      return { direct, reads, switched: before.x !== tables(updated)[0]!.box.x };
    };
    // A narrow edit first fills the width lane's answers for the rows with the flags.
    if (warm) expect(type('W', 3 + seed).switched).toBe(false);
    const { direct, reads, switched } = type('W', 3 + 69);
    expect(switched).toBe(true);
    expect(direct).not.toBeNull();
    expect(direct!.pages).toEqual(lay(part).pages);
    // Each family reads its cells once: the flag-free copies and the rows they copy share one
    // answer. Only the edited row, before and after the edit, is a family of its own.
    expect(reads.eligible).toBe(warm ? 1 : ROWS + 1);
  });
}

// Unit fixture: three rows whose cells have a simple side rule.
const NONE = { state: 'none' } as const;
const RULE = { state: 'edge', style: 'single', color: null, widthPt: 1 } as const;
const unitRows = (): SemanticTableRow[] =>
  Array.from({ length: 3 }, (_, row) => ({
    id: `r${row}`,
    isHeader: false,
    cells: [0, 1].map((column) => ({
      id: `c${row}-${column}`,
      gridColumn: column,
      gridSpan: 1,
      vMergeContinue: false,
      textDirection: 'horizontal',
      blocks: [],
      borders: { top: NONE, bottom: NONE, left: RULE, right: RULE },
    })),
  })) as unknown as SemanticTableRow[];
const narrow: SideRuleTableShape = {
  compatibilityMode: 15,
  depth: 0,
  bidiVisual: false,
  floating: false,
  cellSpacingPt: 0,
  widthType: 'dxa',
  alignment: 'left',
  layoutFixed: false,
  indentPt: 0,
  columnWidthsPt: [100, 100],
  containerWidthPt: 300,
};

test('side-rule copies share answers, and other copies do not', () => {
  const shared = withSharedGridLineSideRules(unitRows(), narrow);
  const keeps = shared.rows.map((row) => rowKeepsWithNext(row, undefined));
  const structure = { rows: shared.rows } as never;
  const breaks = shared.rows.map((_, index) => rowStartsPage(structure, index, undefined, 15));

  const reads = rowFactsTestRecorder();
  const widened = retargetSharedGridLineSideRules(shared.rows, narrow, [100, 250]);
  expect(widened.rows.every((row, index) => row !== shared.rows[index])).toBe(true);
  expect(widened.rows.map((row) => rowKeepsWithNext(row, undefined))).toEqual(keeps);
  const copies = { rows: widened.rows } as never;
  expect(widened.rows.map((_, index) => rowStartsPage(copies, index, undefined, 15))).toEqual(
    breaks
  );
  expect(widened.rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect([reads.keepsWithNext, reads.breaksPageBefore]).toEqual([0, 0]);

  // A copy that is not a side-rule copy, such as a text edit, finds its own answers.
  const edited = { ...widened.rows[0]! };
  expect(rowKeepsWithNext(edited, undefined)).toBe(keeps[0]!);
  expect(reads.keepsWithNext).toBe(1);
  reads.dispose();

  // The record holds answers only, so a copy never keeps its source alive.
  for (const value of Object.values(rowFacts(widened.rows[0]!)))
    expect(value === undefined || typeof value !== 'object').toBe(true);
});
