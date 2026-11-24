// An empty section mark that ends a page past the room above its footnote area stays on the page
// without taking room from the footnotes.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const SECT =
  '<w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>';
const exact = (twips: number, text: string, extra = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips}" w:lineRule="exact"/>` +
  `</w:pPr><w:r><w:t>${text}</w:t>${extra}</w:r></w:p>`;

/** One page of body text above a footnote, a filler of `fillTwips`, then an empty section mark. */
function layout(fillTwips: number) {
  const body =
    exact(280, 'Body', '<w:footnoteReference w:id="1"/>') +
    exact(fillTwips, 'Fill') +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="120"/><w:sectPr>${SECT}</w:sectPr></w:pPr></w:p>` +
    exact(280, 'Next') +
    `<w:sectPr>${SECT}</w:sectPr>`;
  const note = Array.from({ length: 3 }, (_, i) => exact(280, `Note${i}`)).join('');
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1">${note}</w:footnote></w:footnotes>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
  const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [documentFootnoteProps, documentFootnoteProps],
    endnotePropsBySection: [documentEndnoteProps, documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer,
    producer: 'section-mark-note-area',
  };
  return layoutSemanticDocument(part, 1, { measurer, notes, producer: 'section-mark-note-area' });
}

test('an empty section mark past the room above the footnotes takes none of it', () => {
  // The mark's line starts above the footnote area and ends inside it. It stays on the page and
  // out of the flow, so the three-line footnote stays whole and the next section starts page 2.
  const result = layout(4200);
  expect(result.pages.length).toBe(2);
  const [first] = result.pages;
  const mark = first!.fragments.at(-1)!;
  expect(mark.kind).toBe('paragraph');
  expect((mark as { outOfFlow?: boolean }).outOfFlow).toBe(true);
  const notes = first!.footnotes?.notes ?? [];
  expect(notes.map((note) => [note.box.height, note.continuation ?? false])).toEqual([[42, false]]);
  expect(result.pages[1]!.footnotes).toBeUndefined();
});

test('an empty section mark that fits above the footnotes stays in the flow', () => {
  const [first] = layout(4000).pages;
  expect((first!.fragments.at(-1) as { outOfFlow?: boolean }).outOfFlow).toBeUndefined();
});
