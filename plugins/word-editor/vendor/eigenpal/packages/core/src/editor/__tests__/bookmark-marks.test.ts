// Show bookmarks customization (`setBookmarkMarks`), header and footer marks, the
// `openBookmarkDialog` command, and the duplicates a concurrent merge can leave.

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { strToU8, zipSync } from 'fflate';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  editors.push(editor);
  return { editor, container };
}

const SAMPLE =
  `<w:p>${run('Alpha ')}<w:bookmarkStart w:id="1" w:name="Zeta"/>${run('beta')}` +
  `<w:bookmarkEnd w:id="1"/>${run(' gamma')}</w:p>` +
  `<w:p><w:bookmarkStart w:id="2" w:name="_Toc1"/>${run('Delta')}<w:bookmarkEnd w:id="2"/>` +
  `<w:bookmarkStart w:id="3" w:name="alpha"/><w:bookmarkEnd w:id="3"/></w:p>`;

const marksOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('.docx-bookmark-mark'),
];
const describeMark = (mark: HTMLElement) =>
  `${mark.dataset.bookmarkName}:${mark.dataset.bookmarkEdge}:${mark.dataset.bookmarkHidden}`;

describe('bookmark mark options', () => {
  test('each mark names its bookmark, edge, visibility and story', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    expect(marksOf(container).map(describeMark)).toEqual([
      'Zeta:start:false',
      'Zeta:end:false',
      'alpha:point:false',
    ]);
    expect(marksOf(container).every((mark) => mark.dataset.bookmarkStory === 'body')).toBe(true);
  });

  test('include chooses the bookmarks, and disposal restores the default', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    const off = editor.setBookmarkMarks({ include: 'all' });
    expect(marksOf(container).map(describeMark)).toContain('_Toc1:start:true');
    const offFilter = editor.setBookmarkMarks({
      include: (bookmark) => bookmark.name === 'alpha',
    });
    expect(marksOf(container).map(describeMark)).toEqual(['alpha:point:false']);
    offFilter();
    off();
    expect(marksOf(container)).toHaveLength(3);
  });

  test('decorate adjusts or replaces a mark, and the editor still places it', () => {
    const { editor, container } = mount(SAMPLE);
    editor.setBookmarkMarks({
      decorate(element, mark) {
        if (mark.edge === 'point') {
          const replacement = element.ownerDocument.createElement('span');
          replacement.className = 'my-point';
          return replacement;
        }
        element.title = mark.name;
        element.classList.add('my-mark');
      },
    });
    editor.exec({ type: 'toggleBookmarks' });
    const point = container.querySelector<HTMLElement>('.my-point')!;
    expect(point.dataset.bookmarkEdge).toBe('point');
    expect(point.style.position).toBe('absolute');
    expect(Number.parseFloat(point.style.height)).toBeGreaterThan(0);
    expect(point.closest('[contenteditable="true"]')).toBeNull();
    const titled = [...container.querySelectorAll<HTMLElement>('.my-mark')];
    expect(titled.map((mark) => mark.title)).toEqual(['Zeta', 'Zeta']);
  });

  test('a decorate callback that throws keeps the default mark and reports the error', () => {
    const { editor, container } = mount(SAMPLE);
    const errors: string[] = [];
    editor.on('error', (error) => errors.push(`${error.code}: ${error.message}`));
    editor.setBookmarkMarks({
      decorate(element, mark) {
        if (mark.edge === 'start') throw new Error('host bug');
        element.classList.add('decorated');
      },
    });
    editor.exec({ type: 'toggleBookmarks' });
    expect(marksOf(container).map(describeMark)).toEqual([
      'Zeta:start:false',
      'Zeta:end:false',
      'alpha:point:false',
    ]);
    expect(container.querySelectorAll('.decorated')).toHaveLength(2);
    expect(errors).toEqual(['hostCallback: a bookmark mark callback failed: host bug']);
    // The rest of the paint ran: the document still renders and edits.
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
  });

  test('a press on a mark never reaches the pages; a host form control keeps it', () => {
    const { editor, container } = mount(SAMPLE);
    editor.setBookmarkMarks({
      decorate(element, mark) {
        element.style.pointerEvents = 'auto';
        if (mark.edge === 'point') element.append(element.ownerDocument.createElement('input'));
      },
    });
    editor.exec({ type: 'toggleBookmarks' });
    const press = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(marksOf(container)[0]!)).toBe(true);
    expect(press(container.querySelector('.docx-bookmark-mark input')!)).toBe(false);
  });

  test('print keeps the marks for the browser print only on request', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    const sheet = container.querySelector('.docx-bookmark-overlay')!;
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(false);
    const off = editor.setBookmarkMarks({ print: true });
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(true);
    off();
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(false);
  });

  test('a header bookmark is marked on every page that shows the header', () => {
    const { editor, container } = mount(
      `<w:p>${run('One')}</w:p><w:p><w:r><w:br w:type="page"/></w:r>${run('Two')}</w:p>`
    );
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Head' }).ok).toBe(true);
    const surface = editor.surface!;
    const head = surface.state().selection.head;
    surface.setSelection({ anchor: { ...head, offset: 0 }, head });
    expect(editor.exec({ type: 'insertBookmark', name: 'Top' }).ok).toBe(true);
    editor.exec({ type: 'toggleBookmarks' });
    const marks = marksOf(container).filter((mark) => mark.dataset.bookmarkName === 'Top');
    expect(marks.every((mark) => mark.dataset.bookmarkStory === 'headerFooter')).toBe(true);
    expect(editor.surface!.state().pageCount).toBe(2);
    expect(marks.map((mark) => mark.dataset.bookmarkEdge)).toEqual([
      'start',
      'start',
      'end',
      'end',
    ]);
    // One pair per page: the same place on the line, on two different pages.
    const starts = marks.filter((mark) => mark.dataset.bookmarkEdge === 'start');
    expect(starts[0]!.style.left).toBe(starts[1]!.style.left);
    expect(Number.parseFloat(starts[1]!.style.top)).toBeGreaterThan(
      Number.parseFloat(starts[0]!.style.top)
    );
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A body paragraph with a bookmark and a footnote reference, and a footnote with one too. */
function withFootnote(): Uint8Array {
  const body =
    `<w:p><w:bookmarkStart w:id="1" w:name="InBody"/>${run('Alpha')}` +
    `<w:bookmarkEnd w:id="1"/><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0">` +
    `<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p>${run('Note ')}<w:bookmarkStart w:id="2" w:name="InNote"/>` +
    `${run('text')}<w:bookmarkEnd w:id="2"/></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

describe('note marks', () => {
  test('a footnote bookmark is marked in the note area, not at the top of the page', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: withFootnote() });
    editors.push(editor);
    editor.exec({ type: 'toggleBookmarks' });
    const start = (name: string) =>
      marksOf(container).find(
        (mark) => mark.dataset.bookmarkName === name && mark.dataset.bookmarkEdge === 'start'
      )!;
    const body = start('InBody');
    const note = start('InNote');
    expect(note.dataset.bookmarkStory).toBe('note');
    // The note area sits at the bottom of the page, far below the first body line.
    expect(Number.parseFloat(note.style.top) - Number.parseFloat(body.style.top)).toBeGreaterThan(
      300
    );
  });
});

describe('right-to-left marks', () => {
  test('brackets open toward the bookmarked text in a right-to-left paragraph', () => {
    const rtl = (text: string) =>
      `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const { editor, container } = mount(
      `<w:p><w:pPr><w:bidi/></w:pPr>${rtl('שלום ')}<w:bookmarkStart w:id="1" w:name="Rtl"/>` +
        `${rtl('עולם')}<w:bookmarkEnd w:id="1"/>${rtl(' טוב')}</w:p>` +
        `<w:p>${run('Left ')}<w:bookmarkStart w:id="2" w:name="Ltr"/>${run('to right')}` +
        `<w:bookmarkEnd w:id="2"/></w:p>`
    );
    editor.exec({ type: 'toggleBookmarks' });
    const mirrored = (name: string) =>
      marksOf(container)
        .filter((mark) => mark.dataset.bookmarkName === name)
        .map((mark) => mark.classList.contains('docx-bookmark-mark--rtl'));
    expect(mirrored('Rtl')).toEqual([true, true]);
    expect(mirrored('Ltr')).toEqual([false, false]);
  });
});

describe('openBookmarkDialog', () => {
  test('opens the registered dialog, and is refused while none is registered', async () => {
    const { editor } = mount(SAMPLE);
    expect(editor.can({ type: 'openBookmarkDialog' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    let opened = 0;
    let published = 0;
    editor.on('selectionChange', () => (published += 1));
    const before = editor.snapshot();
    const off = editor.setBookmarkChrome({ onRequest: () => (opened += 1) });
    // Chrome that reads `can` re-renders when a dialog registers.
    expect(published).toBe(1);
    expect(editor.snapshot()).not.toBe(before);
    // A host that registers again in one task, as a re-run effect does, publishes nothing.
    const again = editor.setBookmarkChrome({ onRequest: () => (opened += 1) });
    off();
    await Promise.resolve();
    expect(published).toBe(1);
    expect(editor.can({ type: 'openBookmarkDialog' }).ok).toBe(true);
    expect(editor.can({ type: 'openBookmarkDialog' }).ok).toBe(true);
    expect(editor.exec({ type: 'openBookmarkDialog' })).toEqual({ ok: true, changed: false });
    expect(opened).toBe(1);
    again();
    expect(editor.exec({ type: 'openBookmarkDialog' }).ok).toBe(false);
    expect(opened).toBe(1);
    // A removal that stands publishes once the task ends.
    await Promise.resolve();
    expect(published).toBe(2);
  });

  test('works in a read-only document, where Go To still does', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(SAMPLE), mode: 'view' });
    editors.push(editor);
    editor.setBookmarkChrome({ onRequest: () => {} });
    expect(editor.can({ type: 'openBookmarkDialog' }).ok).toBe(true);
  });
});

describe('bookmark copies', () => {
  const COPIES =
    `<w:p><w:bookmarkStart w:id="1" w:name="Same"/>${run('one')}<w:bookmarkEnd w:id="1"/>` +
    `${run(' ')}<w:bookmarkStart w:id="2" w:name="SAME"/>${run('two')}<w:bookmarkEnd w:id="2"/>` +
    `</w:p>`;

  test('one row per name, counting the copies; the first answers', () => {
    const { editor, container } = mount(COPIES);
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 1 }]);
    editor.exec({ type: 'toggleBookmarks' });
    expect(marksOf(container)).toHaveLength(2);
    expect(editor.exec({ type: 'goToBookmark', name: 'same' }).ok).toBe(true);
    const selection = editor.surface!.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([0, 3]);
  });

  test('keepFirstBookmark removes the copy in one step and leaves the selection alone', () => {
    const { editor } = mount(COPIES);
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
    expect(editor.can({ type: 'keepFirstBookmark', name: 'same' }).ok).toBe(true);
    expect(editor.exec({ type: 'keepFirstBookmark', name: 'same' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 0 }]);
    expect(surface.state().selection.head.offset).toBe(1);
    // The first pair stayed: it still marks "one".
    editor.exec({ type: 'goToBookmark', name: 'Same' });
    const selection = surface.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([0, 3]);
    expect(editor.can({ type: 'keepFirstBookmark', name: 'Same' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the bookmark has no copies',
    });
    expect(editor.can({ type: 'keepFirstBookmark', name: 'Missing' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
    editor.exec({ type: 'undo' });
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 1 }]);
  });
});
