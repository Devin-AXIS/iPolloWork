// The footnote search as steps: progress pages carry their note areas, and a wrap-up ends the
// search after its current round with a layout that matches the reserves it used.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import type { LayoutProgress, LayoutSteps } from '../layout-steps.ts';
import {
  attachNotesToLayout,
  buildPageRefHits,
  layoutSemanticDocumentWithNotesSteps,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { collectBodyNoteReferences } from '../note-reference-visibility.ts';
import { enumerateDocumentSections } from '../section-properties.ts';
import type { PageRecord, ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function oneReferenceDocument(): Uint8Array {
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
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'line '.repeat(12)}</w:t></w:r></w:p></w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function load() {
  const loaded = readOoxmlPackage(oneReferenceDocument());
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [footnoteProps],
    endnotePropsBySection: [endnoteProps],
    documentFootnoteProps: footnoteProps,
    documentEndnoteProps: endnoteProps,
    measurer: createFixedMeasurer(),
    producer: 'note-search-steps',
  };
  return { part, notes, sections: enumerateDocumentSections(part) };
}

function fragment(paragraphId: string, atomEnd: number, height: number): ParagraphFragmentRecord {
  const lineHeight = Math.min(14, height);
  return {
    kind: 'paragraph',
    id: `${paragraphId}-frag`,
    paragraphId,
    fragmentIndex: 0,
    box: { x: 0, y: 0, width: 400, height },
    range: { start: 0, end: atomEnd },
    props: [],
    spacing: { before: 0, after: 0, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: [
      {
        id: `${paragraphId}-line-0`,
        range: { paragraphId, start: 0, end: atomEnd },
        spans: [],
        box: { x: 0, y: 0, width: 400, height: lineHeight },
        contentX: 0,
        baseline: lineHeight * 0.8,
        leading: 0,
      },
    ],
  };
}

const CONTENT_HEIGHT = 400;

function page(index: number, fragments: readonly ParagraphFragmentRecord[]): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: CONTENT_HEIGHT + 144 },
    contentBox: { x: 72, y: 72, width: 468, height: CONTENT_HEIGHT },
    fragments,
  };
}

/**
 * A body whose reference sits on page 1 while an earlier pass left a reserve on page 0. The
 * search keeps no reserve without its own record, so the stale one never reaches a round.
 * Each run reports its pages once.
 */
function staleSeedScenario() {
  const { part, notes, sections } = load();
  const ref = collectNoteReferences(part)[0]!;
  const runs: Array<ReadonlyMap<number, number>> = [];
  const session = {
    previous: null as SemanticLayout | null,
    multi: null as unknown,
    notes: null as unknown,
    notePageBottomReserves: new Map([[0, 80]]) as ReadonlyMap<number, number> | null,
  };
  function* runBodySteps(opts: {
    pageBottomReserves?: ReadonlyMap<number, number>;
  }): LayoutSteps<SemanticLayout> {
    const reserves = opts.pageBottomReserves ?? new Map<number, number>();
    runs.push(new Map(reserves));
    const filler = fragment('filler', 4, Math.max(14, CONTENT_HEIGHT - (reserves.get(0) ?? 0) - 1));
    const pages = [page(0, [filler]), page(1, [fragment(ref.paragraphId, ref.atomOffset + 1, 14)])];
    yield { pages, finalize: (published) => ({ revision: 1, pages: published }) };
    return { revision: 1, pages };
  }
  const steps = layoutSemanticDocumentWithNotesSteps(
    part,
    sections,
    { session, measurer: notes.measurer, producer: 'note-search-steps' },
    notes,
    runBodySteps
  );
  return { steps, runs, session };
}

describe('footnote search as steps', () => {
  test('progress shows decided pages only, with their note areas, and can be put back', () => {
    const { steps } = staleSeedScenario();
    const shown: number[] = [];
    let next = steps.next();
    for (; !next.done; next = steps.next()) {
      const progress = next.value as LayoutProgress | undefined;
      if (!progress) continue;
      expect(progress.restorable).not.toBe(false);
      expect(typeof progress.wrapUp).toBe('function');
      shown.push(progress.finalize!(progress.pages).pages.length);
    }
    // The first round decides no page yet, and no round shows a page it has not decided.
    expect(shown[0]).toBe(0);
    expect(shown.every((count, i) => count <= 1 && count >= (shown[i - 1] ?? 0))).toBe(true);
    const notePages = next.value.pages.filter((p) => (p.footnotes?.notes ?? []).length > 0);
    expect(notePages.map((p) => p.index)).toEqual([1]);
  });

  test('without a wrap-up the search drops the stale reserve', () => {
    const { steps, runs, session } = staleSeedScenario();
    for (let next = steps.next(); !next.done; next = steps.next());
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.some((reserves) => reserves.has(0))).toBe(false);
    expect(session.notePageBottomReserves!.has(0)).toBe(false);
    expect(session.notePageBottomReserves!.get(1) ?? 0).toBeGreaterThan(0);
  });

  test('a wrap-up ends the search after the current round, on the reserves it used', () => {
    const { steps, runs, session } = staleSeedScenario();
    const first = steps.next().value as LayoutProgress;
    first.wrapUp!();
    let next = steps.next();
    while (!next.done) next = steps.next();
    expect(runs.length).toBe(1);
    // The published layout was laid under the first round's reserves, so the next pass gets
    // those.
    expect([...(session.notePageBottomReserves ?? new Map())]).toEqual([...runs[0]!]);
    expect(next.value.pages.length).toBe(2);
  });
});

test('a partial attach shows page-bottom notes only and leaves end-collected notes to the end', () => {
  const { part, notes } = load();
  const ref = collectNoteReferences(part)[0]!;
  const docEnd: NotesLayoutInput = {
    ...notes,
    footnotePropsBySection: [{ ...notes.footnotePropsBySection[0]!, pos: 'docEnd' }],
    documentFootnoteProps: { ...notes.documentFootnoteProps, pos: 'docEnd' },
  };
  const layout = {
    revision: 1,
    pages: [
      page(0, [fragment(ref.paragraphId, ref.atomOffset + 1, 14)]),
      page(1, [fragment('tail', 4, 14)]),
    ],
  };
  const hits = buildPageRefHits(collectBodyNoteReferences(part, 'all-markup'), new Map());
  const notesOn = (result: SemanticLayout) =>
    result.pages.flatMap((p) => [...(p.footnotes?.notes ?? []), ...(p.endnotes?.notes ?? [])]);
  expect(notesOn(attachNotesToLayout(layout, hits, docEnd).layout).length).toBeGreaterThan(0);
  expect(notesOn(attachNotesToLayout(layout, hits, docEnd, { partial: true }).layout)).toEqual([]);
});
