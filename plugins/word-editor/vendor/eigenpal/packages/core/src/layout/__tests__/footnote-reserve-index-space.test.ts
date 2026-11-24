// Multi-section footnote reserves live in ONE index space (issue #460): the reserve map is
// keyed by DOCUMENT page index, and every section's pass reads it through `pageIndexStart`.
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
import { enumerateDocumentSections } from '../section-properties.ts';
import { notesReserveContextKey, type NotesLayoutInput } from '../note-pagination.ts';
import type { OoxmlPart } from '../../store/package/ooxml-package.ts';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const SECT_GEOMETRY =
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>';
const sectionBreak = `<w:p><w:pPr><w:sectPr>${SECT_GEOMETRY}</w:sectPr></w:pPr></w:p>`;

function bodyUsedHeight(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

function paras(label: string, count: number, wordsPer: number, citationAt?: number): string {
  return Array.from({ length: count }, (_, i) => {
    const text = `${label} line ${i} ${'word '.repeat(wordsPer)}`;
    if (i === citationAt) {
      return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  }).join('');
}

function zipFootnoteDoc(bodyXml: string, noteWords: number): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'note '.repeat(noteWords)}</w:t></w:r></w:p></w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function notesFor(
  bytes: Uint8Array,
  sectionCount: number
): { part: OoxmlPart; notes: NotesLayoutInput } {
  const loaded = readOoxmlPackage(bytes);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const props = resolveFootnoteProperties(undefined, undefined);
  const enProps = resolveEndnoteProperties(undefined, undefined);
  return {
    part,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: Array.from({ length: sectionCount }, () => props),
      endnotePropsBySection: Array.from({ length: sectionCount }, () => enProps),
      documentFootnoteProps: props,
      documentEndnoteProps: enProps,
      measurer: createFixedMeasurer(),
      producer: 'footnote-reserve-index-space-test',
    },
  };
}

const sortedKeys = (map: ReadonlyMap<number, number>): number[] =>
  [...map.keys()].sort((a, b) => a - b);

describe('multi-section reserve index space (#460)', () => {
  test('notesReserveContextKey folds document slots at section-local positions', () => {
    const reserves = new Map<number, number>([
      [3, 40],
      [1, 20],
    ]);
    // A section starting at document page 1 with 3 readable local slots reads document
    // slots 1..3 — entries land in the key at their LOCAL positions.
    expect(notesReserveContextKey(reserves, 1, 3)).toBe('|nr:0=20,2=40');
    // Entries before the section or past its bound stay out; a window with no entries keys
    // exactly like no map at all (both mean every read returns zero).
    expect(notesReserveContextKey(reserves, 2, 1)).toBe('');
    // A section that moves while a reserve stays at its document page must invalidate.
    expect(notesReserveContextKey(reserves, 0, 4)).not.toBe(notesReserveContextKey(reserves, 1, 4));
    // No prior page count: every entry from the section start on folds in.
    expect(notesReserveContextKey(reserves, 1, Infinity)).toBe('|nr:0=20,2=40');
    expect(notesReserveContextKey(undefined, 1, 3)).toBe('');
  });

  test('a citation on a full page of a later section reserves space on that page', () => {
    // Section 0 is one page; section 1 spans three, with the citation on its FULL middle
    // page — document page 2, section-local slot 1. Reading the reserve at the local slot
    // (the pre-#460 behaviour) misapplies it one sheet late: the citation page keeps its
    // full body, and the note renders only as a continuation on the page after it.
    const bytes = zipFootnoteDoc(
      paras('S0', 4, 10) +
        sectionBreak +
        paras('S1', 80, 18, 40) +
        `<w:sectPr>${SECT_GEOMETRY}</w:sectPr>`,
      60
    );
    const { part, notes } = notesFor(bytes, 2);
    const session = createLayoutSession();
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-later-section-reserve',
    });

    // The reserve is keyed by DOCUMENT page index: section 1's full middle page.
    expect(sortedKeys(session.notePageBottomReserves!)).toEqual([2]);

    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBe(2);
    // No continuation chain: the whole note sits under its citation.
    for (const page of layout.pages) {
      expect((page.footnotes?.notes ?? []).filter((n) => n.continuation)).toEqual([]);
    }
    // The reserve applied: the body stops above the note area instead of filling the column.
    const area = host!.footnotes!;
    const used = bodyUsedHeight(host!);
    expect(area.box.height).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(area.box.y - host!.contentBox.y + 0.5);
    expect(used + area.box.height).toBeLessThanOrEqual(host!.contentBox.height + 0.5);
  });

  test('an edit that grows an earlier section moves the reserve with the citation', () => {
    // Warm session: section 0 grows from one page to two, so section 1 (the citation) and
    // section 2 (reserve-free) both shift down one document page. The recomputed reserve
    // must follow the citation to its NEW document page, and the warm re-layout must
    // publish exactly what a cold pass publishes — the local-slot context key may reuse,
    // never against different reads.
    const docWith = (sectionZeroParas: number): Uint8Array =>
      zipFootnoteDoc(
        paras('S0', sectionZeroParas, 18) +
          sectionBreak +
          paras('S1', 80, 18, 40) +
          sectionBreak +
          paras('S2', 4, 10) +
          `<w:sectPr>${SECT_GEOMETRY}</w:sectPr>`,
        60
      );
    const { part, notes } = notesFor(docWith(4), 3);
    const session = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-reserve-shift',
    });
    expect(sortedKeys(session.notePageBottomReserves!)).toEqual([2]);

    // Hanging same-run separators let 30 paragraphs fit one page; 40 forces the shift.
    const { part: grownPart, notes: grownNotes } = notesFor(docWith(40), 3);
    const incremental = layoutSemanticDocument(grownPart, 2, {
      measurer: grownNotes.measurer,
      notes: grownNotes,
      session,
      producer: 'notes-reserve-shift',
    });
    expect(sortedKeys(session.notePageBottomReserves!)).toEqual([3]);
    const host = incremental.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBe(3);
    for (const page of incremental.pages) {
      expect((page.footnotes?.notes ?? []).filter((n) => n.continuation)).toEqual([]);
    }

    // The seed moves with each section's first page, so the notes pass settles in its first
    // body pass: no reserve round re-lays a section. That pass places sections 0 and 1 (one
    // changed, the other moved) and section 2, whose first page moved, once.
    const sections = enumerateDocumentSections(grownPart);
    expect(sections.length).toBe(3);
    expect(session.stats.placed).toBeLessThan(session.stats.total);

    const clean = layoutSemanticDocument(grownPart, 2, {
      measurer: grownNotes.measurer,
      notes: grownNotes,
      producer: 'notes-reserve-shift',
    });
    expect(JSON.stringify(incremental)).toBe(JSON.stringify(clean));
  });

  test('a continuous section sharing the citation sheet honours the same reserve', () => {
    // Section 0 ends half way down its last page with the citation there; section 1 is
    // continuous and long enough to fill the rest of that sheet. Both passes read the
    // reserve at the shared sheet's DOCUMENT page index, so the continued flow also stops
    // above the note area rather than filling the band the note needs.
    const bytes = zipFootnoteDoc(
      // Keep the citation on document page 2 after same-run separators can hang.
      paras('S0', 80, 18, 79) +
        sectionBreak +
        paras('S1', 40, 18) +
        `<w:sectPr><w:type w:val="continuous"/>${SECT_GEOMETRY}</w:sectPr>`,
      20
    );
    const { part, notes } = notesFor(bytes, 2);
    const session = createLayoutSession();
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-continuous-shared-sheet',
    });

    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBe(2);
    for (const page of layout.pages) {
      expect((page.footnotes?.notes ?? []).filter((n) => n.continuation)).toEqual([]);
    }

    // The continued section really shares the sheet: a section-1 paragraph fragment sits on
    // the host page. The fixture's blocks are all top-level paragraphs, so the section
    // bounds index straight into the document-order paragraph list.
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBe(2);
    const paragraphIds: string[] = [];
    const collect = (node: { kind: string; id?: string; children?: readonly unknown[] }): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph' && node.id) {
        paragraphIds.push(node.id);
        return;
      }
      for (const child of node.children ?? []) {
        collect(child as { kind: string; id?: string; children?: readonly unknown[] });
      }
    };
    collect(part.root as { kind: string; id?: string; children?: readonly unknown[] });
    const sectionOneIds = new Set(
      paragraphIds.slice(sections[1]!.blockStart, sections[1]!.blockEndExclusive)
    );
    expect(sectionOneIds.size).toBeGreaterThan(0);
    const hostParagraphIds = host!.fragments
      .filter((f) => f.kind === 'paragraph')
      .map((f) => (f as ParagraphFragmentRecord).paragraphId);
    expect(hostParagraphIds.some((id) => sectionOneIds.has(id))).toBe(true);

    // BOTH flows on the sheet stop above the note area.
    const area = host!.footnotes!;
    const used = bodyUsedHeight(host!);
    expect(area.box.height).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(area.box.y - host!.contentBox.y + 0.5);
    expect(used + area.box.height).toBeLessThanOrEqual(host!.contentBox.height + 0.5);
  });
});
