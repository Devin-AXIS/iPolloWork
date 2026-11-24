// REF fields inside footnote stories: live values from BODY bookmarks and numbering.
//
// A footnote citing "see Section 2" targets a body paragraph, so the note story must share
// the body's resolution context — and a renumbering edit that the note part cannot see (its
// own nodes survive by identity) must still repaint the note. That repaint hangs on two
// keys: the paragraph's resolved-value token in the note flow's break key, and the values
// token in the notes-pass fingerprint. The calibration gate applies unchanged: a footnote
// field goes live only after its computed value reproduced its authored cache once, and a
// field that never matched paints (and saves) that cache.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
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
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { SemanticLayout } from '../index.ts';
import { buildNumberingIndex } from '../numbering-index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function numberingIndexOf() {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}
const numberingIndex = numberingIndexOf();

const numbered = (inner: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>${inner}</w:p>`;
const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t xml:space="preserve">${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
const refField = (instr: string, cached: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function notesDoc(body: string, footnoteContent: string): Uint8Array {
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p>${footnoteContent}</w:p></w:footnote>`;
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

function openNotesDoc(bytes: Uint8Array): { part: OoxmlPart; notes: NotesLayoutInput } {
  const loaded = readOoxmlPackage(bytes);
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
    measurer: createFixedMeasurer(6, 14),
    producer: 'note-ref',
  };
  return { part, notes };
}

function footnoteTexts(layout: SemanticLayout): string[] {
  return layout.pages
    .flatMap((page) => page.footnotes?.notes ?? [])
    .flatMap((note) => note.fragments)
    .map((fragment) =>
      (fragment.kind === 'paragraph' ? fragment.lines : [])
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    );
}

/** Structural-sharing body edit: every surviving node kept BY IDENTITY, like a store commit. */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

const BODY =
  numbered('<w:r><w:t>gone soon</w:t></w:r>') +
  numbered(bookmarked('target', 'The section')) +
  '<w:p><w:r><w:t>cites</w:t><w:footnoteReference w:id="1"/></w:r></w:p>';

describe('REF fields in footnote stories', () => {
  test('a plain footnote REF with an empty cache paints the bookmarked body text', () => {
    // No result run at all — always calibration-eligible, so the live value paints.
    const { part, notes } = openNotesDoc(
      notesDoc(
        BODY,
        `<w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' REF target ', '')}`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      numberingIndex,
      notes,
      producer: 'note-ref',
    });
    expect(footnoteTexts(layout).join('|')).toContain('see The section');
  });

  test('a footnote REF that fails calibration paints its cached result', () => {
    // 'IX' cannot be reproduced from the target's numbering, so the field keeps its cache —
    // the note never renders worse than the saved file.
    const { part, notes } = openNotesDoc(
      notesDoc(
        BODY,
        `<w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' REF target \\r \\h ', 'IX')}`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      numberingIndex,
      notes,
      producer: 'note-ref',
    });
    const texts = footnoteTexts(layout);
    expect(texts.join('|')).toContain('see IX');
    expect(texts.join('|')).not.toContain('see 2');
  });

  test('a calibrated footnote REF tracks a renumbering body edit on a warm session', () => {
    // The cache ('2') reproduces the computed value, so the field calibrates LIVE on the
    // first pass; the verdict then sticks across the edit that makes the cache stale.
    const { part, notes } = openNotesDoc(
      notesDoc(
        BODY,
        `<w:r><w:t xml:space="preserve">see </w:t></w:r>${refField(' REF target \\r \\h ', '2')}`
      )
    );
    const options = {
      measurer: notes.measurer,
      numberingIndex,
      notes,
      producer: 'note-ref',
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(footnoteTexts(first).join('|')).toContain('see 2');

    // Remove the first numbered paragraph: the footnote part is untouched by identity, so
    // only the resolved-value keys can repaint the note. The notes pass had SETTLED its
    // reserve answer for the first part; the new part identity plus the refFields token in
    // the notes-input fingerprint must retire that answer rather than republish it.
    const after = withBlocks(part, (blocks) => blocks.filter((_, index) => index !== 0));
    const warm = layoutSemanticDocument(after, 2, options);
    const texts = footnoteTexts(warm);
    expect(texts.join('|')).toContain('see 1');
    expect(texts.join('|')).not.toContain('see 2');

    // And the settled path is live for the NEW state: a no-change pass reuses every page
    // (the settled reserve answer republishes) and still paints the repainted value — the
    // settled memo serves the fresh REF value, never the pre-edit one.
    const resettled = layoutSemanticDocument(after, 3, options);
    expect(footnoteTexts(resettled).join('|')).toContain('see 1');
    expect(options.session.stats.reusedPages).toBe(warm.pages.length);
  });
});
