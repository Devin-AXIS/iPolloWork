import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import type { DocxEditorInstance } from '../docx-editor-types.ts';
import { setPreviewWriteGuard } from '../refresh-write-guard.ts';
import {
  BASE,
  EDITED,
  RESTRUCTURED,
  SUGGESTED,
  updateFixture,
} from '../../store/__tests__/package-update-fixture.ts';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function open(document_ = updateFixture(BASE)) {
  const scroll = document.createElement('div');
  scroll.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroll.append(container);
  document.body.append(scroll);
  const editor = createDocxEditor({ container, document: document_ });
  const refresh = createDocumentRefresh(editor);
  disposers.push(() => {
    editor.destroy();
    scroll.remove();
  });
  return { editor, refresh, container, scroll };
}

const text = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

/** Every saved XML entry as text; node ids never reach the file, so equal files are equal. */
async function savedXml(editor: DocxEditorInstance): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels'))
      .map(([name, bytes]) => [name, strFromU8(bytes)])
  );
}

/** What a reload of `bytes` would show, saved: the content the update must arrive with. */
async function reloadedXml(bytes: Uint8Array): Promise<Record<string, string>> {
  const { editor } = open(bytes);
  return savedXml(editor);
}

describe('applyUpdate with mode: edit', () => {
  test('a reload resets history; an edit adds one undo step above earlier history', async () => {
    const reload = open();
    reload.editor.surface!.type('x');
    const reloadSubmission = await reload.refresh.capture();
    const reloaded = await reload.refresh.applyUpdate({
      submission: reloadSubmission,
      sequence: 1,
      bytes: updateFixture(EDITED),
    });
    expect(reloaded).toMatchObject({ ok: true, mode: 'reload' });
    expect(reload.editor.snapshot().canUndo).toBe(false);

    const { editor, refresh } = open();
    const original = await savedXml(editor);
    editor.surface!.type('Typed ');
    const typed = await savedXml(editor);
    const submission = await refresh.capture();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture({
        ...EDITED,
        paragraphs: [
          EDITED.paragraphs[0]!.replace('Goal', 'Typed Goal'),
          ...EDITED.paragraphs.slice(1),
        ],
      }),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: true, mode: 'edit' });
    expect(text(editor)).toContain('Typed Goal of this agreement.');
    const applied = await savedXml(editor);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await savedXml(editor)).toEqual(typed);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(await savedXml(editor)).toEqual(applied);
    editor.exec({ type: 'undo' });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await savedXml(editor)).toEqual(original);
  });

  test('content arrives exactly as a reload shows it, through save and reopen', async () => {
    const { editor, refresh } = open();
    const returned = updateFixture(SUGGESTED);
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: returned, mode: 'edit' })
    ).toMatchObject({ ok: true });
    expect(await savedXml(editor)).toEqual(await reloadedXml(returned));
    // The review module's view of these comments and changes is covered in `packages/pro`.
    const reopened = open(new Uint8Array(await editor.save()));
    expect(await savedXml(reopened.editor)).toEqual(await reloadedXml(returned));
  });

  test('the update reports source refresh, so it does not start another processing job', async () => {
    const { editor, refresh } = open();
    const sources: unknown[] = [];
    editor.on('change', (change) => sources.push(change.source));
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    expect(sources).toEqual(['refresh']);
    editor.exec({ type: 'undo' });
    expect(sources).toEqual(['refresh', undefined]);
  });

  test('cumulative results each add one undo step', async () => {
    const { editor, refresh } = open();
    const submission = await refresh.capture();
    const captured = await savedXml(editor);
    expect(
      (
        await refresh.applyUpdate({
          submission,
          sequence: 1,
          bytes: updateFixture(EDITED),
          mode: 'edit',
        })
      ).ok
    ).toBe(true);
    const first = await savedXml(editor);
    expect(
      (
        await refresh.applyUpdate({
          submission,
          sequence: 2,
          bytes: updateFixture(SUGGESTED),
          mode: 'edit',
        })
      ).ok
    ).toBe(true);
    editor.exec({ type: 'undo' });
    expect(await savedXml(editor)).toEqual(first);
    editor.exec({ type: 'undo' });
    expect(await savedXml(editor)).toEqual(captured);
  });

  test('keeps the caret in its paragraph and maps it past an edit before it', async () => {
    const { editor, refresh } = open();
    const surface = editor.surface!;
    const paragraphs = surface.session.part().root.children[0]!;
    const first = (paragraphs as { children: readonly { id: string }[] }).children[0]!.id;
    const fifth = (paragraphs as { children: readonly { id: string }[] }).children[4]!.id;
    surface.setSelection({
      anchor: { paragraphId: first, offset: 8 },
      head: { paragraphId: first, offset: 8 },
    });
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    // "Purpose of" became "Goal of": offset 8 (before "of") maps to 5.
    expect(surface.state().selection.head).toEqual({ paragraphId: first, offset: 5 });

    surface.setSelection({
      anchor: { paragraphId: fifth, offset: 3 },
      head: { paragraphId: fifth, offset: 3 },
    });
    const next = await refresh.capture();
    await refresh.applyUpdate({
      submission: next,
      sequence: 1,
      bytes: updateFixture(SUGGESTED),
      mode: 'edit',
    });
    expect(surface.state().selection.head.paragraphId).toBe(fifth);
  });

  test('moves the caret to the nearest earlier paragraph when the update removes its own', async () => {
    const { editor, refresh } = open();
    const surface = editor.surface!;
    const paragraphs = surface.session.part().root.children[0]!;
    const ids = (paragraphs as { children: readonly { id: string }[] }).children.map((p) => p.id);
    surface.setSelection({
      anchor: { paragraphId: ids[1]!, offset: 3 },
      head: { paragraphId: ids[1]!, offset: 3 },
    });
    const submission = await refresh.capture();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(RESTRUCTURED),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: true, mode: 'edit' });
    const end = { paragraphId: ids[0]!, offset: 'Purpose of this agreement.'.length };
    expect(surface.state().selection).toEqual({ anchor: end, head: end });
    // Typing lands instead of being dropped at a paragraph that is gone.
    surface.type('Z');
    expect(text(editor)).toContain('Purpose of this agreement.Z');
  });

  test('viewing mode refuses with edit-not-permitted and changes nothing', async () => {
    const { editor, refresh } = open();
    const before = await savedXml(editor);
    const submission = await refresh.capture();
    editor.surface!.setEditingMode('view');
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: false, code: 'edit-not-permitted', reason: 'viewing' });
    expect(result.ok ? '' : result.message).toMatch(/viewing/);
    expect(await savedXml(editor)).toEqual(before);
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('an edit after capture refuses with local-edits and changes nothing', async () => {
    const { editor, refresh } = open();
    const submission = await refresh.capture();
    editor.surface!.type('late ');
    const before = await savedXml(editor);
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: false, code: 'local-edits' });
    expect(result.ok ? null : result.message).toBe('The document changed after capture.');
    expect(result.ok ? null : result.reason).toBeUndefined();
    expect(await savedXml(editor)).toEqual(before);
  });

  test('a difference that cannot apply as an edit refuses with edit-unsupported; reload still works', async () => {
    const { editor, refresh } = open();
    editor.surface!.type('Kept ');
    const before = await savedXml(editor);
    const submission = await refresh.capture();
    // The same document with its main part under another name.
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
    const bytes = zipSync(files);
    const result = await refresh.applyUpdate({ submission, sequence: 1, bytes, mode: 'edit' });
    expect(result).toMatchObject({
      ok: false,
      code: 'edit-unsupported',
      reason: 'different-main-part',
    });
    expect(await savedXml(editor)).toEqual(before);
    expect(editor.snapshot().canUndo).toBe(true);
    const fallback = await refresh.applyUpdate({ submission, sequence: 1, bytes });
    expect(fallback).toMatchObject({ ok: true, mode: 'reload' });
  });

  for (const edit of ['comments', 'forms', 'trackedChanges', 'readOnly'] as const) {
    test(`enforced ${edit} protection refuses with edit-not-permitted and changes nothing`, async () => {
      const settings = `<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`;
      const { editor, refresh } = open(updateFixture({ ...BASE, settings }));
      const before = await savedXml(editor);
      const submission = await refresh.capture();
      const result = await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: updateFixture({ ...EDITED, settings }),
        mode: 'edit',
      });
      // Read-only protection opens the editor in viewing mode, which refuses first.
      expect(result).toMatchObject({
        ok: false,
        code: 'edit-not-permitted',
        reason: edit === 'readOnly' ? 'viewing' : 'protected',
      });
      expect(await savedXml(editor)).toEqual(before);
      expect(editor.snapshot().canUndo).toBe(false);
    });
  }

  test('refuses bytes that are not a document, and an unknown mode', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: new Uint8Array([1]),
        mode: 'edit',
      })
    ).toMatchObject({ ok: false, code: 'invalid-document' });
    expect(
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: updateFixture(EDITED),
        mode: 'merge' as never,
      })
    ).toMatchObject({ ok: false, code: 'invalid-result' });
  });

  test('an identical result succeeds without an undo step', async () => {
    const { editor, refresh } = open();
    const submission = await refresh.capture();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(BASE),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: true, mode: 'edit' });
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('an open preview refuses with busy and changes nothing', async () => {
    const { editor, refresh, container } = open();
    const before = await savedXml(editor);
    const submission = await refresh.capture();
    setPreviewWriteGuard(container, true);
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    setPreviewWriteGuard(container, false);
    expect(result).toMatchObject({ ok: false, code: 'busy' });
    expect(await savedXml(editor)).toEqual(before);
  });

  test('suggesting mode still applies the update, as returned and without new revisions', async () => {
    const { editor, refresh } = open();
    editor.surface!.setEditingMode('suggest');
    const submission = await refresh.capture();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    });
    expect(result).toMatchObject({ ok: true, mode: 'edit' });
    expect(await savedXml(editor)).toEqual(await reloadedXml(updateFixture(EDITED)));
  });
});
