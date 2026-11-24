// The body fit rule lets a page's last line carry its trailing `auto` depth
// past the bottom of the text area. In the modern mode it may not reach into a footnote
// area: there the line's full box must fit. The note passes measure the body the same way, so a note the reserve fit
// whole is not split or carried at attach time.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
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

interface Probe {
  /** Labeled lines (`L01`, `L02`, ...) joined by manual breaks within each paragraph. */
  readonly paragraphs: readonly {
    readonly lines: number;
    readonly widowControl?: boolean;
    readonly spacing?: string;
  }[];
  /** Line number (1-based) -> footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id -> number of 10 pt note lines. */
  readonly notes: Readonly<Record<number, number>>;
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
      const widow = paragraph.widowControl ? '' : '<w:widowControl w:val="0"/>';
      return (
        `<w:p><w:pPr>${widow}<w:spacing ${paragraph.spacing ?? DOUBLE}/>` +
        `<w:rPr><w:sz w:val="24"/></w:rPr></w:pPr>${runs.join('')}</w:p>`
      );
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
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        '</w:body></w:document>'
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
  session = createLayoutSession(),
  compatibilityMode?: number
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
    compatibilityMode,
    producer: 'footnote-trailing-depth',
  };
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    compatibilityMode,
    notes,
    session,
    producer: 'footnote-trailing-depth',
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

const label = (line: LineRecord) =>
  line.spans
    .map((span) => span.text)
    .join('')
    .slice(0, 3);

function pageLines(page: PageRecord): LineRecord[] {
  return page.fragments.flatMap((f) =>
    f.kind === 'paragraph' ? f.lines.filter((line) => label(line).startsWith('L')) : []
  );
}

/** `L01..L14 | 1 2c` per page: first and last body line, then the page's notes. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const lines = pageLines(page).map(label);
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${lines[0] ?? '-'}..${lines.at(-1) ?? '-'}${notes.length ? ` | ${notes.join(' ')}` : ''}`;
  });
}

function areaTop(page: PageRecord): number {
  return page.footnotes!.box.y - page.contentBox.y;
}

describe('footnote area beside the last line trailing spacing', () => {
  // US Letter, 1 in margins: 648 pt of body. Double-spaced 12 pt lines are 30.55 pt boxes
  // whose glyph band ends 15.27 pt above the box bottom; a note line is 12.73 pt.
  test('a line whose trailing depth would reach into the note area moves on', () => {
    // 17 note lines: the area would rise above L14's box bottom, below its glyph band.
    // The line's full box must fit above the area, so L14 starts the next page.
    const { layout, fixedPoint } = layoutProbe(
      { paragraphs: [{ lines: 30 }], refs: { 1: [1] }, notes: { 1: 17 } },
      createLayoutSession(),
      15
    );
    expect(pages(layout)).toEqual(['L01..L13 | 1', 'L14..L30']);
    const page = layout.pages[0]!;
    const last = pageLines(page).at(-1)!;
    expect(last.trailingSpacing ?? 0).toBeGreaterThan(0);
    expect(areaTop(page)).toBeGreaterThanOrEqual(last.box.y + last.box.height - 0.01);
    expect(fixedPoint).toBe(true);
  });

  test('a legacy mode lets that trailing depth reach into the note area', () => {
    // Without a declaration the document lays out in a legacy mode: L14 stays, and the area
    // rises above its box bottom but stays below its glyph band.
    const { layout, fixedPoint } = layoutProbe({
      paragraphs: [{ lines: 30 }],
      refs: { 1: [1] },
      notes: { 1: 17 },
    });
    expect(pages(layout)).toEqual(['L01..L14 | 1', 'L15..L30']);
    const page = layout.pages[0]!;
    const last = pageLines(page).at(-1)!;
    expect(areaTop(page)).toBeLessThan(last.box.y + last.box.height);
    expect(areaTop(page)).toBeGreaterThanOrEqual(
      last.box.y + last.box.height - (last.trailingSpacing ?? 0)
    );
    expect(fixedPoint).toBe(true);
  });

  test('a reference line whose glyph band fits but whose box does not moves with its note', () => {
    const { layout, fixedPoint } = layoutProbe({
      paragraphs: [{ lines: 30 }],
      refs: { 1: [1], 15: [2] },
      notes: { 1: 13, 2: 1 },
    });
    expect(pages(layout)).toEqual(['L01..L14 | 1', 'L15..L30 | 2']);
    expect(fixedPoint).toBe(true);
  });

  test('a split note starts below the full box of its reference line', () => {
    // L14 ends page 1 and carries a note taller than the note column, so the note splits.
    const { layout } = layoutProbe({
      paragraphs: [{ lines: 30 }],
      refs: { 14: [1] },
      notes: { 1: 50 },
    });
    expect(pages(layout)[0]).toBe('L01..L14 | 1');
    const page = layout.pages[0]!;
    const refLine = pageLines(page).at(-1)!;
    expect(refLine.trailingSpacing ?? 0).toBeGreaterThan(0);
    expect(areaTop(page)).toBeGreaterThanOrEqual(refLine.box.y + refLine.box.height - 0.01);
  });

  test('the hold-out measures a returning line below the full box of the line above it', () => {
    // Returning lines start below the preceding full box, including trailing depth.
    // The resulting note split must preserve that clearance and a stable reserve map.
    const { layout, fixedPoint } = layoutProbe({
      paragraphs: [
        {
          lines: 5,
          widowControl: true,
          spacing: 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"',
        },
        { lines: 1, spacing: 'w:after="160" w:line="259" w:lineRule="auto"' },
      ],
      refs: { 1: [2], 4: [4], 5: [1], 6: [3] },
      notes: { 1: 20, 2: 2, 3: 1, 4: 16 },
    });
    expect(pages(layout)).toEqual(['L01..L05 | 2 4 1', 'L06..L06 | 1c 3']);
    const first = layout.pages[0]!;
    const lastLine = pageLines(first).at(-1)!;
    expect(areaTop(first)).toBeGreaterThanOrEqual(lastLine.box.y + lastLine.box.height);
    const noteLines = (page: PageRecord) =>
      page
        .footnotes!.notes.filter((note) => note.noteId === 1)
        .flatMap((note) => note.fragments)
        .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []));
    expect(noteLines(first)).toHaveLength(18);
    expect(noteLines(layout.pages[1]!)).toHaveLength(2);
    expect(fixedPoint).toBe(true);
  });
});

test('continuation openings retain cold geometry after body and reference edits', () => {
  const session = createLayoutSession();
  for (const [count, reference] of [
    [5, 4],
    [5, 3],
    [6, 4],
    [5, 4],
  ]) {
    const probe: Probe = {
      paragraphs: [
        {
          lines: count!,
          widowControl: true,
          spacing: 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"',
        },
        { lines: 1, spacing: 'w:after="160" w:line="259" w:lineRule="auto"' },
      ],
      refs: { 1: [2], [reference!]: [4], 5: [1], 6: [3] },
      notes: { 1: 20, 2: 2, 3: 1, 4: 16 },
    };
    const warm = layoutProbe(probe, session);
    const cold = layoutProbe(probe);
    expect(warm.layout.pages).toEqual(cold.layout.pages);
    expect(warm.fixedPoint).toBe(true);
    expect(cold.fixedPoint).toBe(true);
  }
});
