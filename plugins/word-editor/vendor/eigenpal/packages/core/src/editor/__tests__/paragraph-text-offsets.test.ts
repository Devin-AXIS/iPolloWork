// Offsets between `ParagraphText.text` and `acceptedText`, saved field results for a checker,
// and the identity a host compares to drop a result of a document that is no longer open.

import { afterEach, describe, expect, test } from 'bun:test';
import { acceptedOffsetFromText, textOffsetFromAccepted } from '../paragraph-text-ranges.ts';
import { acceptedTextRanges } from '../paragraph-text-ranges.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const deleted = (text: string) =>
  '<w:del w:id="1" w:author="Reviewer" w:date="2026-10-07T00:00:00Z">' +
  `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

function mount(body: string, fieldResults?: 'atomic' | 'editable') {
  const mounted = mountAnchorEditor(docx(body), fieldResults ? { fieldResults } : {});
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

describe('offsets between text and acceptedText', () => {
  // text: "ab" + deleted "XY" + "cd"; acceptedText: "abcd".
  const body = p(run('ab'), deleted('XY'), run('cd'));

  test('maps text offsets to accepted offsets, and a gap to where it starts', () => {
    const paragraph = mount(body).getParagraphs()[0]!;
    expect(paragraph.text).toBe('abXYcd');
    expect([0, 1, 2, 3, 4, 5, 6, 99].map((at) => acceptedOffsetFromText(paragraph, at))).toEqual([
      0, 1, 2, 2, 2, 3, 4, 4,
    ]);
  });

  test('maps accepted offsets to text offsets, and a gap to the text before it', () => {
    const paragraph = mount(body).getParagraphs()[0]!;
    expect([0, 1, 2, 3, 4, 99].map((at) => textOffsetFromAccepted(paragraph, at))).toEqual([
      0, 1, 2, 5, 6, 6,
    ]);
  });

  test('maps an empty paragraph and a paragraph that is all deleted to zero', () => {
    const editor = mount(p(run('')) + p(deleted('gone')));
    for (const paragraph of editor.getParagraphs()) {
      expect(acceptedOffsetFromText(paragraph, 2)).toBe(0);
      expect(textOffsetFromAccepted(paragraph, 0)).toBe(0);
    }
  });
});

describe('saved field results for proofing', () => {
  const body = p(
    run('See '),
    '<w:fldSimple w:instr="REF bookmark \\h">' + run('the clause') + '</w:fldSimple>',
    run(' here')
  );

  test('reads a field as its result without changing the field offsets', () => {
    const editor = mount(body);
    const plain = editor.getParagraphs()[0]!;
    const results = editor.getParagraphs({ fields: 'result' })[0]!;
    expect(plain.acceptedText).toBe('See ￼ here');
    expect(results.text).toBe(plain.text);
    expect(results.acceptedText).toBe('See the clause here');
    // The result has no `text` offsets: the spans skip it, so a highlight never covers it.
    expect(results.acceptedSpans).toEqual([
      { start: 0, length: 4, acceptedStart: 0 },
      { start: 5, length: 5, acceptedStart: 14 },
    ]);
    expect(acceptedTextRanges(results, 14, 19)[0]).toMatchObject({ start: 5, length: 5 });
    expect(results.proofing.reduce((sum, stretch) => sum + stretch.length, 0)).toBe(19);
    expect(acceptedOffsetFromText(results, 4)).toBe(4);
    expect(textOffsetFromAccepted(results, 8)).toBe(4);
  });

  test('keeps one object per option and leaves the editing mode alone', () => {
    const editor = mount(body);
    const results = editor.getParagraphs({ fields: 'result' });
    const plain = editor.getParagraphs();
    expect(editor.getParagraphs({ fields: 'result' })).toBe(results);
    expect(editor.getParagraphs({ fields: 'object' })).toBe(plain);
    expect(editor.getParagraphText(plain[0]!.blockId, { fields: 'result' })).toBe(results[0]);
    expect(editor.getParagraphText(plain[0]!.blockId)).toBe(plain[0]);
    expect(editor.findMatches('the clause')[0]?.text).toBe('the clause');
    expect(() => editor.getParagraphs({ fields: 'all' as never })).toThrow(TypeError);
  });

  test('reads a result that the editable mode does not make text', () => {
    // REF is not an editable field type, so it stays one object in that mode.
    const editor = mount(body, 'editable');
    expect(editor.getParagraphs()[0]!.acceptedText).toBe('See ￼ here');
    expect(editor.getParagraphs({ fields: 'result' })[0]!.acceptedText).toBe('See the clause here');
  });
});

describe('document identity', () => {
  test('a load keeps block ids but changes loadId', async () => {
    const editor = mount(p(run('Before')));
    const before = { blockId: editor.getParagraphs()[0]!.blockId, ...editor.getDocumentHandle() };
    await editor.load(docx(p(run('After'))));
    expect(editor.getParagraphs()[0]!.blockId).toBe(before.blockId);
    expect(editor.getDocumentHandle().loadId).not.toBe(before.loadId);
  });
});
