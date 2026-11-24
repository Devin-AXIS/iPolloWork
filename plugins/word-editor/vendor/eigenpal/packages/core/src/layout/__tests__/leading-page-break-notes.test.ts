// A leading page break's kept empty line takes no room from the footnotes on its page.

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

// A 290pt content box of 20pt lines.
const sect =
  '<w:sectPr><w:pgSz w:w="4000" w:h="6200"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const exact =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr>';
const line = (text: string, run = '') => `<w:p>${exact}<w:r><w:t>${text}</w:t>${run}</w:r></w:p>`;
const leading = `<w:p>${exact}<w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>`;

function layout(body: string) {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${sect}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:footnote>' +
        '</w:footnotes>'
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const props = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(6, 14);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [props],
    endnotePropsBySection: [endnoteProps],
    documentFootnoteProps: props,
    documentEndnoteProps: endnoteProps,
    measurer,
    producer: 'leading-page-break-notes-test',
  };
  return layoutSemanticDocument(part, 1, { measurer, notes, producer: notes.producer });
}

test('a footnote stays on the page of its reference above a kept break line', () => {
  const fill = Array.from({ length: 12 }, (_, index) => line(`line${index}`)).join('');
  const result = layout(fill + line('cited', '<w:footnoteReference w:id="1"/>') + leading);
  expect(result.pages).toHaveLength(2);
  const notesOn = result.pages.map((page) =>
    (page.footnotes?.notes ?? []).map((note) => `${note.noteId}${note.continuation ? '+' : ''}`)
  );
  expect(notesOn).toEqual([['1'], []]);
});
