// A note's displayed mark is DERIVED, so it moves without moving any paragraph subtree.
// Nothing in a block key or a fragment signature sees it, which leaves the session context
// as the only thing that can refuse a resume onto pages measured for the old marks.

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
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { enumerateDocumentSections } from '../section-properties.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { layoutSemanticDocumentWithNotes } from './notes-layout-drain.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function doc(): Uint8Array {
  const paras = Array.from({ length: 8 }, (_, i) =>
    i === 1
      ? `<w:p><w:r><w:t xml:space="preserve">Body ${i} ${'word '.repeat(6)}</w:t><w:footnoteReference w:id="1"/><w:t xml:space="preserve"> tail text</w:t></w:r></w:p>`
      : i === 3
        ? `<w:p><w:r><w:t xml:space="preserve">Body ${i} ${'word '.repeat(6)}</w:t><w:footnoteReference w:id="2"/><w:t xml:space="preserve"> tail text</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">Body ${i} ${'word '.repeat(6)}</w:t></w:r></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paras}` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t>Second note</w:t></w:r></w:p></w:footnote>' +
        '</w:footnotes>'
    ),
  });
}

const measurer = createFixedMeasurer();

function layWith(
  numFmt: string,
  session?: ReturnType<typeof createLayoutSession>,
  cache?: ReturnType<typeof createParagraphLayoutCache>
): SemanticLayout {
  const loaded = readOoxmlPackage(doc());
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const sections = enumerateDocumentSections(part);
  const fp = resolveFootnoteProperties({ numFmt } as never, undefined);
  const ep = resolveEndnoteProperties(undefined, undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: sections.map(() => fp),
    endnotePropsBySection: sections.map(() => ep),
    documentFootnoteProps: fp,
    documentEndnoteProps: ep,
    measurer,
    producer: 'probe',
  };
  const options = {
    measurer,
    geometry: { width: 612, height: 300, margin: { top: 36, right: 36, bottom: 36, left: 36 } },
    ...(session ? { session } : {}),
    ...(cache ? { cache } : {}),
  };
  return layoutSemanticDocumentWithNotes(part, sections, options as never, notes, (opts) =>
    layoutSemanticDocument(part, 1, opts as never)
  );
}

const citations = (l: SemanticLayout) =>
  l.pages.flatMap((p) =>
    p.fragments.flatMap((f) =>
      f.kind === 'paragraph'
        ? f.lines.flatMap((line) =>
            line.spans
              .filter((s) => s.noteNav?.direction === 'to-note')
              .map((s) => ({
                text: s.text,
                w: Number(s.box.width.toFixed(2)),
                x: Number(s.box.x.toFixed(2)),
              }))
          )
        : []
    )
  );

describe('a renumbered note is measured, not just relettered', () => {
  test('a numFmt change reaches an incremental pass', () => {
    // `1` and `2` are one glyph each; `i` is one and `ii` is two. Reprojection rewrites the
    // display text on any pass, so the digits alone prove nothing — the width is what tells
    // a resumed page from a fresh one, and every span after the citation rides on it.
    const session = createLayoutSession();
    expect(citations(layWith('decimal', session))).toEqual([
      { text: '1', w: 5.45, x: 201.82 },
      { text: '2', w: 5.45, x: 201.82 },
    ]);
    const incremental = layWith('lowerRoman', session);
    expect(citations(incremental)).toEqual(citations(layWith('lowerRoman')));
    expect(citations(incremental)[1]).toEqual({ text: 'ii', w: 10.91, x: 201.82 });
  });

  test('a numFmt change reaches a warm break cache', () => {
    // The session is one of TWO caches keyed on this. The paragraph break cache holds the
    // measured line — citation width included — under a key built from `producer`, and a mark
    // is derived, so the paragraph's own subtree cannot move when its citation does.
    const cache = createParagraphLayoutCache();
    layWith('decimal', undefined, cache);
    expect(citations(layWith('lowerRoman', undefined, cache))).toEqual(
      citations(layWith('lowerRoman'))
    );
  });

  test('an unchanged document still resumes', () => {
    // The token has to be STABLE, not merely complete: it is rebuilt from a new map every
    // pass, so a token that varied with allocation would turn every keystroke into a full
    // pass and pay for this fix with the whole of incremental layout.
    const session = createLayoutSession();
    layWith('decimal', session);
    const before = session.stats.fullPasses;
    layWith('decimal', session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(session.stats.fullPasses).toBe(before);
  });
});

// `order` is the citation order in the body. The notes part keeps its notes in id order, as a
// new note is appended to it, so an earlier note's paragraph is unchanged by the insertion.
function notesDoc(order: readonly number[]): Uint8Array {
  const words = ['', 'One.', 'Two.', 'Three.'];
  const body = order
    .map(
      (id) =>
        `<w:p><w:r><w:t xml:space="preserve">Cites ${id}</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`
    )
    .join('');
  const notes = [...order]
    .sort((a, b) => a - b)
    .map(
      (id) =>
        `<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r>` +
        `<w:r><w:t xml:space="preserve"> ${words[id]}</w:t></w:r></w:p></w:footnote>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        `${notes}</w:footnotes>`
    ),
  });
}

function noteAreaText(
  order: readonly number[],
  pass: {
    readonly revision: number;
    readonly cache: ReturnType<typeof createParagraphLayoutCache>;
    readonly session?: ReturnType<typeof createLayoutSession>;
    readonly numFmt?: string;
  }
): string[] {
  const loaded = readOoxmlPackage(notesDoc(order));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fp = resolveFootnoteProperties({ numFmt: pass.numFmt ?? 'decimal' } as never, undefined);
  const ep = resolveEndnoteProperties(undefined, undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fp],
    endnotePropsBySection: [ep],
    documentFootnoteProps: fp,
    documentEndnoteProps: ep,
    measurer,
    producer: 'probe',
    cache: pass.cache,
  };
  const layout = layoutSemanticDocument(part, pass.revision, {
    measurer,
    producer: 'probe',
    notes,
    cache: pass.cache,
    ...(pass.session ? { session: pass.session } : {}),
  });
  return layout.pages.flatMap((page) =>
    (page.footnotes?.notes ?? []).map((note) =>
      note.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((line) => line.spans.map((s) => s.text)) : []
        )
        .join('')
    )
  );
}

describe("a note's own mark follows its renumbering", () => {
  // The `w:footnoteRef` at the head of a note paints the same derived mark as its citation,
  // and like the citation's paragraph, the note's paragraph does not change when the mark does.
  test('a note cited before another renumbers it on an incremental pass', () => {
    const cache = createParagraphLayoutCache();
    const session = createLayoutSession();
    expect(noteAreaText([1, 2], { revision: 1, cache, session })).toEqual(['1 One.', '2 Two.']);
    expect(noteAreaText([1, 3, 2], { revision: 2, cache, session })).toEqual([
      '1 One.',
      '2 Three.',
      '3 Two.',
    ]);
  });

  test('a numFmt change reaches the note area under a warm break cache', () => {
    const cache = createParagraphLayoutCache();
    noteAreaText([1, 2], { revision: 1, cache });
    expect(noteAreaText([1, 2], { revision: 1, cache, numFmt: 'lowerRoman' })).toEqual([
      'i One.',
      'ii Two.',
    ]);
  });

  test('unchanged marks still reuse the note paragraphs from the break cache', () => {
    const cache = createParagraphLayoutCache();
    noteAreaText([1, 2], { revision: 1, cache });
    const entries = cache.size;
    noteAreaText([1, 2], { revision: 1, cache });
    expect(cache.size).toBe(entries);
  });
});
