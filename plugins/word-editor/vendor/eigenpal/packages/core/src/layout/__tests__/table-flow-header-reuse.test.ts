import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { readTableStructure, type SemanticTableStructure } from '../semantic-table.ts';
import {
  layoutRowFragment,
  measureRowHeight,
  type TableFlowDeps,
} from '../semantic-table-layout.ts';
import { bodyLineId } from '../body-line-id.ts';
import { createFlowHeaderReuse, flowHeaderReuseTestRecorder } from '../table-header-flow-reuse.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, measurer, SECT, styleCascade, W } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, exact 14pt lines.
const EXACT = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
const p = (text: string, run = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/>${EXACT}</w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${run}</w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number, note?: number) =>
  tr([
    tc(p(`r${index}a`)),
    tc(
      p(`r${index}b`, note === undefined ? '' : `<w:r><w:footnoteReference w:id="${note}"/></w:r>`)
    ),
  ]);
/** Two header rows with a merge inside the group: planned on every page they repeat on. */
const MERGED = [
  tr([tc(p('Group') + p('Two'), '<w:vMerge w:val="restart"/>'), tc(p('Top'))], '<w:tblHeader/>'),
  tr([tc(p(''), '<w:vMerge/>'), tc(p('Low'))], '<w:tblHeader/>'),
];
const PLAIN = [tr([tc(p('Head A')), tc(p('Head B'))], '<w:tblHeader/>')];
const table = (headers: readonly string[], rows: readonly string[], tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
  `${[...headers, ...rows].join('')}</w:tbl>`;
const bodyRows = (count: number, notes: ReadonlyMap<number, number> = new Map()) =>
  Array.from({ length: count }, (_, i) => body(i, notes.get(i)));

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const repeats = (layout: SemanticLayout): number =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .filter((fragment) => fragment.rows.some((row) => row.isHeaderRepeat)).length;

/** One cold layout with the reuse off or on: pages, keys, cache reads, line counter, counts. */
function run(part: OoxmlPart, disabled: boolean, layout = defaultLayout) {
  const recorder = flowHeaderReuseTestRecorder(disabled);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const result = layout(part, session, cache);
  recorder.dispose();
  return {
    result,
    pages: JSON.stringify(result.pages),
    keys: [...(tableCellBreakKeysOf(tableNode(part)) ?? [])],
    stats: cache.stats,
    lines: session.endLineCounter,
    plansBuilt: recorder.plansBuilt,
    plansReused: recorder.plansReused,
    rowsPlaced: recorder.rowsPlaced,
    rowsReused: recorder.rowsReused,
  };
}
function defaultLayout(
  part: OoxmlPart,
  session: ReturnType<typeof createLayoutSession>,
  cache: ReturnType<typeof createParagraphLayoutCache>
): SemanticLayout {
  return lay(part, 15, { session, cache });
}
function expectSameWork(off: ReturnType<typeof run>, on: ReturnType<typeof run>): void {
  expect(on.pages).toBe(off.pages);
  expect(on.keys.length).toBeGreaterThan(0);
  expect(on.keys).toEqual(off.keys);
  expect(on.stats).toEqual(off.stats);
  expect(on.lines).toBe(off.lines);
  expect([off.plansReused, off.rowsReused]).toEqual([0, 0]);
}

test('repeated merged headers reuse one plan and one placement per row across pages', () => {
  const part = load(table(MERGED, bodyRows(60)));
  const off = run(part, true);
  const on = run(part, false);
  expectSameWork(off, on);
  const count = repeats(off.result);
  expect(count).toBeGreaterThan(2);
  // The authored group and the first repeat are placed; every later repeat is restamped.
  expect([on.rowsPlaced, on.rowsReused]).toEqual([4, 2 * (count - 1)]);
  expect(on.plansReused).toBeGreaterThanOrEqual(count - 1);
  expect(on.plansBuilt + on.plansReused).toBe(off.plansBuilt);
});

test('a plain repeated header gives the same pages, keys, cache reads and line ids', () => {
  const part = load(table(PLAIN, bodyRows(60)));
  const off = run(part, true);
  const on = run(part, false);
  expectSameWork(off, on);
  expect(on.rowsPlaced + on.rowsReused).toBe(off.rowsPlaced);
});

for (const [name, headers, tblPr] of [
  [
    'a field in a header cell',
    [
      tr(
        [
          tc('<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'),
          tc(p('x')),
        ],
        '<w:tblHeader/>'
      ),
    ],
    '',
  ],
  ['a positioned table', MERGED, '<w:tblpPr w:vertAnchor="text" w:tblpY="0"/>'],
] as const) {
  test(`${name} takes nothing kept`, () => {
    const part = load(table(headers, bodyRows(60), tblPr));
    const off = run(part, true);
    const on = run(part, false);
    expectSameWork(off, on);
    expect([on.plansReused, on.rowsReused]).toEqual([0, 0]);
  });
}

// Footnotes cited from body rows change the page band from page to page.
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
function notesPackage(bodyXml: string, notes: ReadonlyMap<number, number>) {
  const noteXml = [...notes]
    .map(([id, lines]) => {
      const runs = Array.from({ length: lines }, (_, i) => `<w:t>N${id}-${i + 1}</w:t>`);
      return (
        `<w:footnote w:id="${id}"><w:p><w:pPr>${EXACT}</w:pPr>` +
        `<w:r><w:footnoteRef/></w:r><w:r>${runs.join('<w:br/>')}</w:r></w:p></w:footnote>`
      );
    })
    .join('');
  const separator = (type: string, tag: string) =>
    `<w:footnote w:type="${type}" w:id="${type === 'separator' ? -1 : 0}"><w:p><w:pPr>${EXACT}` +
    `</w:pPr><w:r><w:${tag}/></w:r></w:p></w:footnote>`;
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}${SECT}</w:body></w:document>`
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">${separator('separator', 'separator')}` +
          `${separator('continuationSeparator', 'continuationSeparator')}${noteXml}</w:footnotes>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const input: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'flow-header-reuse',
    compatibilityMode: 15,
  };
  return { part: loaded.package.parts.get(loaded.package.mainDocumentPart)!, input };
}

test('page bands that change with footnote reserves keep the same pages both ways', () => {
  const notes = new Map([
    [4, 3],
    [17, 1],
    [30, 4],
    [44, 2],
  ]);
  const cites = new Map([...notes.keys()].map((row) => [row, row]));
  const { part, input } = notesPackage(table(MERGED, bodyRows(60, cites)), notes);
  const layout = (
    target: OoxmlPart,
    session: ReturnType<typeof createLayoutSession>,
    cache: ReturnType<typeof createParagraphLayoutCache>
  ) =>
    layoutSemanticDocument(target, 1, {
      measurer,
      notes: input,
      session,
      cache,
      producer: 'flow-header-reuse',
      compatibilityMode: 15,
    });
  const off = run(part, true, layout);
  const on = run(part, false, layout);
  expectSameWork(off, on);
  expect(repeats(off.result)).toBeGreaterThan(2);
  expect(on.rowsReused).toBeGreaterThan(0);
});

// Direct use: a merged header group in a fixed table at a fixed edge.
const structure = (headers: readonly string[]): SemanticTableStructure =>
  readTableStructure(tableNode(load(table(headers, bodyRows(2)))), 310, 0, styleCascade)!;
function direct(headers: readonly string[], zones: readonly ExclusionZone[] = []) {
  const shape = structure(headers);
  const headerRows = shape.rows.filter((row) => row.isHeader);
  const tally = { lines: 0, forgets: 0, stamp: '1', reported: [] as string[] };
  const deps: TableFlowDeps = {
    measurer,
    styleCascade,
    producer: 'flow-header-direct',
    displayMode: 'all-markup',
    compatibilityMode: 15,
    cache: createParagraphLayoutCache(),
    onCellBreakKey: (key) => void tally.reported.push(key),
    nextLineId: (paragraphId, start, lineIndex, occurrence) => {
      tally.lines += 1;
      return bodyLineId(paragraphId, start, lineIndex, occurrence);
    },
    pageOccurrenceKey: () => tally.stamp,
    pageExclusionZones: () => zones,
  };
  const reuse = createFlowHeaderReuse({
    structure: shape,
    headerRows,
    deps,
    left: () => 3,
    rowHeightOf: (row, top, rowDeps) =>
      measureRowHeight(row, shape.columnWidthsPt, 3, 0, rowDeps, 0, undefined, top),
    rowProbes: { forget: () => void (tally.forgets += 1) },
    admitted: true,
  });
  return { shape, headerRows, deps, tally, reuse };
}

test('a kept plan replays its build keys; a kept row restamps ids through nextLineId', () => {
  const { shape, headerRows, tally, reuse } = direct(MERGED);
  const recorder = flowHeaderReuseTestRecorder();
  const plan = reuse.plan(0);
  const built = tally.reported.slice();
  expect(reuse.plan(0)).toBe(plan);
  expect(tally.reported.slice(built.length)).toEqual(built);
  const deps = reuse.headerDeps();
  reuse.place(true, false, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
  // The next page: a new stamp. Reused, then the same placement made fresh for comparison.
  tally.stamp = '2';
  const at = { lines: tally.lines, reported: tally.reported.length };
  const reused = reuse.place(true, false, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
  const replay = { lines: tally.lines - at.lines, keys: tally.reported.slice(at.reported) };
  const before = { lines: tally.lines, reported: tally.reported.length };
  const fresh = layoutRowFragment(
    headerRows[0]!,
    shape.columnWidthsPt,
    3,
    0,
    true,
    0,
    deps,
    0,
    plan.optionsAt(0, 0)
  );
  recorder.dispose();
  expect(JSON.stringify(reused.record)).toBe(JSON.stringify(fresh.record));
  expect(reused.bottom).toBe(fresh.bottom);
  expect(replay.lines).toBe(tally.lines - before.lines);
  expect(replay.lines).toBeGreaterThan(0);
  expect(replay.keys).toEqual(tally.reported.slice(before.reported));
  expect([recorder.plansBuilt, recorder.plansReused]).toEqual([1, 1]);
  expect([recorder.rowsPlaced, recorder.rowsReused]).toEqual([1, 1]);
  // A bordered repeat (a repeated-header border plan) and an authored group never reuse.
  reuse.place(true, true, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
  reuse.place(false, false, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
});

test('wrap zones on the page keep every plan and row fresh', () => {
  // Empty header cells: nothing reads the zones, but the reuse sees them and stays out.
  const empty = [tr([tc(''), tc('')], '<w:tblHeader/>')];
  const zone = {} as ExclusionZone;
  for (const [zones, reused] of [
    [[zone], 0],
    [[], 1],
  ] as const) {
    const { headerRows, reuse } = direct(empty, zones);
    const recorder = flowHeaderReuseTestRecorder();
    const plan = reuse.plan(0);
    reuse.plan(0);
    const deps = reuse.headerDeps();
    reuse.place(true, false, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
    reuse.place(true, false, 0, headerRows[0]!, 0, deps, plan.optionsAt(0, 0));
    recorder.dispose();
    expect([recorder.plansReused, recorder.rowsReused]).toEqual([reused, reused]);
  }
});
