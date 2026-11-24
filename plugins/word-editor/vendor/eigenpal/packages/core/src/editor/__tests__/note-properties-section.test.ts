// The note-properties dialog reports the section the caret is actually in.
//
// Sections are a body structure, so a note or header paragraph is in no section map. Answering
// `0` for them is not just a display bug: the dialog WRITES BACK to the section it reports, so
// a footnote in section 2 rewrote section 1's `w:sectPr`. The read and the write agreed with
// each other and were both wrong, which is exactly why it showed no symptom.
//
// The contract's own fixture is single-section and cannot see this, so this document has two.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { notePropertiesStateOf } from '../surface-note-state.ts';
import { sectionAnchorParagraphFor } from '../section-scope.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const HEADER_R_ID = 'rId10';

/** Section 2's note numbering restarts, so reading section 1 by mistake is visible. */
const SECOND_SECTION_NOTE_PR =
  '<w:footnotePr><w:numFmt w:val="lowerRoman"/><w:numStart w:val="7"/></w:footnotePr>';

function twoSectionDocx(): Uint8Array {
  const override = (name: string, type: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${type}+xml"/>`;
  // The FIRST section ends on a paragraph-level `w:sectPr`; the note reference sits after it,
  // so the note belongs to the second section — the one the body-only map cannot reach.
  const body =
    '<w:p><w:pPr><w:sectPr><w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr>' +
    `<w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
    '</w:sectPr></w:pPr><w:r><w:t>First section</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second section</w:t></w:r>' +
    '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
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
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p>' +
        '</w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>' +
        '<w:r><w:t>Note text</w:t></w:r></w:p></w:footnote></w:footnotes>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `<w:sectPr>${SECOND_SECTION_NOTE_PR}</w:sectPr></w:body></w:document>`
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): ReturnType<typeof createDocxEditor> {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: twoSectionDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('a section-addressed write anchors on body content', () => {
  test('a header caret anchors on its own section’s body paragraph', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);

    // `w:sectPr` lives on the body story, so the op resolves its target by walking the BODY
    // tree. Handing it the header caret named a paragraph that tree has never held, and the
    // whole write came back `unknown-paragraph` — Page Setup applied nothing from a header.
    const anchor = sectionAnchorParagraphFor(
      surface.session,
      surface.state().selection.head.paragraphId,
      { kind: 'headerFooter', rId: HEADER_R_ID },
      surface.headerFooterState()?.sectionIndex
    );
    expect(anchor).toEqual({ kind: 'anchor', paragraphId: surface.session.paragraphIds()[0]! });
  });

  test('a footnote caret anchors on the section that cites it', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterNote('footnote:1')).toBe(true);

    const anchor = sectionAnchorParagraphFor(
      surface.session,
      surface.state().selection.head.paragraphId,
      { kind: 'notesPart', noteKind: 'footnote' }
    );
    // The reference sits in the second body paragraph, which is the second section.
    expect(anchor).toEqual({ kind: 'anchor', paragraphId: surface.session.paragraphIds()[1]! });
  });

  test('a multi-section page setup write reaches the caret’s own section', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);

    const result = editor.exec({ type: 'setPageSetup', scope: 'section', marginRight: 4321 });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    // The FIRST section owns this header, so its geometry moved and the second's did not.
    const sections = surface.session.paragraphIds().map((id) => surface.sectionPropertiesAt(id));
    expect(sections[0]!.margins.rightTwips).toBe(4321);
    expect(sections[1]!.margins.rightTwips).not.toBe(4321);
  });
});

describe('note properties follow the caret’s own section', () => {
  test('a footnote reports the section that cites it, not section 0', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterNote('footnote:1')).toBe(true);

    const state = notePropertiesStateOf(surface);
    // The reference sits in the SECOND section, so that is the section the dialog edits.
    expect(state?.sectionIndex).toBe(1);
    // And the properties shown are that section's, not the first section's decimal run.
    expect(state?.footnote.resolved.numFmt).toBe('lowerRoman');
    expect(state?.footnote.resolved.numStart).toBe(7);
  });

  test('an open header reports the section that names its relationship', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);

    // The first section owns `rId10`, and a header paragraph is in no section map at all.
    expect(surface.headerFooterState()?.sectionIndex).toBe(0);
    expect(notePropertiesStateOf(surface)?.sectionIndex).toBe(0);
    expect(notePropertiesStateOf(surface)?.footnote.resolved.numFmt).toBe('decimal');
  });

  test('the last section’s own properties are read, not document defaults', () => {
    const editor = mount();
    const surface = editor.surface!;
    const second = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: second, offset: 0 },
      head: { paragraphId: second, offset: 0 },
    });

    // The last section is closed by the BODY-level `w:sectPr`, which no paragraph-mark walk
    // reaches. This is the ordinary case, not a story-parity one: in a single-section document
    // the last section is the only section, so its `w:footnotePr` was never read at all.
    const state = notePropertiesStateOf(surface);
    expect(state?.sectionIndex).toBe(1);
    expect(state?.footnote.resolved.numFmt).toBe('lowerRoman');
    expect(state?.footnote.sectionAuthored?.numFmt).toBe('lowerRoman');
  });

  test('a body caret still reports its own section', () => {
    const editor = mount();
    const surface = editor.surface!;
    const first = notePropertiesStateOf(surface);
    // Opening lands in the first paragraph, which the body map answers directly. The
    // reference-following fallback must not have displaced that.
    expect(first?.sectionIndex).toBe(0);
    expect(first?.footnote.resolved.numFmt).toBe('decimal');
  });
});

describe('the notePropertiesState memo tracks every input of the computation', () => {
  test('re-entering a shared header from another section refreshes the answer', () => {
    const editor = mount();
    const surface = editor.surface!;
    // Section 0 declares `rId10`; section 1 inherits the same part. Entering is UI state:
    // it moves no revision and lands the caret on the SAME header paragraph both times, so
    // a key of revision + paragraph id alone pins the first section's answer forever.
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID, sectionIndex: 0 })).toBe(true);
    expect(surface.notePropertiesState()?.sectionIndex).toBe(0);
    expect(surface.notePropertiesState()?.footnote.resolved.numFmt).toBe('decimal');

    surface.exitHeaderFooter();
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID, sectionIndex: 1 })).toBe(true);
    expect(surface.headerFooterState()?.sectionIndex).toBe(1);
    const reentered = surface.notePropertiesState();
    expect(reentered?.sectionIndex).toBe(1);
    expect(reentered?.footnote.resolved.numFmt).toBe('lowerRoman');
  });

  test('a note-properties write invalidates the memo at a standing caret', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.notePropertiesState()?.footnote.resolved.numFmt).toBe('decimal');
    // The write moves the package revision while the caret stands still.
    expect(
      surface.setNoteProperties({
        scope: 'section',
        sectionIndex: 0,
        footnote: { numFmt: 'upperLetter' },
      })
    ).toBe(true);
    expect(surface.notePropertiesState()?.footnote.resolved.numFmt).toBe('upperLetter');
  });

  test('an unmoved caret returns the identical snapshot, offset moves included', () => {
    const editor = mount();
    const surface = editor.surface!;
    const first = surface.notePropertiesState();
    expect(first).not.toBeNull();
    expect(surface.notePropertiesState()).toBe(first!);
    // The computation reads only the head PARAGRAPH; section membership cannot change
    // within one paragraph, so an offset move must not recompute. This pins the invariant
    // that keeps the selection offset out of the memo key.
    const paragraphId = surface.state().selection.head.paragraphId;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    expect(surface.notePropertiesState()).toBe(first!);
  });
});
