// Explicit tracked-change commands through the mounted browser editor.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';

function mounted(author?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank', ...(author ? { author } : {}) });
  editor.exec({ type: 'insertText', text: 'abcd' });
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

function xmlOf(editor: ReturnType<typeof createDocxEditor>): string {
  return serializeOoxmlPart(editor.surface!.session.part());
}

describe('explicit tracked-change commands', () => {
  test('proposeInsertion resolves a DocLocation and attributes the inserted text', () => {
    const { editor, dispose } = mounted('Configured Author');
    try {
      const command = {
        type: 'proposeInsertion' as const,
        target: { container: { part: 'body' as const }, path: [0], offset: 2 },
        text: 'X',
        author: 'Agent',
      };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:ins');
      expect(xml).toContain('w:author="Agent"');
      expect(xml).toContain('<w:t>X</w:t>');
    } finally {
      dispose();
    }
  });

  test('proposeDeletion uses the current selection and configured author', () => {
    const { editor, dispose } = mounted('Configured Author');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 3 },
      });
      const command = { type: 'proposeDeletion' as const };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:del');
      expect(xml).toContain('w:author="Configured Author"');
      expect(xml).toContain('<w:delText>bc</w:delText>');
    } finally {
      dispose();
    }
  });

  test('proposeReplacement authors one replacement decision', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 3 },
      });
      const command = { type: 'proposeReplacement' as const, replaceWith: 'XY' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      const deletionId = /<w:del\b[^>]*w:id="([^"]+)"/.exec(xml)?.[1];
      const insertionId = /<w:ins\b[^>]*w:id="([^"]+)"/.exec(xml)?.[1];
      expect(deletionId).toBeDefined();
      // One decision, two elements: as Word writes it, the deletion first and each half under
      // its own id (#691). The review lane pairs them on adjacency into one card — see
      // `store/__tests__/tracked-replacement.test.ts`.
      expect(insertionId).toBeDefined();
      expect(insertionId).not.toBe(deletionId);
      expect(xml.indexOf('<w:del ')).toBeLessThan(xml.indexOf('<w:ins '));
      expect(xml).toContain('<w:delText>bc</w:delText>');
      expect(xml).toContain('<w:t>XY</w:t>');
    } finally {
      dispose();
    }
  });

  test('proposeInsertion at a caret inside a tracked deletion lands past it, in order', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 3 },
      });
      expect(editor.exec({ type: 'proposeDeletion' })).toMatchObject({ ok: true });
      // The caret rests INSIDE the struck 'bc'. The store relocates each insert past the
      // deletion; the reported caret must move the same way, or the second proposal lands
      // before the first and the output comes out reversed.
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 2 },
        head: { paragraphId, offset: 2 },
      });
      expect(editor.exec({ type: 'proposeInsertion', text: 'A' })).toMatchObject({ ok: true });
      expect(editor.exec({ type: 'proposeInsertion', text: 'B' })).toMatchObject({ ok: true });
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:delText>bc</w:delText>');
      expect(xml).toMatch(/<w:t[^>]*>AB<\/w:t>/);
    } finally {
      dispose();
    }
  });

  test('proposeReplacement spans paragraph marks and lands after the last struck paragraph', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      // 'abcd' then a split: two paragraphs, 'abcd' and 'second'.
      editor.surface!.insertPlainText('\nsecond');
      const ids = editor.surface!.session.paragraphIds();
      editor.surface!.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 1 },
        head: { paragraphId: ids[1]!, offset: 3 },
      });
      const command = { type: 'proposeReplacement' as const, replaceWith: 'XY' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
      const xml = xmlOf(editor);
      // Both paragraphs keep their struck halves, the mark becomes a merge proposal, and
      // the replacement is one insertion after the LAST struck head — the keyboard's rule.
      expect(xml).toContain('<w:delText>bcd</w:delText>');
      expect(xml).toMatch(
        /<w:delText[^>]*>sec<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t[^>]*>XY<\/w:t>/
      );
    } finally {
      dispose();
    }
  });

  test('proposeReplacement retracts the same author’s insertion in edit mode', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 2 },
        head: { paragraphId, offset: 2 },
      });
      expect(editor.exec({ type: 'proposeInsertion', text: 'X', author: 'Agent' })).toMatchObject({
        ok: true,
        changed: true,
      });
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 4 },
      });

      expect(
        editor.exec({ type: 'proposeReplacement', replaceWith: 'Y', author: 'Agent' })
      ).toMatchObject({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).not.toContain('<w:t>X</w:t>');
      expect(xml).toContain('<w:delText>bc</w:delText>');
      expect(xml).toContain('<w:t>Y</w:t>');
    } finally {
      dispose();
    }
  });

  test('can and exec agree on missing authors, collapsed deletion, and paragraph marks', () => {
    const noAuthor = mounted();
    try {
      const missing = { type: 'proposeInsertion' as const, text: 'X' };
      expect(noAuthor.editor.can(missing)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(noAuthor.editor.exec(missing)).toMatchObject({ ok: false, code: 'invalidArgs' });
    } finally {
      noAuthor.dispose();
    }

    const withAuthor = mounted('Agent');
    try {
      const collapsed = { type: 'proposeDeletion' as const };
      expect(withAuthor.editor.can(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(withAuthor.editor.exec(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
      const multiline = { type: 'proposeInsertion' as const, text: 'one\ntwo' };
      expect(withAuthor.editor.can(multiline)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(withAuthor.editor.exec(multiline)).toMatchObject({ ok: false, code: 'invalidArgs' });
      // Empty text is refused too: it would commit a phantom empty w:ins.
      const empty = { type: 'proposeReplacement' as const, replaceWith: '' };
      expect(withAuthor.editor.can(empty)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(withAuthor.editor.exec(empty)).toMatchObject({ ok: false, code: 'invalidArgs' });
      // The surface backstop mirrors the facade gate for direct callers.
      expect(withAuthor.editor.surface!.proposeTextChange('replacement', '')).toBe(false);
      expect(withAuthor.editor.surface!.proposeTextChange('insertion', 'a\nb')).toBe(false);
    } finally {
      withAuthor.dispose();
    }
  });
});
