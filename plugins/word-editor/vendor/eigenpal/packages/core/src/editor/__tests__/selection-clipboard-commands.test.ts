// `selectAll`, `copy`, `cut` and `paste` as editor commands.
//
// None of the four is new capability — the surface has done all of it since it was
// written, and the browser's own clipboard events already drive the keyboard. What these
// tests pin is the part that IS new: that naming the operation gets an honest `can()`, that
// the gate and the effect agree about whether there was a selection, and that `cut` reports
// the deletion it performed even when the clipboard write goes nowhere.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
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

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function mount(
  body: string,
  options: { mode?: 'edit' | 'view' } = {}
): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body), ...options });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

/** Every addressed paragraph's text, in reading order. */
function texts(editor: DocxEditorInstance): string[] {
  const surface = editor.surface!;
  const part = surface.session.part();
  return surface.session.paragraphIds().map((id) => paragraphTextOf(part, id) ?? '');
}

/** Select `[start, end)` of the first paragraph. */
function selectInFirst(editor: DocxEditorInstance, start: number, end: number): void {
  const surface = editor.surface!;
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

/** Collapse the caret into the first paragraph. */
function caretInFirst(editor: DocxEditorInstance, offset = 0): void {
  selectInFirst(editor, offset, offset);
}

// A recording stand-in for the real clipboard: the engine's write is fire-and-forget, so
// the only way to observe it is to be the thing it writes to.
let written: string[] = [];
let restoreClipboard: (() => void) | undefined;

function installClipboard(writeText: (text: string) => Promise<void>): void {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  restoreClipboard = () => {
    if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
    else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  };
}

beforeEach(() => {
  written = [];
  installClipboard(async (text: string) => {
    written.push(text);
  });
});

afterEach(() => {
  restoreClipboard?.();
  restoreClipboard = undefined;
});

describe('selectAll', () => {
  test('selects the whole body and reports no document change', () => {
    const { editor } = mount(p('first') + p('second'));
    const result = editor.exec({ type: 'selectAll' });

    expect(result).toEqual({ ok: true, changed: false });
    expect(editor.surface!.selectedText()).toContain('first');
    expect(editor.surface!.selectedText()).toContain('second');
  });

  test('is available in a read-only document', () => {
    const { editor } = mount(p('first'), { mode: 'view' });
    expect(editor.can({ type: 'selectAll' })).toEqual({ ok: true });
  });
});

describe('copy', () => {
  test('writes the selected text and leaves the document alone', () => {
    const { editor } = mount(p('hello world'));
    selectInFirst(editor, 0, 5);

    const result = editor.exec({ type: 'copy' });

    expect(result).toEqual({ ok: true, changed: false });
    expect(written).toEqual(['hello']);
    expect(texts(editor)).toEqual(['hello world']);
  });

  test('writes plain text from inline run wrappers', () => {
    const body =
      '<w:p><w:smartTag><w:r><w:t>smart</w:t></w:r></w:smartTag>' +
      '<w:customXml><w:r><w:t>custom</w:t></w:r></w:customXml>' +
      '<w:dir><w:r><w:t>dir</w:t></w:r></w:dir>' +
      '<w:bdo><w:r><w:t>bdo</w:t></w:r></w:bdo></w:p>';
    const { editor } = mount(body);
    editor.exec({ type: 'selectAll' });

    expect(editor.exec({ type: 'copy' })).toEqual({ ok: true, changed: false });
    expect(written).toEqual(['smartcustomdirbdo']);
  });

  test('is refused at a collapsed caret — nothing to copy', () => {
    const { editor } = mount(p('hello world'));
    caretInFirst(editor, 3);

    expect(editor.can({ type: 'copy' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'nothing is selected',
    });
    expect(editor.exec({ type: 'copy' }).ok).toBe(false);
    expect(written).toEqual([]);
  });

  // Reading a document you may not edit and lifting a clause out of it is the whole point
  // of a viewer, so copy must not be gated on the edit mode the way cut is.
  test('is available over a selection in a read-only document', () => {
    const { editor } = mount(p('hello world'), { mode: 'view' });
    selectInFirst(editor, 0, 5);

    expect(editor.can({ type: 'copy' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'copy' })).toEqual({ ok: true, changed: false });
    expect(written).toEqual(['hello']);
  });
});

describe('cut', () => {
  test('writes the selected text and deletes it', () => {
    const { editor } = mount(p('hello world'));
    selectInFirst(editor, 0, 6);

    const result = editor.exec({ type: 'cut' });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ changed: true });
    expect(written).toEqual(['hello ']);
    expect(texts(editor)).toEqual(['world']);
  });

  test('is refused at a collapsed caret', () => {
    const { editor } = mount(p('hello world'));
    caretInFirst(editor, 3);

    expect(editor.can({ type: 'cut' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'nothing is selected',
    });
    expect(texts(editor)).toEqual(['hello world']);
  });

  test('is refused in a read-only document even with a selection', () => {
    const { editor } = mount(p('hello world'), { mode: 'view' });
    selectInFirst(editor, 0, 5);

    expect(editor.can({ type: 'cut' })).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is open for viewing',
    });
    expect(texts(editor)).toEqual(['hello world']);
    expect(written).toEqual([]);
  });

  // The deletion has already committed by the time a clipboard write can reject. Reporting
  // the command as failed would tell the caller the document is unchanged when it is not.
  test('still reports the deletion when the clipboard write rejects', () => {
    installClipboard(async () => {
      throw new Error('clipboard unavailable');
    });
    const { editor } = mount(p('hello world'));
    selectInFirst(editor, 0, 6);

    const result = editor.exec({ type: 'cut' });

    expect(result.ok).toBe(true);
    expect(texts(editor)).toEqual(['world']);
  });

  test('survives an environment with no clipboard at all', () => {
    restoreClipboard?.();
    restoreClipboard = undefined;
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;

    const { editor } = mount(p('hello world'));
    selectInFirst(editor, 0, 6);

    expect(editor.exec({ type: 'cut' }).ok).toBe(true);
    expect(texts(editor)).toEqual(['world']);
  });
});

describe('paste', () => {
  test('inserts text at the caret', () => {
    const { editor } = mount(p('hello '));
    caretInFirst(editor, 6);

    const result = editor.exec({ type: 'paste', text: 'world' });

    expect(result.ok).toBe(true);
    expect(texts(editor)).toEqual(['hello world']);
  });

  test('replaces the selection', () => {
    const { editor } = mount(p('hello world'));
    selectInFirst(editor, 6, 11);

    editor.exec({ type: 'paste', text: 'there' });

    expect(texts(editor)).toEqual(['hello there']);
  });

  // The reason `type` is the wrong lane for pasted text: a newline in run text is a control
  // character the store refuses, which vetoes the transaction and pastes nothing at all.
  test('turns newlines into real paragraphs', () => {
    const { editor } = mount(p(''));
    caretInFirst(editor, 0);

    editor.exec({ type: 'paste', text: 'one\ntwo\nthree' });

    expect(texts(editor)).toEqual(['one', 'two', 'three']);
  });

  test('normalizes CRLF from a Windows clipboard', () => {
    const { editor } = mount(p(''));
    caretInFirst(editor, 0);

    editor.exec({ type: 'paste', text: 'one\r\ntwo' });

    expect(texts(editor)).toEqual(['one', 'two']);
  });

  test('is refused without text', () => {
    const { editor } = mount(p('hello'));

    // The shape gate, reached the way an untyped caller reaches it.
    expect(editor.can({ type: 'paste' } as unknown as { type: 'paste'; text: string })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'paste requires text',
    });
  });

  test('is refused in a read-only document', () => {
    const { editor } = mount(p('hello'), { mode: 'view' });
    caretInFirst(editor, 5);

    expect(editor.can({ type: 'paste', text: 'x' })).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is open for viewing',
    });
    expect(texts(editor)).toEqual(['hello']);
  });
});

describe('embedded object clipboard refusal', () => {
  const object =
    '<w:object xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape type="#_x0000_t75" style="width:10pt;height:12pt"><v:imagedata r:id="preview"/></v:shape></w:object>';
  test('copy and cut refuse object-only and mixed selections without changing text', () => {
    for (const [start, end] of [
      [1, 2],
      [0, 3],
    ]) {
      const { editor } = mount(`<w:p><w:r><w:t>A</w:t>${object}<w:t>Z</w:t></w:r></w:p>`);
      try {
        selectInFirst(editor, start!, end!);
        for (const type of ['copy', 'cut'] as const) {
          expect(editor.exec({ type })).toEqual({
            ok: false,
            code: 'unsupported',
            reason: 'unsupported-content',
          });
          expect(texts(editor)).toEqual(['A\uFFFCZ']);
        }
        expect(written).toEqual([]);
      } finally {
        editor.destroy();
      }
    }
  });
  test('rich paste refuses objects and preserves the selected target text', async () => {
    const { wrapInteropHtml } = await import('../clipboard-fragment-codec.ts');
    const bytes = docx(`<w:p><w:r><w:t>A</w:t>${object}<w:t>Z</w:t></w:r></w:p>`);
    const html = wrapInteropHtml('<p>AZ</p>', { bytes, lastMarkCovered: true });
    const { editor } = mount(p('target'));
    try {
      selectInFirst(editor, 0, 6);
      expect(editor.exec({ type: 'paste', html, text: 'AZ' })).toEqual({
        ok: false,
        code: 'unsupported',
        reason: 'unsupported-content',
      });
      expect(texts(editor)).toEqual(['target']);
    } finally {
      editor.destroy();
    }
  });
});
