// `replaceAcceptedText` fixes a range of `ParagraphText.acceptedText`.
//
// A word that a tracked deletion splits reads as one word to a checker, and its fix names a
// range of that text. Replacing the whole range struck letters that were never wrong and moved
// the other author's deletion out of the word; stitching a fix per part took several undo
// steps. The command edits only the graphemes that differ, in one commit.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { docx } from './paginated-surface-fixtures.ts';
import { replacePart } from './scroll-to-anchor-fixture.ts';
import { textboxDocx } from './textbox-editing-fixture.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import { differingRange } from '../grapheme-diff.ts';
import { fix, openReviewEditor } from './replace-accepted-text-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const deleted = (text: string, id = 1) =>
  `<w:del w:id="${id}" w:author="Reviewer" w:date="2026-10-07T00:00:00Z">` +
  `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

function open(bytes: Uint8Array) {
  const mounted = openReviewEditor(bytes);
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

const mount = (body: string) => open(docx(body));
const first = (editor: ReturnType<typeof mount>) => editor.getParagraphs()[0]!;
const xmlOf = (editor: ReturnType<typeof mount>) =>
  serializeOoxmlPart(editor.surface!.session.part());

describe('differingRange', () => {
  test.each([
    ['agrement', 'agreement', { from: 4, to: 4, text: 'e' }],
    ['recieve', 'receive', { from: 3, to: 5, text: 'ei' }],
    ['same', 'same', { from: 4, to: 4, text: '' }],
    ['teh cat', 'the cat', { from: 1, to: 3, text: 'he' }],
    // A cut never splits a surrogate pair: both emoji share their high surrogate.
    ['a\u{1F600}b', 'a\u{1F601}b', { from: 1, to: 3, text: '\u{1F601}' }],
    // A cut never splits a base letter from its combining mark.
    ['café', 'cafè', { from: 3, to: 5, text: 'è' }],
    ['éx', 'éy', { from: 2, to: 3, text: 'y' }],
  ])('%s to %s', (before, after, expected) => {
    expect(differingRange(before, after)).toEqual(expected);
  });
});

describe('replaceAcceptedText in editing mode', () => {
  test('fixes a word split by a tracked deletion and keeps the deletion in the word', () => {
    const editor = mount(p(run('agre'), deleted('e'), run('ment')));
    const paragraph = first(editor);
    expect(paragraph.acceptedText).toBe('agrement');
    const result = editor.exec(fix(paragraph.blockId, 0, 8, 'agreement', 'agrement'));
    expect(result).toEqual({ ok: true, changed: true });
    const fixed = first(editor);
    expect(fixed.acceptedText).toBe('agreement');
    // "agree" + the reviewer's deleted "e" + "ment": only one letter was written.
    expect(fixed.text).toBe('agreeement');
    expect(fixed.acceptedSpans).toEqual([
      { start: 0, length: 5, acceptedStart: 0 },
      { start: 6, length: 4, acceptedStart: 5 },
    ]);
    expect(xmlOf(editor)).not.toContain('<w:ins ');

    editor.exec({ type: 'undo' });
    expect(first(editor).acceptedText).toBe('agrement');
  });

  test('edits every part of a range from the end to the start in one undo step', () => {
    const editor = mount(p(run('ab'), deleted('X'), run('cd')));
    expect(editor.exec(fix(first(editor).blockId, 0, 4, 'aZd')).ok).toBe(true);
    expect(first(editor).acceptedText).toBe('aZd');
    expect(first(editor).text).toBe('aZXd');
    editor.exec({ type: 'undo' });
    expect(first(editor).text).toBe('abXcd');
  });

  test('joins an open history group', () => {
    const editor = mount(p(run('teh cat and teh dog')));
    const blockId = first(editor).blockId;
    const group = editor.beginHistoryGroup();
    for (const start of [0, 12]) {
      expect(editor.exec(fix(blockId, start, 3, 'the'), { historyGroup: group }).ok).toBe(true);
    }
    group.end();
    expect(first(editor).acceptedText).toBe('the cat and the dog');
    editor.exec({ type: 'undo' });
    expect(first(editor).acceptedText).toBe('teh cat and teh dog');
  });

  test('a caret later in the paragraph moves with its text', () => {
    const editor = mount(p(run('recieve it now')));
    const blockId = first(editor).blockId;
    const caret = { paragraphId: blockId, offset: 11 };
    editor.surface!.setSelection({ anchor: caret, head: caret });
    expect(editor.exec(fix(blockId, 0, 7, 'received')).ok).toBe(true);
    expect(editor.surface!.state().selection.head).toEqual({ paragraphId: blockId, offset: 12 });
  });

  test('a stale or unknown range returns notFound and changes nothing', () => {
    const editor = mount(p(run('teh cat')));
    const blockId = first(editor).blockId;
    const revision = editor.getDocumentHandle().revision;
    for (const command of [
      fix(blockId, 0, 3, 'the', 'tha'),
      fix(blockId, 5, 9, 'the'),
      fix('/word/document.xml#0.0.999', 0, 3, 'the'),
    ]) {
      expect(editor.can(command).ok).toBe(false);
      const result = editor.exec(command);
      expect(result.ok ? null : result.code).toBe('notFound');
    }
    expect(editor.getDocumentHandle().revision).toBe(revision);
    expect(first(editor).acceptedText).toBe('teh cat');
  });

  test('refuses malformed arguments and edits while viewing', () => {
    const editor = mount(p(run('teh cat')));
    const blockId = first(editor).blockId;
    const lineBreak = editor.exec(fix(blockId, 0, 3, 'the\nnew'));
    expect(lineBreak.ok ? null : lineBreak.code).toBe('invalidArgs');
    const negative = editor.can(fix(blockId, -1, 3, 'the'));
    expect(negative.ok ? null : negative.code).toBe('invalidArgs');
    expect(editor.can(fix(blockId, 0, 3, 'the')).ok).toBe(true);
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    const viewing = editor.exec(fix(blockId, 0, 3, 'the'));
    expect(viewing.ok ? null : viewing.code).toBe('locked');
  });

  test('an unchanged range changes nothing', () => {
    const editor = mount(p(run('the cat')));
    expect(editor.exec(fix(first(editor).blockId, 0, 3, 'the'))).toEqual({
      ok: true,
      changed: false,
    });
  });

  test('a scope that does not hold the paragraph returns invalidArgs', () => {
    const editor = mount(p(run('teh cat')));
    const blockId = first(editor).blockId;
    const frame = {
      kind: 'frame' as const,
      id: 'x',
      drawingNodeId: 'y',
      hostParagraphId: blockId,
    };
    for (const scope of [{ kind: 'headerFooter' as const, rId: 'rId9' }, frame]) {
      const command = fix(blockId, 0, 3, 'the');
      const scoped = { ...command, match: { ...command.match, scope } };
      expect(editor.can(scoped)).toMatchObject({ ok: false, code: 'invalidArgs' });
      const result = editor.exec(scoped);
      expect(result.ok ? null : result.reason).toContain('scope');
      expect(result.ok ? null : result.code).toBe('invalidArgs');
    }
    expect(first(editor).acceptedText).toBe('teh cat');
  });
});

describe('objects in the range', () => {
  const body = p(
    run('a '),
    '<w:fldSimple w:instr="PAGE">' + run('1') + '</w:fldSimple>',
    run(' b')
  );

  test('refuses a fix that writes U+FFFC or removes an object', () => {
    const editor = mount(body);
    const paragraph = first(editor);
    expect(paragraph.acceptedText).toBe('a \uFFFC b');
    const before = xmlOf(editor);
    const added = fix(paragraph.blockId, 0, 5, 'a \uFFFC\uFFFC b');
    expect(editor.can(added)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.exec(added)).toMatchObject({ ok: false, code: 'invalidArgs' });
    const removed = fix(paragraph.blockId, 0, 5, 'A c');
    expect(editor.can(removed)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(editor.exec(removed)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(xmlOf(editor)).toBe(before);
  });

  test('edits the letters on both sides of an object and keeps the object', () => {
    const editor = mount(body);
    expect(editor.exec(fix(first(editor).blockId, 0, 5, 'A \uFFFC c')).ok).toBe(true);
    expect(first(editor).acceptedText).toBe('A \uFFFC c');
    expect(xmlOf(editor)).toContain('w:instr="PAGE"');
    expect(xmlOf(editor)).not.toContain('\uFFFC');
  });
});

describe('replaceAcceptedText in suggesting mode', () => {
  test('inserts only the missing letter as a tracked insertion under the author', () => {
    const editor = mount(p(run('agre'), deleted('e'), run('ment')));
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    expect(editor.exec(fix(first(editor).blockId, 0, 8, 'agreement')).ok).toBe(true);
    const xml = xmlOf(editor);
    expect(xml.match(/<w:ins [^>]*w:author="Grace Hopper"/g)).toHaveLength(1);
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:t[^>]*>e<\/w:t><\/w:r><\/w:ins>/);
    expect(xml.match(/<w:delText/g)).toHaveLength(1);
    expect(first(editor).acceptedText).toBe('agreement');
  });

  test('strikes the wrong letters and inserts the fix after them', () => {
    const editor = mount(p(run('recieve')));
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    expect(editor.exec(fix(first(editor).blockId, 0, 7, 'receive')).ok).toBe(true);
    expect(xmlOf(editor)).toContain('<w:delText>ie</w:delText>');
    expect(first(editor).acceptedText).toBe('receive');
    expect(first(editor).text).toBe('recieeive');
  });
});

describe('replaceAcceptedText in text boxes', () => {
  test.each([false, true])('edits a text box without opening it (header: %p)', (inHeader) => {
    const editor = open(textboxDocx(inHeader, true));
    const box = editor
      .getParagraphs()
      .find(
        (paragraph) =>
          paragraph.acceptedText === 'boxed needle' &&
          paragraph.blockId.includes(inHeader ? 'header' : 'document')
      )!;
    const command = fix(box.blockId, 0, 5, 'boxes', 'boxed');
    expect(editor.can(command).ok).toBe(true);
    expect(editor.exec(command).ok).toBe(true);
    expect(editor.getParagraphText(box.blockId)?.acceptedText).toBe('boxes needle');
    expect(editor.surface!.activeScope()).toEqual({ kind: 'body' });
    editor.exec({ type: 'undo' });
    expect(editor.getParagraphText(box.blockId)?.acceptedText).toBe('boxed needle');
  });

  test('edits a text box in a footnote without opening it', () => {
    const documentXml = strFromU8(unzipSync(textboxDocx())['word/document.xml']!);
    const start = documentXml.indexOf('<w:r><mc:AlternateContent');
    const end =
      documentXml.indexOf('</mc:AlternateContent></w:r>') + '</mc:AlternateContent></w:r>'.length;
    const box = documentXml.slice(start, end);
    const bytes = replacePart(storyParityDocx(), 'word/footnotes.xml', (xml) =>
      xml.replace('<w:footnote w:id="1">', `<w:footnote w:id="1"><w:p>${box}</w:p>`)
    );
    const editor = open(bytes);
    const paragraph = editor
      .getParagraphs()
      .find(
        (candidate) => candidate.blockId.includes('footnotes') && candidate.text === 'boxed needle'
      );
    expect(paragraph).toBeDefined();
    expect(editor.exec(fix(paragraph!.blockId, 0, 5, 'boxes')).ok).toBe(true);
    expect(editor.getParagraphText(paragraph!.blockId)?.acceptedText).toBe('boxes needle');
    expect(editor.surface!.activeScope()).toEqual({ kind: 'body' });
  });
});
