// One revision space reaches the outside, and it is the PACKAGE one.
//
// Every story part — the body, each header/footer, the notes part — counts its own
// revisions, and a header/footer part starts from zero when it is created. Anything that
// compares a revision against `packageRevision()`, or hands one to a host as "the
// document's revision", must therefore read the package counter and not a story's.
//
// A body-only fixture cannot catch a mistake here: the two counters coincide until a
// package-level op or a non-body edit moves one without the other. Every test below edits a
// header on purpose so the counters are apart when the assertion runs.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { DocumentChange } from '../../contracts/editor.ts';
import { tableRowOccurrenceTargetFrom } from '../../layout/table-interaction-targets.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE_2X2 =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

/** A document with a declared header part, so the two counters can be driven apart. */
function docxWithHeader(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('HDR')}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
}

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docxWithHeader(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Open the declared header and type one character into it. */
function editTheHeader(editor: DocxEditorInstance): void {
  expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  expect(editor.exec({ type: 'insertText', text: 'H' }).ok).toBe(true);
  expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);
}

describe('the revision a host sees is the package revision', () => {
  test('change events keep rising across a header edit', () => {
    const editor = mount(p('body'));
    const seen: number[] = [];
    editor.on('change', (change: DocumentChange) => seen.push(change.revision));

    const surface = editor.surface!;
    const bodyId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: bodyId, offset: 0 },
      head: { paragraphId: bodyId, offset: 0 },
    });
    editor.exec({ type: 'insertText', text: 'a' });
    editTheHeader(editor);
    surface.setSelection({
      anchor: { paragraphId: bodyId, offset: 0 },
      head: { paragraphId: bodyId, offset: 0 },
    });
    editor.exec({ type: 'insertText', text: 'b' });

    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Reporting the story's own counter made this go BACKWARDS on the first header edit and
    // then repeat numbers it had already emitted, so a host using it as a version key for a
    // dirty flag, dedupe or autosave read the document as unchanged.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThan(seen[index - 1]!);
    }
    expect(new Set(seen).size).toBe(seen.length);
    editor.destroy();
  });

  test('the document handle moves when only a header changed', () => {
    const editor = mount(p('body'));
    const before = editor.getDocumentHandle().revision;
    editTheHeader(editor);
    expect(editor.getDocumentHandle().revision).toBeGreaterThan(before);
    editor.destroy();
  });

  test('a fresh explicit table target is accepted after a header edit', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    // FIRST, so the body and package counters are apart for the rest of the test. From here
    // the body store never catches up again.
    editTheHeader(editor);

    const layout = surface.layout();
    const table = layout.pages
      .flatMap((page) => page.fragments)
      .find((block) => block.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no table in layout');
    const row = table.rows[0]!;
    // Stamped from the CURRENT `layout.revision`, which is the package revision — the only
    // number a host can read off the layout it is pointing at.
    const target = tableRowOccurrenceTargetFrom(layout.revision, { table, row, rowIndex: 0 });

    // Planning compared that against a BODY-store revision, so once the two had diverged
    // even a freshly stamped target read as stale: every explicit-target table command
    // refused and mutated nothing, permanently.
    const command = { type: 'insertRow' as const, where: 'below' as const, target };
    expect(editor.can(command).ok).toBe(true);
    expect(editor.exec(command).ok).toBe(true);
    editor.destroy();
  });
});
