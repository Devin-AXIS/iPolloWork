// `replaceAllMatches` replaces every match of a query in one undo step.
//
// The contract documented the command, but `exec` refused it as unsupported. It must reach
// every story `findMatches` searches, write each story's matches back to front, record
// tracked replacements in suggesting mode, skip what cannot take plain text, and leave the
// reader's selection alone.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { bodyXml, docx, everyStoryDocx, mount, storyXml } from './replace-all-matches-fixture.ts';

describe('replaceAllMatches in editing mode', () => {
  test('replaces in the body, a table, a text box, headers, footers, and notes, undone in one step', () => {
    const { editor, dispose } = mount(everyStoryDocx());
    try {
      const before = storyXml(editor);
      const found = editor.findMatches('Beta', { matchCase: true });
      // Body, cell, text box, header, footer, footnote, endnote.
      expect(found.length).toBe(7);
      const command = {
        type: 'replaceAllMatches' as const,
        query: 'Beta',
        text: 'Gamma ray',
        matchCase: true,
      };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({
        ok: true,
        changed: true,
        replacements: { replaced: 7, skipped: 0 },
      });
      expect(editor.findMatches('Beta', { matchCase: true })).toEqual([]);
      expect(editor.findMatches('Gamma ray').length).toBe(7);
      const after = storyXml(editor);
      for (const name of Object.keys(before)) {
        expect(after[name]).not.toContain('>Beta<');
        expect(after[name]).toContain('Gamma ray');
      }
      expect(after['/word/document.xml']).toContain('cell Gamma ray');
      expect(after['/word/document.xml']).toContain('boxed Gamma ray');

      // ONE undo step takes back every story, and one redo replays them.
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(storyXml(editor)).toEqual(before);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(editor.findMatches('Gamma ray').length).toBe(7);
    } finally {
      dispose();
    }
  });

  test('several matches in one paragraph are written back to front', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t xml:space="preserve">cat and cat, a cat</w:t></w:r></w:p>'
    );
    try {
      const result = editor.exec({ type: 'replaceAllMatches', query: 'cat', text: 'tigers' });
      expect(result).toMatchObject({ ok: true, replacements: { replaced: 3, skipped: 0 } });
      expect(editor.surface!.session.bodyText()).toContain('tigers and tigers, a tigers');
    } finally {
      dispose();
    }
  });

  test('a replacement that contains the query is written once', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>cat cat</w:t></w:r></w:p>');
    try {
      expect(editor.exec({ type: 'replaceAllMatches', query: 'cat', text: 'cats' })).toMatchObject({
        ok: true,
        replacements: { replaced: 2, skipped: 0 },
      });
      expect(editor.surface!.session.bodyText()).toContain('cats cats');
    } finally {
      dispose();
    }
  });

  test('matchCase and wholeWord narrow the matches, and an empty text deletes them', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t xml:space="preserve">Note note notes NOTE</w:t></w:r></w:p>'
    );
    try {
      expect(
        editor.exec({
          type: 'replaceAllMatches',
          query: 'note',
          text: '',
          matchCase: true,
          wholeWord: true,
        })
      ).toMatchObject({ ok: true, replacements: { replaced: 1, skipped: 0 } });
      expect(editor.surface!.session.bodyText()).toContain('Note  notes NOTE');
    } finally {
      dispose();
    }
  });

  test('keeps the selection where the reader left it', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t>first word</w:t></w:r></w:p><w:p><w:r><w:t>second word</w:t></w:r></w:p>'
    );
    try {
      const [first] = editor.surface!.session.paragraphIds();
      const caret = { paragraphId: first!, offset: 2 };
      editor.surface!.setSelection({ anchor: caret, head: caret });
      expect(editor.exec({ type: 'replaceAllMatches', query: 'word', text: 'line' }).ok).toBe(true);
      expect(editor.surface!.state().selection).toEqual({ anchor: caret, head: caret });
    } finally {
      dispose();
    }
  });

  test('a caret later in an edited paragraph moves with its text', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t xml:space="preserve">one two three two four</w:t></w:r></w:p>'
    );
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      // Between "thr" and "ee".
      const caret = { paragraphId, offset: 11 };
      editor.surface!.setSelection({ anchor: caret, head: caret });
      expect(editor.exec({ type: 'replaceAllMatches', query: 'two', text: 'seven' }).ok).toBe(true);
      expect(editor.surface!.state().selection.head).toEqual({ paragraphId, offset: 13 });
    } finally {
      dispose();
    }
  });

  test('no match is a successful no-op', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>nothing here</w:t></w:r></w:p>');
    try {
      const before = bodyXml(editor);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'absent', text: 'x' })).toEqual({
        ok: true,
        changed: false,
        replacements: { replaced: 0, skipped: 0 },
      });
      expect(bodyXml(editor)).toBe(before);
    } finally {
      dispose();
    }
  });

  test('a field result is skipped and the plain text beside it is replaced', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>' +
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>Page</w:t></w:r></w:fldSimple></w:p>'
    );
    try {
      const result = editor.exec({ type: 'replaceAllMatches', query: 'Page', text: 'Sheet' });
      expect(result).toMatchObject({ ok: true, replacements: { replaced: 1, skipped: 1 } });
      const xml = bodyXml(editor);
      expect(xml).toContain('Sheet');
      expect(xml).toContain('w:instr=" PAGE "');
    } finally {
      dispose();
    }
  });

  test('a match in a locked content control is skipped; only locked matches refuse', () => {
    const locked =
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:r><w:t>locked term</w:t></w:r></w:p></w:sdtContent></w:sdt>';
    const free = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const { editor, dispose } = mount(
      free('free term') + free('term one') + locked + free('term two') + free('last term')
    );
    try {
      const original = bodyXml(editor);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'term', text: 'word' })).toMatchObject(
        { ok: true, changed: true, replacements: { replaced: 4, skipped: 1 } }
      );
      const xml = bodyXml(editor);
      for (const text of ['free word', 'word one', 'word two', 'last word', 'locked term'])
        expect(xml).toContain(text);
      // The halves that landed are still one undo step.
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(bodyXml(editor)).toBe(original);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(bodyXml(editor)).toBe(xml);

      const refused = editor.exec({ type: 'replaceAllMatches', query: 'locked', text: 'open' });
      expect(refused).toMatchObject({ ok: false, code: 'locked' });
      expect(bodyXml(editor)).toBe(xml);
    } finally {
      dispose();
    }
  });

  test('read-only document protection refuses the command', () => {
    const { editor, dispose } = mount(
      docx(
        '<w:p><w:r><w:t>term</w:t></w:r></w:p>',
        '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'
      )
    );
    try {
      const command = { type: 'replaceAllMatches' as const, query: 'term', text: 'word' };
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(bodyXml(editor)).toContain('>term<');
    } finally {
      dispose();
    }
  });

  test('viewing mode refuses the command', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>term</w:t></w:r></w:p>');
    try {
      expect(editor.setEditingMode('viewing').ok).toBe(true);
      const command = { type: 'replaceAllMatches' as const, query: 'term', text: 'word' };
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(bodyXml(editor)).toContain('>term<');
    } finally {
      dispose();
    }
  });

  test('malformed arguments are refused before anything is written', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>one two</w:t></w:r></w:p>');
    try {
      expect(editor.can({ type: 'replaceAllMatches', query: '', text: 'x' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(editor.exec({ type: 'replaceAllMatches', query: 'two', text: 'a\nb' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(
        editor.can({
          type: 'replaceAllMatches',
          query: 'two',
          text: 'x',
          matchCase: 'yes' as never,
        })
      ).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(bodyXml(editor)).toContain('one two');
    } finally {
      dispose();
    }
  });

  test('joins an explicit history group', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    try {
      const group = editor.beginHistoryGroup();
      expect(
        editor.exec(
          { type: 'replaceAllMatches', query: 'alpha', text: 'one' },
          { historyGroup: group }
        ).ok
      ).toBe(true);
      expect(
        editor.exec(
          { type: 'replaceAllMatches', query: 'beta', text: 'two' },
          { historyGroup: group }
        ).ok
      ).toBe(true);
      group.end();
      expect(editor.surface!.session.bodyText()).toContain('one two');
      editor.exec({ type: 'undo' });
      expect(editor.surface!.session.bodyText()).toContain('alpha beta');
    } finally {
      dispose();
    }
  });
});

describe('replaceAllMatches in suggesting mode', () => {
  test('records a tracked replacement in every story under the author, undone in one step', () => {
    const { editor, dispose } = mount(everyStoryDocx());
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const before = storyXml(editor);
      expect(
        editor.exec({ type: 'replaceAllMatches', query: 'Beta', text: 'Zeta', matchCase: true })
      ).toMatchObject({ ok: true, changed: true, replacements: { replaced: 7, skipped: 0 } });
      const after = storyXml(editor);
      for (const name of Object.keys(before)) {
        expect(after[name]).toMatch(
          /<w:del w:author="Grace Hopper"[^>]*><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:delText>Beta<\/w:delText>/
        );
        expect(after[name]).toMatch(/<w:ins w:author="Grace Hopper"[^>]*><w:r>.*?<w:t>Zeta<\/w:t>/);
      }
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(storyXml(editor)).toEqual(before);
    } finally {
      dispose();
    }
  });

  test('a caret after a tracked replacement moves past the inserted text', () => {
    const { editor, dispose } = mount(
      '<w:p><w:r><w:t xml:space="preserve">one two three</w:t></w:r></w:p>'
    );
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      const caret = { paragraphId, offset: 11 };
      editor.surface!.setSelection({ anchor: caret, head: caret });
      expect(editor.exec({ type: 'replaceAllMatches', query: 'two', text: 'seven' }).ok).toBe(true);
      // The struck "two" stays in the model text, so only the insertion shifts the caret.
      expect(editor.surface!.state().selection.head).toEqual({ paragraphId, offset: 16 });
    } finally {
      dispose();
    }
  });

  test('adjacent matches keep their replacements in order', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>abab</w:t></w:r></w:p>');
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'ab', text: 'X' })).toMatchObject({
        ok: true,
        replacements: { replaced: 2, skipped: 0 },
      });
      // Accepting every proposal leaves exactly the two replacements.
      expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' })).toMatchObject({
        ok: true,
      });
      expect(editor.surface!.session.bodyText()).toContain('XX');
      expect(editor.surface!.session.bodyText()).not.toContain('ab');
    } finally {
      dispose();
    }
  });
});
