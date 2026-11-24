import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { detectBodyTocs, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const BEGIN =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const ENTRIES = para(BEGIN + run('Alpha 1'), 'TOC1') + para(run('Beta 1'), 'TOC1') + para(END);
const control = (inner: string, lock = '') =>
  `<w:sdt><w:sdtPr><w:id w:val="7"/>${lock}<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const DOCUMENT =
  para(run('Before')) +
  control(para(run('Contents'), 'TOCHeading') + ENTRIES) +
  para(run('Alpha'), 'Heading1') +
  para(run('Body'));

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string, options: { author?: string } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body), ...options });
  editors.push(editor);
  return { editor, surface: editor.surface!, container };
}

const bodyXml = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

function rightClick(container: HTMLElement, text: string): void {
  const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find((el) =>
    el.textContent?.includes(text)
  )!;
  row.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
  );
}

test('removes the right-clicked table of contents in one undo step', async () => {
  const { editor, surface, container } = mount(DOCUMENT);
  const before = bodyXml(editor);
  rightClick(container, 'Beta 1');
  const tocId = editor.snapshot().tocContext!.id;
  expect(editor.can({ type: 'removeToc', tocId })).toEqual({ ok: true });

  expect(editor.exec({ type: 'removeToc', tocId })).toEqual({ ok: true, changed: true });
  expect(detectBodyTocs(surface.session.part())).toHaveLength(0);
  expect(surface.session.bodyText()).toBe('Before\nAlpha\nBody');
  expect(bodyXml(editor)).not.toContain('<w:sdt>');
  // The caret lands at the start of the paragraph after the table of contents.
  expect(surface.state().selection.head).toEqual({
    paragraphId: surface.session.paragraphIds()[1]!,
    offset: 0,
  });
  expect(editor.snapshot().tocContext).toBeNull();

  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(bodyXml(editor)).toBe(before);
  expect(editor.exec({ type: 'redo' }).ok).toBe(true);
  expect(detectBodyTocs(surface.session.part())).toHaveLength(0);

  const saved = await editor.save();
  const xml = strFromU8(unzipSync(new Uint8Array(saved))['word/document.xml']!);
  expect(xml).not.toContain('fldChar');
  editor.load(saved);
  expect(editor.surface!.session.bodyText()).toBe('Before\nAlpha\nBody');
});

test('removes a bare field and keeps the text after its end marker', () => {
  const { editor, surface } = mount(
    para(run('Before')) +
      para(BEGIN + run('Alpha 1'), 'TOC1') +
      para(END + run('Alpha'), 'Heading1') +
      para(run('Body'))
  );
  // With one table of contents, the command needs no id.
  expect(editor.exec({ type: 'removeToc' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toBe('Before\nAlpha\nBody');
  expect(bodyXml(editor)).toContain('<w:pStyle w:val="Heading1"/>');
  expect(bodyXml(editor)).not.toContain('TOC1');
});

test('names why the command cannot run', () => {
  const plain = mount(para(run('Text'))).editor;
  expect(plain.can({ type: 'removeToc' })).toEqual({
    ok: false,
    code: 'notFound',
    reason: 'there is no table of contents to remove',
  });
  expect(plain.can({ type: 'removeToc', tocId: '' })).toMatchObject({
    ok: false,
    code: 'invalidArgs',
  });
  expect(plain.exec({ type: 'removeToc' }).ok).toBe(false);

  const locked = mount(
    para(run('Before')) +
      control(ENTRIES, '<w:lock w:val="sdtContentLocked"/>') +
      para(run('After'))
  ).editor;
  expect(locked.can({ type: 'removeToc' })).toEqual({
    ok: false,
    code: 'unsupported',
    reason: 'the table of contents is locked',
  });

  // Two tables of contents and no right-click: the caret is in neither, so none is addressed.
  const two = mount(para(run('Before')) + ENTRIES + para(run('Middle')) + ENTRIES).editor;
  expect(two.can({ type: 'removeToc' })).toMatchObject({ ok: false, code: 'notFound' });
  const second = detectBodyTocs(two.surface!.session.part())[1]!.id;
  expect(two.exec({ type: 'removeToc', tocId: second })).toEqual({ ok: true, changed: true });
  expect(detectBodyTocs(two.surface!.session.part())).toHaveLength(1);
  expect(two.surface!.session.bodyText()).toBe('Before\nAlpha 1\nBeta 1\n\nMiddle');
});

test('refuses while suggesting and while viewing, and writes nothing', () => {
  const { editor, surface } = mount(DOCUMENT, { author: 'Ann' });
  const before = bodyXml(editor);
  surface.setEditingMode('suggest');
  expect(editor.can({ type: 'removeToc' })).toEqual({
    ok: false,
    code: 'unsupported',
    reason: 'suggesting cannot remove a table of contents outright',
  });
  expect(editor.exec({ type: 'removeToc' }).ok).toBe(false);
  surface.setEditingMode('view');
  expect(editor.can({ type: 'removeToc' }).ok).toBe(false);
  expect(bodyXml(editor)).toBe(before);
});

test('a table of contents that cannot be refreshed can still be removed', () => {
  const { editor, container } = mount(
    para(run('Before')) +
      para(
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\c "Figure" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          run('Figure 1')
      ) +
      para(END) +
      para(run('After'))
  );
  rightClick(container, 'Figure 1');
  const context = editor.snapshot().tocContext;
  expect(context).not.toBeNull();
  expect(editor.can({ type: 'refreshToc', tocId: context!.id }).ok).toBe(false);
  expect(editor.exec({ type: 'removeToc', tocId: context!.id }).ok).toBe(true);
  expect(editor.surface!.session.bodyText()).toBe('Before\nAfter');
});

/** A table of contents whose second row holds a comment and a footnote reference. */
function notesDocx(): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const row =
    '<w:p><w:commentRangeStart w:id="3"/>' +
    run('Beta 1') +
    '<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>' +
    '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
        `<Override PartName="/word/comments.xml" ContentType="${main}.comments+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${main}.footnotes+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${R}/comments" Target="comments.xml"/>` +
        `<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}"><w:comment w:id="3" w:author="Ann"><w:p><w:r><w:t>Check</w:t></w:r></w:p></w:comment></w:comments>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="1"><w:p><w:r><w:t>Row note</w:t></w:r></w:p></w:footnote></w:footnotes>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${para(run('Before'))}${para(BEGIN + run('Alpha 1'))}${row}${para(END)}${para(run('After'))}<w:sectPr/></w:body></w:document>`
    ),
  });
}

test('removes the comments and footnotes whose anchors were in the table of contents', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: notesDocx() });
  editors.push(editor);
  expect(editor.exec({ type: 'removeToc' })).toEqual({ ok: true, changed: true });
  const files = unzipSync(new Uint8Array(await editor.save()));
  const comments = files['word/comments.xml'] ? strFromU8(files['word/comments.xml']) : '';
  expect(comments).not.toContain('Check');
  expect(strFromU8(files['word/footnotes.xml']!)).not.toContain('Row note');
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  const restored = unzipSync(new Uint8Array(await editor.save()));
  expect(strFromU8(restored['word/comments.xml']!)).toContain('Check');
  expect(strFromU8(restored['word/footnotes.xml']!)).toContain('Row note');
});

test('undo of a removal or a refresh puts the caret back at the table of contents', () => {
  const { editor, surface, container } = mount(DOCUMENT);
  const ids = surface.session.paragraphIds();
  const bodyParagraph = ids[ids.length - 1]!;
  // The caret is elsewhere when the menu opens: a right-click does not move it into a TOC.
  surface.setSelection({
    anchor: { paragraphId: bodyParagraph, offset: 2 },
    head: { paragraphId: bodyParagraph, offset: 2 },
  });
  const tocParagraphs = new Set(
    detectBodyTocs(surface.session.part()).flatMap((toc) => [
      toc.beginParagraphId,
      toc.endParagraphId,
      ...toc.resultParagraphIds,
    ])
  );
  const nearToc = (paragraphId: string) => {
    const order = surface.session.paragraphIds();
    const at = order.indexOf(paragraphId);
    const tocAt = order.findIndex((id) => tocParagraphs.has(id));
    const tocEnd = order.length - 1 - [...order].reverse().findIndex((id) => tocParagraphs.has(id));
    return at >= tocAt - 1 && at <= tocEnd + 1;
  };

  rightClick(container, 'Beta 1');
  expect(editor.exec({ type: 'removeToc' }).ok).toBe(true);
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  const afterUndo = surface.state().selection.head.paragraphId;
  expect(afterUndo).not.toBe(bodyParagraph);
  expect(nearToc(afterUndo)).toBe(true);

  surface.setSelection({
    anchor: { paragraphId: bodyParagraph, offset: 2 },
    head: { paragraphId: bodyParagraph, offset: 2 },
  });
  rightClick(container, 'Beta 1');
  expect(editor.exec({ type: 'refreshToc' }).ok).toBe(true);
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  const afterRefreshUndo = surface.state().selection.head.paragraphId;
  expect(afterRefreshUndo).not.toBe(bodyParagraph);
  expect(nearToc(afterRefreshUndo)).toBe(true);
  // Next to the table of contents, never inside its field result.
  expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
});

test('a click after the menu closes ends its hold: a later refresh leaves the caret', () => {
  const { editor, surface, container } = mount(DOCUMENT);
  const ids = surface.session.paragraphIds();
  const bodyParagraph = ids[ids.length - 1]!;
  rightClick(container, 'Beta 1');
  const caret = { paragraphId: bodyParagraph, offset: 2 };
  surface.setSelection({ anchor: caret, head: caret });
  const page = container.querySelector<HTMLElement>(`[data-paragraph-id="${bodyParagraph}"]`)!;
  page.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  expect(surface.state().contextTocId).toBeNull();
  editor.exec({ type: 'refreshToc' });
  expect(surface.state().selection.head).toEqual(caret);
});

test('a table of contents after a table that ends the body leaves an empty paragraph', () => {
  const table =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc>${para(run('cell'))}</w:tc></w:tr></w:tbl>`;
  for (const toc of [control(ENTRIES), ENTRIES]) {
    const { editor, surface } = mount(para(run('Before')) + table + toc);
    const tocId = detectBodyTocs(surface.session.part())[0]!.id;
    expect(editor.exec({ type: 'removeToc', tocId })).toEqual({ ok: true, changed: true });
    expect(bodyXml(editor)).toMatch(/<\/w:tbl><w:p[ />]/);
  }
});
