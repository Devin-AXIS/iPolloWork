import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import type { DocxEditorInstance } from '../docx-editor-types.ts';
import { setPreviewWriteGuard, setRefreshWriteGuard } from '../refresh-write-guard.ts';
import {
  BASE,
  EDITED,
  RESTRUCTURED,
  updateFixture,
} from '../../store/__tests__/package-update-fixture.ts';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function open(document_ = updateFixture(BASE)) {
  return openIn(document_).editor;
}

function openIn(document_ = updateFixture(BASE)) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: document_ });
  disposers.push(() => {
    editor.destroy();
    container.remove();
  });
  return { editor, container };
}

/** `exec` refuses with this code and reason, `can` agrees, and nothing changes. */
async function expectRefused(
  editor: DocxEditorInstance,
  code: string,
  reason: string | undefined,
  execCode: string
) {
  const before = await savedXml(editor);
  const canUndo = editor.snapshot().canUndo;
  const command = { type: 'replaceDocument', docx: updateFixture(EDITED) } as const;
  const result = editor.exec(command);
  expect(result).toMatchObject({ ok: false, code: execCode, replaceDocument: { ok: false, code } });
  expect(result.ok ? null : result.replaceDocument?.reason).toBe(reason);
  expect(editor.can(command)).toMatchObject({ ok: false, code: execCode });
  expect(await savedXml(editor)).toEqual(before);
  expect(editor.snapshot().canUndo).toBe(canUndo);
}

const text = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

async function savedXml(editor: DocxEditorInstance): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels'))
      .map(([name, bytes]) => [name, strFromU8(bytes)])
  );
}

/** The same document with its main part under another name: cannot apply as an edit. */
function renamedMainPart(): Uint8Array {
  const files = unzipSync(updateFixture(EDITED));
  files['word/main.xml'] = files['word/document.xml']!;
  delete files['word/document.xml'];
  files['word/_rels/main.xml.rels'] = files['word/_rels/document.xml.rels']!;
  delete files['word/_rels/document.xml.rels'];
  files['_rels/.rels'] = strToU8(
    strFromU8(files['_rels/.rels']!).replace('word/document.xml', 'word/main.xml')
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace('/word/document.xml', '/word/main.xml')
  );
  return zipSync(files);
}

describe('replaceDocument', () => {
  test('replaces the document as one undo step above earlier history, with no capture', async () => {
    const editor = open();
    const original = await savedXml(editor);
    editor.surface!.type('Typed ');
    const typed = await savedXml(editor);
    const reference = await savedXml(open(updateFixture(RESTRUCTURED)));

    const result = editor.exec({ type: 'replaceDocument', docx: updateFixture(RESTRUCTURED) });
    expect(result).toEqual({
      ok: true,
      changed: true,
      replaceDocument: { ok: true, changed: true },
    });
    expect(await savedXml(editor)).toEqual(reference);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await savedXml(editor)).toEqual(typed);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(await savedXml(editor)).toEqual(reference);
    // The typing before the replacement is still its own undo step.
    editor.exec({ type: 'undo' });
    editor.exec({ type: 'undo' });
    expect(await savedXml(editor)).toEqual(original);
  });

  test('accepts an ArrayBuffer, and an identical file changes nothing', async () => {
    const editor = open();
    const bytes = updateFixture(BASE);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = editor.exec({ type: 'replaceDocument', docx: buffer as ArrayBuffer });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('a matching handle applies; an edited document refuses and changes nothing', async () => {
    const editor = open();
    const expected = editor.getDocumentHandle();
    editor.surface!.type('Late ');
    const before = await savedXml(editor);
    const command = { type: 'replaceDocument', docx: updateFixture(EDITED), expected } as const;
    expect(editor.exec(command)).toMatchObject({
      ok: false,
      code: 'notFound',
      replaceDocument: { ok: false, code: 'staleDocument', reason: 'edited' },
    });
    expect(editor.can(command)).toMatchObject({ ok: false, code: 'notFound' });
    expect(await savedXml(editor)).toEqual(before);

    const current = editor.getDocumentHandle();
    expect(current.loadId).toBe(expected.loadId);
    expect(
      editor.exec({ type: 'replaceDocument', docx: updateFixture(EDITED), expected: current })
    ).toMatchObject({ ok: true, changed: true });
    expect(text(editor)).toContain('Goal of this agreement.');
    // An edit, an undo, and a replacement keep the load identity.
    expect(editor.getDocumentHandle().loadId).toBe(expected.loadId);
  });

  test('a handle from document A never replaces document B, even at the same revision', async () => {
    const editor = open();
    const fromA = editor.getDocumentHandle();
    editor.load(updateFixture(EDITED));
    const afterLoad = editor.getDocumentHandle();
    expect(afterLoad.loadId).not.toBe(fromA.loadId);
    // Edit B until its revision number equals A's, so only the identity tells them apart.
    while (editor.getDocumentHandle().revision < fromA.revision) editor.surface!.type('b');
    expect(editor.getDocumentHandle().revision).toBe(fromA.revision);
    const before = await savedXml(editor);
    const result = editor.exec({
      type: 'replaceDocument',
      docx: updateFixture(RESTRUCTURED),
      expected: fromA,
    });
    expect(result).toMatchObject({
      ok: false,
      replaceDocument: { code: 'staleDocument', reason: 'otherDocument' },
    });
    expect(await savedXml(editor)).toEqual(before);
  });

  test('a malformed handle refuses with invalidRequest', () => {
    const editor = open();
    const result = editor.exec({
      type: 'replaceDocument',
      docx: updateFixture(EDITED),
      expected: { revision: 0 } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'invalidArgs',
      replaceDocument: { code: 'invalidRequest' },
    });
  });

  test('buffered typing lands before the stale check', async () => {
    const editor = open();
    const expected = editor.getDocumentHandle();
    editor.surface!.enqueueType('queued ');
    const result = editor.exec({
      type: 'replaceDocument',
      docx: updateFixture(EDITED),
      expected,
    });
    expect(result).toMatchObject({ replaceDocument: { code: 'staleDocument', reason: 'edited' } });
    expect(text(editor)).toContain('queued ');
  });

  test('a refusal leaves the document and its undo history unchanged', async () => {
    const editor = open();
    editor.surface!.type('Kept ');
    const before = await savedXml(editor);
    const cases = [
      [renamedMainPart(), 'editUnsupported', 'unsupported', 'differentMainPart'],
      [new Uint8Array([1, 2, 3]), 'invalidDocument', 'invalidArgs', undefined],
    ] as const;
    for (const [docx, code, execCode, reason] of cases) {
      const result = editor.exec({ type: 'replaceDocument', docx });
      expect(result).toMatchObject({ ok: false, code: execCode, replaceDocument: { code } });
      if (result.ok || !result.replaceDocument || result.replaceDocument.ok)
        throw new Error('expected a typed refusal');
      expect(result.replaceDocument.reason).toBe(reason);
      expect(result.reason).toBe(result.replaceDocument.message);
      expect(await savedXml(editor)).toEqual(before);
    }
    // The only undo step is still the typing.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(text(editor)).not.toContain('Kept ');
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('viewing mode refuses in exec and can, with a typed reason', () => {
    const editor = open();
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const command = { type: 'replaceDocument', docx: updateFixture(EDITED) } as const;
    expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
    expect(editor.exec(command)).toMatchObject({
      ok: false,
      code: 'locked',
      replaceDocument: { code: 'editNotPermitted', reason: 'viewing' },
    });
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('refuses a history group and bad arguments with a typed outcome', () => {
    const editor = open();
    // A replacement is always its own undo step, so it cannot join a group.
    const grouped = editor.exec(
      { type: 'replaceDocument', docx: updateFixture(EDITED) },
      { historyGroup: editor.beginHistoryGroup() }
    );
    expect(grouped).toMatchObject({
      ok: false,
      code: 'unsupported',
      replaceDocument: { ok: false, code: 'invalidRequest' },
    });
    const bad = editor.exec({
      type: 'replaceDocument',
      docx: 'not bytes' as unknown as Uint8Array,
    });
    expect(bad).toMatchObject({
      ok: false,
      code: 'invalidArgs',
      replaceDocument: { code: 'invalidRequest' },
    });
    expect(editor.can({ type: 'replaceDocument', docx: updateFixture(EDITED) })).toEqual({
      ok: true,
    });
  });

  test('a document refresh or a preview refuses with busy, in exec and can', async () => {
    for (const set of [setRefreshWriteGuard, setPreviewWriteGuard]) {
      const { editor, container } = openIn();
      set(container, true);
      await expectRefused(editor, 'busy', undefined, 'unsupported');
      set(container, false);
      expect(editor.exec({ type: 'replaceDocument', docx: updateFixture(EDITED) }).ok).toBe(true);
    }
  });

  test('suggesting mode refuses rather than record an untracked edit', async () => {
    const editor = open();
    editor.surface!.setEditingMode('suggest');
    await expectRefused(editor, 'editNotPermitted', 'suggesting', 'locked');
  });

  for (const edit of ['comments', 'forms', 'trackedChanges'] as const) {
    test(`enforced ${edit} protection refuses with protected`, async () => {
      const settings = `<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`;
      const editor = open(updateFixture({ ...BASE, settings }));
      await expectRefused(editor, 'editNotPermitted', 'protected', 'locked');
    });
  }

  test('an editor with no document, or a destroyed one, refuses with unavailable', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const empty = createDocxEditor({ container });
    disposers.push(() => {
      empty.destroy();
      container.remove();
    });
    const command = { type: 'replaceDocument', docx: updateFixture(EDITED) } as const;
    expect(empty.exec(command)).toMatchObject({
      ok: false,
      replaceDocument: { code: 'unavailable' },
    });
    expect(empty.can(command).ok).toBe(false);
    const destroyed = open();
    destroyed.destroy();
    expect(destroyed.exec(command)).toMatchObject({
      ok: false,
      replaceDocument: { code: 'unavailable' },
    });
  });
});
