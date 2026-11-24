import { afterEach, describe, expect, test } from 'bun:test';
import type { ParagraphsChangeEvent } from '../../contracts/editor-events.ts';
import { docx, formatDefaultsDocx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor, replacePart } from './scroll-to-anchor-fixture.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import { textboxDocx } from './textbox-editing-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string) => `<w:p>${run(text)}</w:p>`;
const table = (...cells: string[]) =>
  `<w:tbl><w:tblGrid>${cells.map(() => '<w:gridCol w:w="2000"/>').join('')}</w:tblGrid><w:tr>${cells
    .map((cell) => `<w:tc>${p(cell)}</w:tc>`)
    .join('')}</w:tr></w:tbl>`;

function mount(bytes: Uint8Array) {
  const mounted = mountAnchorEditor(bytes);
  cleanups.push(mounted.destroy);
  const editor = mounted.editor;
  const events: ParagraphsChangeEvent[] = [];
  const order: string[] = [];
  editor.on('change', () => order.push('change'));
  editor.on('paragraphsChange', (event) => {
    order.push('paragraphsChange');
    events.push(event);
  });
  return { editor, events, order };
}

function idOf(editor: ReturnType<typeof mount>['editor'], word: string): string {
  const [match] = editor.findMatches(word);
  if (!match) throw new Error(`no ${word}`);
  return match.blockId;
}

function caretAt(editor: ReturnType<typeof mount>['editor'], word: string, after = 0) {
  const [match] = editor.findMatches(word);
  if (!match) throw new Error(`no ${word}`);
  const caret = { paragraphId: match.blockId, offset: match.start + after };
  expect(editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } }).ok).toBe(
    true
  );
}

describe('paragraphsChange', () => {
  test('removing styles reports the changed proofing language', () => {
    const body = p('alpha');
    const bytes = replacePart(formatDefaultsDocx(body), 'word/styles.xml', (xml) =>
      xml.replace('<w:kern w:val="2"/>', '<w:lang w:val="fr-FR"/>')
    );
    const { editor, events } = mount(bytes);
    const before = editor.getParagraphs()[0]!;
    expect(before.proofing[0]!.lang).toBe('fr-FR');
    expect(editor.exec({ type: 'replaceDocument', docx: docx(body) }).ok).toBe(true);
    expect(editor.getParagraphs()[0]!.proofing[0]!.lang).toBeNull();
    expect(events).toMatchObject([{ changed: [before.blockId], added: [], deleted: [] }]);
  });

  test('page-fit selection listeners cannot suppress the replacement paragraph event', () => {
    const mounted = mountAnchorEditor(docx(p('alpha') + p('bravo')));
    cleanups.push(mounted.destroy);
    const { editor, scroller } = mounted;
    Object.defineProperty(scroller, 'clientWidth', { value: 700, configurable: true });
    editor.setZoom(1);
    editor.setZoomMode('auto');
    const alpha = idOf(editor, 'alpha');
    const bravo = idOf(editor, 'bravo');
    const events: ParagraphsChangeEvent[] = [];
    editor.on('paragraphsChange', (event) => events.push(event));
    let edited = false;
    let accepted = false;
    editor.on('selectionChange', () => {
      if (edited) return;
      edited = true;
      accepted = editor.exec({
        type: 'replaceAcceptedText',
        match: { blockId: bravo, start: 0, length: 5, expectedText: 'bravo' },
        text: 'bravely',
      }).ok;
    });
    const beforeZoom = editor.getZoom();
    const replacement = docx(
      p('alpine') + p('bravo') + '<w:sectPr><w:pgSz w:w="15840" w:h="12240"/></w:sectPr>'
    );
    expect(editor.exec({ type: 'replaceDocument', docx: replacement }).ok).toBe(true);
    expect(editor.getZoom()).toBeLessThan(beforeZoom);
    expect(accepted).toBe(true);
    expect(events.map((event) => event.changed)).toEqual([[alpha], [bravo]]);
    expect(events[0]!.revision).toBeLessThan(events[1]!.revision);
  });

  test('a change listener loading another document cancels the old paragraph event', () => {
    const { editor, events } = mount(docx(p('alpha')));
    let loaded = false;
    editor.on('change', () => {
      if (loaded) return;
      loaded = true;
      editor.load(docx(p('replacement')));
    });
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(editor.getParagraphs()[0]!.text).toBe('replacement');
    expect(events).toEqual([]);
  });

  test('a change listener destroying the editor cancels the old paragraph event', () => {
    const { editor, events } = mount(docx(p('alpha')));
    editor.on('change', () => editor.destroy());
    editor.exec({ type: 'insertText', text: 'x' });
    expect(events).toEqual([]);
  });

  test('a paragraph listener loading a document stops remaining old-session listeners', () => {
    const { editor, events } = mount(docx(p('alpha')));
    editor.on('paragraphsChange', () => editor.load(docx(p('replacement'))));
    let staleCalls = 0;
    editor.on('paragraphsChange', () => staleCalls++);
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(staleCalls).toBe(0);
    expect(editor.getParagraphs()[0]!.text).toBe('replacement');
  });

  test('listener edits keep both paragraph events in revision order', () => {
    const { editor, events, order } = mount(docx(p('alpha') + p('bravo')));
    const alpha = idOf(editor, 'alpha');
    const bravo = idOf(editor, 'bravo');
    let edited = false;
    editor.on('change', () => {
      if (edited) return;
      edited = true;
      expect(
        editor.exec({
          type: 'replaceAcceptedText',
          match: { blockId: bravo, start: 0, length: 5, expectedText: 'bravo' },
          text: 'bravely',
        }).ok
      ).toBe(true);
    });
    expect(
      editor.exec({
        type: 'replaceAcceptedText',
        match: { blockId: alpha, start: 0, length: 5, expectedText: 'alpha' },
        text: 'alpine',
      }).ok
    ).toBe(true);
    expect(events.map((event) => event.changed)).toEqual([[alpha], [bravo]]);
    expect(events[0]!.revision).toBeLessThan(events[1]!.revision);
    expect(order).toEqual(['change', 'paragraphsChange', 'change', 'paragraphsChange']);
  });

  test('typing lists the edited paragraph once, after the change event', () => {
    const { editor, events, order } = mount(docx(p('alpha') + p('bravo')));
    const bravo = idOf(editor, 'bravo');
    caretAt(editor, 'bravo');
    expect(events).toHaveLength(0);
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(events).toEqual([
      { added: [], changed: [bravo], deleted: [], source: 'local', revision: expect.any(Number) },
    ]);
    expect(order).toEqual(['change', 'paragraphsChange']);
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  test('a split adds a paragraph, and undo and redo report local changes', () => {
    const { editor, events } = mount(docx(p('headtail') + p('other')));
    const head = idOf(editor, 'headtail');
    caretAt(editor, 'headtail', 4);
    expect(editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
    const ids = editor.getParagraphs().map((paragraph) => paragraph.blockId);
    expect(ids).toHaveLength(3);
    const added = ids.find((id) => id !== head && id !== idOf(editor, 'other'))!;
    const split = events.at(-1)!;
    expect(new Set([...split.added, ...split.changed])).toEqual(new Set([head, added]));
    expect(split.added).toContain(added);
    expect(split.deleted).toEqual([]);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undo = events.at(-1)!;
    expect(undo.source).toBe('local');
    expect(undo.deleted).toEqual([added]);
    expect(undo.changed).toEqual([head]);

    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(events.at(-1)).toMatchObject({ source: 'local', added: [added], changed: [head] });
  });

  test('a merge across paragraphs deletes the second one', () => {
    const { editor, events } = mount(docx(p('first') + p('second')));
    const first = idOf(editor, 'first');
    const second = idOf(editor, 'second');
    const anchor = { paragraphId: first, offset: 3 };
    const head = { paragraphId: second, offset: 2 };
    expect(editor.exec({ type: 'setSelection', range: { anchor, head } }).ok).toBe(true);
    expect(editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(events.at(-1)).toMatchObject({ changed: [first], deleted: [second], added: [] });
  });

  test('an edit in a table cell lists only that cell paragraph', () => {
    const { editor, events } = mount(docx(table('left', 'right') + p('after')));
    const right = idOf(editor, 'right');
    caretAt(editor, 'right');
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(events.at(-1)).toMatchObject({ changed: [right], added: [], deleted: [] });
  });

  test('a replacement in a header lists the header paragraph', () => {
    const { editor, events } = mount(storyParityDocx());
    // Body first, then the other stories: the second `Alpha` is outside the body.
    const header = editor.getParagraphs().filter(({ text }) => text === 'Alpha')[1]!;
    expect(
      editor.exec({
        type: 'replaceAcceptedText',
        match: { blockId: header.blockId, start: 0, length: 5, expectedText: 'Alpha' },
        text: 'Alpine',
      }).ok
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ changed: [header.blockId], added: [], deleted: [] });
  });

  test('an edit in a text box lists the text box paragraph', () => {
    const { editor, events } = mount(textboxDocx());
    const box = editor.getParagraphs().find(({ text }) => text === 'boxed needle')!;
    expect(
      editor.exec({
        type: 'replaceAcceptedText',
        match: { blockId: box.blockId, start: 0, length: 5, expectedText: 'boxed' },
        text: 'boxes',
      }).ok
    ).toBe(true);
    expect(events.at(-1)!.changed).toContain(box.blockId);
    expect(events.at(-1)!.added).toEqual([]);
    expect(events.at(-1)!.deleted).toEqual([]);
  });

  test('a listener added after unheard edits sees only its own commit', () => {
    const mounted = mountAnchorEditor(docx(p('alpha') + p('bravo')));
    cleanups.push(mounted.destroy);
    const editor = mounted.editor;
    caretAt(editor, 'alpha');
    expect(editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    const events: ParagraphsChangeEvent[] = [];
    editor.on('paragraphsChange', (event) => events.push(event));
    caretAt(editor, 'bravo');
    expect(editor.exec({ type: 'insertText', text: 'y' }).ok).toBe(true);
    expect(events).toMatchObject([{ added: [], changed: [idOf(editor, 'ybravo')], deleted: [] }]);
  });

  test('replaceDocument fires it as an undoable edit, unlike load', () => {
    const { editor, events } = mount(docx(p('alpha') + p('bravo')));
    const before = editor.getParagraphs().map(({ blockId }) => blockId);
    expect(editor.exec({ type: 'replaceDocument', docx: docx(p('other text')) }).ok).toBe(true);
    expect(events).toHaveLength(1);
    const [event] = events;
    const now = editor.getParagraphs().map(({ blockId }) => blockId);
    for (const id of now) expect([...event!.added, ...event!.changed]).toContain(id);
    for (const id of before.filter((id) => !now.includes(id))) {
      expect(event!.deleted).toContain(id);
    }
  });

  test.each([false, true])(
    'the first observed replacement reports removed stories after unheard edits: %s',
    (unheardEdit) => {
      const mounted = mountAnchorEditor(storyParityDocx());
      cleanups.push(mounted.destroy);
      const editor = mounted.editor;
      if (unheardEdit) editor.exec({ type: 'insertText', text: 'x' });
      const before = editor.getParagraphs().map(({ blockId }) => blockId);
      const events: ParagraphsChangeEvent[] = [];
      editor.on('paragraphsChange', (event) => events.push(event));
      expect(editor.exec({ type: 'replaceDocument', docx: docx(p('replacement')) }).ok).toBe(true);
      const after = new Set(editor.getParagraphs().map(({ blockId }) => blockId));
      expect(new Set(events.flatMap((event) => event.deleted))).toEqual(
        new Set(before.filter((id) => !after.has(id)))
      );
    }
  );

  test('selection, highlights and loads never fire it', async () => {
    const { editor, events } = mount(docx(p('alpha beta')));
    caretAt(editor, 'alpha', 2);
    editor.setHighlights('spelling', editor.findMatches('beta'), { kind: 'spelling' });
    editor.clearHighlights();
    await editor.load(docx(p('other text')));
    expect(events).toHaveLength(0);
  });
});
