// Hostile / amplification bounds for note pagination + section enumeration.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import { resolveNotesPart, collectNoteReferences } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  attachNotesToLayout,
  buildPageRefHits,
  buildPageRefIndex,
  filterRefsOnPage,
  MAX_NOTE_OVERFLOW_PAGES,
  type NotesLayoutInput,
  type PageRefHit,
} from '../note-pagination.ts';
import { DEFAULT_NOTE_SEPARATOR_HEIGHT_PT, layoutNoteSeparator } from '../note-layout.ts';
import {
  enumerateDocumentSections,
  enumerateDocumentSectionsBounded,
  MAX_DOCUMENT_SECTIONS,
} from '../section-properties.ts';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function tallSeparatorDoc(separatorParas: number): Uint8Array {
  const sepBody = Array.from(
    { length: separatorParas },
    (_, i) => `<w:p><w:r><w:t>Sep ${i} ${'x'.repeat(40)}</w:t></w:r></w:p>`
  ).join('');
  const contBody = Array.from(
    { length: separatorParas },
    (_, i) => `<w:p><w:r><w:t>Cont ${i} ${'x'.repeat(40)}</w:t></w:r></w:p>`
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
        `<w:p><w:r><w:t>Body with footnote</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1">${sepBody}</w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0">${contBody}</w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Note body</w:t></w:r></w:p></w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function loadNotesDoc(bytes: Uint8Array): {
  part: NonNullable<
    ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P }
      ? P extends { parts: Map<string, infer Part> }
        ? Part
        : never
      : never
  >;
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
    measurer: createFixedMeasurer(7),
    producer: 'note-amplification',
  };
  return { part, notes };
}

function countSeparatorFragments(pages: readonly PageRecord[]): number {
  let total = 0;
  for (const page of pages) {
    total += page.footnotes?.separator?.fragments.length ?? 0;
    total += page.endnotes?.separator?.fragments.length ?? 0;
  }
  return total;
}

describe('P0 tall separator fails closed', () => {
  test('200-paragraph separator+continuationSeparator does not mint 257 pages', () => {
    const { part, notes } = loadNotesDoc(tallSeparatorDoc(200));
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'hostile-sep',
    });

    const drainPages = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    const zeroNoteDrains = drainPages.filter((page) => (page.footnotes?.notes.length ?? 0) === 0);

    // Pre-fix amplifier: pages=257, drain=256, ~51k separator fragments.
    expect(layout.pages.length).toBeLessThan(257);
    expect(layout.pages.length).toBeLessThan(MAX_NOTE_OVERFLOW_PAGES);
    expect(zeroNoteDrains.length).toBeLessThanOrEqual(1);
    expect(countSeparatorFragments(layout.pages)).toBeLessThan(200 * 2);

    // Reasons surface on a notes-attach pass (body layout has no prior note areas).
    const bodyLayout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      producer: 'hostile-sep-body',
    });
    const packageRefs = collectNoteReferences(part).map((hit) => ({
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      paragraphId: hit.paragraphId,
      atomOffset: hit.atomOffset,
      customMarkFollows: hit.customMarkFollows,
    }));
    const hits = buildPageRefHits(packageRefs, new Map());
    const attached = attachNotesToLayout(bodyLayout, hits, notes);
    expect(
      attached.fallbackReasons.some(
        (r) => r === 'note-separator-height-cap' || r === 'note-overflow-stalled'
      )
    ).toBe(true);
  });

  test('oversize authored separator becomes synthetic short rule', () => {
    const { notes } = loadNotesDoc(tallSeparatorDoc(200));
    const laid = layoutNoteSeparator(
      notes.footnotesPart,
      'separator',
      500,
      { measurer: notes.measurer, producer: 'sep-cap' },
      'footnote',
      100
    );
    expect(laid.fallbackReason).toBe('note-separator-height-cap');
    expect(laid.synthetic).toBe(true);
    expect(laid.fragments).toEqual([]);
    expect(laid.flowHeight).toBe(DEFAULT_NOTE_SEPARATOR_HEIGHT_PT);
  });
});

describe('P2 filterRefsOnPage index', () => {
  test('indexed path matches unindexed results with fewer candidate scans', () => {
    const refs: PageRefHit[] = [];
    for (let i = 0; i < 40; i += 1) {
      refs.push({
        noteKind: 'footnote',
        noteId: i + 1,
        paragraphId: `p-${Math.floor(i / 2)}`,
        atomOffset: (i % 2) * 4,
        customMarkFollows: false,
        sectionIndex: 0,
      });
    }
    const frag = (paragraphId: string): ParagraphFragmentRecord =>
      ({
        kind: 'paragraph',
        id: `${paragraphId}-frag`,
        paragraphId,
        fragmentIndex: 0,
        box: { x: 0, y: 0, width: 100, height: 12 },
        range: { start: 0, end: 8 },
        props: [],
        spacing: { before: 0, after: 0, line: null, lineRule: 'auto' },
        indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
        lines: [],
      }) as ParagraphFragmentRecord;
    const page: PageRecord = {
      id: 'page-0',
      index: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      contentBox: { x: 0, y: 0, width: 100, height: 100 },
      fragments: [frag('p-3'), frag('p-7')],
    };

    const unindexed = filterRefsOnPage(page, refs);
    const index = buildPageRefIndex(refs);
    const indexed = filterRefsOnPage(page, refs, index);
    expect(indexed.map((r) => `${r.paragraphId}:${r.atomOffset}:${r.noteId}`)).toEqual(
      unindexed.map((r) => `${r.paragraphId}:${r.atomOffset}:${r.noteId}`)
    );
    // Index only retains refs for paragraphs that exist; page touches 2 paragraphs × 2 refs.
    expect(indexed.length).toBe(4);
    expect([...index.keys()].length).toBeLessThan(refs.length);
  });
});

describe('P3 deferred overflow reindex', () => {
  test('many endnote overflow sheets still finish with contiguous page indexes', () => {
    const noteParas = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>Endnote line ${i} ${'word '.repeat(30)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:endnoteReference w:id="1"/></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="12240" w:h="5000"/><w:pgMar w:top="360" w:right="720" w:bottom="360" w:left="720"/>' +
          '<w:endnotePr><w:pos w:val="docEnd"/></w:endnotePr></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${noteParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: null,
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(7),
      producer: 'overflow-reindex',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'overflow-reindex',
    });
    expect(layout.pages.length).toBeGreaterThan(2);
    for (let i = 0; i < layout.pages.length; i += 1) {
      expect(layout.pages[i]!.index).toBe(i);
      expect(layout.pages[i]!.id).toBe(`page-${i}`);
    }
  });
});

describe('P4 section enumeration bound', () => {
  test('hostile sectPr count caps at MAX_DOCUMENT_SECTIONS', () => {
    const hostileCount = MAX_DOCUMENT_SECTIONS + 40;
    const paras = Array.from({ length: hostileCount }, (_, i) => {
      return (
        `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>` +
        `<w:r><w:t>S${i}</w:t></w:r></w:p>`
      );
    }).join('');
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${paras}<w:sectPr/></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const sections = enumerateDocumentSections(result.part);
    expect(sections.length).toBeLessThanOrEqual(MAX_DOCUMENT_SECTIONS);
    const bounded = enumerateDocumentSectionsBounded(result.part);
    expect(bounded.truncated).toBe(true);
    expect(bounded.sections.length).toBe(MAX_DOCUMENT_SECTIONS);
    // Remaining body is still covered by the last accepted section.
    expect(bounded.sections[bounded.sections.length - 1]!.blockEndExclusive).toBe(hostileCount);
  });

  test('normal multi-section docs are unchanged', () => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>B</w:t></w:r></w:p>` +
        `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const bounded = enumerateDocumentSectionsBounded(result.part);
    expect(bounded.truncated).toBe(false);
    expect(bounded.sections.length).toBe(2);
  });
});
