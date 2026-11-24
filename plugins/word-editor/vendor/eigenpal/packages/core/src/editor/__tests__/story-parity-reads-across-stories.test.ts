// Two document-wide reads that answered about the body alone, and one that answered about a
// story the reader had deleted.
//
// A bookmark in a header is a bookmark in the document: an internal hyperlink that names it has
// to reach it, and navigating to one has to land there. Reading the body alone said neither
// existed. Keying the answer on the BODY revision compounded it — a bookmark added in a header
// never invalidated the cache either.
//
// The anchor index runs the other way. A deleted story's store is kept so undo and redo hold
// its identity, but its part is gone from the package — and indexing it left a removed header's
// paragraphs addressable by paraId, so an anchor into a story that is not there still resolved.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const HEADER_R_ID = 'rId10';
const BODY_MARK = 'BodyMark';
const HEADER_MARK = 'HeaderMark';
const NOTE_MARK = 'NoteMark';

/** A `w:bookmarkStart`/`End` pair around one run. */
function bookmarked(name: string, text: string, id: string): string {
  return (
    `<w:p><w:bookmarkStart w:id="${id}" w:name="${name}"/>` +
    `<w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="${id}"/></w:p>`
  );
}

function docx(): Uint8Array {
  const override = (name: string, type: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${type}+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml', 'header') +
        override('footnotes.xml', 'footnotes') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">${bookmarked(HEADER_MARK, 'In the header', '2')}</w:hdr>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p>' +
        '</w:footnote>' +
        `<w:footnote w:id="1">${bookmarked(NOTE_MARK, 'In the note', '3')}</w:footnote>` +
        '</w:footnotes>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        bookmarked(BODY_MARK, 'In the body', '1') +
        '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('bookmarks cover every story', () => {
  test('a header and a note bookmark are both in the index', () => {
    const editor = mount();
    const names = [...editor.surface!.session.bookmarks().keys()];
    expect(names).toContain(BODY_MARK);
    expect(names, 'the header bookmark is missing').toContain(HEADER_MARK);
    expect(names, 'the note bookmark is missing').toContain(NOTE_MARK);
  });

  test('each bookmark points into the story that declares it', () => {
    const editor = mount();
    const marks = editor.surface!.session.bookmarks();
    // The anchor has to name a paragraph in the DECLARING part, or navigating to it lands
    // somewhere else entirely.
    expect(marks.get(BODY_MARK)?.paragraphId).toStartWith('/word/document.xml#');
    expect(marks.get(HEADER_MARK)?.paragraphId).toStartWith('/word/header1.xml#');
    expect(marks.get(NOTE_MARK)?.paragraphId).toStartWith('/word/footnotes.xml#');
  });

  test('a bookmark added in a header invalidates the cache', () => {
    const editor = mount();
    const surface = editor.surface!;
    const before = surface.session.bookmarks();
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    surface.type('X');

    // Keyed on the BODY revision, a header edit moved nothing the cache watched, so it kept
    // answering for the document as it was.
    expect(surface.session.bookmarks(), 'the cache was not invalidated').not.toBe(before);
  });
});

describe('jumping to a bookmark enters the story it is in', () => {
  for (const [name, part, scope] of [
    ['BodyMark', '/word/document.xml', { kind: 'body' }],
    ['HeaderMark', '/word/header1.xml', { kind: 'headerFooter', rId: HEADER_R_ID }],
    ['NoteMark', '/word/footnotes.xml', { kind: 'note', id: 'footnote:1' }],
  ] as const) {
    test(`${name}: the caret lands there and a keystroke follows it`, () => {
      const editor = mount();
      const surface = editor.surface!;
      expect(surface.navigation.goToBookmark(name), 'the jump was refused').toBe(true);
      expect(surface.state().selection.head.paragraphId).toStartWith(`${part}#`);

      // Widening the bookmark index without this made the jump SUCCEED into a story the
      // scope had not opened: `activeScope` said body, the caret sat on a paragraph the body
      // store has never heard of, and every keystroke after it was refused with nothing said.
      expect(surface.activeScope(), 'the scope did not follow the caret').toEqual(scope);
      const before = surface.session.packageRevision();
      surface.type('Z');
      expect(surface.session.packageRevision(), 'the keystroke vanished').not.toBe(before);
    });
  }
});

describe('a deleted story stops being addressable', () => {
  test('its paragraphs leave the anchor index', () => {
    const editor = mount();
    const surface = editor.surface!;
    // Open it first: only an OPEN story's store is kept after deletion, which is the state
    // that leaked. A store nobody opened is simply gone with its part.
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const headerParagraphs = () =>
      [...surface.session.paragraphAnchors().paraIdByNode.keys()].filter((id) =>
        id.startsWith('/word/header1.xml#')
      );
    expect(headerParagraphs().length, 'the header was never indexed').toBeGreaterThan(0);

    surface.exitHeaderFooter();
    const removed = surface.applyHeaderFooterLifecycle?.({
      op: 'deleteHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(removed?.ok, 'the fixture could not delete its header').toBe(true);

    // The store stays parked so undo keeps its identity, but the part is out of the package —
    // and an anchor into a story the reader removed must not still resolve.
    expect(headerParagraphs(), 'a deleted header is still addressable').toEqual([]);
  });
});
