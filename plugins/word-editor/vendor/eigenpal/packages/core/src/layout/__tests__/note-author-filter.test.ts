import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  budgetedNoteScanMemoStats,
  resolveNotesPart,
} from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { layoutSemanticDocument, type SemanticLayoutOptions } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { layoutSemanticDocumentWithNotes } from './notes-layout-drain.ts';
import { paragraphSectionIndexOf } from '../note-paragraph-section-index.ts';
import { noteReferenceVisible } from '../note-reference-visibility.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';
import { enumerateDocumentSections } from '../section-properties.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const reference = (kind: 'footnote' | 'endnote', id: number) =>
  `<w:r><w:${kind}Reference w:id="${id}"/></w:r>`;

function documentBytes(): Uint8Array {
  // More nodes than the former 20k attribution prefix, but no painted content or extra pages.
  const prefix = Array.from(
    { length: 20_010 },
    (_, index) => `<w:bookmarkStart w:id="${index}" w:name="b${index}"/>`
  ).join('');
  const body =
    `<w:p>${reference('footnote', 1)}</w:p>` +
    `<w:p><w:del w:id="2" w:author="Ada">${reference('footnote', 2)}</w:del></w:p>` +
    `<w:p><w:ins w:id="3" w:author="Ada">${reference('endnote', 3)}</w:ins></w:p>` +
    `<w:p><w:del w:id="4" w:author="Grace">${reference('footnote', 4)}</w:del></w:p>` +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:trPr><w:del w:id="5" w:author="Ada"/></w:trPr><w:tc><w:p>${reference(
      'endnote',
      5
    )}</w:p></w:tc></w:tr></w:tbl>` +
    `<w:p>${prefix}<w:del w:id="6" w:author="Ada">${reference('footnote', 6)}</w:del></w:p>`;
  const note = (kind: 'footnote' | 'endnote', id: number) => {
    const content =
      kind === 'footnote' && id === 1
        ? '<w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
          '<w:del w:id="7" w:author="Ada"><w:r><w:delText>GONE</w:delText></w:r></w:del>'
        : `<w:r><w:t>${kind} ${id}</w:t></w:r>`;
    return `<w:${kind} w:id="${id}"><w:p>${content}</w:p></w:${kind}>`;
  };
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="foot" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="end" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${[1, 2, 4, 6]
        .map((id) => note('footnote', id))
        .join('')}</w:footnotes>`
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">${[3, 5].map((id) => note('endnote', id)).join('')}</w:endnotes>`
    ),
  });
}

function fixture() {
  const loaded = readOoxmlPackage(documentBytes());
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const sections = enumerateDocumentSections(part);
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const cache = createParagraphLayoutCache();
  const layout = (hiddenAuthors: readonly string[] = ['Ada']): SemanticLayout => {
    const filter = revisionAuthorFilter(hiddenAuthors);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: sections.map(() => footnoteProps),
      endnotePropsBySection: sections.map(() => endnoteProps),
      documentFootnoteProps: footnoteProps,
      documentEndnoteProps: endnoteProps,
      measurer,
      cache,
      producer: 'note-author-filter',
      displayMode: 'all-markup',
      ...(filter ? { revisionAuthorFilter: filter } : {}),
    };
    const options: SemanticLayoutOptions = {
      measurer,
      cache,
      displayMode: 'all-markup',
      ...(filter ? { revisionAuthorFilter: filter } : {}),
    };
    return layoutSemanticDocumentWithNotes(part, sections, options, notes, (next) =>
      layoutSemanticDocument(part, 1, next)
    );
  };
  return { layout };
}

function footnoteText(layout: SemanticLayout): string {
  return layout.pages
    .flatMap((page) => page.footnotes?.notes ?? [])
    .flatMap((note) => note.fragments)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('');
}

describe('review author filtering of notes', () => {
  test('foreign row revision names and attributes do not hide note references', () => {
    const rowOf = (properties: string) => {
      const result = readOoxmlPackage(
        zipSync({
          '[Content_Types].xml': strToU8(
            `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
          ),
          '_rels/.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
          ),
          'word/document.xml': strToU8(
            `<w:document xmlns:w="${W}" xmlns:x="urn:foreign"><w:body><w:tbl><w:tr><w:trPr>${properties}</w:trPr><w:tc><w:p>${reference('footnote', 1)}</w:p></w:tc></w:tr></w:tbl></w:body></w:document>`
          ),
        })
      );
      if (!result.ok) throw new Error(result.reason);
      const body = result.package.parts
        .get(result.package.mainDocumentPart)!
        .root.children.find((child) => child.kind === 'body');
      if (!body || body.kind === 'textValue') throw new Error('no body');
      const table = body.children.find((child) => child.kind === 'table');
      const row = table?.children.find((child) => child.kind === 'tableRow');
      if (!row) throw new Error('no row');
      return row;
    };

    expect(noteReferenceVisible([rowOf('<x:del x:author="Ada"/>')], 'proposed')).toBe(true);
    expect(
      noteReferenceVisible(
        [rowOf('<w:del x:author="Ada" w:id="2" w:author="Grace"/>')],
        'all-markup',
        revisionAuthorFilter(['Ada'])
      )
    ).toBe(true);
  });

  test('projects wrapper and row references exactly after a long prefix and reuses the result', () => {
    const { layout } = fixture();
    const first = layout();
    const footnotes = first.pages.flatMap((page) => page.footnotes?.notes ?? []);
    const endnotes = first.pages.flatMap((page) => page.endnotes?.notes ?? []);
    expect([...new Set(footnotes.map((note) => note.noteId))]).toEqual([1, 4]);
    expect([...new Set(endnotes.map((note) => note.noteId))]).toEqual([3]);

    const before = budgetedNoteScanMemoStats.budgetFreeRootReuses;
    layout();
    expect(budgetedNoteScanMemoStats.budgetFreeRootReuses).toBeGreaterThan(before);
  });

  test('invalidates shared note paragraph breaks when reviewer visibility changes', () => {
    const { layout } = fixture();
    expect(footnoteText(layout([]))).toContain('keep GONE');
    expect(footnoteText(layout(['Ada']))).toContain('keep ');
    expect(footnoteText(layout(['Ada']))).not.toContain('GONE');
  });

  test('maps an absorbed paragraph reference to its later section', () => {
    const xml =
      `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>first</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:rPr><w:del w:id="7" w:author="Ada"/></w:rPr></w:pPr>' +
      `${reference('footnote', 7)}</w:p><w:p><w:r><w:t>survivor</w:t></w:r></w:p>` +
      '<w:sectPr/></w:body></w:document>';
    const parsed = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(xml),
      })
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const part = parsed.package.parts.get(parsed.package.mainDocumentPart)!;
    const paragraphs = part.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .filter((child) => child.kind === 'paragraph');
    const sections = enumerateDocumentSections(part, 'all-markup', revisionAuthorFilter(['Ada']));
    const index = paragraphSectionIndexOf(
      part,
      sections,
      'all-markup',
      revisionAuthorFilter(['Ada'])
    );
    expect(index.get(paragraphs[1]!.id)).toBe(1);
  });
});
