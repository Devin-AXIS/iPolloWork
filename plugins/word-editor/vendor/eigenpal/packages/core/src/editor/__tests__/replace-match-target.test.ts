// `replaceMatch` and `selectMatch` with a stale or computed target.
//
// A host holds a range across edits: a proofing card for "go to" stays open while the reader,
// or a collaborator, keeps typing. Offsets name a position in one revision, so replacing them
// as given after "He " became "Kids " overwrote the wrong text. A target that carries the text
// it expects is now checked first and refused with nothing changed.
//
// A computed range also needs no `TextMatch` run address, and its story comes from its
// paragraph: a header range is replaced from the body without opening the header.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  paragraphTextOf,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { HighlightRange } from '../../contracts/editor.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { partOfNodeId } from '../surface-scope.ts';
import { FOOTNOTE_SCOPE_ID, HEADER_R_ID, storyParityDocx } from './story-parity-fixture.ts';

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

function mount(bytes: Uint8Array): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A complex field whose saved result shows `result`. */
const field = (result: string): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF exhibit </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t xml:space="preserve">${result}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const SENTENCE = '<w:p><w:r><w:t xml:space="preserve">He go to school.</w:t></w:r></w:p>';

const bodyXml = (editor: DocxEditorInstance): string =>
  serializeOoxmlPart(editor.surface!.session.part());

const textOf = (editor: DocxEditorInstance, blockId: string): string | null => {
  const part = partOfNodeId(editor.surface!.session, blockId);
  return part ? paragraphTextOf(part, blockId) : null;
};

/** The reader, or a collaborator, rewrites the start of the sentence. */
function rewriteStart(editor: DocxEditorInstance): void {
  const [he] = editor.findMatches('He ', { matchCase: true });
  expect(editor.exec({ type: 'replaceMatch', match: he!, text: 'Kids ' }).ok).toBe(true);
  expect(bodyXml(editor)).toContain('Kids go to school.');
}

describe('a target whose text moved is refused', () => {
  test('a stale findMatches result changes nothing and reports notFound', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const [match] = editor.findMatches('go to');
      expect(match).toMatchObject({ start: 3, length: 5, text: 'go to' });
      rewriteStart(editor);
      const before = bodyXml(editor);
      const selection = editor.surface!.state().selection;

      const command = { type: 'replaceMatch' as const, match: match!, text: 'goes to' };
      const refusal = {
        ok: false,
        code: 'notFound',
        reason: 'the text at the match changed; find it again',
      };
      expect(editor.can(command)).toEqual(refusal);
      expect(editor.exec(command)).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
      expect(editor.selectMatch(match!)).toEqual(refusal);
      expect(editor.surface!.state().selection).toEqual(selection);

      // Found again, the same words replace cleanly.
      const [fresh] = editor.findMatches('go to');
      expect(editor.exec({ ...command, match: fresh! })).toEqual({ ok: true, changed: true });
      expect(bodyXml(editor)).toContain('Kids goes to school.');
    } finally {
      editor.destroy();
    }
  });

  test('a computed range with expectedText is checked the same way', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const range: HighlightRange = { blockId, start: 3, length: 5, expectedText: 'go to' };
      rewriteStart(editor);
      const before = bodyXml(editor);

      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'goes to' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      expect(editor.selectMatch(range)).toMatchObject({ ok: false, code: 'notFound' });
      expect(bodyXml(editor)).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  test('a match inside a field result selects the field and refuses a replacement', () => {
    const editor = mount(docx(`<w:p>${run('See ')}${field('Exhibit A')}</w:p>`));
    try {
      const [match] = editor.findMatches('hibit');
      // The model range is the whole field; the text is the part that matched.
      expect(match).toMatchObject({ start: 4, length: 1, text: 'hibit' });
      expect(editor.selectMatch(match!)).toEqual({ ok: true, changed: false });
      expect(editor.selectMatch({ ...match!, text: 'other' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      const before = bodyXml(editor);
      const command = { type: 'replaceMatch' as const, match: match!, text: 'X' };
      const refusal = {
        ok: false,
        code: 'unsupported',
        reason: 'the match is inside a field result; replace the whole field or edit the field',
      };
      expect(editor.can(command)).toEqual(refusal);
      expect(editor.exec(command)).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  test('a match covering a whole field result replaces the field', () => {
    const editor = mount(docx(`<w:p>${run('See ')}${field('Exhibit A')}</w:p>`));
    try {
      const [match] = editor.findMatches('Exhibit A');
      expect(match).toMatchObject({ start: 4, length: 1, text: 'Exhibit A' });
      expect(editor.exec({ type: 'replaceMatch', match: match!, text: 'Annex 1' })).toEqual({
        ok: true,
        changed: true,
      });
      expect(textOf(editor, match!.blockId)).toBe('See Annex 1');
    } finally {
      editor.destroy();
    }
  });

  test('a stale field match is refused when another field takes its offsets', () => {
    const body = `<w:p>${run('See ')}${field('Exhibit A')}${run(' and ')}${field('Exhibit B')}</w:p>`;
    const editor = mount(docx(body));
    try {
      const [match] = editor.findMatches('hibit');
      expect(match).toMatchObject({ start: 4, length: 1, text: 'hibit' });
      // A peer deletes the first field and " and ", so the second field sits at offset 4.
      const blockId = match!.blockId;
      const removed = editor.exec({
        type: 'replaceMatch',
        match: { blockId, start: 4, length: 6 },
        text: '',
      });
      expect(removed.ok).toBe(true);
      expect(editor.findMatches('Exhibit B')[0]).toMatchObject({ start: 4, length: 1 });
      const before = bodyXml(editor);

      for (const command of [
        { type: 'replaceMatch' as const, match: match!, text: 'Q' },
        { type: 'replaceMatch' as const, match: match!, text: '' },
      ]) {
        expect(editor.exec(command)).toMatchObject({ ok: false, code: 'notFound' });
      }
      expect(editor.selectMatch(match!)).toMatchObject({ ok: false, code: 'notFound' });
      expect(bodyXml(editor)).toBe(before);
      expect(editor.findMatches('Exhibit B')).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  test('a range over a field is accepted only when its whole text equals expectedText', () => {
    const body = `<w:p>${field('Exhibit A')}${run(' go to school.')}</w:p>`;
    const editor = mount(docx(body));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const before = bodyXml(editor);
      const wide: HighlightRange = { blockId, start: 0, length: 8, expectedText: 'go' };
      expect(editor.exec({ type: 'replaceMatch', match: wide, text: 'X' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      expect(editor.selectMatch(wide)).toMatchObject({ ok: false, code: 'notFound' });
      // The same range, named by the text it shows, is accepted.
      const exact: HighlightRange = { blockId, start: 0, length: 4, expectedText: 'Exhibit A go' };
      expect(editor.selectMatch(exact)).toEqual({ ok: true, changed: false });
      expect(bodyXml(editor)).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  test('a paragraph that no longer exists reports notFound', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const range: HighlightRange = { blockId: 'word/document.xml#gone', start: 0, length: 2 };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'x' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      expect(editor.selectMatch(range)).toMatchObject({ ok: false, code: 'notFound' });
    } finally {
      editor.destroy();
    }
  });

  test('a non-string expectedText is refused as an argument error', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const range = { blockId, start: 3, length: 5, expectedText: 5 } as unknown as HighlightRange;
      expect(editor.can({ type: 'replaceMatch', match: range, text: 'x' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(editor.selectMatch(range)).toMatchObject({ ok: false, code: 'invalidArgs' });
    } finally {
      editor.destroy();
    }
  });
});

describe('struck text is not replaced', () => {
  const DELETED =
    '<w:p><w:r><w:t xml:space="preserve">one </w:t></w:r>' +
    '<w:del w:id="1" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:delText>two</w:delText></w:r></w:del>' +
    '<w:r><w:t xml:space="preserve"> three</w:t></w:r></w:p>';
  const MOVED =
    '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
    '<w:moveFrom w:id="2" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>moved</w:t></w:r></w:moveFrom></w:p>';
  const refusal = {
    ok: false,
    code: 'unsupported',
    reason: 'the match overlaps deleted text; accept or reject that change first',
  };

  test('a second replacement of the same struck word is refused in suggesting mode', () => {
    const editor = mount(docx('<w:p><w:r><w:t>Alpha Beta Gamma</w:t></w:r></w:p>'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const [first] = editor.findMatches('Beta');
      expect(editor.exec({ type: 'replaceMatch', match: first!, text: 'Zeta' }).ok).toBe(true);
      const before = bodyXml(editor);
      // The struck word is still found, and still holds its text.
      const [struck] = editor.findMatches('Beta');
      expect(struck).toBeDefined();
      const command = { type: 'replaceMatch' as const, match: struck!, text: 'Zeta' };
      expect(editor.can(command)).toEqual(refusal);
      expect(editor.exec(command)).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
      expect(textOf(editor, struck!.blockId)).toBe('Alpha BetaZeta Gamma');
      // Selecting struck text for review stays allowed.
      expect(editor.selectMatch(struck!)).toEqual({ ok: true, changed: false });
    } finally {
      editor.destroy();
    }
  });

  test("a match across another author's deletion is refused", () => {
    const editor = mount(docx(DELETED));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      expect(textOf(editor, blockId)).toBe('one two three');
      const before = bodyXml(editor);
      const range: HighlightRange = { blockId, start: 2, length: 6, expectedText: 'e two ' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'X' })).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  test('editing mode keeps a pending deletion rather than replacing it with plain text', () => {
    const editor = mount(docx(DELETED));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const before = bodyXml(editor);
      const range: HighlightRange = { blockId, start: 4, length: 3, expectedText: 'two' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'four' })).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
      expect(bodyXml(editor)).toContain('<w:delText>two</w:delText>');
      // Text beside the deletion still replaces.
      const beside: HighlightRange = { blockId, start: 0, length: 3, expectedText: 'one' };
      expect(editor.exec({ type: 'replaceMatch', match: beside, text: 'zero' }).ok).toBe(true);
      expect(textOf(editor, blockId)).toBe('zero two three');
    } finally {
      editor.destroy();
    }
  });

  test('moved-away text is refused too', () => {
    const editor = mount(docx(MOVED));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const before = bodyXml(editor);
      const range: HighlightRange = { blockId, start: 5, length: 5, expectedText: 'moved' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'X' })).toEqual(refusal);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      editor.destroy();
    }
  });
});

describe('a computed range', () => {
  test('replaces with a range-shaped target, in one undo step', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const range: HighlightRange = { blockId, start: 3, length: 5, expectedText: 'go to' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'goes to' })).toEqual({
        ok: true,
        changed: true,
      });
      expect(textOf(editor, blockId)).toBe('He goes to school.');
      editor.exec({ type: 'undo' });
      expect(textOf(editor, blockId)).toBe('He go to school.');
    } finally {
      editor.destroy();
    }
  });

  test('without expected text, the offsets are replaced as given', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      expect(
        editor.exec({ type: 'replaceMatch', match: { blockId, start: 0, length: 2 }, text: 'She' })
          .ok
      ).toBe(true);
      expect(textOf(editor, blockId)).toBe('She go to school.');
    } finally {
      editor.destroy();
    }
  });

  test('records a tracked replacement in suggesting mode', () => {
    const editor = mount(docx(SENTENCE));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const range: HighlightRange = { blockId, start: 3, length: 5, expectedText: 'go to' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'goes to' }).ok).toBe(true);
      const xml = bodyXml(editor);
      expect(xml).toMatch(/<w:del w:author="Grace Hopper"[^>]*><w:r><w:delText>go to<\/w:delText>/);
      expect(xml).toMatch(/<w:ins w:author="Grace Hopper"[^>]*><w:r><w:t>goes to<\/w:t>/);
      editor.exec({ type: 'undo' });
      expect(bodyXml(editor)).not.toContain('<w:del ');
      expect(bodyXml(editor)).not.toContain('<w:ins ');
    } finally {
      editor.destroy();
    }
  });

  test('a history group joins several replacements into one undo step', () => {
    const editor = mount(docx(SENTENCE));
    try {
      const blockId = editor.surface!.session.paragraphIds()[0]!;
      const group = editor.beginHistoryGroup();
      // Back to front, so the earlier range keeps its offsets.
      const late = editor.exec(
        {
          type: 'replaceMatch',
          match: { blockId, start: 9, length: 6, expectedText: 'school' },
          text: 'class',
        },
        { historyGroup: group }
      );
      const early = editor.exec(
        {
          type: 'replaceMatch',
          match: { blockId, start: 3, length: 5, expectedText: 'go to' },
          text: 'goes to',
        },
        { historyGroup: group }
      );
      group.end();
      expect(late).toMatchObject({ ok: true, changed: true, history: { kind: 'started' } });
      expect(early).toMatchObject({ ok: true, changed: true, history: { kind: 'extended' } });
      expect(textOf(editor, blockId)).toBe('He goes to class.');
      editor.exec({ type: 'undo' });
      expect(textOf(editor, blockId)).toBe('He go to school.');
    } finally {
      editor.destroy();
    }
  });
});

describe('the story comes from the paragraph', () => {
  const findIn = (editor: DocxEditorInstance, kind: 'headerFooter' | 'note') => {
    const match = editor.findMatches('Alpha').find((candidate) => candidate.scope?.kind === kind);
    if (!match) throw new Error(`no ${kind} match`);
    return match;
  };

  /** Mount inside a scroll container that records every scroll, with a caret in the body. */
  function mountReading(): {
    editor: DocxEditorInstance;
    scrolls: number[];
    caret: ReturnType<NonNullable<DocxEditorInstance['surface']>['state']>['selection'];
    dispose(): void;
  } {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const container = document.createElement('div');
    scroller.append(container);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
    const scrolls: number[] = [];
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => 0,
      set: (next: number) => scrolls.push(next),
      configurable: true,
    });
    scroller.scrollTo = ((options: ScrollToOptions) => {
      scrolls.push(options.top ?? 0);
    }) as HTMLElement['scrollTo'];
    const editor = createDocxEditor({
      container,
      document: storyParityDocx(),
      author: 'Grace Hopper',
      modules: [reviewModule()],
    });
    const first = editor.surface!.session.paragraphIds()[0]!;
    const position = { paragraphId: first, offset: 2 };
    editor.surface!.setSelection({ anchor: position, head: position });
    scrolls.length = 0;
    return {
      editor,
      scrolls,
      caret: editor.surface!.state().selection,
      dispose() {
        editor.destroy();
        scroller.remove();
      },
    };
  }

  test('a header range is replaced from the body without opening the header', async () => {
    const { editor, scrolls, caret, dispose } = mountReading();
    try {
      const { blockId, start, length } = findIn(editor, 'headerFooter');
      const range: HighlightRange = { blockId, start, length, expectedText: 'Alpha' };

      expect(editor.can({ type: 'replaceMatch', match: range, text: 'Zeta' })).toEqual({
        ok: true,
      });
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Zeta' })).toEqual({
        ok: true,
        changed: true,
      });
      expect(textOf(editor, blockId)).toBe('Zeta');
      // The reader stays where they were: in the body, with the same caret and page.
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
      expect(editor.surface!.state().selection).toEqual(caret);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(scrolls).toEqual([]);
      expect(editor.surface!.state().selection).toEqual(caret);

      editor.exec({ type: 'undo' });
      expect(textOf(editor, blockId)).toBe('Alpha');
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    } finally {
      dispose();
    }
  });

  test('a tracked header replacement from the body keeps the body open', () => {
    const { editor, caret, dispose } = mountReading();
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const { blockId, start, length } = findIn(editor, 'headerFooter');
      const range: HighlightRange = { blockId, start, length, expectedText: 'Alpha' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Zeta' }).ok).toBe(true);
      expect(textOf(editor, blockId)).toBe('AlphaZeta');
      expect(
        editor.getTrackedChanges().map((change) => [change.kind, change.author, change.story])
      ).toEqual([
        ['delete', 'Grace Hopper', 'header'],
        ['insert', 'Grace Hopper', 'header'],
      ]);
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
      expect(editor.surface!.state().selection).toEqual(caret);
      editor.exec({ type: 'undo' });
      expect(textOf(editor, blockId)).toBe('Alpha');
      expect(editor.getTrackedChanges()).toEqual([]);
    } finally {
      dispose();
    }
  });

  test('a history group joins replacements in two stories into one undo step', () => {
    const { editor, dispose } = mountReading();
    try {
      const header = findIn(editor, 'headerFooter');
      const body = editor.findMatches('Alpha').find((candidate) => !candidate.scope)!;
      const group = editor.beginHistoryGroup();
      const first = editor.exec(
        { type: 'replaceMatch', match: header, text: 'Zeta' },
        { historyGroup: group }
      );
      const second = editor.exec(
        { type: 'replaceMatch', match: body, text: 'Zeta' },
        { historyGroup: group }
      );
      group.end();
      expect(first).toMatchObject({ ok: true, history: { kind: 'started' } });
      expect(second).toMatchObject({ ok: true, history: { kind: 'extended' } });
      editor.exec({ type: 'undo' });
      expect(textOf(editor, header.blockId)).toBe('Alpha');
      expect(textOf(editor, body.blockId)).toBe('Alpha');
    } finally {
      dispose();
    }
  });

  test('a header range without scope is replaced while the header is open', () => {
    const editor = mount(storyParityDocx());
    try {
      const match = findIn(editor, 'headerFooter');
      expect(editor.selectMatch(match).ok).toBe(true);
      const range: HighlightRange = { blockId: match.blockId, start: match.start, length: 5 };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Omega' }).ok).toBe(true);
      expect(textOf(editor, match.blockId)).toBe('Omega');
      expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
    } finally {
      editor.destroy();
    }
  });

  test('a note range without scope is replaced without opening the note', () => {
    const { editor, caret, dispose } = mountReading();
    try {
      const { blockId, start, length } = findIn(editor, 'note');
      expect(findIn(editor, 'note').scope).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
      const range: HighlightRange = { blockId, start, length, expectedText: 'Alpha' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Omega' }).ok).toBe(true);
      expect(textOf(editor, blockId)).toBe('Omega');
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
      expect(editor.surface!.state().selection).toEqual(caret);
    } finally {
      dispose();
    }
  });

  test('a body range replaced from an open header keeps the header open', () => {
    const editor = mount(storyParityDocx());
    try {
      expect(editor.selectMatch(findIn(editor, 'headerFooter')).ok).toBe(true);
      const selection = editor.surface!.state().selection;
      const body = editor.findMatches('Alpha').find((candidate) => !candidate.scope)!;
      expect(editor.exec({ type: 'replaceMatch', match: body, text: 'Omega' }).ok).toBe(true);
      expect(textOf(editor, body.blockId)).toBe('Omega');
      expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
      expect(editor.surface!.state().selection).toEqual(selection);
    } finally {
      editor.destroy();
    }
  });

  test('selectMatch opens the story of a range without scope', () => {
    const editor = mount(storyParityDocx());
    try {
      const { blockId, start, length } = findIn(editor, 'headerFooter');
      expect(editor.selectMatch({ blockId, start, length })).toEqual({ ok: true, changed: false });
      expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
      expect(editor.surface!.state().selection).toEqual({
        anchor: { paragraphId: blockId, offset: start },
        head: { paragraphId: blockId, offset: start + length },
      });
    } finally {
      editor.destroy();
    }
  });

  test('a scope that names another story is refused', () => {
    const editor = mount(storyParityDocx());
    try {
      const { blockId, start, length } = findIn(editor, 'headerFooter');
      const range: HighlightRange = { blockId, start, length, scope: { kind: 'body' } };
      const refused = { ok: false, code: 'invalidArgs' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Omega' })).toMatchObject(
        refused
      );
      expect(editor.selectMatch(range)).toMatchObject(refused);
      expect(textOf(editor, blockId)).toBe('Alpha');
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    } finally {
      editor.destroy();
    }
  });

  test('a stale header range refuses and changes nothing', () => {
    const editor = mount(storyParityDocx());
    try {
      const { blockId, start, length } = findIn(editor, 'headerFooter');
      const range: HighlightRange = { blockId, start, length, expectedText: 'Gamma' };
      expect(editor.exec({ type: 'replaceMatch', match: range, text: 'Omega' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      expect(editor.getActiveScope()).toEqual({ kind: 'body' });
      expect(textOf(editor, blockId)).toBe('Alpha');
    } finally {
      editor.destroy();
    }
  });
});
