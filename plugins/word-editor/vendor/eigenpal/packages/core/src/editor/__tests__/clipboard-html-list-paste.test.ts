// Pasting an HTML list through the `paste` command.
//
// Two defects met here. Every pasted paragraph after the first landed without a
// `w14:paraId`, so `query({ type: 'paragraphs' })` could not address it. And in a document
// that already had `numbering.xml`, the merged list definitions were dropped at commit, so
// the pasted paragraphs referenced a `numId` the document did not define and painted no
// markers — until a later list happened to be created under that same `numId`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  validateRasterHeader,
  type ImageDecodePort,
  type SupportedImageMime,
} from '../../store/package/image-resources.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';

const ITEMS = ['First pasted item', 'Second pasted item', 'Third pasted item'];
const LIST_HTML = `<ol>${ITEMS.map((item) => `<li>${item}</li>`).join('')}</ol>`;

/** A document whose first paragraph is already a `lowerLetter` list item. */
function numberedDocument(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CT}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMBERING_REL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
        '<w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>Existing item</w:t></w:r></w:p><w:p/></w:body></w:document>'
    ),
  });
}

/** A document with no numbering part at all. */
function plainDocument(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Heading</w:t></w:r></w:p><w:p/></w:body></w:document>`
    ),
  });
}

/** happy-dom decodes no images; this port reads the raster header, enough for an insert. */
const imageDecodePort: ImageDecodePort = Object.freeze({
  async decode(bytes: Uint8Array, mime: SupportedImageMime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    return { pixelWidth: header.pixelWidth, pixelHeight: header.pixelHeight, dpiX: 96, dpiY: 96 };
  },
});

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes, imageDecodePort });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

/** Put the caret at the start of the last paragraph and paste the list there. */
function pasteListAtEnd(editor: DocxEditorInstance): void {
  const surface = editor.surface!;
  const ids = surface.session.paragraphIds();
  const last = ids[ids.length - 1]!;
  surface.setSelection({
    anchor: { paragraphId: last, offset: 0 },
    head: { paragraphId: last, offset: 0 },
  });
  expect(editor.exec({ type: 'paste', text: ITEMS.join('\n'), html: LIST_HTML })).toEqual({
    ok: true,
    changed: true,
  });
}

function paraIdsByText(editor: DocxEditorInstance): Map<string, string | undefined> {
  const paragraphs = editor.query({ type: 'paragraphs' });
  return new Map(ITEMS.map((item) => [item, paragraphs.find((p) => p.text === item)?.paraId]));
}

function allParaIds(editor: DocxEditorInstance): (string | undefined)[] {
  return editor.query({ type: 'paragraphs' }).map((paragraph) => paragraph.paraId);
}

function savedPart(editor: DocxEditorInstance, name: string): string {
  const entry = unzipSync(editor.surface!.session.save())[name];
  return entry ? strFromU8(entry) : '';
}

/** `w:numId` values the body references, and `w:num` ids numbering.xml defines. */
function numberingReferences(editor: DocxEditorInstance): {
  referenced: Set<string>;
  defined: string[];
} {
  const body = savedPart(editor, 'word/document.xml');
  const numbering = savedPart(editor, 'word/numbering.xml');
  const referenced = new Set([...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]!));
  const defined = [...numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map((m) => m[1]!);
  return { referenced, defined };
}

describe('pasting an HTML list', () => {
  test('gives every pasted paragraph its own paraId', () => {
    const { editor } = mount(plainDocument());
    pasteListAtEnd(editor);
    const ids = [...paraIdsByText(editor).values()];
    expect(ids.every((id) => typeof id === 'string' && /^[0-9A-F]{8}$/.test(id))).toBe(true);
    const all = allParaIds(editor);
    expect(all.every((id) => id !== undefined)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  test('a second paste of the same list mints fresh identities', () => {
    const { editor } = mount(plainDocument());
    pasteListAtEnd(editor);
    pasteListAtEnd(editor);
    const all = allParaIds(editor);
    expect(all).toHaveLength(8);
    expect(all.every((id) => id !== undefined)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  test('numbers the list in a document that already has numbering', () => {
    const { editor, container } = mount(numberedDocument());
    pasteListAtEnd(editor);
    expect(container.textContent).toContain(
      'a)Existing item1.First pasted item2.Second pasted item3.Third pasted item'
    );
    const { referenced, defined } = numberingReferences(editor);
    expect(referenced.size).toBe(2);
    for (const numId of referenced) expect(defined).toContain(numId);
  });

  test('identities and numbering survive save and reopen', () => {
    const { editor } = mount(numberedDocument());
    pasteListAtEnd(editor);
    const before = paraIdsByText(editor);
    const { editor: reopened, container } = mount(editor.surface!.session.save());
    expect(paraIdsByText(reopened)).toEqual(before);
    expect(container.textContent).toContain('1.First pasted item2.Second pasted item');
  });

  // Package undo keeps numbering definitions the shell gained, so a later reference never
  // dangles; an unreferenced definition is inert. What matters is that nothing references a
  // definition the document lacks, in either direction.
  test('undo removes the pasted list and redo restores it, numbered', () => {
    const { editor, container } = mount(numberedDocument());
    pasteListAtEnd(editor);
    const pasted = paraIdsByText(editor);

    expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
    expect([...paraIdsByText(editor).values()].every((id) => id === undefined)).toBe(true);
    const undone = numberingReferences(editor);
    for (const numId of undone.referenced) expect(undone.defined).toContain(numId);

    expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
    expect(paraIdsByText(editor)).toEqual(pasted);
    expect(container.textContent).toContain('1.First pasted item');
    const { referenced, defined } = numberingReferences(editor);
    for (const numId of referenced) expect(defined).toContain(numId);
  });
});

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

// The paste and image intents commit a whole package, and promotion no longer re-merges
// the live numbering part over it. A list the toolbar created a moment earlier must still
// survive both: the paste case fails without the fix, the image case is a regression
// guard for the promotion change.
describe('package intents keep a list the toolbar just created', () => {
  function toggleListOnFirst(editor: DocxEditorInstance): void {
    const surface = editor.surface!;
    const first = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 0 },
    });
    expect(editor.exec({ type: 'toggleList', kind: 'ordered' }).ok).toBe(true);
  }

  function expectNoDanglingNumbering(editor: DocxEditorInstance): void {
    const { referenced, defined } = numberingReferences(editor);
    expect(referenced.size).toBeGreaterThan(0);
    for (const numId of referenced) expect(defined).toContain(numId);
  }

  test('an image inserted after a toolbar list', async () => {
    const { editor } = mount(plainDocument());
    toggleListOnFirst(editor);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 12,
      heightPoints: 12,
    });
    expect(result).toEqual({ ok: true, changed: true });
    expectNoDanglingNumbering(editor);
  });

  test('a list pasted after a toolbar list', () => {
    const { editor, container } = mount(plainDocument());
    toggleListOnFirst(editor);
    pasteListAtEnd(editor);
    expectNoDanglingNumbering(editor);
    expect(container.textContent).toContain('1.First pasted item');
  });
});
