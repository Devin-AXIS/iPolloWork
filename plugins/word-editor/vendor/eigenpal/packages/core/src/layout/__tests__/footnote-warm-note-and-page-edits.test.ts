// A warm footnote pass after an edit to a note, or to the page size, matches a fresh pass.
//
// The reserve search keeps the previous walk's decisions for the pages an edit did not move.
// A note edit changes the reserve of the page that cites the note, also when the citation is
// in a table cell; a page size edit changes every page's note area limit.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import type { OoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const EXACT = '<w:pPr><w:spacing w:line="240" w:lineRule="exact" w:after="0"/></w:pPr>';
const measurer = createFixedMeasurer(5, 12);

function paragraph(text: string, ref = ''): string {
  return `<w:p>${EXACT}<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${ref}</w:p>`;
}

function documentBytes(body: string, noteText: string, pageHeightTwips: number): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>` +
        `<w:pgSz w:w="4000" w:h="${pageHeightTwips}"/>` +
        '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${paragraph(noteText)}</w:footnote></w:footnotes>`
    ),
  });
}

function load(bytes: Uint8Array): { part: OoxmlPart; footnotesPart: OoxmlPart | null } {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return {
    part: loaded.package.parts.get(loaded.package.mainDocumentPart)!,
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
  };
}

function lay(
  part: OoxmlPart,
  footnotesPart: OoxmlPart | null,
  mode: number,
  revision: number,
  session?: LayoutSession,
  displayMode?: RevisionDisplayMode
): SemanticLayout {
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  return layoutSemanticDocument(part, revision, {
    measurer,
    notes: {
      footnotesPart,
      endnotesPart: null,
      footnotePropsBySection: [footnoteProps],
      endnotePropsBySection: [endnoteProps],
      documentFootnoteProps: footnoteProps,
      documentEndnoteProps: endnoteProps,
      measurer,
      producer: 'footnote-warm-note-and-page-edits',
    },
    ...(session ? { session } : {}),
    producer: 'footnote-warm-note-and-page-edits',
    compatibilityMode: mode,
    ...(displayMode ? { displayMode } : {}),
  });
}

const REF = '<w:r><w:footnoteReference w:id="1"/></w:r>';
const fillers = (count: number) =>
  Array.from({ length: count }, (_, i) => paragraph(`Filler paragraph ${i}`)).join('');

describe('a warm footnote pass matches a fresh one', () => {
  for (const mode of [15, 14]) {
    test(`after a note that a table cell cites grows, mode ${mode}`, () => {
      const table =
        '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
        `${paragraph('Cited in a cell', REF)}</w:tc></w:tr></w:tbl>`;
      const body = table + fillers(100);
      const before = load(documentBytes(body, 'Short note.', 6000));
      const after = load(documentBytes(body, `Short note. ${'n'.repeat(400)}`, 6000));
      const session = createLayoutSession();
      lay(before.part, before.footnotesPart, mode, 1, session);
      // The same body part, so only the note changed.
      const warm = lay(before.part, after.footnotesPart, mode, 2, session);
      const freshSession = createLayoutSession();
      const fresh = lay(before.part, after.footnotesPart, mode, 2, freshSession);
      expect(JSON.stringify(warm.pages)).toBe(JSON.stringify(fresh.pages));
      expect([...session.notePageBottomReserves!]).toEqual([
        ...freshSession.notePageBottomReserves!,
      ]);
    });

    test(`after a note grows that a joined paragraph cites, mode ${mode}`, () => {
      // A deleted paragraph mark joins the citing paragraph to the next one in the proposed
      // view; the joined fragment is named after the next paragraph.
      const joined =
        '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact" w:after="0"/><w:rPr>' +
        '<w:del w:id="9" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        `<w:r><w:t xml:space="preserve">Cites a note </w:t></w:r>${REF}</w:p>`;
      const body = joined + fillers(100);
      const before = load(documentBytes(body, 'Short note.', 6000));
      const after = load(documentBytes(body, `Short note. ${'n'.repeat(400)}`, 6000));
      const session = createLayoutSession();
      lay(before.part, before.footnotesPart, mode, 1, session, 'proposed');
      const warm = lay(before.part, after.footnotesPart, mode, 2, session, 'proposed');
      const freshSession = createLayoutSession();
      const fresh = lay(before.part, after.footnotesPart, mode, 2, freshSession, 'proposed');
      expect(JSON.stringify(warm.pages)).toBe(JSON.stringify(fresh.pages));
      expect([...session.notePageBottomReserves!]).toEqual([
        ...freshSession.notePageBottomReserves!,
      ]);
    });

    test(`after the page grows taller, mode ${mode}`, () => {
      // The note area limit comes from the page height, so the first page's reserve changes
      // also when its body does not. The next pass starts from the kept reserves.
      const body = paragraph('Cites a long note', REF);
      const note = 'n'.repeat(1600);
      const before = load(documentBytes(body, note, 6000));
      const after = load(documentBytes(body, note, 9000));
      const session = createLayoutSession();
      lay(before.part, before.footnotesPart, mode, 1, session);
      const warm = lay(after.part, before.footnotesPart, mode, 2, session);
      const freshSession = createLayoutSession();
      const fresh = lay(after.part, before.footnotesPart, mode, 2, freshSession);
      expect(JSON.stringify(warm.pages)).toBe(JSON.stringify(fresh.pages));
      expect([...session.notePageBottomReserves!]).toEqual([
        ...freshSession.notePageBottomReserves!,
      ]);
    });
  }
});
