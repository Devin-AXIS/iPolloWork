// A footnote starts on the page of its reference line, below that line's full box, and the
// reflow loop reaches the same answer cold and warm. These probes cover shapes where the
// hold-out release or the attach floor used to strand a note on a later page, or raise the
// note area into a reference line in another column.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { bodyOnlyPage } from '../note-fragment-geometry.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { footnoteReservesEqual } from '../note-reserves.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { LineRecord, PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOUBLE = 'w:after="0" w:line="480" w:lineRule="auto"';

interface Paragraph {
  readonly lines: number;
  readonly widowControl?: boolean;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly spacing?: string;
}

interface Probe {
  /** Labeled lines (`L01`, `L02`, ...) joined by manual breaks within each paragraph. */
  readonly paragraphs: readonly Paragraph[];
  /** Line number (1-based) -> footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id -> number of 10 pt note lines. */
  readonly notes: Readonly<Record<number, number>>;
  readonly columns?: number;
}

function probeDocx(probe: Probe): Uint8Array {
  const run = (content: string, props = '') =>
    `<w:r><w:rPr>${props}<w:sz w:val="24"/></w:rPr>${content}</w:r>`;
  let line = 0;
  const body = probe.paragraphs
    .map((paragraph) => {
      const runs: string[] = [];
      for (let index = 0; index < paragraph.lines; index += 1) {
        line += 1;
        runs.push(run(`<w:t xml:space="preserve">L${String(line).padStart(2, '0')} text</w:t>`));
        for (const id of probe.refs[line] ?? []) {
          runs.push(
            run(`<w:footnoteReference w:id="${id}"/>`, '<w:vertAlign w:val="superscript"/>')
          );
        }
        if (index < paragraph.lines - 1) runs.push(run('<w:br/>'));
      }
      const props =
        (paragraph.keepNext ? '<w:keepNext/>' : '') +
        (paragraph.keepLines ? '<w:keepLines/>' : '') +
        (paragraph.widowControl ? '' : '<w:widowControl w:val="0"/>') +
        `<w:spacing ${paragraph.spacing ?? DOUBLE}/>`;
      return `<w:p><w:pPr>${props}<w:rPr><w:sz w:val="24"/></w:rPr></w:pPr>${runs.join('')}</w:p>`;
    })
    .join('');
  const noteParagraph = (content: string) =>
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${content}</w:p>`;
  const noteBody = (id: number, count: number) =>
    noteParagraph(
      Array.from(
        { length: count },
        (_, i) =>
          `${i > 0 ? '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:br/></w:r>' : ''}` +
          `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">N${id} ${i + 1}</w:t></w:r>`
      ).join('')
    );
  const notes = Object.entries(probe.notes)
    .map(([id, count]) => `<w:footnote w:id="${id}">${noteBody(Number(id), count)}</w:footnote>`)
    .join('');
  const columns = probe.columns ? `<w:cols w:num="${probe.columns}" w:space="720"/>` : '';
  return zipSync({
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
      `<w:document xmlns:w="${W}"><w:body>${body}` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>${columns}` +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1">${noteParagraph('<w:r><w:separator/></w:r>')}</w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0">${noteParagraph('<w:r><w:continuationSeparator/></w:r>')}</w:footnote>` +
        notes +
        '</w:footnotes>'
    ),
  });
}

function layoutProbe(
  probe: Probe,
  session: LayoutSession = createLayoutSession(),
  revision = 1
): { layout: SemanticLayout; fixedPoint: boolean } {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-stranded-notes',
  };
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    notes,
    session,
    producer: 'footnote-stranded-notes',
  });
  const used = session.notePageBottomReserves ?? new Map<number, number>();
  const refs = collectNoteReferences(part);
  const hits = buildPageRefHits(refs, new Map(refs.map((ref) => [ref.paragraphId, 0])));
  const computed = computeFootnoteReserves(
    { ...layout, pages: layout.pages.map(bodyOnlyPage) },
    hits,
    notes,
    provisionalNoteMarks(hits, notes),
    undefined,
    used
  );
  return {
    layout,
    fixedPoint: computed.stable && footnoteReservesEqual(computed.reserves, used),
  };
}

/**
 * Whether another pass over the same session republishes the same pages and reserves. The
 * strict reserve recomputation in {@link layoutProbe} does not apply once the orphan-pair
 * phase has run, because that phase publishes its own map.
 */
function settles(
  probe: Probe,
  session: LayoutSession,
  layout: SemanticLayout,
  revision = 1
): boolean {
  const reserves = session.notePageBottomReserves;
  const again = layoutProbe(probe, session, revision).layout;
  return (
    JSON.stringify(pages(again)) === JSON.stringify(pages(layout)) &&
    footnoteReservesEqual(session.notePageBottomReserves ?? new Map(), reserves ?? new Map())
  );
}

const label = (line: LineRecord) => /^L\d+/.exec(line.spans.map((span) => span.text).join(''));

function labeledLines(page: PageRecord): { readonly line: LineRecord; readonly number: number }[] {
  return page.fragments.flatMap((f) =>
    f.kind === 'paragraph'
      ? f.lines.flatMap((line) => {
          const match = label(line);
          return match ? [{ line, number: Number(match[0].slice(1)) }] : [];
        })
      : []
  );
}

/** `L01..L14 | 1 2c` per page: first and last body line, then the page's notes. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const lines = labeledLines(page).map(({ number }) => `L${String(number).padStart(2, '0')}`);
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${lines[0] ?? '-'}..${lines.at(-1) ?? '-'}${notes.length ? ` | ${notes.join(' ')}` : ''}`;
  });
}

/**
 * Every way a probe's notes can go wrong: a note whose first fragment is not on its
 * reference line's page, and a note area that rises into the full box of a reference line
 * whose note starts on that page.
 */
function strandedNotes(probe: Probe, layout: SemanticLayout): string[] {
  const problems: string[] = [];
  const refPage = new Map<number, number>();
  for (const page of layout.pages) {
    const heads = new Set(
      (page.footnotes?.notes ?? []).filter((n) => !n.continuation).map((n) => n.noteId)
    );
    const top = page.footnotes ? page.footnotes.box.y - page.contentBox.y : Infinity;
    for (const { line, number } of labeledLines(page)) {
      for (const id of probe.refs[number] ?? []) {
        refPage.set(id, page.index);
        if (heads.has(id) && line.box.y + line.box.height > top + 0.01) {
          problems.push(`note ${id}: area enters its reference line on page ${page.index}`);
        }
      }
    }
  }
  for (const [id, pageIndex] of refPage) {
    const head = layout.pages.findIndex((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === id && !n.continuation)
    );
    if (head !== pageIndex) problems.push(`note ${id}: reference on ${pageIndex}, head on ${head}`);
  }
  return problems;
}

describe('footnote hold-out release', () => {
  // US Letter, 1 in margins, 648 pt of body. Page 2 ends with a full note area and 14 pt of
  // body slack. Page 3 opens with an independent paragraph whose first line needs 15 pt of
  // it, so nothing on page 3 can return to page 2. A release there changes no body line, but
  // it drops a hold that the reflow loop needs to settle the pages after it, and the loop
  // then published notes 2 and 7 without a head. The keepLines paragraph after it carries
  // both of those notes.
  const paragraphs: Paragraph[] = [
    { lines: 12, widowControl: true, keepNext: true, spacing: 'w:line="520" w:lineRule="atLeast"' },
    { lines: 12, widowControl: true },
    { lines: 1, spacing: 'w:after="160" w:line="259" w:lineRule="auto"' },
    { lines: 20, keepLines: true, spacing: 'w:line="520" w:lineRule="atLeast"' },
    { lines: 2, widowControl: true },
    { lines: 3, widowControl: true, spacing: 'w:line="480" w:lineRule="exact"' },
  ];
  const probe: Probe = {
    paragraphs,
    refs: { 4: [8], 14: [4], 15: [1, 5], 21: [3], 26: [6], 33: [2, 7] },
    notes: { 1: 20, 2: 20, 3: 8, 4: 4, 5: 4, 6: 8, 7: 16, 8: 12 },
  };

  test('keeps a hold that no paragraph on the next page can use', () => {
    const { layout } = layoutProbe(probe);
    expect(pages(layout).slice(0, 2)).toEqual(['L01..L14 | 8 4', 'L15..L21 | 1 5 3']);
    expect(strandedNotes(probe, layout)).toEqual([]);
  });

  test('a warm pass after the keepLines edit matches a clean layout', () => {
    const session = createLayoutSession();
    const before: Probe = {
      ...probe,
      paragraphs: paragraphs.map((p, i) => (i === 3 ? { ...p, keepLines: false } : p)),
    };
    layoutProbe(before, session, 1);
    const warm = layoutProbe(probe, session, 2);
    const clean = layoutProbe(probe);
    expect(pages(warm.layout)).toEqual(pages(clean.layout));
    expect(strandedNotes(probe, warm.layout)).toEqual([]);
  });

  // In the strict answer, the second page ends at L24 and the third page opens with a
  // widow-controlled paragraph whose second line (L26) cites a 12-line note. The pair then
  // returns to the second page with its eviction off. The note has no room below it there,
  // so the whole note continues on the third page. No block ahead of the pair changes pages.
  // The search decides each page from no reserve, so a cold and a warm pass agree.
  const orphanPair: Probe = {
    paragraphs: [
      ...Array.from({ length: 24 }, () => ({ lines: 1 })),
      { lines: 6, widowControl: true },
      ...Array.from({ length: 25 }, () => ({ lines: 1 })),
    ],
    refs: { 3: [1], 12: [3], 26: [2] },
    notes: { 1: 32, 2: 12, 3: 4 },
  };

  test('an opening orphan pair keeps its line and its whole note continues', () => {
    const session = createLayoutSession();
    const { layout } = layoutProbe(orphanPair, session);
    expect(pages(layout)).toEqual(['L01..L07 | 1', 'L08..L26 | 3', 'L27..L42 | 2', 'L43..L55']);
    expect(strandedNotes(orphanPair, layout)).toEqual(['note 2: reference on 1, head on 2']);
    expect(settles(orphanPair, session, layout)).toBe(true);
    expect(pages(layoutProbe(orphanPair).layout)).toEqual(pages(layout));
  });
});

describe('footnote attach floor across columns', () => {
  // Two columns. L09 ends column 1 and cites note 3; L14 sits higher in column 2 and cites
  // note 1. Note 1 lays out after note 3, and its own line would let the stack rise into
  // L09's line box. The stack stays below every reference line whose note starts on the page.
  const probe: Probe = {
    paragraphs: [
      {
        lines: 12,
        widowControl: true,
        keepLines: true,
        spacing: 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"',
      },
      {
        lines: 3,
        widowControl: true,
        spacing: 'w:before="240" w:after="0" w:line="480" w:lineRule="auto"',
      },
    ],
    refs: { 2: [5], 5: [2, 4], 8: [6], 9: [3], 14: [1] },
    notes: { 1: 4, 2: 4, 3: 2, 4: 12, 5: 6, 6: 1 },
    columns: 2,
  };

  test('the note area stays below each reference line in both columns', () => {
    const session = createLayoutSession();
    const { layout } = layoutProbe(probe, session);
    expect(strandedNotes(probe, layout)).toEqual([]);
    expect(settles(probe, session, layout)).toBe(true);
  });
});

type TreeEdit = Record<string, unknown>;

/** Notes with a continuation and no head on any page. */
function headlessNotes(layout: SemanticLayout): number[] {
  const heads = new Set<number>();
  const continued = new Set<number>();
  for (const page of layout.pages) {
    for (const note of page.footnotes?.notes ?? []) {
      (note.continuation ? continued : heads).add(note.noteId);
    }
  }
  return [...continued].filter((noteId) => !heads.has(noteId));
}

/**
 * Applies `edits` one by one to a retained session, laying the document out six times after
 * each edit. Every published layout must start each note on some page, and the last two
 * passes must agree.
 */
function expectRetainedPassesKeepHeads(probe: Probe, edits: readonly TreeEdit[]): void {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const body = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main)).bodyStore();
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-stranded-notes',
  };
  const session = createLayoutSession();
  let revision = 1;
  const shapes: string[] = [];
  for (const edit of [null, ...edits]) {
    if (edit) {
      // The recorded edits are plain tree ops; `apply` validates each one.
      const applied = body.transact((ctx) => ctx.apply(edit as Parameters<typeof ctx.apply>[0]));
      expect(applied.ok).toBe(true);
      revision += 1;
    }
    shapes.length = 0;
    for (let pass = 0; pass < 6; pass += 1) {
      const layout = layoutSemanticDocument(body.part, revision, { measurer, notes, session });
      expect(headlessNotes(layout)).toEqual([]);
      shapes.push(JSON.stringify(pages(layout)));
    }
  }
  expect(shapes.at(-1)).toBe(shapes.at(-2));
}

describe('footnote reflow in a retained session', () => {
  const id = (index: string) => `/word/document.xml#${index}`;
  const exact = { after: '0', line: '480', lineRule: 'exact' };

  // After the last edit the reserve maps of two passes alternate; one of them leaves the
  // page before note 3's reference without a reserve. A pass that stopped on that map
  // published note 3 without a head; the loop now republishes the last map that left room.
  test('a two-map cycle republishes the map that leaves the notes room', () => {
    expectRetainedPassesKeepHeads(
      {
        paragraphs: [
          { lines: 45, spacing: 'w:after="0" w:line="480" w:lineRule="exact"' },
          { lines: 30, widowControl: true },
          { lines: 45, widowControl: true, spacing: 'w:after="0" w:line="480" w:lineRule="exact"' },
          { lines: 1, widowControl: true },
          {
            lines: 1,
            widowControl: true,
            spacing: 'w:before="240" w:after="0" w:line="480" w:lineRule="auto"',
          },
          { lines: 1 },
        ],
        refs: { 12: [6], 51: [3], 55: [7], 66: [2], 86: [4], 88: [5], 115: [1] },
        notes: { 1: 10, 2: 12, 3: 2, 4: 4, 5: 12, 6: 3, 7: 8 },
      },
      [
        {
          op: 'setParagraphProperties',
          paragraphId: id('0.0.4'),
          properties: [
            {
              localName: 'spacing',
              attributes: { before: '240', after: '0', line: '480', lineRule: 'auto' },
            },
            { localName: 'keepLines' },
          ],
        },
        { op: 'splitParagraph', paragraphId: id('0.0.3'), offset: 9 },
        { op: 'splitParagraph', paragraphId: id('0.0.0'), offset: 9 },
        {
          op: 'setParagraphProperties',
          paragraphId: id('0.0.2'),
          properties: [
            { localName: 'spacing', attributes: exact },
            { localName: 'widowControl', attributes: { val: '0' } },
          ],
        },
        { op: 'deleteText', paragraphId: id('0.0.2'), start: 0, end: 9 },
        { op: 'insertText', paragraphId: id('0.0.5'), offset: 3, text: 'x' },
        { op: 'setSectionProperties', marginBottomTwips: 1430 },
        {
          op: 'setParagraphProperties',
          paragraphId: id('new:7'),
          properties: [
            { localName: 'widowControl', attributes: { val: '0' } },
            { localName: 'spacing', attributes: exact },
            { localName: 'keepLines' },
          ],
        },
      ]
    );
  });

  // The first pass after the split cycles through three maps, none of which leaves the
  // notes room. The loop now grows the reserves over every map it adopted before stopping.
  test('a three-map cycle grows over every map before it stops', () => {
    expectRetainedPassesKeepHeads(
      {
        paragraphs: [
          { lines: 3, widowControl: true, spacing: 'w:after="0" w:line="480" w:lineRule="exact"' },
          { lines: 3, widowControl: true, spacing: 'w:after="0" w:line="360" w:lineRule="auto"' },
          { lines: 2, spacing: 'w:after="0" w:line="360" w:lineRule="auto"' },
        ],
        refs: { 2: [7, 8], 4: [1], 6: [2, 5], 7: [3, 6], 8: [4] },
        notes: { 1: 20, 2: 10, 3: 3, 4: 2, 5: 20, 6: 8, 7: 4, 8: 8 },
      },
      [
        {
          op: 'setParagraphProperties',
          paragraphId: id('0.0.0'),
          properties: [{ localName: 'spacing', attributes: exact }, { localName: 'keepLines' }],
        },
        {
          op: 'setRunProperties',
          paragraphId: id('0.0.2'),
          start: 0,
          end: 3,
          properties: [{ localName: 'sz', attributes: { val: '26' } }],
        },
        { op: 'insertText', paragraphId: id('0.0.2'), offset: 3, text: 'x' },
        { op: 'deleteText', paragraphId: id('0.0.2'), start: 0, end: 9 },
        { op: 'splitParagraph', paragraphId: id('0.0.2'), offset: 9 },
      ]
    );
  });
});
