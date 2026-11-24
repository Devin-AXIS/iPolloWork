// Footnotes taller than the remaining page: the first fragment stays on the reference
// page, the remainder drains forward, and drained reservations release (issue #608).
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Letter page, 1-inch margins, createFixedMeasurer(6, 14): the default run size is 10pt,
// so a line is 14 * 10/11 pt tall, a character 6 * 10/11 pt wide, and the 468pt content
// column breaks at floor(468 / (60/11)) = 85 characters.
const LINE_H = 14 * (10 / 11);
const CHARS_PER_LINE = 85;

function packageXml(documentBody: string, footnotes: string): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        documentBody +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        footnotes +
        '</w:footnotes>'
    ),
  });
}

/** 60 one-line body paragraphs; `refs` maps paragraph index → footnote id. */
function bodyParas(count: number, refs: ReadonlyMap<number, number>, edited = false): string {
  return Array.from({ length: count }, (_, i) => {
    const label = edited && i === 0 ? `Body para ${i} EDITED` : `Body para ${i}`;
    const id = refs.get(i);
    return id !== undefined
      ? `<w:p><w:r><w:t>${label} ref</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`
      : `<w:p><w:r><w:t>${label}</w:t></w:r></w:p>`;
  }).join('');
}

function singleRunFootnote(id: number, chars: number): string {
  return `<w:footnote w:id="${id}"><w:p><w:r><w:t>${'f'.repeat(chars)}</w:t></w:r></w:p></w:footnote>`;
}

function layoutOf(
  bytes: Uint8Array,
  producer: string,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1
): SemanticLayout {
  const loaded = readOoxmlPackage(bytes);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
  const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [documentFootnoteProps],
    endnotePropsBySection: [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer: createFixedMeasurer(6, 14),
    producer,
  };
  return layoutSemanticDocument(part, revision, {
    measurer: notes.measurer,
    notes,
    ...(session ? { session } : {}),
    producer,
  });
}

function bodyLineCount(page: PageRecord): number {
  let lines = 0;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph') lines += fragment.lines.length;
  }
  return lines;
}

function placedNoteHeight(page: PageRecord): number {
  return (page.footnotes?.notes ?? []).reduce((sum, note) => sum + note.box.height, 0);
}

/**
 * Every non-drain page that keeps at most one body line must be a genuine full-page
 * footnote continuation. A near-empty body page with little or no footnote content is
 * exactly the starved shape of issue #608: a reservation outliving the content it was
 * measured for. The final page is exempt — trailing body can legitimately end there.
 */
function expectNoStarvedPages(layout: SemanticLayout): void {
  for (const page of layout.pages) {
    if (page.noteStream !== undefined) continue;
    if (page.index === layout.pages.length - 1) continue;
    if (bodyLineCount(page) > 1) continue;
    expect(placedNoteHeight(page)).toBeGreaterThanOrEqual(page.contentBox.height - 4 * LINE_H);
  }
}

function expectFullyDrained(layout: SemanticLayout, expectedNoteLines: number): void {
  let placed = 0;
  for (const page of layout.pages) placed += placedNoteHeight(page);
  expect(placed).toBeCloseTo(expectedNoteLines * LINE_H, 1);
}

describe('oversized footnote starts on its reference page (issue #608)', () => {
  // The issue's repro table: one long footnote referenced from paragraph 2 of 60.
  test.each([[6000], [9000], [14000]])('fn=%i chars', (chars) => {
    const layout = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), singleRunFootnote(1, chars)),
      `fn-overflow-${chars}`
    );

    // The reference page (page 0 — the citation sits on paragraph 2) hosts the note's
    // FIRST fragment, not a continuation, with real height.
    const refPage = layout.pages[0]!;
    expect(refPage.footnotes).toBeTruthy();
    const head = refPage.footnotes!.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(head!.box.height).toBeGreaterThan(LINE_H);
    // Body keeps the referencing line — the page is not evacuated to a drain sheet.
    expect(bodyLineCount(refPage)).toBeGreaterThanOrEqual(2);

    // Hand-computed packing: body lines + note lines at one line height per line, ignoring
    // the two separators — the result must land within one page of it.
    const noteLines = Math.ceil(chars / CHARS_PER_LINE);
    const expected = Math.ceil(((60 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('two adjacent footnotes totalling more than one page drain without starving pages', () => {
    const refs = new Map([
      [1, 1],
      [2, 2],
    ]);
    const layout = layoutOf(
      packageXml(bodyParas(60, refs), singleRunFootnote(1, 6000) + singleRunFootnote(2, 6000)),
      'fn-adjacent'
    );

    const refPage = layout.pages[0]!;
    const head = refPage.footnotes?.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(head!.box.height).toBeGreaterThan(LINE_H);

    const noteLines = 2 * Math.ceil(6000 / CHARS_PER_LINE);
    const expected = Math.ceil(((60 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('a footnote taller than an entire page caps and drains without unbounded pages', () => {
    const noteParaTexts = Array.from(
      { length: 250 },
      (_, i) => `Giant note para ${i} ${'x'.repeat(70)}`
    );
    const noteParas = noteParaTexts
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join('');
    const layout = layoutOf(
      packageXml(bodyParas(6, new Map([[1, 1]])), `<w:footnote w:id="1">${noteParas}</w:footnote>`),
      'fn-giant'
    );

    const refPage = layout.pages[0]!;
    const head = refPage.footnotes?.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(bodyLineCount(refPage)).toBeGreaterThanOrEqual(2);

    let noteLines = 0;
    for (const text of noteParaTexts) noteLines += Math.ceil(text.length / CHARS_PER_LINE);
    const expected = Math.ceil(((6 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    // Drain sheets exist, each carries note content, and the drain terminates.
    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);
    for (const page of drain) {
      expect((page.footnotes?.notes.length ?? 0) > 0).toBe(true);
    }
    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('a cantSplit table row taller than the reserve-shrunk band takes the full page', () => {
    // Paragraph 2 references a footnote whose carry reserves most of the next page; the
    // w:cantSplit row (40 lines, ~509pt) exceeds the band the reserve leaves but fits the
    // full column. The paginator must place it against the full band — never abort layout
    // over a row+reserve collision — and the notes then drain past the row's page.
    const rowParas = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>Row line ${i}</w:t></w:r></w:p>`
    ).join('');
    const tableXml =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
      `<w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${rowParas}</w:tc></w:tr>` +
      '</w:tbl>';
    const body =
      '<w:p><w:r><w:t>Lead paragraph</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Reference here</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
      tableXml +
      Array.from({ length: 6 }, (_, i) => `<w:p><w:r><w:t>Tail ${i}</w:t></w:r></w:p>`).join('');
    const layout = layoutOf(packageXml(body, singleRunFootnote(1, 9000)), 'fn-cantsplit');

    // The row landed whole: one table fragment, taller than any reserve-shrunk band.
    const tableFragments = layout.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table')
    );
    expect(tableFragments.length).toBe(1);
    expect(tableFragments[0]!.box.height).toBeGreaterThan(400);

    // Footnote areas never overlap body content on any page.
    for (const page of layout.pages) {
      if (!page.footnotes) continue;
      let bodyBottom = 0;
      for (const fragment of page.fragments) {
        bodyBottom = Math.max(bodyBottom, fragment.box.y + fragment.box.height);
      }
      expect(page.footnotes.box.y).toBeGreaterThanOrEqual(page.contentBox.y + bodyBottom - 0.5);
    }

    const noteLines = Math.ceil(9000 / CHARS_PER_LINE);
    const expected = Math.ceil(
      ((8 + 40 + noteLines) * LINE_H) / layout.pages[0]!.contentBox.height
    );
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);
    expectFullyDrained(layout, noteLines);
  });

  test('a page hosting several references sizes each note to its own reference line', () => {
    // 12 references over the first 48 paragraphs, all on page 0 of a body-only layout.
    // Sizing the page's reserve against the LOWEST reference line strangles every note to
    // the sliver under it — stably, because the resulting layout reproduces the same floor.
    // Per-reference floors let the first notes push body (and later references) forward.
    const refs = new Map(Array.from({ length: 12 }, (_, i) => [(i + 1) * 4, i + 1] as const));
    const notesXml = Array.from(
      { length: 12 },
      (_, i) =>
        `<w:footnote w:id="${i + 1}"><w:p><w:r><w:t>${'n'.repeat(800)}</w:t></w:r></w:p></w:footnote>`
    ).join('');
    const layout = layoutOf(packageXml(bodyParas(60, refs), notesXml), 'fn-multi-ref');

    // Page 0 keeps only the body above the accumulated note stack — not 48 lines with a
    // strangled 1-line note region.
    expect(bodyLineCount(layout.pages[0]!)).toBeLessThanOrEqual(30);
    expect(placedNoteHeight(layout.pages[0]!)).toBeGreaterThan(300);

    const noteLines = 12 * Math.ceil(800 / CHARS_PER_LINE);
    const expected = Math.ceil(((60 + noteLines) * LINE_H) / layout.pages[0]!.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);
    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('many mid-size footnotes adopt recomputed reserves instead of accumulating stale ones', () => {
    // 24 notes of ~18 lines across ~13 pages: every reserve pass shifts references forward,
    // so a monotonic union of pass maps keeps reserves at every slot any pass ever wanted —
    // runs of one-line pages whose reservation nothing fills (the real-document shape behind
    // issue #608). Adoption stays within a page of the hand-computed packing cold, and the
    // session-seeded passes continue the iteration to the interleaved fixed point.
    const refs = new Map(Array.from({ length: 24 }, (_, i) => [(i + 1) * 8, i + 1] as const));
    const notesXml = Array.from(
      { length: 24 },
      (_, i) =>
        `<w:footnote w:id="${i + 1}"><w:p><w:r><w:t>${'n'.repeat(1500)}</w:t></w:r></w:p></w:footnote>`
    ).join('');
    const bytes = packageXml(bodyParas(200, refs), notesXml);

    const noteLines = 24 * Math.ceil(1500 / CHARS_PER_LINE);
    const cold = layoutOf(bytes, 'fn-adoption');
    const expected = Math.ceil(((200 + noteLines) * LINE_H) / cold.pages[0]!.contentBox.height);
    // Legal splits keep packing bounded while widow control can leave some unused room.
    expect(Math.abs(cold.pages.length - expected)).toBeLessThanOrEqual(2);
    expectFullyDrained(cold, noteLines);
    expectNoStarvedPages(cold);

    // Every note starts on its reference page and continues without losing its mark.
    for (const [paragraphIndex, id] of refs) {
      const refPages = pagesOwningParagraph(cold, paragraphIndex);
      const head = noteHeadPage(cold, id);
      expect(head).not.toBeNull();
      expect(refPages).toContain(head!);
      expect(noteRecordCount(cold, id)).toBeGreaterThanOrEqual(1);
      expect(noteRecordCount(cold, id)).toBeLessThanOrEqual(2);
    }

    // Session-seeded passes continue the reserve iteration where the cold pass stopped;
    // by the third the packing is interleaved everywhere and a further pass changes nothing.
    const session = createLayoutSession();
    let settled = layoutOf(bytes, 'fn-adoption', session);
    for (let pass = 0; pass < 3; pass += 1) {
      settled = layoutOf(bytes, 'fn-adoption', session, 2 + pass);
    }
    const again = layoutOf(bytes, 'fn-adoption', session, 5);
    expect(shapeOf(again)).toBe(shapeOf(settled));
    expect(settled.pages.length).toBe(cold.pages.length);
    expectFullyDrained(settled, noteLines);
    expectNoStarvedPages(settled);
    // Fully settled, every note interleaves beside its reference — no drain sheets remain.
    expect(settled.pages.every((page) => page.noteStream === undefined)).toBe(true);
  });

  test('warm session converges to the cold layout after an edit near the reference', () => {
    const footnotes = singleRunFootnote(1, 9000);
    const session = createLayoutSession();
    const loadedCold = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), footnotes),
      'fn-warm-converge'
    );
    // Cold pass carries the session forward.
    const withSession = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), footnotes),
      'fn-warm-converge',
      session
    );
    expect(shapeOf(withSession)).toBe(shapeOf(loadedCold));

    // Edit paragraph 0, one paragraph above the reference; the warm pass must publish
    // exactly what a clean pass over the edited document publishes.
    const editedBytes = packageXml(bodyParas(60, new Map([[1, 1]]), true), footnotes);
    const warm = layoutOf(editedBytes, 'fn-warm-converge', session, 2);
    const clean = layoutOf(editedBytes, 'fn-warm-converge', undefined, 2);
    expect(shapeOf(warm)).toBe(shapeOf(clean));
    expectNoStarvedPages(warm);
  });
});

/** Pages (in order) whose body fragments draw `paragraph "Body para <n>"` text. */
function pagesOwningParagraph(layout: SemanticLayout, paragraphIndex: number): number[] {
  // Word boundary, not a substring: "Body para 8" must not also claim "Body para 80".
  const needle = new RegExp(`Body para ${paragraphIndex}\\b`);
  const found: number[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      // Projected spans (the citation mark digits) are excluded: the mark "1" is its own
      // span right after "Body para 40", and concatenating it would read "Body para 401".
      const text = fragment.lines
        .flatMap((line) => line.spans.filter((span) => !span.projected).map((span) => span.text))
        .join('');
      if (needle.test(text)) {
        found.push(page.index);
        break;
      }
    }
  }
  return found;
}

/** The page index that hosts note `id`'s FIRST (non-continuation) record, or null. */
function noteHeadPage(layout: SemanticLayout, id: number): number | null {
  for (const page of layout.pages) {
    for (const note of page.footnotes?.notes ?? []) {
      if (note.noteId === id && note.continuation !== true) return page.index;
    }
  }
  return null;
}

function noteRecordCount(layout: SemanticLayout, id: number): number {
  let count = 0;
  for (const page of layout.pages) {
    for (const note of page.footnotes?.notes ?? []) {
      if (note.noteId === id) count += 1;
    }
  }
  return count;
}

describe('a footnote that cannot fit below its reference moves with it (keep-whole)', () => {
  // ~50 body lines fill a page; the reference sits close to the bottom, and the 4-line
  // note cannot fit below it. Word does not split a footnote that fits in a page's note
  // column: the reference LINE moves to the next page and the note lays out whole there.
  test('short note near the page bottom does not split', () => {
    const refAt = 47;
    const layout = layoutOf(
      packageXml(bodyParas(60, new Map([[refAt, 1]])), singleRunFootnote(1, 300)),
      'fn-keep-whole'
    );

    expect(noteRecordCount(layout, 1)).toBe(1);
    const refPages = pagesOwningParagraph(layout, refAt);
    expect(refPages).toHaveLength(1);
    expect(noteHeadPage(layout, 1)).toBe(refPages[0]!);
    expectNoStarvedPages(layout);
  });

  // The reported real-document shape: earlier references' notes stack down to a later
  // reference's line, its own note gets no room, and the note used to render whole as an
  // unmarked "continuation" on the next page — or split mid-sentence — while body text
  // stayed put. The reference and its whole note must travel together instead.
  test('a reference starved by the stack above it keeps its note', () => {
    const refs = new Map([
      [10, 1],
      [44, 2],
    ]);
    const layout = layoutOf(
      packageXml(bodyParas(60, refs), singleRunFootnote(1, 3200) + singleRunFootnote(2, 300)),
      'fn-starved-ref'
    );

    for (const id of [1, 2]) {
      expect(noteRecordCount(layout, id)).toBe(1);
      const refPages = pagesOwningParagraph(layout, id === 1 ? 10 : 44);
      expect(noteHeadPage(layout, id)).toBe(refPages[0]!);
    }
    expectNoStarvedPages(layout);
  });

  // The fit rule admits a paragraph without charging its `w:spacing w:after`, but the
  // fragment box includes it. The note passes must measure the body the same way, or the
  // reserve under-claims by the trailing after-spacing and the attach pass splits a note
  // the reserve fitted whole.
  test('trailing paragraph after-spacing does not shrink the note area', () => {
    const refAt = 40;
    const spaced = Array.from({ length: 60 }, (_, i) => {
      const ref = i === refAt ? '<w:footnoteReference w:id="1"/>' : '';
      return (
        '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' +
        `<w:r><w:t>Body para ${i}</w:t>${ref}</w:r></w:p>`
      );
    }).join('');
    const layout = layoutOf(packageXml(spaced, singleRunFootnote(1, 400)), 'fn-after-spacing');

    expect(noteRecordCount(layout, 1)).toBe(1);
    expect(noteHeadPage(layout, 1)).toBe(pagesOwningParagraph(layout, refAt)[0]!);
  });
});

const shapeOf = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      contentBox: page.contentBox,
      noteStream: page.noteStream ?? null,
      bodyLines: bodyLineCount(page),
      fragments: page.fragments.map((f) => ({
        kind: f.kind,
        id: f.id,
        box: f.box,
      })),
      footnoteHeight: page.footnotes?.box.height ?? 0,
      footnoteNotes: (page.footnotes?.notes ?? []).map((n) => ({
        id: n.noteId,
        continuation: n.continuation ?? false,
        height: n.box.height,
      })),
    }))
  );
