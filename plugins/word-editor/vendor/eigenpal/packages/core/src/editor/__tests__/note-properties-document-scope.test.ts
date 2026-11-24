// Note numbering reads each section's own `w:sectPr`; settings.xml supplies only the endnote
// position. So the dialog must report the section's values even when settings.xml names others,
// and a document-scope write must reach every section — a write to settings.xml alone saves a
// change that no section numbers by.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, strFromU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { notePropertiesStateOf } from '../surface-note-state.ts';
import type { EditorCommand } from '../../contracts/editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const HEADER_R_ID = 'rId10';

/**
 * Two sections. settings.xml names footnote and endnote numbering that no section uses, plus
 * an endnote position. Section 1 carries a header reference; section 2 is the body-level
 * `w:sectPr` and holds the one footnote reference.
 */
function docx(): Uint8Array {
  const override = (name: string, type: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${type}+xml"/>`;
  const body =
    '<w:p><w:pPr><w:sectPr>' +
    `<w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
    '<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>First section</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second section</w:t></w:r>' +
    '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        override('document.xml', 'document.main') +
        override('header1.xml', 'header') +
        override('footnotes.xml', 'footnotes') +
        override('settings.xml', 'settings') +
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
        `<Relationship Id="rId30" Type="${R}/settings" Target="settings.xml"/>` +
        '</Relationships>'
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/>` +
        '<w:footnotePr><w:pos w:val="beneathText"/><w:numFmt w:val="chicago"/>' +
        '<w:numStart w:val="3"/></w:footnotePr>' +
        '<w:endnotePr><w:pos w:val="sectEnd"/><w:numFmt w:val="upperLetter"/></w:endnotePr>' +
        '<w:compat/></w:settings>'
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(bytes: Uint8Array = docx()): ReturnType<typeof createDocxEditor> {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: bytes, author: 'Notes' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** The resolved properties the dialog shows for each section, by moving the caret there. */
function resolvedBySection(editor: ReturnType<typeof createDocxEditor>) {
  const surface = editor.surface!;
  return surface.session.paragraphIds().map((paragraphId) => {
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    const state = notePropertiesStateOf(surface)!;
    return { footnote: state.footnote.resolved, endnote: state.endnote.resolved };
  });
}

const WHOLE_DOCUMENT: EditorCommand = {
  type: 'setNoteProperties',
  scope: 'document',
  footnote: { numFmt: 'lowerRoman', numRestart: 'eachSect', position: 'beneathText' },
  endnote: { numFmt: 'decimal', numRestart: 'continuous', position: 'docEnd' },
};

describe('settings.xml note properties', () => {
  test('do not set the numbering the dialog reports; the endnote position still applies', () => {
    const editor = mount();
    for (const section of resolvedBySection(editor)) {
      expect(section.footnote).toEqual({
        pos: 'pageBottom',
        numFmt: 'decimal',
        numStart: 1,
        numRestart: 'continuous',
      });
      expect(section.endnote).toEqual({
        pos: 'sectEnd',
        numFmt: 'lowerRoman',
        numStart: 1,
        numRestart: 'continuous',
      });
    }
  });
});

describe('a document-scope note properties write', () => {
  test('reaches every section, and can() agrees with exec', () => {
    const editor = mount();
    expect(editor.can(WHOLE_DOCUMENT).ok).toBe(true);
    const result = editor.exec(WHOLE_DOCUMENT);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    for (const section of resolvedBySection(editor)) {
      expect(section.footnote.numFmt).toBe('lowerRoman');
      expect(section.footnote.numRestart).toBe('eachSect');
      expect(section.endnote.numFmt).toBe('decimal');
      expect(section.endnote.pos).toBe('docEnd');
    }
  });

  test('saves into every sectPr in schema order, and into settings.xml before w:compat', async () => {
    const editor = mount();
    expect(editor.exec(WHOLE_DOCUMENT).ok).toBe(true);
    const files = unzipSync(new Uint8Array(await editor.save()));
    const document = strFromU8(files['word/document.xml']!);
    const sectPrs = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? [];
    expect(sectPrs).toHaveLength(2);
    for (const sectPr of sectPrs) {
      // CT_SectPr: header/footer references, then footnotePr, endnotePr, then page geometry.
      expect(sectPr).toMatch(
        /^<w:sectPr>(<w:headerReference[^>]*\/>)*<w:footnotePr><w:pos w:val="beneathText"\/><w:numFmt w:val="lowerRoman"\/><w:numRestart w:val="eachSect"\/><\/w:footnotePr><w:endnotePr>[\s\S]*<\/w:endnotePr><w:pgSz /
      );
    }
    const settings = strFromU8(files['word/settings.xml']!);
    expect(settings).toMatch(
      /<w:defaultTabStop [^>]*\/><w:footnotePr>[\s\S]*<\/w:footnotePr><w:endnotePr>[\s\S]*<\/w:endnotePr><w:compat\/>/
    );

    // Reopened, the saved file numbers by the written values.
    const reopened = mount(new Uint8Array(await editor.save()));
    for (const section of resolvedBySection(reopened)) {
      expect(section.footnote.numFmt).toBe('lowerRoman');
      expect(section.endnote.numFmt).toBe('decimal');
    }
  });

  test('undoes in one step, restoring the sections and settings.xml together', async () => {
    const editor = mount();
    const before = unzipSync(new Uint8Array(await editor.save()));
    expect(editor.exec(WHOLE_DOCUMENT).ok).toBe(true);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = unzipSync(new Uint8Array(await editor.save()));
    expect(strFromU8(undone['word/document.xml']!)).toBe(strFromU8(before['word/document.xml']!));
    expect(strFromU8(undone['word/settings.xml']!)).toBe(strFromU8(before['word/settings.xml']!));
    expect(resolvedBySection(editor)[1]!.footnote.numFmt).toBe('decimal');

    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(resolvedBySection(editor).map((section) => section.footnote.numFmt)).toEqual([
      'lowerRoman',
      'lowerRoman',
    ]);
  });

  test('keeps a section’s other note kind when the write names only one', () => {
    const editor = mount();
    expect(
      editor.exec({
        type: 'setNoteProperties',
        scope: 'section',
        sectionIndex: 1,
        endnote: { numFmt: 'upperRoman' },
      }).ok
    ).toBe(true);
    expect(
      editor.exec({ type: 'setNoteProperties', scope: 'document', footnote: { numStart: 4 } }).ok
    ).toBe(true);
    const sections = resolvedBySection(editor);
    expect(sections.map((section) => section.footnote.numStart)).toEqual([4, 4]);
    expect(sections.map((section) => section.endnote.numFmt)).toEqual(['lowerRoman', 'upperRoman']);
  });
});

describe('a note properties write merges by field', () => {
  test('a field the write leaves out keeps every section’s value', () => {
    const editor = mount();
    expect(
      editor.exec({
        type: 'setNoteProperties',
        scope: 'document',
        footnote: { numStart: 3, numRestart: 'eachSect', position: 'beneathText' },
      }).ok
    ).toBe(true);
    expect(editor.exec({ type: 'setNoteProperties', footnote: { numFmt: 'upperLetter' } }).ok).toBe(
      true
    );
    for (const section of resolvedBySection(editor)) {
      expect(section.footnote).toEqual({
        pos: 'beneathText',
        numFmt: 'upperLetter',
        numStart: 3,
        numRestart: 'eachSect',
      });
    }
  });

  test('applying the values the dialog opened with leaves every section as it was', async () => {
    const editor = mount();
    const before = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const state = notePropertiesStateOf(editor.surface!)!;
    // The command the properties dialog sends when nothing was changed.
    const result = editor.exec({
      type: 'setNoteProperties',
      scope: 'document',
      footnote: {
        numFmt: state.footnote.resolved.numFmt,
        numRestart: state.footnote.resolved.numRestart,
        position: state.footnote.resolved.pos,
      },
      endnote: {
        numFmt: state.endnote.resolved.numFmt,
        numRestart: state.endnote.resolved.numRestart,
        position: state.endnote.resolved.pos,
      },
    });
    expect(result.ok).toBe(true);
    const after = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(after).toBe(before);
  });
});

describe('a section-scope endnote position write', () => {
  test('moves the endnotes of every section, as the dialog then reports', () => {
    const editor = mount();
    const command: EditorCommand = {
      type: 'setNoteProperties',
      scope: 'section',
      sectionIndex: 0,
      endnote: { numFmt: 'decimal', position: 'docEnd' },
    };
    expect(editor.can(command).ok).toBe(true);
    expect(editor.exec(command).ok).toBe(true);
    const sections = resolvedBySection(editor);
    expect(sections.map((section) => section.endnote.pos)).toEqual(['docEnd', 'docEnd']);
    // The format stays a per-section value.
    expect(sections.map((section) => section.endnote.numFmt)).toEqual(['decimal', 'lowerRoman']);
  });
});
