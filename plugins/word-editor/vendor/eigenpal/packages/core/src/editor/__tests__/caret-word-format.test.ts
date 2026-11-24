// Formatting at a caret inside a word formats the whole word.
//
// Inside means a word character on both sides of the caret. At a word's edge the format is
// armed for the next typed text and the document does not change. A word is letters, digits,
// combining marks and apostrophes; a hyphen, an underscore, a period or a comma ends it.
// Thai and the other dictionary scripts split into dictionary words. Text the view hides, such
// as a tracked deletion in the proposed view, joins the letters around it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARK = 'w:author="A" w:date="2026-01-01T00:00:00Z"';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> note</w:t></w:r></w:p></w:footnote></w:footnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const BIG = '<w:rPr><w:sz w:val="40"/></w:rPr>';

const opened: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { editor, container } of opened.splice(0)) {
    editor.destroy();
    container.remove();
  }
});
function open(paragraphs: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(paragraphs) });
  opened.push({ editor, container });
  return editor;
}
function caret(editor: DocxEditorInstance, offset: number, paragraph = 0): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}
const size = (editor: DocxEditorInstance) =>
  editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 40 });

/** The first paragraph's text, with runs that carry `match` in their properties in brackets. */
function marked(editor: DocxEditorInstance, match = '<w:sz w:val="40"/>', paragraph = 0): string {
  const xml = serializeOoxmlPart(editor.surface!.session.part());
  const body = /<w:body>(.*)<\/w:body>/s.exec(xml)?.[1] ?? '';
  const p = body.split('</w:p>')[paragraph] ?? '';
  let out = '';
  for (const [, rPr = '', text = ''] of p.matchAll(
    /<w:r>(<w:rPr>.*?<\/w:rPr>)?(?:<w:t[^>]*>|<w:delText[^>]*>)(.*?)<\/w:(?:t|delText)><\/w:r>/g
  )) {
    out += rPr.includes(match) ? `[${text}]` : text;
  }
  return out.replace(/\]\[/g, '').replace(/&apos;/g, "'");
}

describe('a caret format inside a word formats the whole word', () => {
  test.each([
    [2, '[abcd] efgh, ij'],
    [0, 'abcd efgh, ij'],
    [4, 'abcd efgh, ij'],
    [5, 'abcd efgh, ij'],
    [9, 'abcd efgh, ij'],
    [10, 'abcd efgh, ij'],
  ])('caret at %i', (offset, expected) => {
    const editor = open(`<w:p>${run('abcd efgh, ij')}</w:p>`);
    caret(editor, offset);
    const revision = editor.surface!.session.packageRevision();
    expect(size(editor).ok).toBe(true);
    expect(marked(editor)).toBe(expected);
    if (expected === 'abcd efgh, ij') {
      expect(editor.surface!.session.packageRevision()).toBe(revision);
    }
  });

  test.each([
    [2, "[don't] abc123 well-known x_y ab.cd"],
    [4, "[don't] abc123 well-known x_y ab.cd"],
    [9, "don't [abc123] well-known x_y ab.cd"],
    [15, "don't abc123 [well]-known x_y ab.cd"],
    [20, "don't abc123 well-[known] x_y ab.cd"],
    [25, "don't abc123 well-known x_y ab.cd"],
    [29, "don't abc123 well-known x_y [ab].cd"],
  ])('word characters, caret at %i', (offset, expected) => {
    const editor = open(`<w:p>${run("don't abc123 well-known x_y ab.cd")}</w:p>`);
    caret(editor, offset);
    size(editor);
    expect(marked(editor)).toBe(expected);
  });

  test.each([
    ['我们今天去北京 ok', 2, '[我们今天去北京] ok'],
    ['café ok', 2, '[café] ok'],
    ['1,234.56 ok', 3, '1,[234].56 ok'],
    ['สวัสดีครับ ok', 3, '[สวัสดี]ครับ ok'],
    ['สวัสดีครับ ok', 6, 'สวัสดีครับ ok'],
  ])('%s, caret at %i', (text, offset, expected) => {
    const editor = open(`<w:p>${run(text)}</w:p>`);
    caret(editor, offset);
    size(editor);
    expect(marked(editor)).toBe(expected);
  });

  test('the caret stays put, one undo restores the word, and typing takes the format', () => {
    const editor = open(`<w:p>${run('abcd efgh')}</w:p>`);
    caret(editor, 2);
    size(editor);
    const { anchor, head } = editor.surface!.state().selection;
    expect([anchor.offset, head.offset]).toEqual([2, 2]);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(marked(editor)).toBe('abcd efgh');
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    caret(editor, 2);
    editor.surface!.type('x');
    expect(marked(editor)).toBe('[abxcd] efgh');
  });

  test.each([
    [1, '<w:b/>', '[abcd] z'],
    [3, '<w:b w:val="0"/>', '[abcd] z'],
  ])(
    'in a partly bold word, the caret at %i decides the toggle for the whole word',
    (offset, match, expected) => {
      const editor = open(
        `<w:p>${run('ab')}${run('cd', '<w:rPr><w:b/></w:rPr>')}${run(' z')}</w:p>`
      );
      caret(editor, offset);
      const before = editor.getSelectionFormatting()?.bold;
      editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(marked(editor, match)).toBe(expected);
      expect(editor.getSelectionFormatting()?.bold).toBe(!before);
    }
  );

  test('a note reference ends the word before it', () => {
    const reference = '<w:r><w:footnoteReference w:id="1"/></w:r>';
    const editor = open(`<w:p>${run('claim')}${reference}${run(' next')}</w:p>`);
    const revision = editor.surface!.session.packageRevision();
    caret(editor, 5);
    size(editor);
    expect(editor.surface!.session.packageRevision()).toBe(revision);
    caret(editor, 2);
    size(editor);
    expect(marked(editor)).toBe('[claim] next');
  });

  test('an optional hyphen stays inside the word', () => {
    const editor = open(
      `<w:p><w:r><w:t>Versi</w:t><w:softHyphen/><w:t xml:space="preserve">cherung ok</w:t></w:r></w:p>`
    );
    caret(editor, 2);
    size(editor);
    // "Versi" 0-5, the optional hyphen at 5, "cherung" 6-13, " ok" after.
    caret(editor, 10);
    expect(editor.getSelectionFormatting()?.fontSizeHalfPoints).toBe(40);
    caret(editor, 16);
    expect(editor.getSelectionFormatting()?.fontSizeHalfPoints).not.toBe(40);
  });

  test('a letter outside the basic plane stays inside the word', () => {
    const editor = open(`<w:p>${run('𠮷野家 ok')}</w:p>`);
    caret(editor, 2);
    size(editor);
    expect(marked(editor)).toBe('[𠮷野家] ok');
  });

  test('a color reaches the whole word, a highlight only arms the next typed text', () => {
    const editor = open(`<w:p>${run('abcd efgh')}</w:p>`);
    caret(editor, 2);
    editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' });
    expect(marked(editor, '<w:color w:val="FF0000"/>')).toBe('[abcd] efgh');
    const revision = editor.surface!.session.packageRevision();
    caret(editor, 7);
    editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' });
    expect(editor.surface!.session.packageRevision()).toBe(revision);
  });

  test('clear formatting at a caret inside a word clears that word only', () => {
    const editor = open(`<w:p>${run('abcd efgh', '<w:rPr><w:b/><w:i/></w:rPr>')}</w:p>`);
    caret(editor, 2);
    editor.exec({ type: 'clearFormatting' });
    expect(marked(editor, '<w:b/>')).toBe('abcd[ efgh]');
  });

  test('a control edge ends the word', () => {
    const control = `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${run('TOKEN')}</w:sdtContent></w:sdt>`;
    const editor = open(`<w:p>${run('aa')}${control}${run('zz')}</w:p>`);
    caret(editor, 1);
    size(editor);
    expect(marked(editor)).toBe('[aa]TOKENzz');
    editor.exec({ type: 'undo' });
    const revision = editor.surface!.session.packageRevision();
    caret(editor, 2);
    size(editor);
    expect(editor.surface!.session.packageRevision()).toBe(revision);
  });

  test('a hidden tracked deletion joins the word it sits in', () => {
    const replaced =
      run('a t') +
      `<w:del w:id="1" ${MARK}><w:r><w:delText>eh</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" ${MARK}>${run('he')}</w:ins>${run(' z')}`;
    const editor = open(`<w:p>${replaced}</w:p>`);
    caret(editor, 6);
    size(editor);
    expect(marked(editor)).toBe('a [t]eh[he] z');
  });
});

describe('a format painter click paints a replaced word whole', () => {
  test('the hidden deletion does not split the painted word', () => {
    const replaced =
      run('a t') +
      `<w:del w:id="1" ${MARK}><w:r><w:delText>eh</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" ${MARK}>${run('he')}</w:ins>${run(' z')}`;
    const editor = open(`<w:p>${run('src', BIG)}</w:p><w:p>${replaced}</w:p>`);
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[0]!, offset: 3 },
    });
    expect(editor.exec({ type: 'copyFormatting' }).ok).toBe(true);
    caret(editor, 2, 1);
    expect(editor.exec({ type: 'pasteFormatting' }).ok).toBe(true);
    expect(marked(editor, '<w:sz w:val="40"/>', 1)).toBe('a [t]eh[he] z');
  });
});
