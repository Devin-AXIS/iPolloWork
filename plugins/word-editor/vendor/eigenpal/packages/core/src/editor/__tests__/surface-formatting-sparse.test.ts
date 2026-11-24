// Sparse formatting reads. Each read must answer exactly as the complete index answers after
// the same sequence of reads on the same layout: the same first fragment, the same first empty
// style from every page any read has loaded, and the same table membership, including
// paragraphs a merged fragment absorbed. A read must build no entry for other paragraphs.

import { afterEach, expect, test } from 'bun:test';
import {
  formattingIndexTestRecorder,
  paragraphFormattingEntry,
} from '../surface-formatting-index.ts';
import { fragmentParagraphs } from '../../layout/line-segments.ts';
import {
  shareTableFragmentFacts,
  tableFormattingMembers,
  tableFragmentFacts,
  tableFragmentFactsTestRecorder,
} from '../../layout/table-fragment-facts.ts';
import { lay, load, para, styleCascade } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../../layout/semantic-records.ts';

const initial = lay(load(para('first')));
const basePage = initial.pages[0]!;
const base = basePage.fragments[0] as ParagraphFragmentRecord;
const STYLE = base.lines[0]!.spans[0]!.style;

/** An ordinary one-line paragraph fragment named `id`. */
function paragraph(id: string, extra: Partial<ParagraphFragmentRecord> = {}) {
  return {
    ...base,
    id: `${id}-fragment`,
    paragraphId: id,
    range: { ...base.range, paragraphId: id },
    lines: base.lines.map((line) => ({
      ...line,
      range: { ...line.range, paragraphId: id },
      spans: line.spans.map((span) => ({ ...span, range: { ...span.range, paragraphId: id } })),
    })),
    ...extra,
  } as ParagraphFragmentRecord;
}

/** `survivor`'s fragment drawing `absorbed`'s text too: a merged paragraph. */
function mergedFragment(survivor: string, absorbed: string): ParagraphFragmentRecord {
  const own = paragraph(survivor);
  const other = paragraph(absorbed);
  return {
    ...own,
    lines: [{ ...own.lines[0]!, spans: [...own.lines[0]!.spans, ...other.lines[0]!.spans] }],
  };
}

/** A fragment whose line draws an inline picture owned by `owner`. */
function withDrawing(id: string, owner: string): ParagraphFragmentRecord {
  const own = paragraph(id);
  const drawing = { paragraphId: owner, start: 0, advanceStart: 100, advanceEnd: 110, x: 100 };
  return {
    ...own,
    lines: [{ ...own.lines[0]!, drawings: [drawing] }],
  } as unknown as ParagraphFragmentRecord;
}

/** A fragment whose line RANGE names `ghost` while every span is its own: no ghost segment. */
function rangeOnly(id: string, ghost: string): ParagraphFragmentRecord {
  const own = paragraph(id);
  return {
    ...own,
    lines: [{ ...own.lines[0]!, range: { ...own.lines[0]!.range, paragraphId: ghost } }],
  };
}

const withEmptyStyle = (fragment: ParagraphFragmentRecord): ParagraphFragmentRecord => ({
  ...fragment,
  props: [],
  emptyParagraphStyle: STYLE,
});

let tableCount = 0;
/** A table fragment of rows of cells; `repeat` marks repeated header rows. */
function table(
  rows: readonly { readonly repeat?: boolean; readonly cells: readonly BlockFragmentRecord[][] }[]
): TableFragmentRecord {
  tableCount += 1;
  return {
    kind: 'table',
    id: `table-${tableCount}`,
    tableId: `table-node-${tableCount}`,
    fragmentIndex: 0,
    nestingDepth: 0,
    columnEdges: [0, 100],
    box: { x: 0, y: 0, width: 100, height: 100 },
    rows: rows.map((row, index) => ({
      id: `row-${tableCount}-${index}`,
      ...(row.repeat ? { isHeaderRepeat: true } : {}),
      box: { x: 0, y: 0, width: 100, height: 10 },
      cells: row.cells.map((blocks, cell) => ({
        id: `cell-${tableCount}-${index}-${cell}`,
        box: { x: 0, y: 0, width: 100, height: 10 },
        blocks,
      })),
    })),
  } as unknown as TableFragmentRecord;
}

function page(
  index: number,
  fragments: readonly BlockFragmentRecord[],
  stories: {
    header?: BlockFragmentRecord[];
    footer?: BlockFragmentRecord[];
    notes?: BlockFragmentRecord[][];
  } = {}
): PageRecord {
  return {
    ...basePage,
    index,
    fragments,
    ...(stories.header
      ? { header: { ...(basePage.header ?? {}), fragments: stories.header } }
      : {}),
    ...(stories.footer
      ? { footer: { ...(basePage.footer ?? {}), fragments: stories.footer } }
      : {}),
    ...(stories.notes
      ? { footnotes: { notes: stories.notes.map((fragments) => ({ fragments })) } }
      : {}),
  } as unknown as PageRecord;
}

const layoutOf = (pages: readonly PageRecord[]): SemanticLayout => ({ ...initial, pages });

/** The previous complete index, restated: the oracle every sparse read must match. */
function oracle() {
  const byPage = new WeakMap<PageRecord, Map<string, OracleEntry>>();
  const byLayout = new WeakMap<
    SemanticLayout,
    { entries: Map<string, OracleEntry>; next: number }
  >();
  interface OracleEntry {
    readonly fragment: ParagraphFragmentRecord;
    readonly indent: { readonly indent: unknown; readonly inTable: boolean };
    readonly emptyStyle: unknown;
  }
  const merge = (entries: Map<string, OracleEntry>, id: string, next: OracleEntry) => {
    const previous = entries.get(id);
    if (!previous) entries.set(id, next);
    else if (!previous.emptyStyle && next.emptyStyle)
      entries.set(id, { ...previous, emptyStyle: next.emptyStyle });
  };
  const pageEntries = (target: PageRecord) => {
    const known = byPage.get(target);
    if (known) return known;
    const entries = new Map<string, OracleEntry>();
    const walk = (blocks: readonly BlockFragmentRecord[], inTable: boolean): void => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          const entry = {
            fragment: block,
            indent: { indent: block.indent, inTable },
            emptyStyle: block.emptyParagraphStyle,
          };
          for (const id of fragmentParagraphs(block)) merge(entries, id, entry);
          continue;
        }
        for (const row of block.rows) {
          if (row.isHeaderRepeat) continue;
          for (const cell of row.cells) walk(cell.blocks, true);
        }
      }
    };
    walk(target.fragments, false);
    if (target.header) walk(target.header.fragments, false);
    if (target.footer) walk(target.footer.fragments, false);
    for (const area of [target.footnotes, target.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) walk(note.fragments, false);
    }
    byPage.set(target, entries);
    return entries;
  };
  return (layout: SemanticLayout, id: string, requireEmptyStyle = false) => {
    let state = byLayout.get(layout);
    if (!state) byLayout.set(layout, (state = { entries: new Map(), next: 0 }));
    const ready = () => {
      const entry = state.entries.get(id);
      return entry && (!requireEmptyStyle || entry.emptyStyle) ? entry : undefined;
    };
    let entry = ready();
    while (!entry && state.next < layout.pages.length) {
      for (const [other, next] of pageEntries(layout.pages[state.next++]!))
        merge(state.entries, other, next);
      entry = ready();
    }
    return entry ?? state.entries.get(id);
  };
}

const same = (actual: ReturnType<typeof paragraphFormattingEntry>, expected: unknown): void => {
  const reference = expected as ReturnType<typeof paragraphFormattingEntry>;
  if (reference === undefined) {
    expect(actual).toBeUndefined();
    return;
  }
  expect(actual).toBeDefined();
  expect(actual!.fragment).toBe(reference.fragment);
  expect(actual!.emptyStyle).toBe(reference.emptyStyle);
  expect(actual!.indent).toEqual(reference.indent);
};

/** Pages covering every story, merges, drawings, range-only names, repeats and nesting. */
function fixturePages(): PageRecord[] {
  const nested = table([
    { repeat: true, cells: [[paragraph('nested-repeat')]] },
    { cells: [[paragraph('nested-1')], [withEmptyStyle(paragraph('a'))]] },
  ]);
  const big = table([
    { repeat: true, cells: [[paragraph('repeat-only')], [paragraph('a')]] },
    ...Array.from({ length: 12 }, (_, row) => ({
      cells: [[paragraph(`t${row}-0`)], [paragraph(`t${row}-1`)]],
    })),
    { cells: [[mergedFragment('t-survivor', 'absorbed-in-table')], [nested]] },
  ]);
  return [
    page(0, [paragraph('a'), mergedFragment('b', 'b-absorbed'), paragraph('c')], {
      header: [paragraph('head')],
      footer: [paragraph('foot')],
    }),
    page(1, [big, withDrawing('d', 'picture-owner'), rangeOnly('e', 'ghost')], {
      header: [paragraph('head')],
      notes: [[paragraph('note-1')]],
    }),
    page(
      2,
      [withEmptyStyle(paragraph('c')), paragraph('late'), withEmptyStyle(paragraph('b-absorbed'))],
      {
        footer: [withEmptyStyle(paragraph('foot'))],
      }
    ),
    page(3, [table([{ cells: [[withEmptyStyle(paragraph('t3-1'))]] }]), paragraph('last')]),
  ];
}

const IDS = [
  'a',
  'b',
  'b-absorbed',
  'c',
  'head',
  'foot',
  'repeat-only',
  'nested-repeat',
  'nested-1',
  't-survivor',
  'absorbed-in-table',
  'd',
  'picture-owner',
  'e',
  'ghost',
  'note-1',
  'late',
  'last',
  't0-0',
  't5-1',
  't11-0',
  't3-1',
  'missing',
];

let recorder: ReturnType<typeof formattingIndexTestRecorder> | null = null;
afterEach(() => {
  recorder?.dispose();
  recorder = null;
});

test('seeded read sequences answer as the complete index, with and without promotion', () => {
  const pages = fixturePages();
  const extra = Array.from({ length: 40 }, (_, index) => `t${index % 12}-${index % 2}`);
  for (const seed of [1, 7, 42, 1234, 99991]) {
    let state = seed;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const reference = oracle();
    // Fresh layouts over the same pages: page caches are shared, layout state is not.
    const layout = layoutOf(pages);
    const pool = seed % 2 === 0 ? [...IDS, ...extra.map((id, at) => `${id}#${at}`)] : IDS;
    for (let read = 0; read < 80; read += 1) {
      const id = pool[Math.floor(random() * pool.length)]!;
      const requireEmptyStyle = random() < 0.4;
      same(
        paragraphFormattingEntry(layout, id, requireEmptyStyle),
        reference(layout, id, requireEmptyStyle)
      );
    }
  }
});

test("a later paragraph's read exposes an earlier paragraph's empty style", () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  const reference = oracle();
  // `c` opens on page 0 without an empty style; page 2 holds its continuation with one.
  same(paragraphFormattingEntry(layout, 'c'), reference(layout, 'c'));
  expect(paragraphFormattingEntry(layout, 'c')!.emptyStyle).toBeUndefined();
  // Reading `late` loads pages 1 and 2 for every paragraph.
  same(paragraphFormattingEntry(layout, 'late'), reference(layout, 'late'));
  const after = paragraphFormattingEntry(layout, 'c');
  same(after, reference(layout, 'c'));
  expect(after!.emptyStyle).toBe(STYLE);
  expect(after!.fragment).toBe(pages[0]!.fragments[2]);
});

test('an empty-style read catches up across pages and keeps the opening fragment', () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  const reference = oracle();
  same(paragraphFormattingEntry(layout, 'b-absorbed'), reference(layout, 'b-absorbed'));
  const result = paragraphFormattingEntry(layout, 'b-absorbed', true);
  same(result, reference(layout, 'b-absorbed', true));
  expect(result!.fragment).toBe(pages[0]!.fragments[1]);
  expect(result!.emptyStyle).toBe(STYLE);
});

test('a read builds entries only for its paragraph and enters only tables that draw it', () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  const facts = tableFragmentFactsTestRecorder();
  recorder = formattingIndexTestRecorder();
  try {
    expect(paragraphFormattingEntry(layout, 'last')!.fragment).toBe(pages[3]!.fragments[1]);
    expect(recorder.completePages).toBe(0);
    expect(recorder.completeLayouts).toBe(0);
    // One read per page. The two top-level tables are tested by membership, not entered.
    expect(recorder.pageReads).toBe(4);
    expect(facts.membersComputed).toBe(2);
    // A paragraph inside the big table enters it, and with it the nested table it holds;
    // the memberships already known are not computed again.
    expect(paragraphFormattingEntry(layout, 't5-1')!.indent.inTable).toBe(true);
    expect(facts.membersComputed).toBe(3);
  } finally {
    facts.dispose();
  }
});

test('table membership never hides a paragraph a merged fragment absorbed', () => {
  const pages = fixturePages();
  const big = pages[1]!.fragments[0] as TableFragmentRecord;
  expect(tableFragmentFacts(big).paragraphIds.has('absorbed-in-table')).toBe(false);
  expect(tableFormattingMembers(big).has('absorbed-in-table')).toBe(true);
  const result = paragraphFormattingEntry(layoutOf(pages), 'absorbed-in-table');
  expect(result!.fragment.paragraphId).toBe('t-survivor');
  expect(result!.indent.inTable).toBe(true);
});

test('drawings name members; a line range alone does not', () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  const reference = oracle();
  same(paragraphFormattingEntry(layout, 'picture-owner'), reference(layout, 'picture-owner'));
  expect(paragraphFormattingEntry(layout, 'picture-owner')!.fragment).toBe(pages[1]!.fragments[1]);
  same(paragraphFormattingEntry(layout, 'ghost'), reference(layout, 'ghost'));
  expect(paragraphFormattingEntry(layout, 'ghost')).toBeUndefined();
});

test('repeated header rows are excluded at every nesting level', () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  expect(paragraphFormattingEntry(layout, 'repeat-only')).toBeUndefined();
  expect(paragraphFormattingEntry(layout, 'nested-repeat')).toBeUndefined();
  expect(paragraphFormattingEntry(layout, 'nested-1')!.indent.inTable).toBe(true);
  // `a` opens on page 0; its repeated-header copy is not a fragment of it.
  expect(paragraphFormattingEntry(layout, 'a')!.fragment).toBe(pages[0]!.fragments[0]);
});

test('reused pages give the same entry objects, also after the layout promotes', () => {
  const pages = fixturePages();
  const first = layoutOf(pages);
  const entry = paragraphFormattingEntry(first, 't11-0');
  const second = layoutOf(pages);
  expect(paragraphFormattingEntry(second, 't11-0')).toBe(entry);
  // A third layout reads 32 other paragraphs first, then promotes on the next new one.
  const third = layoutOf(pages);
  recorder = formattingIndexTestRecorder();
  const others = Array.from({ length: 32 }, (_, index) => `missing-${index}`);
  for (const id of others) expect(paragraphFormattingEntry(third, id)).toBeUndefined();
  expect(recorder.completeLayouts).toBe(0);
  expect(paragraphFormattingEntry(third, 't11-0')).toBe(entry);
  expect(recorder.completeLayouts).toBe(1);
});

test('answers given before promotion stay the same objects after it', () => {
  const pages = fixturePages();
  const layout = layoutOf(pages);
  const reference = oracle();
  // The first pass loads every page (`missing`); an earlier paragraph may then gain an empty
  // style from a later page, as the complete index would give it. The second pass reads the
  // caught-up answers, which must then stay.
  for (const id of IDS) same(paragraphFormattingEntry(layout, id), reference(layout, id));
  const given = new Map<string, ReturnType<typeof paragraphFormattingEntry>>();
  for (const id of IDS) {
    given.set(id, paragraphFormattingEntry(layout, id));
    same(given.get(id), reference(layout, id));
  }
  recorder = formattingIndexTestRecorder();
  for (let index = 0; index < 20; index += 1) {
    const id = `absent-${index}`;
    same(paragraphFormattingEntry(layout, id), reference(layout, id));
  }
  expect(recorder.completeLayouts).toBe(1);
  for (const id of IDS) {
    expect(paragraphFormattingEntry(layout, id)).toBe(given.get(id));
    same(paragraphFormattingEntry(layout, id), reference(layout, id));
  }
});

test('width-only sharing carries formatting members only when no paragraph draws another', () => {
  const plain = table([{ cells: [[paragraph('p1')], [paragraph('p2')]] }]);
  const mixed = table([{ cells: [[mergedFragment('m1', 'm-absorbed')]] }]);
  const facts = tableFragmentFactsTestRecorder();
  try {
    const plainMembers = tableFormattingMembers(plain);
    const mixedMembers = tableFormattingMembers(mixed);
    expect(facts.membersComputed).toBe(2);
    const plainCopy = { ...plain } as TableFragmentRecord;
    const mixedCopy = { ...mixed } as TableFragmentRecord;
    shareTableFragmentFacts(plain, plainCopy);
    shareTableFragmentFacts(mixed, mixedCopy);
    expect(tableFormattingMembers(plainCopy)).toBe(plainMembers);
    expect(facts.membersComputed).toBe(2);
    // A fragment that draws another paragraph is computed again for its copy.
    expect(tableFormattingMembers(mixedCopy)).toEqual(mixedMembers);
    expect(facts.membersComputed).toBe(3);
  } finally {
    facts.dispose();
  }
});

test('a width edit carries table formatting members exactly as a fresh walk finds them', () => {
  const cell = (text: string) =>
    '<w:tc><w:tcPr/><w:p><w:pPr><w:widowControl w:val="0"/>' +
    '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
  const rows = Array.from(
    { length: 30 },
    (_, index) => `<w:tr>${[0, 1, 2].map((c) => cell(`r${index}c${c}`)).join('')}</w:tr>`
  );
  let part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
      `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`
  );
  const tableNode = part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
  const paragraphId = readTableStructure(tableNode, 310, 0, styleCascade)!.rows[13]!.cells[1]!
    .blocks[0]!.id;
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const tables = (layout: SemanticLayout) =>
    layout.pages
      .flatMap((each) => each.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');
  let layout = lay(part, 15, { session, cache });
  for (const fragment of tables(layout)) tableFormattingMembers(fragment);
  let carried = 0;
  for (const [offset, text] of [...'wider '].entries()) {
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId, offset, text });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const facts = tableFragmentFactsTestRecorder();
    try {
      layout = lay(part, 15, { session, cache });
      const before = facts.membersComputed;
      for (const fragment of tables(layout)) {
        const members = tableFormattingMembers(fragment);
        // A copy is a new key: its members come from a fresh walk of the same rows.
        expect(members).toEqual(tableFormattingMembers({ ...fragment }));
      }
      carried += tables(layout).length - (facts.membersComputed - before - tables(layout).length);
    } finally {
      facts.dispose();
    }
  }
  // Width edits replaced fragments without walking them for members.
  expect(carried).toBeGreaterThan(tables(layout).length);
});

test('one fragment placed outside and inside a table gets its own context in either order', () => {
  for (const order of [
    ['body', 'cell'],
    ['cell', 'body'],
  ] as const) {
    const shared = paragraph(`shared-${order[0]}-first`);
    const pages = { body: page(0, [shared]), cell: page(0, [table([{ cells: [[shared]] }])]) };
    for (const context of order) {
      const target = pages[context];
      const entry = paragraphFormattingEntry(layoutOf([target]), shared.paragraphId);
      expect(entry!.fragment).toBe(shared);
      expect(entry!.indent.inTable).toBe(context === 'cell');
      same(entry, oracle()(layoutOf([target]), shared.paragraphId));
      // The same page in a later layout gives the same entry object.
      expect(paragraphFormattingEntry(layoutOf([target]), shared.paragraphId)).toBe(entry);
    }
  }
});

test('the complete index keeps each context apart for one shared fragment', () => {
  const shared = paragraph('shared-complete');
  const body = page(0, [shared]);
  const cell = page(1, [table([{ cells: [[shared]] }])]);
  const absent = Array.from({ length: 33 }, (_, index) => `absent-context-${index}`);
  for (const pages of [
    [cell, body],
    [body, cell],
  ]) {
    const layout = layoutOf(pages);
    const reference = oracle();
    recorder = formattingIndexTestRecorder();
    for (const id of absent) same(paragraphFormattingEntry(layout, id), reference(layout, id));
    expect(recorder.completeLayouts).toBe(1);
    recorder.dispose();
    recorder = null;
    const entry = paragraphFormattingEntry(layout, shared.paragraphId);
    same(entry, reference(layout, shared.paragraphId));
    // The first page that draws it decides the context.
    expect(entry!.indent.inTable).toBe(pages[0] === cell);
  }
});
