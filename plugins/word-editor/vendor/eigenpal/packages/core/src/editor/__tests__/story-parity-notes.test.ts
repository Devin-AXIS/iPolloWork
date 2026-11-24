// A note story stays reachable whatever it holds.
//
// Found while building the parity fixture: giving every story an identical probe story made the
// footnote and endnote disappear. `validKnownKind` spelled out the note's child rule instead of
// reusing the body's, and the copy admitted only `generic` where the body admits every preserved
// child. So a block `w:sdt` — or a bookmark, a hyperlink, a range marker — demoted the NOTE, and
// a demoted note is not a note: it leaves `notesOf`, its paragraphs leave `paragraphIdsIn`, and
// `enterNote` refuses with no reason, because nothing believes a note is there to enter.
//
// All of those are ordinary Word markup inside a footnote, so this was a note that could not be
// read or edited at all. Each is pinned below, because the rule they share is one predicate and
// a future edit to it would take them all together.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const BLOCK_SDT =
  `<w:sdt><w:sdtPr><w:alias w:val="Pick"/><w:tag w:val="Pick"/><w:text/></w:sdtPr>` +
  `<w:sdtContent><w:p><w:r><w:t>Control</w:t></w:r></w:p></w:sdtContent></w:sdt>`;

const NOTE_PARAGRAPH = '<w:p><w:r><w:t>Note</w:t></w:r></w:p>';

/** One footnote holding exactly `inner`, referenced from the body. */
function docx(inner: string, noteType = ''): Uint8Array {
  const body =
    `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0">` +
    `<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"${noteType}>${inner}</w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

function mount(inner: string, noteType = ''): { surface: PaginatedSurface; destroy: () => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(inner, noteType), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return {
    surface: result.surface,
    destroy: () => {
      result.surface.destroy();
      container.remove();
    },
  };
}

/** Paragraphs the footnote part publishes, minus the two separator paragraphs. */
function noteParagraphCount(surface: PaginatedSurface): number {
  // No subtraction. This used to drop two for the `w:separator` and `w:continuationSeparator`
  // notes, which the story walk counted as content — they are the rules drawn above a note
  // area, hold no editable text, and are excluded now.
  return surface.session.paragraphIdsIn({ kind: 'notesPart', noteKind: 'footnote' }).length;
}

const BOOKMARK = '<w:bookmarkStart w:id="1" w:name="mark"/><w:bookmarkEnd w:id="1"/>';

describe('a note story is reachable whatever it holds', () => {
  for (const [what, inner, paragraphs] of [
    ['paragraphs', NOTE_PARAGRAPH, 1],
    ['a block content control', `${NOTE_PARAGRAPH}${BLOCK_SDT}`, 2],
    ['a bookmark', `${BOOKMARK}${NOTE_PARAGRAPH}`, 1],
  ] as const) {
    test(`a footnote holding ${what} is reachable`, () => {
      const { surface, destroy } = mount(inner);
      try {
        expect(noteParagraphCount(surface)).toBe(paragraphs);
        expect(surface.enterNote('footnote:1')).toBe(true);
      } finally {
        destroy();
      }
    });
  }
});

describe('a note type decides whether it is a story', () => {
  for (const [what, type, reachable] of [
    ['no type at all', '', true],
    ['an explicit normal', ' w:type="normal"', true],
    ['a separator', ' w:type="separator"', false],
    ['a continuation separator', ' w:type="continuationSeparator"', false],
    ['a continuation notice', ' w:type="continuationNotice"', false],
    // An unrecognized type fails the typed-node check, so the element demotes to `generic` and
    // is not a note at all. Not editable, and not a way to hide anything: the text round-trips
    // untouched, which the assertion below checks rather than assuming.
    ['a garbage type', ' w:type="zzz-not-a-type"', false],
  ] as const) {
    test(`${what}: reachable = ${String(reachable)}`, async () => {
      const { surface, destroy } = mount(NOTE_PARAGRAPH, type);
      try {
        const ids = surface.session.paragraphIdsIn({ kind: 'notesPart', noteKind: 'footnote' });
        expect(ids.length > 0, `expected reachable = ${String(reachable)}`).toBe(reachable);

        // Unreachable is not the same as lost. Whatever the type says, the note's text and the
        // type itself survive a save — an element the engine will not let you edit is still
        // one it must hand back exactly as it found it.
        const saved = strFromU8(
          unzipSync(new Uint8Array(await surface.session.save()))['word/footnotes.xml']!
        );
        expect(saved, 'the note text did not survive the round trip').toContain('<w:t>Note</w:t>');
        if (type !== '') expect(saved).toContain(type.trim());
      } finally {
        destroy();
      }
    });
  }
});
