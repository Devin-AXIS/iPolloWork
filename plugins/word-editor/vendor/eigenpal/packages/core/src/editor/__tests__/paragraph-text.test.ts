import { afterEach, describe, expect, test } from 'bun:test';
import { textboxDocx } from './textbox-editing-fixture.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import { mountAnchorEditor, replacePart } from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const byReviewer = 'w:author="Reviewer" w:date="2026-10-07T00:00:00Z"';

function mount(body: string) {
  const mounted = mountAnchorEditor(docx(body));
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

function blockOf(editor: ReturnType<typeof mount>, word: string): string {
  const [match] = editor.findMatches(word);
  if (!match) throw new Error(`no ${word}`);
  return match.blockId;
}

describe('getParagraphText', () => {
  test.each(['atomic', 'editable'] as const)(
    'uses %s field offsets for highlights',
    (fieldResults) => {
      const mounted = mountAnchorEditor(
        docx(
          p(
            run('Date '),
            '<w:fldSimple w:instr="DATE">' + run('11 November') + '</w:fldSimple>',
            run(' 😀 recieve')
          )
        ),
        { fieldResults }
      );
      cleanups.push(mounted.destroy);
      const editor = mounted.editor;
      const paragraph = editor.getParagraphText(blockOf(editor, 'recieve'))!;
      expect(paragraph.text).toBe(
        fieldResults === 'editable' ? 'Date 11 November 😀 recieve' : 'Date \uFFFC 😀 recieve'
      );
      expect(paragraph.acceptedText).toBe(paragraph.text);
      expect(editor.getParagraphs()[0]).toBe(paragraph);
      expect(
        editor.setHighlights('spelling', [
          {
            blockId: paragraph.blockId,
            start: paragraph.text.indexOf('recieve'),
            length: 7,
            expectedText: 'recieve',
          },
        ])
      ).toEqual({ applied: 1, unavailable: 0 });
    }
  );

  test.each(['del', 'moveFrom'])(
    'maps accepted text across %s without marking deleted characters',
    (kind) => {
      const editor = mount(
        p(
          run('😀 rec'),
          `<w:${kind} w:id="1" ${byReviewer}><w:r><w:delText>ie</w:delText></w:r></w:${kind}>`,
          `<w:ins w:id="2" ${byReviewer}>${run('ei')}</w:ins>`,
          run('ve')
        )
      );
      const paragraph = editor.getParagraphText(blockOf(editor, 'rec'))!;
      expect(paragraph.text).toBe('😀 recieeive');
      expect(paragraph.acceptedText).toBe('😀 receive');
      expect(paragraph.acceptedSpans).toEqual([
        { start: 0, length: 6, acceptedStart: 0 },
        { start: 8, length: 4, acceptedStart: 6 },
      ]);
      expect(
        editor.setHighlights(
          'kept',
          paragraph.acceptedSpans.map(({ start, length }) => ({
            blockId: paragraph.blockId,
            start,
            length,
            expectedText: paragraph.text.slice(start, start + length),
          }))
        )
      ).toEqual({ applied: 2, unavailable: 0 });
      expect(
        paragraph.acceptedSpans
          .map(({ start, length }) => paragraph.text.slice(start, start + length))
          .join('')
      ).toBe(paragraph.acceptedText);
    }
  );

  test('reads optional hyphens, non-breaking hyphens and symbols as they show', () => {
    const editor = mount(
      p(
        run('co'),
        '<w:r><w:softHyphen/></w:r>',
        run('operate well'),
        '<w:r><w:noBreakHyphen/></w:r>',
        run('known '),
        '<w:r><w:sym w:font="Wingdings" w:char="F04A"/></w:r>'
      )
    );
    const [paragraph] = editor.getParagraphs();
    expect(paragraph?.text).toBe('co\u001foperate well\u001eknown (');
    expect(paragraph?.acceptedText).toBe('cooperate well\u2011known \uFFFC');
    expect(paragraph?.acceptedSpans).toEqual([
      { start: 0, length: 2, acceptedStart: 0 },
      { start: 3, length: 20, acceptedStart: 2 },
    ]);
  });

  test.each(['', 'Plain text'])('maps an unchanged paragraph: %s', (text) => {
    const editor = mount(p(run(text)));
    const [paragraph] = editor.getParagraphs();
    expect(paragraph?.acceptedText).toBe(text);
    expect(paragraph?.acceptedSpans).toEqual(
      text ? [{ start: 0, length: text.length, acceptedStart: 0 }] : []
    );
  });

  test.each(['', 'kept'])('maps leading, adjacent and trailing deletions around %s', (kept) => {
    const deleted = `<w:del w:id="1" ${byReviewer}><w:r><w:delText>x</w:delText></w:r></w:del>`;
    const editor = mount(p(deleted, deleted, run(kept), deleted));
    const [paragraph] = editor.getParagraphs();
    expect(paragraph?.acceptedText).toBe(kept);
    expect(paragraph?.acceptedSpans).toEqual(
      kept ? [{ start: 2, length: 4, acceptedStart: 0 }] : []
    );
  });

  test('returns null for an id the document does not hold', () => {
    const editor = mount(p(run('Plain text')));

    expect(editor.getParagraphText('/word/document.xml#0.0.999')).toBeNull();
  });
});

describe('getParagraphs', () => {
  test('reads every paragraph before its page is painted, in model order', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `Line ${index}.`);
    const editor = mount(lines.map((text) => p(run(text))).join(''));
    const paragraphs = editor.getParagraphs();
    expect(paragraphs.map(({ text }) => text)).toEqual(lines);
    editor.scrollToBlock(paragraphs[399]!.blockId);
    expect(editor.getParagraphs()).toBe(paragraphs);
  });

  test('reuses unchanged paragraphs across edits, undo and redo', () => {
    const editor = mount(p(run('First')) + p(run('Second')));
    const before = editor.getParagraphs();
    const match = editor.findMatches('First')[0]!;
    expect(editor.exec({ type: 'replaceMatch', match, text: 'Changed' }).ok).toBe(true);
    const after = editor.getParagraphs();
    expect(after[0]?.acceptedText).toBe('Changed');
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after[0])).toBe(true);
    expect(Object.isFrozen(after[0]!.acceptedSpans)).toBe(true);
    expect(Object.isFrozen(after[0]!.acceptedSpans[0])).toBe(true);
    expect(editor.getParagraphText(after[0]!.blockId)).toBe(after[0]);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.getParagraphs()[0]?.acceptedText).toBe('First');
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(editor.getParagraphs()[0]?.acceptedText).toBe('Changed');
  });

  test('reads headers, footers and notes once, independent of the active story', () => {
    const mounted = mountAnchorEditor(storyParityDocx());
    cleanups.push(mounted.destroy);
    const paragraphs = mounted.editor.getParagraphs();
    const alpha = paragraphs.filter(({ text }) => text === 'Alpha');
    expect(alpha).toHaveLength(5);
    expect(new Set(paragraphs.map(({ blockId }) => blockId)).size).toBe(paragraphs.length);
    for (const paragraph of alpha) {
      expect(mounted.editor.getParagraphText(paragraph.blockId)).toBe(paragraph);
      expect(
        mounted.editor.setHighlights('story', [
          { blockId: paragraph.blockId, start: 0, length: 5, expectedText: 'Alpha' },
        ])
      ).toEqual({ applied: 1, unavailable: 0 });
    }
    expect(paragraphs).toHaveLength(26);
  });

  test('includes table cells and the active text-box copy once', () => {
    const boxText = '<w:txbxContent>' + p(run('boxed needle')) + '</w:txbxContent>';
    const bytes = replacePart(textboxDocx(), 'word/document.xml', (xml) =>
      xml
        .replace(
          '<mc:Fallback><w:pict/></mc:Fallback>',
          '<mc:Fallback><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox>' +
            boxText +
            '</v:textbox></v:shape></w:pict></mc:Fallback>'
        )
        .replace(
          '</w:body>',
          '<w:tbl><w:tr><w:tc>' + p(run('Cell')) + '</w:tc></w:tr></w:tbl></w:body>'
        )
    );
    const mounted = mountAnchorEditor(bytes);
    cleanups.push(mounted.destroy);
    const paragraphs = mounted.editor.getParagraphs();
    // A story that ends with a table gets an empty paragraph after it.
    expect(paragraphs.map(({ text }) => text)).toEqual([
      'body',
      '\uFFFC',
      'boxed needle',
      'Cell',
      '',
    ]);
    const boxed = paragraphs[2]!;
    expect(mounted.editor.getParagraphText(boxed.blockId)).toBe(boxed);
    expect(
      mounted.editor.setHighlights('box', [
        { blockId: boxed.blockId, start: 0, length: boxed.text.length, expectedText: boxed.text },
      ])
    ).toEqual({ applied: 1, unavailable: 0 });
  });

  test('reloads paragraphs even when node ids repeat', async () => {
    const editor = mount(p(run('Before')));
    const [before] = editor.getParagraphs();
    await editor.load(docx(p(run('After'))));
    const [after] = editor.getParagraphs();
    expect(after?.text).toBe('After');
    expect(after).not.toBe(before);
  });
});
