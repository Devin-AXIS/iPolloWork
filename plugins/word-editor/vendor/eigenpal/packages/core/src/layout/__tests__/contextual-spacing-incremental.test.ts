// `w:contextualSpacing` across an INCREMENTAL pass.
//
// The property drops a paragraph's space before or after when the neighbour on that side
// is a paragraph of the same style, so a block's height is a function of two blocks it
// does not contain. The incremental pass resumes from the first block whose FLOW KEY moved,
// and a content key cannot see a neighbour appear — so inserting a paragraph under the last
// one of a run left that one still carrying the space it had when it was last, for as long
// as the session lived. Reopening the same bytes laid it out correctly, which is the shape
// of the bug: identical input, two answers.
//
// No numbering here on purpose. `w:contextualSpacing` is a paragraph-style question, and
// keeping lists out of it isolates what actually broke.

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

/** 8pt after every paragraph, and one style that suppresses it between its own. */
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:pPrDefault><w:pPr>' +
  '<w:spacing w:after="160" w:line="240" w:lineRule="auto"/>' +
  '</w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Tight"><w:name w:val="Tight"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>' +
  '</w:styles>';

const styled = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Tight"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

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

const heights = (editor: DocxEditorInstance): number[] =>
  editor
    .surface!.layout()
    .pages[0]!.fragments.map((fragment) => Math.round(fragment.box.height * 100) / 100);

describe('w:contextualSpacing survives an incremental pass', () => {
  test('a new same-style paragraph takes the space-after off the one above it', () => {
    const editor = mount(docx(styled('one') + styled('two')));
    const surface = editor.surface!;

    // On open: the pair closes up, and only the last one carries the 8pt.
    const [firstOnOpen, lastOnOpen] = heights(editor);
    expect(lastOnOpen! - firstOnOpen!).toBe(8);

    // Split the LAST one. The paragraph that was last is now followed by its own style, so
    // its space-after has to go — the case a content-only key cannot see.
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[1]!, offset: 3 },
      head: { paragraphId: ids[1]!, offset: 3 },
    });
    surface.splitParagraph();
    surface.type('three');

    const after = heights(editor);
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(firstOnOpen!);
    expect(after[1]).toBe(firstOnOpen!);
    expect(after[2]! - firstOnOpen!).toBe(8);
  });

  test('the incremental answer equals the answer for the same bytes reopened', async () => {
    const editor = mount(docx(styled('one') + styled('two')));
    const surface = editor.surface!;
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[1]!, offset: 3 },
      head: { paragraphId: ids[1]!, offset: 3 },
    });
    surface.splitParagraph();
    surface.type('three');
    const incremental = heights(editor);

    // The oracle: identical bytes, laid out from scratch. Any disagreement here IS the bug,
    // whatever the numbers happen to be.
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(incremental).toEqual(heights(reopened));
  });

  test('a paragraph of a DIFFERENT style below still leaves the space standing', () => {
    const editor = mount(docx(styled('one') + '<w:p><w:r><w:t>plain</w:t></w:r></w:p>'));
    const [tight, plain] = heights(editor);
    // Nothing to suppress against, so both keep their 8pt and the heights match.
    expect(tight).toBe(plain);
  });
});
