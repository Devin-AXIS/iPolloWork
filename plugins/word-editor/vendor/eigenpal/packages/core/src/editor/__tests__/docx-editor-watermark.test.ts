// `setWatermark`, `getWatermark()` and the `watermark` query against the real engine: one
// package write in every header the document shows, one undo step, a refusal that writes
// nothing, and a watermark that survives save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { PNG_1X1 } from './image-decode-harness.ts';
import { docx, PNG } from '../../export/__tests__/header-picture-watermark-fixture.ts';

function mount(document: Uint8Array = blankDocumentBytes()): DocxEditorInstance {
  const container = window.document.createElement('div');
  const editor = createDocxEditor({ container, document });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

async function headerXml(editor: DocxEditorInstance): Promise<string[]> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return Object.keys(files)
    .filter((name) => /^word\/header\d+\.xml$/.test(name))
    .map((name) => strFromU8(files[name]!));
}

describe('document watermark', () => {
  test('a text watermark lands in a new header with the dialog defaults', async () => {
    const editor = mount();
    expect(editor.getWatermark()).toBeNull();
    expect(editor.exec({ type: 'setWatermark', watermark: { text: 'CONFIDENTIAL' } })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.getWatermark()).toEqual({
      kind: 'text',
      text: 'CONFIDENTIAL',
      fontFamily: 'Calibri',
      fontSizePt: null,
      bold: false,
      italic: false,
      color: 'C0C0C0',
      transparency: 0.5,
      layout: 'diagonal',
    });
    const headers = await headerXml(editor);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('id="PowerPlusWaterMarkObject1"');
    expect(headers[0]).toContain('rotation:315');
    expect(headers[0]).toContain('<v:fill opacity="0.5"/>');
    expect(headers[0]).toContain('string="CONFIDENTIAL"');
  });

  test('the write is one undo step and replacing keeps one shape per header', async () => {
    const editor = mount();
    editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT' } });
    editor.exec({
      type: 'setWatermark',
      watermark: { text: 'SAMPLE', layout: 'horizontal', color: 'FF0000', transparency: 0 },
    });
    const headers = await headerXml(editor);
    expect(headers.join('').match(/PowerPlusWaterMarkObject/g)).toHaveLength(1);
    expect(headers[0]).not.toContain('rotation');
    expect(headers[0]).not.toContain('v:fill');
    expect(editor.getWatermark()).toMatchObject({ text: 'SAMPLE', layout: 'horizontal' });
    editor.exec({ type: 'undo' });
    expect(editor.getWatermark()).toMatchObject({ text: 'DRAFT', layout: 'diagonal' });
    editor.exec({ type: 'undo' });
    expect(editor.getWatermark()).toBeNull();
  });

  test('a saved watermark reopens, and null removes it', async () => {
    const editor = mount();
    editor.exec({
      type: 'setWatermark',
      watermark: { text: 'TOP SECRET', fontSizePt: 72, bold: true, italic: true },
    });
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(reopened.getWatermark()).toMatchObject({
      kind: 'text',
      text: 'TOP SECRET',
      fontSizePt: 72,
      bold: true,
      italic: true,
    });
    expect(reopened.exec({ type: 'setWatermark', watermark: null })).toEqual({
      ok: true,
      changed: true,
    });
    expect(reopened.getWatermark()).toBeNull();
    expect((await headerXml(reopened)).join('')).not.toContain('WaterMark');
    // Removing nothing changes nothing.
    expect(reopened.exec({ type: 'setWatermark', watermark: null })).toEqual({
      ok: true,
      changed: false,
    });
  });

  test('a picture watermark is washed out by default and reads back its bytes', async () => {
    const editor = mount();
    expect(editor.exec({ type: 'setWatermark', watermark: { imageData: PNG_1X1 } })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.getWatermark()).toEqual({ kind: 'image', washout: true });
    const query = editor.query({ type: 'watermark' });
    expect(query?.imageData).toEqual(PNG_1X1);
    const headers = await headerXml(editor);
    expect(headers[0]).toContain('id="WordPictureWatermark1"');
    expect(headers[0]).toContain('gain="19661f"');
    expect(headers[0]).toContain('blacklevel="22938f"');
    // A text watermark replaces the picture and drops its media.
    editor.exec({ type: 'setWatermark', watermark: { text: 'COPY' } });
    const files = unzipSync(new Uint8Array(await editor.save()));
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(false);
  });

  test('an authored picture watermark reads back and a new watermark replaces it', async () => {
    const editor = mount(docx({ imageData: ' gain="19661f" blacklevel="22938f"' }));
    expect(editor.getWatermark()).toEqual({ kind: 'image', washout: true });
    expect(editor.query({ type: 'watermark' })?.imageData).toEqual(PNG);
    editor.exec({ type: 'setWatermark', watermark: { text: 'COPY' } });
    const headers = (await headerXml(editor)).join('');
    expect(headers).not.toContain('WordPictureWatermark');
    expect(headers.match(/PowerPlusWaterMarkObject/g)).toHaveLength(1);
    expect(editor.getWatermark()).toMatchObject({ kind: 'text', text: 'COPY' });
  });

  test('invalid options are refused before anything is written', () => {
    const editor = mount();
    const refused = [
      {},
      { text: 'A', imageData: PNG_1X1 },
      { text: '' },
      { text: 'two\nlines' },
      { text: 'A', color: 'silver' },
      { text: 'A', transparency: 2 },
      { text: 'A', fontSizePt: 0 },
      { text: 'A', fontFamily: 'x";}' },
      { text: 'A', washout: true },
      { imageData: new Uint8Array([1, 2, 3]) },
    ];
    for (const watermark of refused) {
      expect(editor.can({ type: 'setWatermark', watermark })).toMatchObject({ ok: false });
      const result = editor.exec({ type: 'setWatermark', watermark });
      expect(result.ok).toBe(false);
    }
    expect(editor.getWatermark()).toBeNull();
    expect(editor.can({ type: 'setWatermark', watermark: { text: 'OK' } })).toEqual({ ok: true });
  });
});
