// A heading that opens with a page break is listed on the page where its text is painted.
//
// Pressing Ctrl+Enter before the text of a heading puts the break inside the heading
// paragraph. The break lays out at the bottom of the previous page, so a page lookup that
// took the paragraph's first fragment listed the heading one page early.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const heading = (runs: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runs}</w:p>`;
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const PAGE_BREAK = '<w:r><w:br w:type="page"/></w:r>';
const INTRO = '<w:p><w:r><w:t>Contents go here</w:t></w:r></w:p>';

type Editor = ReturnType<typeof createDocxEditor>;
const open: Editor[] = [];
const containers = new WeakMap<Editor, HTMLElement>();
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(body: string): Editor {
  // Jumps scroll the nearest scroll container, so the test gives the editor one.
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  const editor = createDocxEditor({ container });
  editor.load(docx(body));
  open.push(editor);
  containers.set(editor, container);
  return editor;
}

/** Put the caret at `offset` of the first paragraph, then insert a table of contents there. */
function insertTocAtStart(editor: Editor): void {
  const first = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: first, offset: 0 },
  });
  expect(editor.exec({ type: 'insertToc' }).ok).toBe(true);
}

/** The page number each TOC row shows, keyed by heading text, read from the saved XML. */
async function tocPages(editor: Editor): Promise<Record<string, string>> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  const rows = xml.split('</w:p>').filter((row) => row.includes('<w:pStyle w:val="TOC1"/>'));
  const pages: Record<string, string> = {};
  for (const row of rows) {
    const texts = [...row.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]!);
    pages[texts.slice(0, -1).join('')] = texts.at(-1)!;
  }
  return pages;
}

/** Click the TOC entry that names `title`, the way a reader follows the link. */
function clickEntry(editor: Editor, title: string): void {
  const link = [...containers.get(editor)!.querySelectorAll<HTMLElement>('a.docx-hyperlink')].find(
    (anchor) => anchor.textContent?.includes(title)
  )!;
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
}

/** The element that scrolls the pages: a jump moves its `scrollTop`. */
function scrollerOf(editor: Editor): HTMLElement {
  return containers.get(editor)!.parentElement!;
}

/** The saved XML of the last TOC row, which links to the second heading. */
async function lastTocRowXml(editor: Editor): Promise<string> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  return xml
    .split('</w:p>')
    .filter((row) => row.includes('<w:pStyle w:val="TOC1"/>'))
    .at(-1)!;
}

/** The saved XML of the last body paragraph, the second heading in every fixture here. */
async function lastParagraphXml(editor: Editor): Promise<string> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  const paragraphs = xml.split('</w:p>');
  return paragraphs[paragraphs.length - 2]!;
}

describe('table of contents for a heading that opens with a page break', () => {
  test('writes the heading bookmark after the break, in front of the text', async () => {
    const separateRuns = mount(
      INTRO + heading(text('First heading')) + heading(PAGE_BREAK + text('Second heading'))
    );
    insertTocAtStart(separateRuns);
    expect(await lastParagraphXml(separateRuns)).toMatch(
      /<w:br w:type="page"\/><\/w:r><w:bookmarkStart [^>]*w:name="_Toc\d+"\/><w:r>.*Second heading/
    );

    // Ctrl+Enter writes the break into the run of the text. The run splits around the bookmark.
    const oneRun = mount(
      INTRO +
        heading(text('First heading')) +
        heading('<w:r><w:br w:type="page"/><w:t>Second heading</w:t></w:r>')
    );
    insertTocAtStart(oneRun);
    const saved = await lastParagraphXml(oneRun);
    expect(saved).toMatch(
      /<w:br w:type="page"\/><\/w:r><w:bookmarkStart [^>]*w:name="_Toc\d+"\/><w:r>.*Second heading/
    );
    expect(await tocPages(oneRun)).toEqual({ 'First heading': '1', 'Second heading': '2' });
    // A second full refresh reuses the bookmark rather than adding another one.
    expect(oneRun.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
    expect((await lastParagraphXml(oneRun)).match(/<w:bookmarkStart /g)).toHaveLength(1);
  });

  test('lists the heading on the page of its text', async () => {
    const editor = mount(
      INTRO + heading(text('First heading')) + heading(PAGE_BREAK + text('Second heading'))
    );
    insertTocAtStart(editor);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '2' });
    // Updating page numbers keeps the page of the text.
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '2' });
  });

  test('a page break typed before the heading text moves the entry to the next page', async () => {
    const editor = mount(INTRO + heading(text('First heading')) + heading(text('Second heading')));
    insertTocAtStart(editor);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '1' });

    // Ctrl+Enter with the caret before the text of the second heading.
    const ids = editor.surface!.session.paragraphIds();
    const second = ids[ids.length - 1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: second, offset: 0 },
      head: { paragraphId: second, offset: 0 },
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '2' });
    // The bookmark was written before the break existed, so it sits in front of it. A click
    // on the entry still lands on the heading text, not on the break at the bottom of page 1.
    clickEntry(editor, 'Second heading');
    expect(editor.surface!.state().selection.head).toEqual({ paragraphId: second, offset: 1 });
    // Go To Bookmark shows the heading text too, and selects the whole bookmark, break
    // included. The link jump puts the text a margin below the top; Go To Bookmark centers it,
    // which scrolls further. Centering the break at the bottom of page 1 would scroll less.
    const scroller = scrollerOf(editor);
    const linkTop = scroller.scrollTop;
    expect(linkTop).toBeGreaterThan(0);
    scroller.scrollTop = 0;
    const name = /w:anchor="(_Toc\d+)"/.exec(await lastTocRowXml(editor))![1]!;
    expect(editor.exec({ type: 'goToBookmark', name }).ok).toBe(true);
    expect(scroller.scrollTop).toBeGreaterThan(linkTop);
    expect(editor.surface!.state().selection.anchor).toEqual({ paragraphId: second, offset: 0 });

    // Undo takes back the page numbers, then the break; a refresh after that gives page 1.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '1' });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' }).ok).toBe(true);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '1' });
  });

  test('a column break in a one-column section gives the same page and bookmark', async () => {
    const editor = mount(
      INTRO +
        heading(text('First heading')) +
        heading('<w:r><w:br w:type="column"/></w:r>' + text('Second heading'))
    );
    insertTocAtStart(editor);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Second heading': '2' });
    expect(await lastParagraphXml(editor)).toMatch(
      /<w:br w:type="column"\/><\/w:r><w:bookmarkStart [^>]*w:name="_Toc\d+"\/>/
    );
  });

  test('a heading with text before its page break keeps the page of that text', async () => {
    const editor = mount(
      INTRO + heading(text('First heading')) + heading(text('Split') + PAGE_BREAK + text('heading'))
    );
    insertTocAtStart(editor);
    expect(await tocPages(editor)).toEqual({ 'First heading': '1', 'Split heading': '1' });
  });

  test('a click on the entry puts the caret on the heading text, after the break', () => {
    const editor = mount(
      INTRO + heading(text('First heading')) + heading(PAGE_BREAK + text('Second heading'))
    );
    insertTocAtStart(editor);
    clickEntry(editor, 'Second heading');
    const ids = editor.surface!.session.paragraphIds();
    // Offset 0 is the break at the bottom of page 1; offset 1 starts the text on page 2.
    expect(editor.surface!.state().selection.head).toEqual({
      paragraphId: ids[ids.length - 1]!,
      offset: 1,
    });

    // `scrollToBlock`, which the outline uses, shows the same line: the heading text on
    // page 2, not the break at the bottom of page 1. Both put the line 24px below the top.
    const scroller = scrollerOf(editor);
    const linkTop = scroller.scrollTop;
    expect(linkTop).toBeGreaterThan(0);
    scroller.scrollTop = 0;
    // A reveal needs a viewport with a height; happy-dom lays nothing out.
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 100_000 });
    expect(editor.scrollToBlock(ids[ids.length - 1]!)).toBe(true);
    expect(scroller.scrollTop).toBe(linkTop);
  });

  test('the page number survives save and reopen', async () => {
    const editor = mount(
      INTRO + heading(text('First heading')) + heading(PAGE_BREAK + text('Second heading'))
    );
    insertTocAtStart(editor);
    const reopened = mount('');
    reopened.load(new Uint8Array(await editor.save()));
    expect(await tocPages(reopened)).toEqual({ 'First heading': '1', 'Second heading': '2' });
    expect(reopened.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: false,
    });
  });
});
