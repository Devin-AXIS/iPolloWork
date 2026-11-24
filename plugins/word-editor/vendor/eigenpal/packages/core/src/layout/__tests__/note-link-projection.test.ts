// Note-story link projection.
//
// Note stories run the same paragraph walk as the body, so they must receive the same
// projector seams: a `w:hyperlink` or a HYPERLINK field in a footnote used to paint as
// plain text with no link record — measured, but dead to paint and navigation. The seams
// are inherited from the body's layout options at the semantic-layout notes seam.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function linkedNotesDoc(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/>` +
    `<w:footnoteReference w:id="2"/></w:r></w:p>`;
  const hyperlinkField =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText> HYPERLINK "https://example.com" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>example</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p>` +
    `<w:hyperlink w:anchor="top"><w:r><w:t>Jump</w:t></w:r></w:hyperlink>` +
    `</w:p></w:footnote>` +
    `<w:footnote w:id="2"><w:p>${hyperlinkField}</w:p></w:footnote>`;
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

describe('note-story link projection', () => {
  test('w:hyperlink and HYPERLINK fields in footnotes carry span link records', () => {
    const loaded = readOoxmlPackage(linkedNotesDoc());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const settings = settingsPartOf(loaded.package);
    const documentFootnoteProps = resolveFootnoteProperties(
      undefined,
      authoredDocumentFootnoteProperties(settings)
    );
    const documentEndnoteProps = resolveEndnoteProperties(
      undefined,
      authoredDocumentEndnoteProperties(settings)
    );
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-link',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-link',
      // The BODY's seams; the notes input above declares none, so these must be inherited.
      projectLink: (node) =>
        node.kind === 'textValue'
          ? null
          : { id: `typed:${node.id}`, kind: 'internal', href: '#top', anchor: 'top' },
      projectFieldLink: (spec) =>
        spec.target ? { id: `field:${spec.target}`, kind: 'external', href: spec.target } : null,
    });

    const noteSpans = layout.pages
      .flatMap((page) => page.footnotes?.notes ?? [])
      .flatMap((note) => note.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.spans);
    expect(noteSpans.length).toBeGreaterThan(0);

    const typedLinked = noteSpans.find((span) => span.text === 'Jump');
    expect(typedLinked?.link).toMatchObject({ kind: 'internal', anchor: 'top' });

    const fieldLinked = noteSpans.find((span) => span.text === 'example');
    expect(fieldLinked?.link).toMatchObject({
      id: 'field:https://example.com',
      kind: 'external',
      href: 'https://example.com',
    });
  });

  test('a per-part projector wins over the inherited body projector for note stories', () => {
    const loaded = readOoxmlPackage(linkedNotesDoc());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const settings = settingsPartOf(loaded.package);
    const documentFootnoteProps = resolveFootnoteProperties(
      undefined,
      authoredDocumentFootnoteProperties(settings)
    );
    const documentEndnoteProps = resolveEndnoteProperties(
      undefined,
      authoredDocumentEndnoteProperties(settings)
    );
    const askedParts: string[] = [];
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-link-scoped',
      // The r:id of a link in a note declares itself in THAT part's relationships, so the
      // per-part projector must win over the body's inherited one.
      projectLinkForPart: (ownerPartName) => {
        askedParts.push(ownerPartName);
        return (node) =>
          node.kind === 'textValue'
            ? null
            : { id: `scoped:${node.id}`, kind: 'external', href: 'https://note.example/' };
      },
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-link-scoped',
      projectLink: (node) =>
        node.kind === 'textValue'
          ? null
          : { id: `body:${node.id}`, kind: 'external', href: 'https://body.example/' },
    });

    const noteSpans = layout.pages
      .flatMap((page) => page.footnotes?.notes ?? [])
      .flatMap((note) => note.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.spans);
    const typedLinked = noteSpans.find((span) => span.text === 'Jump');
    expect(typedLinked?.link).toMatchObject({ kind: 'external', href: 'https://note.example/' });
    expect(askedParts).toContain(notes.footnotesPart!.name);
  });
});
