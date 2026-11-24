// Copying text that holds non-breaking and optional hyphens (issue #1071).
//
// Plain text carries a non-breaking hyphen as U+2011 and leaves an optional hyphen out: it is a
// line-breaking hint, not a character of the words. The HTML flavour keeps both, so a rich paste
// back into a document restores the hyphen elements.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

let mounted: { editor: DocxEditorInstance; container: HTMLElement } | null = null;
afterEach(() => {
  mounted?.editor.destroy();
  mounted?.container.remove();
  mounted = null;
});

test('plain text keeps a non-breaking hyphen and leaves an optional hyphen out', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(
      '<w:p><w:r><w:t>co</w:t><w:noBreakHyphen/><w:t>op rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>'
    ),
  });
  mounted = { editor, container };
  const surface = editor.surface!;
  const paragraphId = surface.state().selection.head.paragraphId;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 12 },
  });
  const flavours = surface.copyFlavours();
  expect(flavours.text).toBe('co‑op rates');
  // The rich flavour keeps the optional hyphen for a paste back into a document.
  expect(flavours.html).toContain('­');
  // The selection itself still reads one character per hyphen, so offsets stay aligned.
  expect(surface.selectedText()).toBe('co‑op rate­s');
});

test('plain text keeps a literal U+00AD and drops only the optional hyphen element', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(
      '<w:p><w:r><w:t xml:space="preserve">aa­bb </w:t><w:softHyphen/><w:t xml:space="preserve">cc </w:t>' +
        '<w:noBreakHyphen/><w:t>dd</w:t></w:r></w:p>'
    ),
  });
  mounted = { editor, container };
  const surface = editor.surface!;
  const paragraphId = surface.state().selection.head.paragraphId;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 13 },
  });
  expect(surface.copyFlavours().text).toBe('aa­bb cc ‑dd');
  // The selection still reads one character per model offset.
  expect(surface.selectedText()).toBe('aa­bb ­cc ‑dd');
});
