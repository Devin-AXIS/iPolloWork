// `w:pgBorders` on sheets the NOTES pass mints.
//
// A footnote-drain sheet is cloned from a page the body pass produced. The frame is a question
// about the NEW sheet's place in its section (`w:display`), not about the template's: a
// template that is the section's first page carries no `notFirstPage` frame, and every sheet
// minted after it must still draw one.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

/** One short body page whose single footnote drains onto sheets the notes pass mints. */
function layoutWithDrain(display: 'allPages' | 'firstPage' | 'notFirstPage'): SemanticLayout {
  const noteParas = Array.from(
    { length: 60 },
    (_, i) => `<w:p><w:r><w:t>Footnote drain ${i} ${'x'.repeat(60)}</w:t></w:r></w:p>`
  ).join('');
  const bytes = zipSync({
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
        `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
        `<w:sectPr>` +
        `<w:pgSz w:w="12240" w:h="7200"/>` +
        `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>` +
        `<w:pgBorders w:display="${display}" w:offsetFrom="page">` +
        `<w:top w:val="single" w:sz="8" w:space="24" w:color="C00000"/>` +
        `</w:pgBorders>` +
        `</w:sectPr>` +
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
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
  const documentEndnoteProps = resolveEndnoteProperties(undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [documentFootnoteProps],
    endnotePropsBySection: [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer,
    producer: 'probe',
  };
  return layoutSemanticDocument(part, 1, { measurer, notes, producer: 'probe' });
}

describe('page borders on note-overflow sheets', () => {
  test("notFirstPage: the drain sheets after the section's first page draw the frame", () => {
    const layout = layoutWithDrain('notFirstPage');
    const [first, ...rest] = layout.pages;
    // The fixture really exercises the drain: a body page, then minted sheets.
    expect(first!.noteStream).toBeUndefined();
    const drain = rest.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);

    // Page 0 is the section's first page, so it has no frame. That is the template the drain
    // sheets are cloned from — and exactly why they must not copy its (absent) frame.
    expect(first!.pageBorders).toBeUndefined();
    for (const page of drain) {
      expect(page.pageBorders?.display).toBe('notFirstPage');
      expect(page.pageBorders?.strokes.map((stroke) => stroke.side)).toEqual(['top']);
      expect(page.pageBorders?.strokes[0]!.edge.color).toBe('C00000');
    }
  });

  test("firstPage: only the section's first page draws it, never a drain sheet", () => {
    const layout = layoutWithDrain('firstPage');
    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);
    expect(layout.pages[0]!.pageBorders?.display).toBe('firstPage');
    for (const page of drain) expect(page.pageBorders).toBeUndefined();
  });

  test('allPages: every sheet, body or minted, draws it', () => {
    const layout = layoutWithDrain('allPages');
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) expect(page.pageBorders?.display).toBe('allPages');
  });
});
