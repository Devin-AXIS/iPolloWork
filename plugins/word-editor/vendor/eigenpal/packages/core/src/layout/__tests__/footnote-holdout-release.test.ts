// The footnote hold-out keeps only the reference's `w:keepNext` group off the previous
// page. Blocks ahead of that group return on their own, so a page before a reference page
// fills instead of freezing at whatever height an earlier reflow round left it.
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
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Letter page, 1 in margins, createFixedMeasurer(6, 14): one-line paragraphs of 12.73 pt,
// 50 of them to a 648 pt page.
const LINE_H = 14 * (10 / 11);

interface Probe {
  /** One-line body paragraphs. */
  readonly paragraphs: number;
  /** Paragraph index -> footnote id referenced at its end. */
  readonly refs: ReadonlyMap<number, number>;
  /** Footnote id -> characters of note text (85 per note line). */
  readonly notes: ReadonlyMap<number, number>;
  /** Paragraph indexes that carry `w:keepNext`. */
  readonly keepNext?: ReadonlySet<number>;
  readonly columns?: number;
  /** Text appended to paragraph 0 (an edit that moves nothing). */
  readonly edit?: string;
}

function probeDocx(probe: Probe): Uint8Array {
  const body = Array.from({ length: probe.paragraphs }, (_, i) => {
    const keep = probe.keepNext?.has(i) ? '<w:pPr><w:keepNext/></w:pPr>' : '';
    const ref = probe.refs.get(i);
    const text = `P${i}${i === 0 && probe.edit ? probe.edit : ''}`;
    const cite = ref === undefined ? '' : `<w:footnoteReference w:id="${ref}"/>`;
    return `<w:p>${keep}<w:r><w:t>${text}</w:t>${cite}</w:r></w:p>`;
  }).join('');
  const columns = probe.columns ? `<w:cols w:num="${probe.columns}" w:space="720"/>` : '';
  const notes = [...probe.notes]
    .map(
      ([id, chars]) =>
        `<w:footnote w:id="${id}"><w:p><w:r><w:t>${'n'.repeat(chars)}</w:t></w:r></w:p></w:footnote>`
    )
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>${columns}` +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        notes +
        '</w:footnotes>'
    ),
  });
}

function layoutProbe(
  probe: Probe,
  session = createLayoutSession(),
  revision = 1
): { layout: SemanticLayout; fixedPoint: boolean } {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(6, 14);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-holdout-release',
  };
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    notes,
    session,
    producer: 'footnote-holdout-release',
  });
  // The published reserves must reproduce themselves: recomputing them from the layout
  // they produced gives the same map, and the body already leaves them room.
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

/** `first-last[notes]` per page; `c` marks a note continuation or a two-column page. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const paragraphs = page.fragments.flatMap((f) => (f.kind === 'paragraph' ? [f] : []));
    const index = (id: string | undefined) => id?.split('.').pop() ?? '-';
    const columns = new Set(paragraphs.map((f) => Math.round(f.box.x))).size > 1 ? 'c' : '';
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${index(paragraphs[0]?.paragraphId)}-${index(paragraphs.at(-1)?.paragraphId)}${columns}[${notes.join(',')}]`;
  });
}

function bodyBottom(page: PageRecord): number {
  const last = page.fragments.at(-1);
  return last ? last.box.y + last.box.height : 0;
}

describe('footnote hold-out behind independent paragraphs', () => {
  // Page 1's reserve pushes page 1's tail onto page 2 in the second round. Page 2's own
  // reference (P90) no longer fits there and opens page 3 behind six paragraphs that do
  // not keep with it. Those paragraphs return to page 2; only the reference stays out.
  const probe: Probe = {
    paragraphs: 150,
    refs: new Map([
      [5, 1],
      [90, 2],
    ]),
    notes: new Map([
      [1, 900],
      [2, 200],
    ]),
  };

  test('paragraphs ahead of the reference return to the previous page', () => {
    const { layout, fixedPoint } = layoutProbe(probe);
    expect(pages(layout)).toEqual(['0-37[1]', '38-87[]', '88-133[2]', '134-149[]']);
    const page = layout.pages[1]!;
    expect(page.contentBox.height - bodyBottom(page)).toBeLessThan(LINE_H);
    expect(fixedPoint).toBe(true);
  });

  test('a warm pass after an edit matches a clean layout', () => {
    const session = createLayoutSession();
    layoutProbe(probe, session, 1);
    const edited = { ...probe, edit: 'x' };
    const warm = layoutProbe(edited, session, 2);
    const clean = layoutProbe(edited);
    expect(pages(warm.layout)).toEqual(pages(clean.layout));
    expect(warm.fixedPoint).toBe(true);
  });

  test('a keep-with-next chain returns together above a legal note split', () => {
    // P78-P79 keep with P80. All three return together when the note can start below them.
    const chained: Probe = {
      paragraphs: 150,
      refs: new Map([
        [5, 1],
        [80, 2],
      ]),
      notes: new Map([
        [1, 300],
        [2, 1200],
      ]),
      keepNext: new Set([78, 79]),
    };
    const { layout, fixedPoint } = layoutProbe(chained);
    expect(pages(layout)).toEqual(['0-44[1]', '45-80[2]', '81-127[2c]', '128-149[]']);
    expect(fixedPoint).toBe(true);
  });

  test('two-column pages keep the hold', () => {
    // Returning lines may change column, which the release cannot predict.
    const columns: Probe = {
      paragraphs: 150,
      refs: new Map([
        [5, 1],
        [80, 2],
      ]),
      notes: new Map([
        [1, 300],
        [2, 600],
      ]),
      columns: 2,
    };
    const { layout, fixedPoint } = layoutProbe(columns);
    expect(pages(layout)).toEqual(['0-73c[1]', '74-149c[2]']);
    expect(fixedPoint).toBe(true);
  });
});

test('notes in a kept reference opening settle equally after note growth', () => {
  const before: Probe = {
    paragraphs: 100,
    refs: new Map([
      [5, 1],
      [65, 2],
      [66, 3],
      [67, 4],
    ]),
    notes: new Map([
      [1, 300],
      [2, 250],
      [3, 600],
      [4, 250],
    ]),
    keepNext: new Set([65, 66]),
  };
  const after = { ...before, notes: new Map(before.notes).set(2, 700) };
  const session = createLayoutSession();
  layoutProbe(before, session, 1);
  const warm = layoutProbe(after, session, 2);
  const cold = layoutProbe(after);
  expect(pages(warm.layout)).toEqual(pages(cold.layout));
  expect(warm.fixedPoint).toBe(true);
  expect(cold.fixedPoint).toBe(true);
  for (const [paragraph, noteId] of after.refs) {
    const referencePage = warm.layout.pages.findIndex((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'paragraph' && fragment.paragraphId.endsWith(`.${paragraph}`)
      )
    );
    const openingPage = warm.layout.pages.findIndex((page) =>
      page.footnotes?.notes.some((note) => note.noteId === noteId && !note.continuation)
    );
    expect(openingPage).toBe(referencePage);
  }
});
