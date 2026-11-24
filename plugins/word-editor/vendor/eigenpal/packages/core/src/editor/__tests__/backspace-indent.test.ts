// Backspace at the start of an indented paragraph removes the indent before it joins the
// paragraph to the one before it. The left and first-line or hanging indent go together and
// the right indent stays. List Paragraph is left; any other style's indent is cancelled with a
// 0. A paragraph lined up with the text of the list item before it steps back to that item's
// marker first.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="1440"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="FirstIndented"><w:name w:val="First Indented"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>';

/** Stock geometry: level n puts its marker at 720n + 360 and its text at 720(n + 1). */
const NUMBERING =
  '<w:abstractNum w:abstractNumId="0">' +
  Array.from(
    { length: 9 },
    (_, ilvl) =>
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
      `<w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  ).join('') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';

function docx(body: string, extraStyles = '', numbering = NUMBERING): Uint8Array {
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
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${STYLES}${extraStyles}</w:styles>`),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, ilvl = 0) =>
  paragraph(
    text,
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>`
  );

const open: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array, author?: string): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    author,
  });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const ids = (editor: DocxEditorInstance) => editor.surface!.session.paragraphIds();
const texts = (editor: DocxEditorInstance) =>
  ids(editor).map((id) => paragraphTextOf(editor.surface!.session.part(), id));
const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
/** Each paragraph's own `w:pPr` content, as saved. */
const properties = (editor: DocxEditorInstance) =>
  [
    ...documentXml(editor.surface!.save()).matchAll(
      /<w:p\b[^>]*>(?:<w:pPr>(.*?)<\/w:pPr>)?(?=<w:r>|<\/w:p>)/g
    ),
  ].map((match) => match[1] ?? '');

function backspaceAt(editor: DocxEditorInstance, index: number, offset = 0): void {
  const surface = editor.surface!;
  const point = { paragraphId: ids(editor)[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
  surface.deleteBackward();
}

/** Opens `Before` + a paragraph with `pPr`, presses Backspace once at its start. */
function afterOnePress(pPr: string, before = paragraph('Before')) {
  const editor = mount(docx(before + paragraph('Case', pPr)));
  backspaceAt(editor, 1);
  return { texts: texts(editor), properties: properties(editor)[1] };
}

describe('Backspace at the start of an indented paragraph', () => {
  test.each([
    ['a left indent', '<w:ind w:left="1440"/>'],
    ['a first-line indent', '<w:ind w:firstLine="720"/>'],
    ['a hanging indent', '<w:ind w:left="720" w:hanging="360"/>'],
    ['a deep left indent, in one press', '<w:ind w:left="2880"/>'],
    ['a left and a first-line indent', '<w:ind w:left="720" w:firstLine="360"/>'],
    ['a negative left indent', '<w:ind w:left="-360"/>'],
    ['a start indent', '<w:ind w:start="1440"/>'],
    ['a left indent in characters', '<w:ind w:leftChars="200" w:left="420"/>'],
    ['a hanging indent alone', '<w:ind w:hanging="360"/>'],
  ])('removes %s first, and the next press joins', (_, pPr) => {
    const editor = mount(docx(paragraph('Before') + paragraph('Case', pPr)));
    backspaceAt(editor, 1);
    expect(texts(editor)).toEqual(['Before', 'Case']);
    expect(properties(editor)[1]).toBe('');
    backspaceAt(editor, 1);
    expect(texts(editor)).toEqual(['BeforeCase']);
  });

  test('keeps the right indent and the direction', () => {
    expect(afterOnePress('<w:ind w:left="1440" w:right="720"/>').properties).toBe(
      '<w:ind w:right="720"/>'
    );
    expect(afterOnePress('<w:bidi/><w:ind w:left="1440"/>').properties).toBe('<w:bidi/>');
  });

  test('a right indent alone is not an indent to remove, so the press joins', () => {
    expect(afterOnePress('<w:ind w:right="1440"/>').texts).toEqual(['BeforeCase']);
    expect(afterOnePress('<w:bidi/><w:ind w:right="1440"/>').texts).toEqual(['BeforeCase']);
  });

  test("a style's indent is cancelled with a 0, and the paragraph keeps the style", () => {
    expect(afterOnePress('<w:pStyle w:val="Indented"/>').properties).toBe(
      '<w:pStyle w:val="Indented"/><w:ind w:left="0"/>'
    );
    expect(afterOnePress('<w:pStyle w:val="FirstIndented"/>').properties).toBe(
      '<w:pStyle w:val="FirstIndented"/><w:ind w:firstLine="0"/>'
    );
  });

  test('List Paragraph is left, with any indent the paragraph states itself', () => {
    expect(afterOnePress('<w:pStyle w:val="ListParagraph"/>').properties).toBe('');
    expect(
      afterOnePress('<w:pStyle w:val="ListParagraph"/><w:ind w:left="1440"/>').properties
    ).toBe('');
  });

  test('an empty indented paragraph is removed at once', () => {
    for (const pPr of ['<w:ind w:left="1440"/>', '<w:ind w:firstLine="720"/>']) {
      const editor = mount(
        docx(paragraph('Before') + `<w:p><w:pPr>${pPr}</w:pPr></w:p>` + paragraph('After'))
      );
      backspaceAt(editor, 1);
      expect(texts(editor)).toEqual(['Before', 'After']);
    }
  });

  test('the first paragraph of the document loses its indent too', () => {
    const editor = mount(docx(paragraph('First', '<w:ind w:left="720"/>') + paragraph('After')));
    backspaceAt(editor, 0);
    expect(properties(editor)[0]).toBe('');
    expect(texts(editor)).toEqual(['First', 'After']);
  });

  test('inside the text, Backspace still deletes a character', () => {
    const editor = mount(docx(paragraph('Before') + paragraph('Case', '<w:ind w:left="720"/>')));
    backspaceAt(editor, 1, 2);
    expect(texts(editor)).toEqual(['Before', 'Cse']);
    expect(properties(editor)[1]).toBe('<w:ind w:left="720"/>');
  });

  test('the first paragraph of a table cell loses its indent', () => {
    const cell = (body: string) =>
      `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${body}</w:tc></w:tr></w:tbl>`;
    const editor = mount(
      docx(paragraph('Before') + cell(paragraph('Cell', '<w:ind w:left="720"/>')))
    );
    backspaceAt(editor, 1);
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts(editor)).toEqual(['Before', 'Cell', '']);
    expect(properties(editor)[1]).toBe('');
  });

  test('undo brings the indent back', () => {
    const editor = mount(docx(paragraph('Before') + paragraph('Case', '<w:ind w:left="720"/>')));
    backspaceAt(editor, 1);
    editor.surface!.undo();
    expect(properties(editor)[1]).toBe('<w:ind w:left="720"/>');
  });

  test('in suggesting mode the removal is a change that reject undoes', () => {
    const editor = mount(
      docx(paragraph('Before') + paragraph('Case', '<w:pStyle w:val="ListParagraph"/>')),
      'Reviewer'
    );
    editor.surface!.setEditingMode('suggest');
    backspaceAt(editor, 1);
    expect(properties(editor)[1]).toMatch(
      /^<w:pPrChange w:author="Reviewer"[^>]*><w:pPr><w:pStyle w:val="ListParagraph"\/><\/w:pPr><\/w:pPrChange>$/
    );
    const reopened = mount(editor.surface!.save());
    expect(
      reopened.surface!.applyAutomationOps(() => [{ op: 'rejectAllRevisions' as const }]).rejected
    ).toBe(false);
    expect(properties(reopened)[1]).toBe('<w:pStyle w:val="ListParagraph"/>');
  });
});

describe('a paragraph lined up with the list item before it', () => {
  test('steps back to the marker of a first-level item, then loses the indent', () => {
    for (const pPr of [
      '<w:pStyle w:val="ListParagraph"/>',
      '<w:ind w:left="720"/>',
      '<w:pStyle w:val="ListParagraph"/><w:ind w:left="720"/>',
    ]) {
      const editor = mount(docx(item('One') + paragraph('Case', pPr)));
      backspaceAt(editor, 1);
      expect(properties(editor)[1]).toBe('<w:ind w:left="360"/>');
      backspaceAt(editor, 1);
      expect(properties(editor)[1]).toBe('');
      expect(texts(editor)).toEqual(['One', 'Case']);
    }
  });

  test('loses the whole indent where it does not line up with the item text', () => {
    for (const pPr of [
      '<w:ind w:left="1080"/>',
      '<w:ind w:firstLine="720"/>',
      '<w:ind w:left="720" w:hanging="360"/>',
      '<w:ind w:left="720" w:firstLine="360"/>',
    ])
      expect(afterOnePress(pPr, item('One')).properties).toBe('');
    expect(afterOnePress('<w:pStyle w:val="ListParagraph"/>', item('One', 3)).properties).toBe('');
  });

  test('a List Paragraph item takes four presses at the first level and three deeper', () => {
    const first = mount(docx(item('One') + item('Two')));
    const steps = [];
    for (let press = 0; press < 4; press += 1) {
      backspaceAt(first, 1);
      steps.push({ texts: texts(first), properties: properties(first)[1] });
    }
    expect(steps).toEqual([
      { texts: ['One', 'Two'], properties: '<w:pStyle w:val="ListParagraph"/>' },
      { texts: ['One', 'Two'], properties: '<w:ind w:left="360"/>' },
      { texts: ['One', 'Two'], properties: '' },
      { texts: ['OneTwo'], properties: undefined },
    ]);

    const deeper = mount(docx(item('One') + item('Two', 3)));
    backspaceAt(deeper, 1);
    expect(properties(deeper)[1]).toBe('<w:pStyle w:val="ListParagraph"/><w:ind w:left="2880"/>');
    backspaceAt(deeper, 1);
    expect(properties(deeper)[1]).toBe('');
    backspaceAt(deeper, 1);
    expect(texts(deeper)).toEqual(['OneTwo']);
  });
});

describe('lining up, and indents a press cannot remove', () => {
  test('a deeper item: the paragraph steps back to that level marker', () => {
    expect(afterOnePress('<w:ind w:left="2880"/>', item('One', 3)).properties).toBe(
      '<w:ind w:left="2520"/>'
    );
  });

  test('a paragraph after a table does not line up with an item in its last cell', () => {
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      `${item('Cell')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(docx(table + paragraph('Case', '<w:ind w:left="720"/>')));
    backspaceAt(editor, 1);
    expect(properties(editor)[1]).toBe('');
  });

  test('an indent from a table style or a markerless level leaves the press to the join', () => {
    const styled = mount(
      docx(
        '<w:tbl><w:tblPr><w:tblStyle w:val="Indenting"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/>' +
          `</w:tblGrid><w:tr><w:tc>${paragraph('One')}${paragraph('Two')}</w:tc></w:tr></w:tbl>`,
        '<w:style w:type="table" w:styleId="Indenting"><w:name w:val="Indenting"/>' +
          '<w:pPr><w:ind w:left="720"/></w:pPr></w:style>'
      )
    );
    backspaceAt(styled, 1);
    expect(texts(styled)).toEqual(['OneTwo', '']);

    const markerless = mount(
      docx(
        paragraph('Before') +
          paragraph('Case', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
        '',
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
          '<w:numFmt w:val="none"/><w:lvlText w:val=""/>' +
          '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
      )
    );
    backspaceAt(markerless, 1);
    expect(texts(markerless)).toEqual(['BeforeCase']);
  });

  test('a content-locked control keeps the indent; a data binding alone lets it go', () => {
    const control = (sdtPr: string) =>
      paragraph('Before') +
      `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>` +
      `${paragraph('Held', '<w:ind w:left="720"/>')}</w:sdtContent></w:sdt>`;
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const editor = mount(docx(control(`<w:lock w:val="${lock}"/>`)));
      backspaceAt(editor, 1);
      expect(properties(editor)[1]).toBe('<w:ind w:left="720"/>');
      expect(texts(editor)).toEqual(['Before', 'Held']);
    }
    const bound = mount(
      docx(control('<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/><w:text/>'))
    );
    backspaceAt(bound, 1);
    expect(properties(bound)[1]).toBe('');
  });

  test('the Original view of a removed indent leaves the press to the join', () => {
    const editor = mount(
      docx(
        paragraph('Before') +
          paragraph(
            'Case',
            '<w:pPrChange w:id="5" w:author="Ada"><w:pPr><w:ind w:left="1440"/></w:pPr></w:pPrChange>'
          )
      )
    );
    editor.surface!.setRevisionDisplayMode('original');
    backspaceAt(editor, 1);
    expect(texts(editor)).toEqual(['BeforeCase']);
  });
});
