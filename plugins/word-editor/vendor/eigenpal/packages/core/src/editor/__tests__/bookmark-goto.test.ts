// Go To for bookmarks in the engine: the name box's filter and target rules, the place each
// bookmark reports, the `openGoTo` command, and `goToBookmark` into every kind of story.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { BookmarkSummary } from '../../contracts/editor-bookmarks.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  goToBookmarkGroups,
  goToBookmarkMatch,
  goToBookmarkRows,
  goToBookmarkTarget,
} from '../bookmark-dialog-model.ts';
import { commandForSlot, toolbarCommandState } from '../toolbar-commands.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const mark = (id: number, name: string, text: string) =>
  `<w:p><w:bookmarkStart w:id="${id}" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="${id}"/></w:p>`;

/** One bookmark in the body, a header, a footer, a footnote and an endnote. */
function stories(): Uint8Array {
  const body =
    mark(1, 'InBody', 'body text') +
    '<w:p><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>' +
    '<w:footerReference w:type="default" r:id="rIdF"/></w:sectPr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${TYPE}.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${TYPE}.header+xml"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${TYPE}.footer+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${TYPE}.footnotes+xml"/>` +
        `<Override PartName="/word/endnotes.xml" ContentType="${TYPE}.endnotes+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdF" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${mark(1, 'InHeader', 'head')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${mark(1, 'InFooter', 'foot')}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${mark(1, 'InFootnote', 'fn')}` +
        '</w:footnote></w:footnotes>'
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1">${mark(1, 'InEndnote', 'en')}` +
        '</w:endnote></w:endnotes>'
    ),
  });
}

function mount(mode?: 'view') {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: stories(), ...(mode ? { mode } : {}) });
  editors.push(editor);
  return editor;
}

const summary = (name: string, order: number, hidden = false): BookmarkSummary => ({
  name,
  hidden,
  story: 'body',
  place: 'body',
  order,
  empty: false,
  atSelection: false,
  duplicates: 0,
});

describe('the Go To name box', () => {
  const rows = [summary('Intro', 0), summary('Section10', 1), summary('Section2', 2)];
  const all = [...rows, summary('_Toc1', 3, true)];

  test('filters without case, names that start with the text first', () => {
    const names = (query: string) =>
      goToBookmarkRows(all, { query, sortBy: 'name', showHidden: false }).map((row) => row.name);
    expect(names('')).toEqual(['Intro', 'Section2', 'Section10']);
    expect(names('SEC')).toEqual(['Section2', 'Section10']);
    expect(names('o')).toEqual(['Intro', 'Section2', 'Section10']);
    expect(names('2')).toEqual(['Section2']);
    expect(names('toc')).toEqual([]);
    expect(
      goToBookmarkRows(all, { query: 'toc', sortBy: 'location', showHidden: true }).map(
        (row) => row.name
      )
    ).toEqual(['_Toc1']);
  });

  test('means the exact name, hidden or not, else the first row offered', () => {
    const offered = goToBookmarkRows(all, { query: 'sec', sortBy: 'name', showHidden: false });
    expect(goToBookmarkTarget(all, 'section10', offered)?.name).toBe('Section10');
    expect(goToBookmarkTarget(all, 'sec', offered)?.name).toBe('Section2');
    expect(goToBookmarkTarget(all, '_toc1', [])?.name).toBe('_Toc1');
    expect(goToBookmarkTarget(all, 'nowhere', [])).toBeNull();
    expect(goToBookmarkTarget(all, '  ', offered)).toBeNull();
  });

  test('sorted by location, rows follow the place groups so the arrow keys match the screen', () => {
    const placed = [
      { ...summary('Sec1', 0) },
      { ...summary('HeadA', 1), place: 'header' as const },
      { ...summary('Foot', 2), place: 'footer' as const },
      { ...summary('SecH', 3), place: 'header' as const },
      { ...summary('MySec', 4) },
    ];
    const names = (query: string) =>
      goToBookmarkRows(placed, { query, sortBy: 'location', showHidden: false }).map(
        (row) => row.name
      );
    // Starts-first inside a place, never across places.
    expect(names('sec')).toEqual(['Sec1', 'MySec', 'SecH']);
    // Interleaved parts: the headers stay together.
    expect(names('')).toEqual(['Sec1', 'MySec', 'HeadA', 'SecH', 'Foot']);
    const rows = goToBookmarkRows(placed, { query: '', sortBy: 'location', showHidden: false });
    expect(
      goToBookmarkGroups(rows).flatMap((group) => group.rows.map(({ index }) => index))
    ).toEqual([0, 1, 2, 3, 4]);
  });

  test('finds the match in a name without case, and groups rows by place in order', () => {
    expect(goToBookmarkMatch('Section10', ' sec ')).toEqual({ start: 0, end: 3 });
    expect(goToBookmarkMatch('Section10', 'TION')).toEqual({ start: 3, end: 7 });
    expect(goToBookmarkMatch('Section10', 'zz')).toBeNull();
    expect(goToBookmarkMatch('Section10', '')).toBeNull();
    const placed = [
      { ...summary('Foot', 0), place: 'footer' as const },
      { ...summary('Body', 1) },
      { ...summary('Head', 2), place: 'header' as const },
      { ...summary('Body2', 3) },
    ];
    expect(
      goToBookmarkGroups(placed).map((group) => [
        group.place,
        group.rows.map(({ row, index }) => `${row.name}@${index}`),
      ])
    ).toEqual([
      ['body', ['Body@1', 'Body2@3']],
      ['header', ['Head@2']],
      ['footer', ['Foot@0']],
    ]);
  });
});

describe('Go To in the editor', () => {
  test('each bookmark names its place', () => {
    const editor = mount();
    expect(
      editor.query({ type: 'bookmarks' }).map(({ name, story, place }) => [name, story, place])
    ).toEqual([
      ['InBody', 'body', 'body'],
      ['InHeader', 'headerFooter', 'header'],
      ['InFooter', 'headerFooter', 'footer'],
      ['InFootnote', 'note', 'footnote'],
      ['InEndnote', 'note', 'endnote'],
    ]);
  });

  test('goToBookmark selects the text in every story, and a missing name is refused', () => {
    const editor = mount();
    for (const [name, scope, length] of [
      ['InHeader', 'headerFooter', 4],
      ['InFooter', 'headerFooter', 4],
      ['InFootnote', 'note', 2],
      ['InEndnote', 'note', 2],
      ['InBody', 'body', 9],
    ] as const) {
      expect(editor.exec({ type: 'goToBookmark', name })).toEqual({ ok: true, changed: false });
      expect(editor.snapshot().scope.kind).toBe(scope);
      const { anchor, head } = editor.surface!.state().selection;
      expect([anchor.offset, head.offset]).toEqual([0, length]);
    }
    expect(editor.exec({ type: 'goToBookmark', name: 'Missing' })).toEqual({
      ok: false,
      code: 'notFound',
      reason: 'the document has no bookmark with that name',
    });
  });

  test('Ctrl+G in the document sends openGoTo to the registered UI', () => {
    const editor = mount();
    let opened = 0;
    editor.setGoToChrome({ onRequest: () => (opened += 1) });
    const pages = document.body.lastElementChild!.querySelector<HTMLElement>('.docx-pages')!;
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', {
        key: 'g',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      pages.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press({ ctrlKey: true })).toBe(true);
    expect(opened).toBe(1);
    // Shift is someone else's chord.
    expect(press({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(opened).toBe(1);
  });

  test('openGoTo from the shortcut is refused while the Go To UI turned its shortcut off', () => {
    const editor = mount();
    let opened = 0;
    editor.setGoToChrome({ onRequest: () => (opened += 1) });
    expect(editor.can({ type: 'openGoTo', fromShortcut: true }).ok).toBe(true);
    // A host UI on top that keeps the chord for the browser.
    const off = editor.setGoToChrome({ onRequest: () => (opened += 10), shortcut: false });
    expect(editor.exec({ type: 'openGoTo', fromShortcut: true })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the Go To shortcut is turned off',
    });
    expect(opened).toBe(0);
    // Without the flag, as from a menu row, the UI still opens.
    expect(editor.exec({ type: 'openGoTo' }).ok).toBe(true);
    expect(opened).toBe(10);
    off();
    expect(editor.exec({ type: 'openGoTo', fromShortcut: true }).ok).toBe(true);
    expect(opened).toBe(11);
  });

  test('openGoTo opens the registered Go To UI, also read-only, and is refused without one', () => {
    const editor = mount('view');
    expect(editor.can({ type: 'openGoTo' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'no Go To view is registered',
    });
    // The Insert menu row runs the same command, so it follows the registration.
    expect(commandForSlot('insert.goToBookmark')).toEqual({ type: 'openGoTo' });
    expect(toolbarCommandState(editor, 'insert.goToBookmark').enabled).toBe(false);
    let opened = 0;
    const off = editor.setGoToChrome({ onRequest: () => (opened += 1) });
    expect(toolbarCommandState(editor, 'insert.goToBookmark').enabled).toBe(true);
    expect(editor.exec({ type: 'openGoTo' })).toEqual({ ok: true, changed: false });
    expect(opened).toBe(1);
    // Read-only: a footer bookmark is shown; the footer is not opened for editing.
    const before = editor.surface!.state().selection;
    expect(editor.exec({ type: 'goToBookmark', name: 'InFooter' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(editor.snapshot().scope.kind).toBe('body');
    expect(editor.surface!.state().selection).toEqual(before);
    expect(editor.exec({ type: 'goToBookmark', name: 'InBody' }).ok).toBe(true);
    off();
    expect(editor.exec({ type: 'openGoTo' }).ok).toBe(false);
  });
});
