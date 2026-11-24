// Backspace at the start of a list item removes its number or bullet first.
//
// The text stays on its own line where the list put it: the paragraph keeps its style, and
// its own left indent takes the list's text position when the style alone does not give it.
// Only a later Backspace joins it to the previous paragraph. The expected properties are the
// ones a reference editor writes for each case.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { directParagraphProperties, paragraphTextOf } from '@docx-editor.dev/core/store';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const STYLE = '<w:pStyle w:val="ListParagraph"/>';
const numPr = (level = 0, numId = 1) =>
  `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`;
const paragraph = (text: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const LEVEL = (ilvl: number, format: string, text: string, left: number) =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/>` +
  `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  `<w:abstractNum w:abstractNumId="0">${LEVEL(0, 'decimal', '%1.', 720)}${LEVEL(1, 'lowerLetter', '%2.', 1440)}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1">${LEVEL(0, 'bullet', '•', 720)}</w:abstractNum>` +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Numbered"><w:name w:val="Numbered"/>' +
  `<w:basedOn w:val="Normal"/><w:pPr>${numPr()}</w:pPr></w:style>` +
  '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
  `<w:basedOn w:val="Normal"/><w:pPr>${numPr(0, 2)}<w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>` +
  '<w:style w:type="paragraph" w:styleId="Hang"><w:name w:val="Hang"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:firstLineChars="200"/></w:pPr></w:style>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${STYLES}</w:styles>`),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array, author?: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes, author });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const ids = (editor: DocxEditorInstance) => editor.surface!.session.paragraphIds();
const texts = (editor: DocxEditorInstance) =>
  ids(editor).map((id) => paragraphTextOf(editor.surface!.session.part(), id));
const markers = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph')
    .map((fragment) => fragment.marker?.text ?? null);
/** The paragraph's own properties, as `name` or `name(attr=value,…)`. */
const own = (editor: DocxEditorInstance, index: number) =>
  directParagraphProperties(editor.surface!.session.part(), ids(editor)[index]!)
    .filter((property) => property.localName !== 'contextualSpacing')
    .map((property) => {
      const attributes = Object.entries(property.attributes ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join(',');
      return attributes ? `${property.localName}(${attributes})` : property.localName;
    });

function backspaceAt(editor: DocxEditorInstance, index: number, offset = 0): void {
  const surface = editor.surface!;
  const point = { paragraphId: ids(editor)[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
  surface.deleteBackward();
}

const list = (second: string, props = STYLE + numPr()) =>
  paragraph('Intro') +
  paragraph('One', STYLE + numPr()) +
  paragraph('Two', second === 'Two' ? props : props) +
  paragraph('Three', STYLE + numPr()) +
  paragraph('After');

describe('Backspace at the start of a list item', () => {
  test('removes the number, keeps the style and the text on its own line', () => {
    const editor = mount(docx(list('Two')));
    expect(markers(editor)).toEqual([null, '1.', '2.', '3.', null]);
    backspaceAt(editor, 2);
    expect(texts(editor)).toEqual(['Intro', 'One', 'Two', 'Three', 'After']);
    expect(markers(editor)).toEqual([null, '1.', null, '2.', null]);
    // List Paragraph already puts the text at the list's position, so no indent is written.
    expect(own(editor, 2)).toEqual(['pStyle(val=ListParagraph)']);
    const caret = editor.surface!.state().selection;
    expect(caret.head).toEqual({ paragraphId: ids(editor)[2]!, offset: 0 });
  });

  test('removes a bullet the same way', () => {
    const bullets = (text: string) => paragraph(text, STYLE + numPr(0, 2));
    const editor = mount(docx(paragraph('Intro') + bullets('One') + bullets('Two')));
    backspaceAt(editor, 2);
    expect(texts(editor)).toEqual(['Intro', 'One', 'Two']);
    expect(markers(editor)).toEqual([null, '•', null]);
    expect(own(editor, 2)).toEqual(['pStyle(val=ListParagraph)']);
  });

  test('holds a deeper level at its text position with an indent of its own', () => {
    const editor = mount(docx(list('Two', STYLE + numPr(1))));
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['pStyle(val=ListParagraph)', 'ind(left=1440)']);
  });

  test('without a list style, writes the list indent as the paragraph own', () => {
    const editor = mount(docx(list('Two', numPr())));
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['ind(left=720)']);
  });

  test('keeps an authored left indent and drops the hanging indent the marker used', () => {
    const editor = mount(
      docx(list('Two', STYLE + numPr() + '<w:ind w:left="1080" w:hanging="360"/>'))
    );
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['pStyle(val=ListParagraph)', 'ind(left=1080)']);
  });

  test('switches off numbering that comes from the paragraph style', () => {
    const numbered = (text: string) => paragraph(text, '<w:pStyle w:val="Numbered"/>');
    const editor = mount(docx(paragraph('Intro') + numbered('One') + numbered('Two')));
    expect(markers(editor)).toEqual([null, '1.', '2.']);
    backspaceAt(editor, 2);
    expect(markers(editor)).toEqual([null, '1.', null]);
    expect(own(editor, 2)).toContain('numPr');
  });

  test('later presses step the indent back, and only then join the previous paragraph', () => {
    const editor = mount(docx(list('Two')));
    backspaceAt(editor, 2);
    // Lined up with the item before it: back to that item's marker, then no indent.
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['ind(left=360)']);
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual([]);
    expect(texts(editor)).toEqual(['Intro', 'One', 'Two', 'Three', 'After']);
    backspaceAt(editor, 2);
    expect(texts(editor)).toEqual(['Intro', 'OneTwo', 'Three', 'After']);
  });

  test('undo brings the number back in one step', () => {
    const editor = mount(docx(list('Two')));
    backspaceAt(editor, 2);
    editor.surface!.undo();
    expect(markers(editor)).toEqual([null, '1.', '2.', '3.', null]);
    expect(own(editor, 2)).toEqual(['pStyle(val=ListParagraph)', 'numPr']);
  });

  test('inside the text, or over a range, Backspace deletes as before', () => {
    const editor = mount(docx(list('Two')));
    backspaceAt(editor, 2, 2);
    expect(texts(editor)[2]).toBe('Tw'.slice(0, 1) + 'o');
    expect(markers(editor)[2]).toBe('2.');
    const surface = editor.surface!;
    const id = ids(editor)[1]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 3 },
    });
    surface.deleteBackward();
    expect(texts(editor)[1]).toBe('');
    expect(markers(editor)[1]).toBe('1.');
  });

  test('an empty list item loses its number too', () => {
    const editor = mount(docx(list('', STYLE + numPr()).replace('Two', '')));
    backspaceAt(editor, 2);
    expect(texts(editor)).toEqual(['Intro', 'One', '', 'Three', 'After']);
    expect(markers(editor)).toEqual([null, '1.', null, '2.', null]);
  });

  test('works on a list item in a table cell', () => {
    const cell = (body: string) => `<w:tbl><w:tr><w:tc>${body}</w:tc></w:tr></w:tbl>`;
    const editor = mount(
      docx(
        cell(paragraph('One', STYLE + numPr()) + paragraph('Two', STYLE + numPr())) + paragraph('')
      )
    );
    backspaceAt(editor, 1);
    expect(texts(editor)).toEqual(['One', 'Two', '']);
    expect(own(editor, 0)).toContain('numPr');
    expect(own(editor, 1)).toEqual(['pStyle(val=ListParagraph)']);
  });

  test('a style that numbers the item keeps the text left with numId 0', () => {
    const bullet = (text: string) => paragraph(text, '<w:pStyle w:val="ListBullet"/>');
    const editor = mount(docx(paragraph('Intro') + bullet('One') + bullet('Two')));
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['pStyle(val=ListBullet)', 'numPr', 'ind(left=720)']);
    expect(markers(editor)).toEqual([null, '\u2022', null]);
  });

  test('a hanging indent from a style that does not number the item is cancelled', () => {
    const editor = mount(docx(list('Two', '<w:pStyle w:val="Hang"/>' + numPr())));
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['pStyle(val=Hang)', 'ind(firstLine=0)']);
    // The first line starts where the list put the text, not 360 twips to its left.
    const fragment = editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .find((entry) => entry.kind === 'paragraph' && entry.paragraphId === ids(editor)[2]);
    const three = editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .find((entry) => entry.kind === 'paragraph' && entry.paragraphId === ids(editor)[3]);
    const left = (entry: typeof fragment) =>
      entry && entry.kind === 'paragraph' ? entry.lines[0]!.box.x : NaN;
    expect(left(fragment)).toBeCloseTo(left(three), 3);
  });

  test('a first line a style sets in characters is cancelled in both units', () => {
    const editor = mount(docx(list('Two', '<w:pStyle w:val="Body"/>' + numPr())));
    backspaceAt(editor, 2);
    expect(own(editor, 2)).toEqual(['pStyle(val=Body)', 'ind(firstLine=0,firstLineChars=0)']);
  });

  test('once the number is gone, Backspace in the Original view still reaches the join', () => {
    const editor = mount(docx(list('Two')), 'Reviewer');
    editor.surface!.setEditingMode('suggest');
    backspaceAt(editor, 2);
    editor.surface!.setRevisionDisplayMode('original');
    backspaceAt(editor, 2);
    editor.surface!.setRevisionDisplayMode('all-markup');
    expect(own(editor, 2)).not.toContain('numPr');
    expect(JSON.stringify(editor.surface!.session.part().root)).toContain('"localName":"del"');
  });

  test('in suggesting mode the removal is a tracked change that reject undoes', async () => {
    const editor = mount(docx(list('Two')), 'Reviewer');
    editor.surface!.setEditingMode('suggest');
    backspaceAt(editor, 2);
    expect(texts(editor)).toEqual(['Intro', 'One', 'Two', 'Three', 'After']);
    expect(markers(editor)).toEqual([null, '1.', null, '2.', null]);
    const saved = new Uint8Array(await editor.save());
    expect(strFromU8(unzipSync(saved)['word/document.xml']!)).toContain('<w:pPrChange');
    const reopened = mount(saved, 'Reviewer');
    expect(markers(reopened)).toEqual([null, '1.', null, '2.', null]);
    reopened.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(own(reopened, 2)).toEqual(['pStyle(val=ListParagraph)', 'numPr']);
  });
});
