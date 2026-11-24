// `contentLockPolicy: { allowFormattingInLockedContent }` through `createDocxEditor`: the toolbar
// mark restyles a content-locked control only for a host that opted in, and typing over it is
// still refused. A large document opens in a prepare task before its mount, so the policy must
// reach that session as well, or the option silently does nothing on exactly the long files.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { ContentLockPolicy } from '../../store/package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const BODY =
  '<w:p><w:r><w:t>ABC</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="t"/>' +
  '<w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>TOKEN</w:t></w:r>' +
  '</w:sdtContent></w:sdt><w:r><w:t>DEF</w:t></w:r></w:p>';

/** `filler` adds an uncompressed text part big enough to make the editor defer the open. */
function docx(filler = false): Uint8Array {
  const lines = filler
    ? Array.from({ length: 30_000 }, (_, i) => `Filler line ${i} of ordinary text.\n`).join('')
    : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="bin" ContentType="application/octet-stream"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
    ...(filler ? { 'word/filler.bin': strToU8(lines) } : {}),
  });
}

const POLICY: ContentLockPolicy = { allowFormattingInLockedContent: true };

function mount(contentLockPolicy?: ContentLockPolicy): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(),
    ...(contentLockPolicy ? { contentLockPolicy } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

async function savedMainXml(editor: DocxEditorInstance): Promise<string> {
  const parts = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(parts['word/document.xml']!);
}

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('contentLockPolicy in the editor', () => {
  test('default: bold over a content-locked control is refused and changes nothing', async () => {
    const editor = mount();
    editor.surface!.selectAll();
    // The toolbar asks first, and gets the same answer the write would.
    expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(await savedMainXml(editor)).not.toContain('<w:b/>');
    editor.destroy();
  });

  test('default: font size and family over a content-locked control report the refusal', async () => {
    const editor = mount();
    editor.surface!.selectAll();
    for (const command of [
      { type: 'setMarkAttr', mark: 'fontSize', value: 14 },
      { type: 'setMarkAttr', mark: 'fontFamily', value: 'Arial' },
    ] as const) {
      const result = editor.exec(command);
      expect(result).toMatchObject({ ok: false, code: 'locked' });
      expect(result.ok ? '' : result.reason).not.toBe('');
    }
    expect(await savedMainXml(editor)).not.toContain('w:sz ');
    // A later write that lands reports success, so no refusal lingers.
    editor.surface!.setSelection({
      anchor: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 0 },
      head: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 2 },
    });
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('opt-in: bold restyles the control and the text around it, the lock stays', async () => {
    const editor = mount(POLICY);
    editor.surface!.selectAll();
    expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
    const xml = await savedMainXml(editor);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:val="sdtContentLocked"');
    expect(editor.surface!.session.bodyText()).toBe('ABCTOKENDEF');
    editor.destroy();
  });

  test('opt-in: typing over the control is still refused', () => {
    const editor = mount(POLICY);
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'insertText', text: 'x' })).not.toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.bodyText()).toBe('ABCTOKENDEF');
    editor.destroy();
  });

  test('opt-in: a large document opened ahead of its mount keeps the policy', async () => {
    const editor = createDocxEditor({ document: docx(true), contentLockPolicy: POLICY });
    editor.attach(document.createElement('div'));
    expect(editor.snapshot().isOpening).toBe(true);
    await until(() => editor.surface !== null);
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
    expect(await savedMainXml(editor)).toContain('<w:b/>');
    editor.destroy();
  });
});
