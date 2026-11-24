// `replaceMatch` replaces one `findMatches` result where it stands.
//
// It was classified as unsupported in every mode, so a host holding a match had to move the
// selection with `selectMatch` first, which scrolls and takes the reader's caret. Suggesting
// must record a tracked replacement under the editor's author; editing replaces outright.
// Either way the selection and the viewport stay where the reader left them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { EditorModule } from '../../contracts/modules.ts';

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

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

/** Enough paragraphs that the last one is far below the first screen. */
const LONG = Array.from(
  { length: 120 },
  (_, index) =>
    `<w:p><w:r><w:t>${index === 110 ? 'the far target word here' : `paragraph ${index}`}</w:t></w:r></w:p>`
).join('');

/** An editor inside a scroll container whose geometry is stated, as happy-dom reports none. */
function mount(body: string): {
  editor: DocxEditorInstance;
  scroller: HTMLElement;
  dispose(): void;
} {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrollTop = options.top ?? 0;
  }) as HTMLElement['scrollTo'];
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return {
    editor,
    scroller,
    dispose() {
      editor.destroy();
      scroller.remove();
    },
  };
}

const xmlOf = (editor: DocxEditorInstance): string =>
  serializeOoxmlPart(editor.surface!.session.part());

/** Put a caret on the first page and keep the pages focused, so a follow would scroll. */
function caretAtTop(editor: DocxEditorInstance) {
  const first = editor.surface!.session.paragraphIds()[0]!;
  const caret = { paragraphId: first, offset: 2 };
  editor.surface!.setSelection({ anchor: caret, head: caret });
  editor.focus();
  return { anchor: caret, head: caret };
}

describe('replaceMatch in suggesting mode', () => {
  test('records a tracked replacement and leaves the selection and the page alone', async () => {
    const { editor, scroller, dispose } = mount(LONG);
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const selection = caretAtTop(editor);
      expect(scroller.scrollTop).toBe(0);
      const [match] = editor.findMatches('target');
      expect(match).toBeDefined();

      const command = { type: 'replaceMatch' as const, match: match!, text: 'chosen' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });

      const xml = xmlOf(editor);
      expect(xml).toMatch(
        /<w:del w:author="Grace Hopper"[^>]*><w:r><w:delText>target<\/w:delText>/
      );
      expect(xml).toMatch(/<w:ins w:author="Grace Hopper"[^>]*><w:r><w:t>chosen<\/w:t>/);
      // The strike stays in place and the insertion follows it.
      const tracked = editor.getTrackedChanges().map((change) => [change.kind, change.author]);
      expect(tracked).toEqual([
        ['delete', 'Grace Hopper'],
        ['insert', 'Grace Hopper'],
      ]);
      expect(editor.surface!.state().selection).toEqual(selection);
      // Nor on a repaint the commit left behind.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(scroller.scrollTop).toBe(0);
      expect(editor.surface!.state().selection).toEqual(selection);

      // One undo step takes both halves back.
      editor.exec({ type: 'undo' });
      expect(xmlOf(editor)).not.toContain('<w:del ');
      expect(xmlOf(editor)).not.toContain('chosen');
      expect(xmlOf(editor)).toContain('the far target word here');

      // The viewport can see a scroll: selecting the match first is what moves it.
      expect(editor.selectMatch(editor.findMatches('target')[0]!).ok).toBe(true);
      expect(scroller.scrollTop).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  test('an empty replacement is a tracked deletion only', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>keep drop keep</w:t></w:r></w:p>');
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const [match] = editor.findMatches('drop');
      expect(editor.exec({ type: 'replaceMatch', match: match!, text: '' }).ok).toBe(true);
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:delText>drop</w:delText>');
      expect(xml).not.toContain('<w:ins ');
    } finally {
      dispose();
    }
  });

  test("refuses inside another author's insertion it cannot split, as proposeReplacement does", () => {
    const body =
      '<w:p><w:ins w:id="1" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
      '<w:hyperlink w:anchor="target"><w:r><w:t>abcd</w:t></w:r></w:hyperlink></w:ins></w:p>';
    const { editor, dispose } = mount(body);
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const before = xmlOf(editor);
      const [match] = editor.findMatches('bc');
      expect(match).toBeDefined();
      const refused = editor.exec({ type: 'replaceMatch', match: match!, text: 'XY' });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('expected a refusal');
      expect(refused.code).toBe('invalidArgs');
      expect(refused.reason.length).toBeGreaterThan(0);
      expect(xmlOf(editor)).toBe(before);

      // The selection lane refuses the same edit with the same reason.
      editor.surface!.setSelection({
        anchor: { paragraphId: match!.blockId, offset: match!.start },
        head: { paragraphId: match!.blockId, offset: match!.start + match!.length },
      });
      const proposed = editor.exec({ type: 'proposeReplacement', replaceWith: 'XY' } as never);
      expect(proposed).toEqual(refused);
    } finally {
      dispose();
    }
  });
});

describe('replaceMatch in editing mode', () => {
  test('replaces outright, keeps the selection and the page, and undoes in one step', () => {
    const { editor, scroller, dispose } = mount(LONG);
    try {
      const selection = caretAtTop(editor);
      const [match] = editor.findMatches('target');
      expect(editor.exec({ type: 'replaceMatch', match: match!, text: 'chosen' })).toEqual({
        ok: true,
        changed: true,
      });
      const xml = xmlOf(editor);
      expect(xml).toContain('the far chosen word here');
      expect(xml).not.toContain('<w:ins ');
      expect(xml).not.toContain('<w:del ');
      expect(scroller.scrollTop).toBe(0);
      expect(editor.surface!.state().selection).toEqual(selection);

      editor.exec({ type: 'undo' });
      expect(xmlOf(editor)).toContain('the far target word here');
    } finally {
      dispose();
    }
  });

  test('a caret later in the same paragraph moves with its text', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>one two three</w:t></w:r></w:p>');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      const caret = { paragraphId, offset: 10 };
      editor.surface!.setSelection({ anchor: caret, head: caret });
      const [match] = editor.findMatches('two');
      expect(editor.exec({ type: 'replaceMatch', match: match!, text: 'seven' }).ok).toBe(true);
      // Still in front of "ree".
      expect(editor.surface!.state().selection.head).toEqual({ paragraphId, offset: 12 });
    } finally {
      dispose();
    }
  });

  test('a malformed match or text is refused before anything is written', () => {
    const { editor, dispose } = mount('<w:p><w:r><w:t>one two</w:t></w:r></w:p>');
    try {
      const [match] = editor.findMatches('two');
      const bad = { ...match!, start: -1 };
      expect(editor.can({ type: 'replaceMatch', match: bad, text: 'x' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(editor.exec({ type: 'replaceMatch', match: match!, text: 'a\nb' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(xmlOf(editor)).toContain('one two');
    } finally {
      dispose();
    }
  });
});
