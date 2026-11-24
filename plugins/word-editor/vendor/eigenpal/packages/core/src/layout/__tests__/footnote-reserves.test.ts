// Footnote bottom-reservation: body shrink, ref+note co-location, idempotent reflow.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { enumerateDocumentSections } from '../section-properties.ts';
import {
  attachNotesToLayout,
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { layoutSemanticDocumentWithNotes } from './notes-layout-drain.ts';
import { collectNoteReferences } from '../../store/package/note-references.ts';
import type { PageRecord, ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function bodyUsedHeight(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

/** Dense body so a page fills without footnote reservation; one ref + multi-line note. */
function filledPageWithFootnoteDoc(): Uint8Array {
  const bodyParas = Array.from({ length: 48 }, (_, i) => {
    const text = `Body line ${i} ${'word '.repeat(28)}`;
    if (i === 2) {
      return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  }).join('');
  const noteParas = Array.from(
    { length: 6 },
    (_, i) => `<w:p><w:r><w:t>Footnote para ${i} ${'note '.repeat(20)}</w:t></w:r></w:p>`
  ).join('');
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
        bodyParas +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1">${noteParas}</w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function loadNotesDoc(bytes: Uint8Array): {
  part: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P }
    ? P extends { parts: Map<string, infer Part> }
      ? Part
      : never
    : never;
  notes: NotesLayoutInput;
} {
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
    measurer: createFixedMeasurer(),
    producer: 'footnote-reserves-test',
  };
  return { part, notes };
}

/** Small footnote body — enough for controlled mock reflow and reserve tests. */
function singleRefFootnoteDoc(withSecondRef = false): Uint8Array {
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
        '<w:p><w:r><w:t>Body with footnote</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
        (withSecondRef
          ? '<w:p><w:r><w:t>Second footnote</w:t><w:footnoteReference w:id="2"/></w:r></w:p>'
          : '') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'line '.repeat(12)}</w:t></w:r></w:p></w:footnote>` +
        (withSecondRef
          ? '<w:footnote w:id="2"><w:p><w:r><w:t>Section-end note</w:t></w:r></w:p></w:footnote>'
          : '') +
        '</w:footnotes>'
    ),
  });
}

function paraFrag(
  paragraphId: string,
  opts: { atomEnd: number; y: number; height: number; width?: number }
): ParagraphFragmentRecord {
  // One line at the fragment top covering the whole atom range — real layout always
  // publishes lines, and the reserve pass reads the referencing LINE's bottom from them.
  const lineHeight = Math.min(14, opts.height);
  return {
    kind: 'paragraph',
    id: `${paragraphId}-frag`,
    paragraphId,
    fragmentIndex: 0,
    box: { x: 0, y: opts.y, width: opts.width ?? 400, height: opts.height },
    range: { start: 0, end: opts.atomEnd },
    props: [],
    spacing: { before: 0, after: 0, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: [
      {
        id: `${paragraphId}-line-0`,
        range: { paragraphId, start: 0, end: opts.atomEnd },
        spans: [],
        box: { x: 0, y: opts.y, width: opts.width ?? 400, height: lineHeight },
        contentX: 0,
        baseline: lineHeight * 0.8,
        leading: 0,
      },
    ],
  };
}

function mockPage(
  index: number,
  fragments: readonly ParagraphFragmentRecord[],
  contentHeight: number
): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: contentHeight + 144 },
    contentBox: { x: 72, y: 72, width: 468, height: contentHeight },
    fragments,
  };
}

describe('footnote bottom reservation', () => {
  test('reference and footnote share a page; body bottom is shortened', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-test',
    });

    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    const area = host!.footnotes!;
    expect(area.notes.some((n) => n.noteId === 1)).toBe(true);

    // Owning reference is on the same page (body fragment carries the footnote ref paragraph).
    const refParas = host!.fragments.filter((f) => f.kind === 'paragraph');
    expect(refParas.length).toBeGreaterThan(0);

    const used = bodyUsedHeight(host!);
    // Body ends at or above the footnote area — reservation shortened available body height.
    expect(used).toBeLessThanOrEqual(area.box.y - host!.contentBox.y + 0.5);
    expect(area.box.height).toBeGreaterThan(0);
    // Body does not consume the full content column once notes are reserved.
    expect(used + area.box.height).toBeLessThanOrEqual(host!.contentBox.height + 0.5);
    expect(used).toBeLessThan(host!.contentBox.height - area.box.height + 1);
  });

  test('computeFootnoteReserves is idempotent across repeated passes', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-idempotent',
    });

    // Body-only pages (strip attached note areas) — same input the reflow loop sees.
    const bodyPages = layout.pages.map((page) => {
      const { footnotes, endnotes, noteStream, ...body } = page;
      void footnotes;
      void endnotes;
      void noteStream;
      return body;
    });
    const bodyLayout = { revision: layout.revision, pages: bodyPages };

    const packageRefs = collectNoteReferences(part).map((hit) => ({
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      paragraphId: hit.paragraphId,
      atomOffset: hit.atomOffset,
      customMarkFollows: hit.customMarkFollows,
    }));
    const paragraphSectionIndex = new Map<string, number>();
    for (const ref of packageRefs) paragraphSectionIndex.set(ref.paragraphId, 0);
    const allHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
    const noteMarks = provisionalNoteMarks(allHits, notes);

    const first = computeFootnoteReserves(bodyLayout, allHits, notes, noteMarks);
    const second = computeFootnoteReserves(bodyLayout, allHits, notes, noteMarks);

    expect(first.stable).toBe(true);
    expect(second.stable).toBe(first.stable);
    expect([...second.reserves.entries()]).toEqual([...first.reserves.entries()]);
    expect(second.reasons).toEqual(first.reasons);

    // A third layout pass publishes the same footnote geometry.
    const again = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-idempotent',
    });
    expect(again.pages.length).toBe(layout.pages.length);
    for (let i = 0; i < layout.pages.length; i += 1) {
      const a = layout.pages[i]!.footnotes?.box.height ?? 0;
      const b = again.pages[i]!.footnotes?.box.height ?? 0;
      expect(b).toBeCloseTo(a, 3);
      expect(bodyUsedHeight(again.pages[i]!)).toBeCloseTo(bodyUsedHeight(layout.pages[i]!), 3);
    }
  });

  test('sectEnd refs do not affect pageBottom notes on the same page in either order', () => {
    const { part, notes } = loadNotesDoc(singleRefFootnoteDoc(true));
    const refs = collectNoteReferences(part);
    expect(refs).toHaveLength(2);
    const contentHeight = 400;
    const bodyLayout: SemanticLayout = {
      revision: 1,
      pages: [
        mockPage(
          0,
          refs.map((ref, index) =>
            paraFrag(ref.paragraphId, {
              atomEnd: ref.atomOffset + 1,
              y: index * 20,
              height: 14,
            })
          ),
          contentHeight
        ),
      ],
    };
    for (const pageBottomIndex of [0, 1]) {
      const sectionByParagraph = new Map(
        refs.map((ref, index) => [ref.paragraphId, index === pageBottomIndex ? 0 : 1])
      );
      const allHits = buildPageRefHits(refs, sectionByParagraph);
      const mixedNotes: NotesLayoutInput = {
        ...notes,
        footnotePropsBySection: [
          resolveFootnoteProperties({ pos: 'pageBottom' }),
          resolveFootnoteProperties({ pos: 'sectEnd' }),
        ],
      };
      const noteMarks = provisionalNoteMarks(allHits, mixedNotes);
      const pageBottomOnly = computeFootnoteReserves(
        bodyLayout,
        [allHits[pageBottomIndex]!],
        mixedNotes,
        noteMarks
      );
      const mixed = computeFootnoteReserves(bodyLayout, allHits, mixedNotes, noteMarks);
      const attached = attachNotesToLayout(bodyLayout, allHits, mixedNotes);

      expect(pageBottomOnly.reserves.get(0)).toBeGreaterThan(0);
      expect(mixed.reserves.get(0)).toBe(pageBottomOnly.reserves.get(0));
      expect(attached.layout.pages[0]!.footnotes?.notes.map((note) => note.noteId)).toEqual([
        allHits[pageBottomIndex]!.noteId,
      ]);
    }
  });

  test('the notes-pass memo reproduces a clean pass byte for byte', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const session = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-memo-oracle',
    });
    // The editor rebuilds the notes input object every pass; a content-equal rebuild must
    // hit the session memo and still publish exactly what a memo-less pass publishes.
    const rebuiltNotes: NotesLayoutInput = { ...notes };
    const incremental = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes: rebuiltNotes,
      session,
      producer: 'notes-memo-oracle',
    });
    const clean = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      producer: 'notes-memo-oracle',
    });
    expect(JSON.stringify(incremental)).toBe(JSON.stringify(clean));
  });

  test('a citation that cannot keep its note moves on and leaves no note area behind', () => {
    const { part, notes } = loadNotesDoc(singleRefFootnoteDoc());
    const sections = enumerateDocumentSections(part);
    const refs = collectNoteReferences(part);
    expect(refs.length).toBe(1);
    const ref = refs[0]!;
    const contentH = 400;
    const fillerH = 380;
    const lineH = 14;

    // A causal body: page 0 reads only its own reserve. The citing line follows a filler
    // paragraph and stays on page 0 only while it fits above that page's reserve.
    const reserveCalls: Array<ReadonlyMap<number, number>> = [];
    const runBody = (opts: {
      pageBottomReserves?: ReadonlyMap<number, number>;
    }): SemanticLayout => {
      const reserves = opts.pageBottomReserves ?? new Map<number, number>();
      reserveCalls.push(new Map(reserves));
      const filler = paraFrag('filler-para', { atomEnd: 4, y: 0, height: fillerH });
      if (fillerH + lineH <= contentH - (reserves.get(0) ?? 0)) {
        const cite = paraFrag(ref.paragraphId, {
          atomEnd: ref.atomOffset + 1,
          y: fillerH,
          height: lineH,
        });
        return { revision: 1, pages: [mockPage(0, [filler, cite], contentH)] };
      }
      const cite = paraFrag(ref.paragraphId, { atomEnd: ref.atomOffset + 1, y: 0, height: lineH });
      return {
        revision: 1,
        pages: [mockPage(0, [filler], contentH), mockPage(1, [cite], contentH)],
      };
    };
    const lay = (session?: ReturnType<typeof createLayoutSession>) =>
      layoutSemanticDocumentWithNotes(
        part,
        sections,
        {
          measurer: notes.measurer,
          producer: 'footnote-reserves-moved-citation',
          ...(session ? { session } : {}),
        },
        notes,
        runBody
      );

    const layout = lay();
    expect(reserveCalls.length).toBeGreaterThanOrEqual(2);
    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    // The note starts on the page of its citation, and the page before holds no note area.
    expect(host?.index).toBe(1);
    expect(
      host!.fragments.some((f) => f.kind === 'paragraph' && f.paragraphId === ref.paragraphId)
    ).toBe(true);
    expect(layout.pages[0]!.footnotes).toBeUndefined();
    expect(bodyUsedHeight(layout.pages[0]!)).toBeCloseTo(fillerH, 3);

    // A warm pass over the same input publishes the same pages.
    const session = createLayoutSession();
    lay(session);
    expect(JSON.stringify(lay(session).pages)).toBe(JSON.stringify(layout.pages));
  });

  test('a reserve left by an earlier pass without a search record is not reused', () => {
    const { part, notes } = loadNotesDoc(singleRefFootnoteDoc());
    const sections = enumerateDocumentSections(part);
    const refs = collectNoteReferences(part);
    const ref = refs[0]!;
    const contentH = 400;
    const reserveCalls: Array<ReadonlyMap<number, number>> = [];
    const session = {
      previous: null as SemanticLayout | null,
      multi: null as unknown,
      // An earlier pass reserved page 0; the citation is now on page 1.
      notePageBottomReserves: new Map<number, number>([[0, 80]]) as ReadonlyMap<
        number,
        number
      > | null,
    };

    // A causal body: the filler fills page 0 down to its reserve and continues on page 1,
    // above the citing line.
    const runBody = (opts: {
      pageBottomReserves?: ReadonlyMap<number, number>;
    }): SemanticLayout => {
      const reserves = opts.pageBottomReserves ?? new Map<number, number>();
      reserveCalls.push(new Map(reserves));
      const r0 = reserves.get(0) ?? 0;
      const filler = paraFrag('filler-para', { atomEnd: 4, y: 0, height: contentH - r0 });
      const page1 = [
        ...(r0 > 0 ? [paraFrag('filler-tail', { atomEnd: 4, y: 0, height: r0 })] : []),
        paraFrag(ref.paragraphId, { atomEnd: ref.atomOffset + 1, y: r0, height: 14 }),
      ];
      return {
        revision: 1,
        pages: [mockPage(0, [filler], contentH), mockPage(1, page1, contentH)],
      };
    };

    const layout = layoutSemanticDocumentWithNotes(
      part,
      sections,
      { session, measurer: notes.measurer, producer: 'stale-seed-drop' },
      notes,
      runBody
    );

    expect(reserveCalls.some((reserves) => reserves.has(0))).toBe(false);
    const last = reserveCalls[reserveCalls.length - 1]!;
    expect(last.get(1) ?? 0).toBeGreaterThan(0);
    expect(session.notePageBottomReserves!.has(0)).toBe(false);
    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host?.index).toBe(1);
    expect(bodyUsedHeight(layout.pages[0]!)).toBeCloseTo(contentH, 3);
  });
});

describe('incremental notes layout (reserve persistence)', () => {
  function multiPageFootnoteDoc(paragraphCount: number, footnoteEvery: number): Uint8Array {
    const bodyParas = Array.from({ length: paragraphCount }, (_, i) => {
      const text = `Body line ${i} ${'word '.repeat(18)}`;
      if (i > 0 && i % footnoteEvery === 0) {
        const id = Math.floor(i / footnoteEvery);
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const noteCount = Math.floor(paragraphCount / footnoteEvery);
    const notesXml = Array.from({ length: noteCount }, (_, i) => {
      const id = i + 1;
      return (
        `<w:footnote w:id="${id}">` +
        `<w:p><w:r><w:t>Note ${id} ${'note '.repeat(8)}</w:t></w:r></w:p>` +
        '</w:footnote>'
      );
    }).join('');
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
          bodyParas +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          notesXml +
          '</w:footnotes>'
      ),
    });
  }

  function editedMultiPageFootnoteDoc(
    paragraphCount: number,
    footnoteEvery: number,
    editIndex: number
  ): Uint8Array {
    const bodyParas = Array.from({ length: paragraphCount }, (_, i) => {
      const text =
        i === editIndex
          ? `Body line ${i} EDITED ${'word '.repeat(18)}`
          : `Body line ${i} ${'word '.repeat(18)}`;
      if (i > 0 && i % footnoteEvery === 0) {
        const id = Math.floor(i / footnoteEvery);
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const noteCount = Math.floor(paragraphCount / footnoteEvery);
    const notesXml = Array.from({ length: noteCount }, (_, i) => {
      const id = i + 1;
      return (
        `<w:footnote w:id="${id}">` +
        `<w:p><w:r><w:t>Note ${id} ${'note '.repeat(8)}</w:t></w:r></w:p>` +
        '</w:footnote>'
      );
    }).join('');
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
          bodyParas +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          notesXml +
          '</w:footnotes>'
      ),
    });
  }

  const layoutShape = (layout: SemanticLayout): string =>
    JSON.stringify(
      layout.pages.map((page) => ({
        index: page.index,
        box: page.box,
        contentBox: page.contentBox,
        fragments: page.fragments.map((f) => ({
          kind: f.kind,
          id: f.id,
          box: f.box,
          ...(f.kind === 'paragraph'
            ? { paragraphId: f.paragraphId, range: f.range, lines: f.lines.length }
            : {}),
        })),
        footnoteHeight: page.footnotes?.box.height ?? 0,
        footnoteNotes: (page.footnotes?.notes ?? []).map((n) => ({
          id: n.noteId,
          continuation: n.continuation,
        })),
      }))
    );

  test('unchanged footnote document reuses session without a second full body pass', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(120, 20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-unchanged',
    });
    expect(first.pages.length).toBeGreaterThan(1);
    expect(session.notePageBottomReserves).not.toBeNull();
    expect(session.notePageBottomReserves!.size).toBeGreaterThan(0);
    const fullPassesAfterCold = session.stats.fullPasses;
    // Cold start: empty seed, the reserved reflow, then one hold-out round — the page
    // before a reference-opening page claims its slack so the opening line cannot pull
    // back. The hold-out round resumes before the first page whose reserve moved, so only
    // the first two are full passes.
    expect(fullPassesAfterCold).toBe(2);

    const second = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-unchanged',
    });
    expect(layoutShape(second)).toBe(layoutShape(first));
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
    // Warm pass must not run another full body pagination.
    expect(session.stats.fullPasses).toBe(fullPassesAfterCold);
  });

  test('mid-document edit with footnotes matches a clean layout and resumes', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(120, 20));
    const session = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-edit',
    });
    const fullPassesAfterCold = session.stats.fullPasses;

    const { part: editedPart, notes: editedNotes } = loadNotesDoc(
      editedMultiPageFootnoteDoc(120, 20, 55)
    );
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session,
      producer: 'notes-incremental-edit',
    });
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-incremental-edit',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    // Seeded reserves: the edit resumes — no extra full pass for reserve rediscovery.
    expect(session.stats.fullPasses).toBe(fullPassesAfterCold);
  });

  test('typing in a referencing paragraph keeps distant note areas by identity', () => {
    // A keystroke in a paragraph that carries a footnote reference only SHIFTS the
    // reference's atom offset. The notes memo must survive that (marks, per-page reserve
    // and attach caches), so every page far from the edit hands the painter the SAME
    // attached page object — re-laying all note stories per keystroke is the regression
    // this pins (issue #631).
    const bytes = multiPageFootnoteDoc(120, 20);
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const normalized = normalizeParagraphIdentity(main);
    const store = new TreePackageStore(loaded.package, normalized);
    const bodyStore = store.bodyStore();
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'notes-keystroke-reuse',
    };
    const session = createLayoutSession();
    const layoutNow = (revision: number) =>
      layoutSemanticDocument(bodyStore.part, revision, {
        measurer: notes.measurer,
        notes,
        session,
        producer: 'notes-keystroke-reuse',
      });
    const before = layoutNow(1);
    layoutNow(2);

    // Paragraph 60 carries footnote 3 in this fixture (every 20th paragraph cites).
    const body = bodyStore.part.root.children?.[0];
    const refParagraph = (body?.children ?? []).filter((n) => n.kind === 'paragraph')[60]!;
    const applied = bodyStore.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: refParagraph.id, offset: 1, text: 'x' })
    );
    expect(applied.ok).toBe(true);

    const after = layoutNow(3);
    const clean = layoutSemanticDocument(bodyStore.part, 3, {
      measurer: notes.measurer,
      notes,
      producer: 'notes-keystroke-reuse',
    });
    expect(layoutShape(after)).toBe(layoutShape(clean));

    // Every page except the edited one keeps its attached record — footnote area included —
    // by IDENTITY, which is what proves no note story on those pages was re-laid.
    let reusedWithNotes = 0;
    for (let i = 0; i < after.pages.length; i += 1) {
      const now = after.pages[i]!;
      const was = before.pages[i]!;
      if (now === was && now.footnotes !== undefined) reusedWithNotes += 1;
    }
    expect(reusedWithNotes).toBeGreaterThanOrEqual(after.pages.length - 3);
  });

  test('900-paragraph footnote document: warm pass is one resumed body layout', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(900, 40));
    const session = createLayoutSession();
    const cold = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-900-bench',
    });
    expect(cold.pages.length).toBeGreaterThan(10);
    const coldFull = session.stats.fullPasses;
    // The last reserve round resumes before the first page whose reserve moved.
    expect(session.stats.placed).toBeGreaterThan(0);
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(coldFull).toBeGreaterThanOrEqual(1);

    const warm = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-900-bench',
    });
    expect(warm.pages.length).toBe(cold.pages.length);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(cold.pages.length);
    expect(session.stats.fullPasses).toBe(coldFull);

    const sessionEdit = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session: sessionEdit,
      producer: 'notes-900-edit',
    });
    const beforeEditFull = sessionEdit.stats.fullPasses;
    const { part: editedPart, notes: editedNotes } = loadNotesDoc(
      editedMultiPageFootnoteDoc(900, 40, 450)
    );
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session: sessionEdit,
      producer: 'notes-900-edit',
    });
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-900-edit',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(sessionEdit.stats.placed).toBeLessThan(sessionEdit.stats.total);
    expect(sessionEdit.stats.reusedPages).toBeGreaterThan(0);
    expect(sessionEdit.stats.fullPasses).toBe(beforeEditFull);
  });
});

describe('multi-section reserve locality', () => {
  /**
   * Section 0 spans three pages and carries the one citation on its LAST page (reserve page
   * slot 2). Sections 1 and 2 are one page each, so slot 2 sits past every reserve slot
   * their passes can read — a reserve there must not enter their context keys.
   */
  function multiSectionFootnoteDoc(noteWords: number): Uint8Array {
    const sectPr =
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>';
    const section0 = Array.from({ length: 80 }, (_, i) => {
      const text = `S0 line ${i} ${'word '.repeat(18)}`;
      if (i === 75) {
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const shortSection = (label: string): string =>
      Array.from(
        { length: 4 },
        (_, i) => `<w:p><w:r><w:t>${label} line ${i} ${'word '.repeat(10)}</w:t></w:r></w:p>`
      ).join('');
    const sectionBreak = `<w:p><w:pPr><w:sectPr>${sectPr}</w:sectPr></w:pPr></w:p>`;
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
          section0 +
          sectionBreak +
          shortSection('S1') +
          sectionBreak +
          shortSection('S2') +
          `<w:sectPr>${sectPr}</w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'note '.repeat(noteWords)}</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
  }

  const layoutShape = (layout: SemanticLayout): string =>
    JSON.stringify(
      layout.pages.map((page) => ({
        index: page.index,
        box: page.box,
        contentBox: page.contentBox,
        fragments: page.fragments.map((f) => ({
          kind: f.kind,
          id: f.id,
          box: f.box,
          ...(f.kind === 'paragraph'
            ? { paragraphId: f.paragraphId, range: f.range, lines: f.lines.length }
            : {}),
        })),
        footnoteHeight: page.footnotes?.box.height ?? 0,
      }))
    );

  function notesFor(bytes: Uint8Array): ReturnType<typeof loadNotesDoc> {
    const { part, notes } = loadNotesDoc(bytes);
    const props = notes.footnotePropsBySection[0]!;
    const enProps = notes.endnotePropsBySection[0]!;
    return {
      part,
      notes: {
        ...notes,
        footnotePropsBySection: [props, props, props],
        endnotePropsBySection: [enProps, enProps, enProps],
      },
    };
  }

  test('a reserve change on section 0 relayouts only section 0; the result matches a clean pass', () => {
    const { part, notes } = notesFor(multiSectionFootnoteDoc(20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-section-locality',
    });
    // The reserve sits on section 0's last page (slot 2); sections 1 and 2 hold one page each.
    expect(first.pages.length).toBe(5);
    expect(session.notePageBottomReserves).not.toBeNull();
    expect([...session.notePageBottomReserves!.keys()]).toEqual([2]);
    const firstReserve = session.notePageBottomReserves!.get(2)!;
    const sectionOnePage = first.pages[3]!;
    const sectionTwoPage = first.pages[4]!;

    // The edit grows the note, so section 0's reserve height changes ({2: h} -> {2: h'}).
    const { part: editedPart, notes: editedNotes } = notesFor(multiSectionFootnoteDoc(60));
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session,
      producer: 'notes-section-locality',
    });
    expect([...session.notePageBottomReserves!.keys()]).toEqual([2]);
    expect(session.notePageBottomReserves!.get(2)!).toBeGreaterThan(firstReserve);

    // Locality: the reserve change stayed inside section 0 — the other sections' pages come
    // back as the SAME records, not rebuilt twins.
    expect(incremental.pages[3]).toBe(sectionOnePage);
    expect(incremental.pages[4]).toBe(sectionTwoPage);

    // Equivalence: the sliced context key changes nothing about the layout itself.
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-section-locality',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
  });

  test('open pays one full pass; the reserved reflow pass reuses every section', () => {
    const { part, notes } = notesFor(multiSectionFootnoteDoc(20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-section-open',
    });
    expect(first.pages.length).toBe(5);
    expect(session.notePageBottomReserves!.size).toBe(1);
    // The reflow's second body pass re-places only the reserved section, so the open
    // performs exactly one FULL pass. Before the per-section reserve slice it performed two.
    expect(session.stats.fullPasses).toBe(1);
    // `fullPasses` alone is a weak gate: it increments only when NOTHING is reused, so a
    // regression that re-places two of three sections would still read 1. Pin the reflow
    // pass's actual work — it re-placed only blocks of the reserved section, from the last
    // checkpoint before the reserved page, and took the other two sections' pages back by
    // reuse.
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBe(3);
    const sectionZeroBlocks = sections[0]!.blockEndExclusive - sections[0]!.blockStart;
    expect(session.stats.placed).toBeGreaterThan(0);
    expect(session.stats.placed).toBeLessThan(sectionZeroBlocks);
    expect(session.stats.reusedPages).toBeGreaterThanOrEqual(2);
    // And the second pass really applied the reserve: the citation page keeps room for the
    // note above the page bottom.
    const host = first.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBe(2);
  });
});
