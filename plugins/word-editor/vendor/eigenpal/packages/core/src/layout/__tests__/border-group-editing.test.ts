// Paragraph border groups under the gestures that actually break them.
//
// The sibling test drives `layoutSemanticDocument` with two trees. This one drives a live
// editor, because the failing gesture is a natural one and the test trap is specific: a test
// that builds the content and THEN applies the property passes, since the whole run is laid
// out once with its final structure. The gesture that fails is the other order — put the
// borders on first, then grow the run — so each new paragraph changes the verdict of the one
// above it. Both orders are covered.
//
// The oracle is the same bytes reopened. Any disagreement IS the bug.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

const rule = (side: string) => `<w:${side} w:val="single" w:sz="8" w:space="4" w:color="000000"/>`;

/** A paragraph inside a `w:pBdr` box, with no `w:between` — so grouping removes the rule. */
const bordered = (text: string) =>
  '<w:p><w:pPr><w:pBdr>' +
  rule('top') +
  rule('left') +
  rule('bottom') +
  rule('right') +
  '</w:pBdr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Box geometry plus which rules each fragment draws — everything the grouping decides. */
const shapeOf = (editor: DocxEditorInstance): unknown =>
  editor.surface!.layout().pages.map((page) =>
    page.fragments.map((fragment) => ({
      y: Math.round(fragment.box.y * 100) / 100,
      height: Math.round(fragment.box.height * 100) / 100,
      sides:
        fragment.kind === 'paragraph'
          ? (fragment.borders ?? []).map((stroke) => stroke.side)
          : undefined,
    }))
  );

/** Put the caret in the paragraph at `index`, at `offset` (default: the start). */
function caretIn(editor: DocxEditorInstance, index: number, offset = 0): void {
  const surface = editor.surface!;
  const id = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

async function reopened(editor: DocxEditorInstance): Promise<DocxEditorInstance> {
  return mount(new Uint8Array(await editor.save()));
}

describe('growing a bordered run', () => {
  test('splitting the last member re-places the one that was last', async () => {
    const editor = mount(docx(bordered('one') + bordered('two')));
    caretIn(editor, 1, 'two'.length);
    editor.surface!.splitParagraph();
    editor.surface!.type('three');

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('a run grown one paragraph at a time, the order that hides the bug', async () => {
    // Borders FIRST, then grow. Each Enter makes the paragraph above stop closing its box,
    // which is the verdict a content key cannot see moving.
    const editor = mount(docx(bordered('one')));
    const surface = editor.surface!;
    let last = 'one';
    for (const text of ['two', 'three', 'four']) {
      caretIn(editor, surface.session.paragraphIds().length - 1, last.length);
      surface.splitParagraph();
      surface.type(text);
      last = text;
    }

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('typing into a member without splitting it leaves the group alone', async () => {
    const editor = mount(docx(bordered('one') + bordered('two')));
    caretIn(editor, 0, 'one'.length);
    editor.surface!.type(' more');

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });
});

describe('splitting a bordered run', () => {
  test('Increase Indent on the last member closes the box above it', async () => {
    const editor = mount(docx(bordered('one') + bordered('two') + bordered('three')));
    caretIn(editor, 2);
    expect(editor.surface!.adjustIndent('increase')).toBe(true);

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('Increase Indent on a MIDDLE member splits the group in two', async () => {
    const editor = mount(docx(bordered('one') + bordered('two') + bordered('three')));
    caretIn(editor, 1);
    expect(editor.surface!.adjustIndent('increase')).toBe(true);

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('toggling the last member into a list splits the group', async () => {
    const editor = mount(docx(bordered('one') + bordered('two') + bordered('three')));
    caretIn(editor, 2);
    expect(editor.surface!.toggleList('bullet')).toBe(true);

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });

  test('Backspace merging the last two members re-places what is left', async () => {
    const editor = mount(docx(bordered('one') + bordered('two') + bordered('three')));
    const surface = editor.surface!;
    caretIn(editor, 2);
    surface.deleteBackward();

    expect(shapeOf(editor)).toEqual(shapeOf(await reopened(editor)));
  });
});
