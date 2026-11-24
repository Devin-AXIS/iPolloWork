// The save path refreshes stale REF field results, and ONLY stale ones.
//
// What these tests pin down: after an edit, `editor.save()` exports the value the pages
// paint (the cached result runs are rewritten first); a document whose results are already
// fresh saves byte-identically with no revision bump and no undo entry; revision-marked
// results are left untouched; and a refresh+save+reopen document digests identically across
// a second save (the D9 oracle for the rewrite being a fixed point). Fixtures mount FRESH —
// the calibration gate requires a field's computed value to reproduce its cache once before
// it goes live, so the refreshable states are the ones an edit creates afterwards.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { semanticDigest } from '../../store/package/ooxml-digest.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
const refField = (instr: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

// FRESH on load: both caches reproduce the bookmarked text, so calibration passes and the
// fields go live. The edit below then makes those caches stale.
const FRESH_BODY =
  `<w:p>${bookmarked('term', 'Closing Date')}</w:p>` +
  `<w:p>${refField(' REF term \\h ', '<w:r><w:t>Closing Date</w:t></w:r>')}</w:p>` +
  '<w:p><w:fldSimple w:instr=" REF term "><w:r><w:t>Closing Date</w:t></w:r></w:fldSimple></w:p>' +
  '<w:sectPr/>';

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function firstParagraphId(editor: DocxEditorInstance): string {
  const part = editor.surface!.session.part();
  let found: string | undefined;
  const walk = (node: (typeof part)['root']): void => {
    if (found) return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children) {
      if (child.kind !== 'textValue') walk(child);
    }
  };
  walk(part.root);
  if (!found) throw new Error('missing paragraph');
  return found;
}

/** Append one character to the bookmarked target text, so both REF caches go stale. */
function editTarget(editor: DocxEditorInstance): void {
  const result = editor.surface!.session.applyTreeOps([
    {
      op: 'insertText',
      paragraphId: firstParagraphId(editor),
      // At the bookmark's start, so the typed text joins the bookmark.
      offset: 0,
      text: 'The ',
    },
  ]);
  expect(result.committed).toBe(true);
}

async function savedDocumentXml(editor: DocxEditorInstance): Promise<string> {
  const bytes = new Uint8Array(await editor.save());
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

describe('save() refreshes stale REF results', () => {
  test('Original view does not save PAGEREF results from the original pagination', async () => {
    const editor = mount(
      `<w:p>${refField(' PAGEREF target ', '<w:r><w:t>2</w:t></w:r>')}</w:p>` +
        '<w:p><w:pPr><w:pageBreakBefore/><w:pPrChange w:id="20" w:author="Ada">' +
        '<w:pPr/></w:pPrChange></w:pPr>' +
        bookmarked('target', 'Target') +
        '</w:p>'
    );
    try {
      const surface = editor.surface!;
      expect(surface.layout().pages).toHaveLength(2);
      const before = new Uint8Array(await editor.save());
      const revision = editor.getDocumentHandle().revision;
      surface.setRevisionDisplayMode('original');
      expect(surface.layout().pages).toHaveLength(1);
      expect(new Uint8Array(await editor.save())).toEqual(before);
      expect(editor.getDocumentHandle().revision).toBe(revision);
      expect(surface.session.canUndo()).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  test('after an edit the exported bytes carry the live value; the instruction survives', async () => {
    const editor = mount(FRESH_BODY);
    editTarget(editor);
    const xml = await savedDocumentXml(editor);
    expect(xml).toContain(' REF term \\h ');
    // BOTH result caches now read the edited text (the target run serializes as two w:t).
    expect(xml).toContain(
      '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>The Closing Date</w:t></w:r>'
    );
    expect(xml).toContain('<w:fldSimple w:instr=" REF term "><w:r><w:t>The Closing Date</w:t>');
    editor.destroy();
  });

  test('fresh results save byte-identically, with no revision bump and no undo entry', async () => {
    const editor = mount(FRESH_BODY);
    const surface = editor.surface!;
    const revisionBefore = editor.getDocumentHandle().revision;
    // The oracle: a serialize with NO refresh in front of it.
    const withoutRefresh = surface.session.save();
    const withRefresh = new Uint8Array(await editor.save());
    expect(withRefresh).toEqual(withoutRefresh);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);
    expect(surface.session.canUndo()).toBe(false);
    editor.destroy();
  });

  test('a stale refresh is one ordinary transaction: revision bumps and it is undoable', async () => {
    const editor = mount(FRESH_BODY);
    editTarget(editor);
    const revisionAfterEdit = editor.getDocumentHandle().revision;
    await editor.save();
    expect(editor.getDocumentHandle().revision).toBeGreaterThan(revisionAfterEdit);
    expect(editor.surface!.session.canUndo()).toBe(true);
    editor.destroy();
  });

  test('a result wrapped in revision markup is skipped and saved exactly as loaded', async () => {
    const editor = mount(
      `<w:p>${bookmarked('term', 'Closing Date')}</w:p>` +
        `<w:p>${refField(
          ' REF term ',
          '<w:ins w:id="9" w:author="QA" w:date="2020-01-01T00:00:00Z">' +
            '<w:r><w:t>Closing Date</w:t></w:r></w:ins>'
        )}</w:p>` +
        '<w:sectPr/>'
    );
    editTarget(editor);
    const revisionAfterEdit = editor.getDocumentHandle().revision;
    const xml = await savedDocumentXml(editor);
    // The stale result stays exactly as loaded, revision markup and all — no refresh
    // transaction ran for a document whose only REF result is revision content.
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('<w:t>Closing Date</w:t>');
    expect(xml).toContain('<w:t>The Closing Date</w:t>');
    expect(editor.getDocumentHandle().revision).toBe(revisionAfterEdit);
    editor.destroy();
  });

  test('refresh + save + reopen digests identically across a second save', async () => {
    const editor = mount(FRESH_BODY);
    editTarget(editor);
    const firstSave = new Uint8Array(await editor.save());
    editor.destroy();

    const container = document.createElement('div');
    const reopened = createDocxEditor({ container, document: firstSave });
    const secondSave = new Uint8Array(await reopened.save());
    // The rewrite is a fixed point: nothing was stale on reopen, so the second save is the
    // byte-identical serialization, and the semantic digests agree.
    expect(secondSave).toEqual(firstSave);
    const digestOf = (bytes: Uint8Array) => {
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error(loaded.reason);
      return semanticDigest(loaded.package.parts.values());
    };
    expect(digestOf(secondSave)).toEqual(digestOf(firstSave));
    reopened.destroy();
  });

  test('a document opened for viewing is never rewritten by save', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx(
        `<w:p>${bookmarked('term', 'Closing Date')}</w:p>` +
          `<w:p>${refField(' REF term ', '<w:r><w:t>Old</w:t></w:r>')}</w:p>` +
          '<w:sectPr/>'
      ),
      mode: 'view',
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    const xml = await savedDocumentXml(editor);
    expect(xml).toContain('Old');
    editor.destroy();
  });
});
