import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf, directParagraphProperties, findNode } from '@docx-editor.dev/core/store';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { ensureSeparatorStyle } from '../list-separator-style.ts';
import {
  openStore,
  captureOneJournal,
  replayAndCompare,
} from '../../store/__tests__/canonical-primitive-journal-coverage-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLE = '<w:pStyle w:val="ListParagraph"/>';
const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
const LIST = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const paragraph = (text: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, props = AUTO) => paragraph(text, STYLE + LIST + props);
const NORMAL =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';
const NUMBERING = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

function docx(
  body: string,
  styles = NORMAL +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>',
  numbering = NUMBERING
): Uint8Array {
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
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/numbering.xml': strToU8(numbering),
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

const fragments = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph');
function enter(editor: DocxEditorInstance, index: number, offset: number): void {
  const surface = editor.surface!;
  const point = { paragraphId: surface.session.paragraphIds()[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
  surface.splitParagraph();
}

const texts = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.paragraphIds()
    .map((id) => paragraphTextOf(editor.surface!.session.part(), id));
const markers = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) => fragment.marker?.text ?? null);
const gap = paragraph('', STYLE);
const sequence = (second = item('Second')) => item('First') + gap + second + item('Third');

describe('Enter continues a single blank separator between list items', () => {
  test('before a trailing soft break, inserts an unnumbered separator and lands on the new item', async () => {
    const second = item('Second').replace('</w:r>', '<w:br/></w:r>');
    const editor = mount(docx(sequence(second)));
    enter(editor, 2, 6);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '\n', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
    const rows = fragments(editor);
    expect(rows[4]!.lines[0]!.box.y - rows[2]!.lines[0]!.box.y).toBeCloseTo(
      rows[2]!.lines[0]!.box.y - rows[0]!.lines[0]!.box.y,
      5
    );
    editor.surface!.type('New');
    expect(texts(editor)).toEqual(['First', '', 'Second', '', 'New\n', 'Third']);
    const reloaded = mount(new Uint8Array(await editor.save()));
    expect(texts(reloaded)).toEqual(texts(editor));
    expect(markers(reloaded)).toEqual(markers(editor));
  });

  test('plain endings and middle splits continue the same separator', () => {
    for (const offset of [0, 3, 6]) {
      const editor = mount(docx(sequence()));
      enter(editor, 2, offset);
      expect(texts(editor)).toEqual([
        'First',
        '',
        'Second'.slice(0, offset),
        '',
        'Second'.slice(offset),
        'Third',
      ]);
    }
  });

  test('one undo restores the original paragraphs, and redo restores the separator', () => {
    const editor = mount(docx(sequence()));
    const before = texts(editor);
    enter(editor, 2, 6);
    const after = texts(editor);
    editor.surface!.undo();
    expect(texts(editor)).toEqual(before);
    editor.surface!.redo();
    expect(texts(editor)).toEqual(after);
    editor.surface!.type('New');
    expect(texts(editor)[4]).toBe('New');
  });

  test('typing and Enter on the new item repeats the established pattern', () => {
    const editor = mount(docx(sequence()));
    enter(editor, 2, 6);
    editor.surface!.type('New');
    editor.surface!.splitParagraph();
    expect(texts(editor)).toEqual(['First', '', 'Second', '', 'New', '', '', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', null, '4.', '5.']);
  });

  test('does not invent a separator without one preceding list item and one empty paragraph', () => {
    for (const [body, target] of [
      [item('First') + item('Second'), 1],
      [item('First') + gap + gap + item('Second'), 3],
      [paragraph('Lead') + gap + item('Second'), 2],
      [item('First') + paragraph('Text', STYLE) + item('Second'), 2],
      [item('First') + item('') + item('Second'), 2],
      [paragraph('Lead') + gap + paragraph('Second'), 2],
      [item('Second') + gap + item('Next'), 0],
    ] as const) {
      const editor = mount(docx(body));
      const count = texts(editor).length;
      enter(editor, target, 6);
      expect(texts(editor)).toHaveLength(count + 1);
    }
  });

  test('a separator has only List Paragraph and the direct typing face', () => {
    const second = item(
      'Second',
      AUTO + '<w:ind w:left="960"/><w:rPr><w:sz w:val="32"/></w:rPr>'
    ).replace('<w:r>', '<w:r><w:rPr><w:sz w:val="32"/></w:rPr>');
    const editor = mount(docx(sequence(second)));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    const props = directParagraphProperties(
      surface.session.part(),
      surface.session.paragraphIds()[3]!
    );
    expect(props.map((p) => p.localName)).toEqual(['pStyle']);
    const separator = findNode(surface.session.part(), surface.session.paragraphIds()[3]!);
    expect(JSON.stringify(separator)).toContain('32');
    expect(fragments(editor)[3]!.lines[0]!.box.height).toBe(
      fragments(editor)[4]!.lines[0]!.box.height
    );
  });

  test('section properties remain on the tail alone', () => {
    const section = '<w:sectPr><w:type w:val="continuous"/></w:sectPr>';
    const editor = mount(docx(sequence(item('Second', AUTO + section))));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    const owners = surface.session
      .paragraphIds()
      .filter((id) =>
        JSON.stringify(findNode(surface.session.part(), id)).includes('\"localName\":\"sectPr\"')
      );
    expect(owners).toEqual([surface.session.paragraphIds()[4]!]);
  });

  test('continues separators within a table cell without crossing cell boundaries', () => {
    const table = `<w:tbl><w:tr><w:tc>${sequence()}</w:tc><w:tc>${item('Other')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(docx(table));
    enter(editor, 2, 6);
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third', 'Other', '']);
  });
  test('tracked Enter proposes both new marks and rejects without leaving a separator', async () => {
    const editor = mount(docx(sequence()), 'Test author');
    editor.surface!.setEditingMode('suggest');
    enter(editor, 2, 6);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third']);
    const reloaded = mount(new Uint8Array(await editor.save()), 'Test author');
    reloaded.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(texts(reloaded)).toEqual(['First', '', 'Second', 'Third']);
    editor.surface!.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
  });

  test('style-based numbering stays off on the separator', () => {
    const styles =
      NORMAL +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr>${LIST}<w:contextualSpacing/></w:pPr></w:style>`;
    const styledItem = (text: string) => paragraph(text, STYLE);
    const blank = paragraph('', STYLE + '<w:numPr><w:numId w:val="0"/></w:numPr>');
    const editor = mount(
      docx(styledItem('First') + blank + styledItem('Second') + styledItem('Third'), styles)
    );
    enter(editor, 2, 6);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
  });

  test('replacing text in either selection direction continues the separator in edit and suggest modes', async () => {
    for (const mode of ['edit', 'suggest'] as const)
      for (const reverse of [false, true]) {
        const editor = mount(docx(sequence()), 'Test author');
        const surface = editor.surface!;
        surface.setEditingMode(mode);
        const id = surface.session.paragraphIds()[2]!;
        const a = { paragraphId: id, offset: 3 };
        const b = { paragraphId: id, offset: 6 };
        surface.setSelection({ anchor: reverse ? b : a, head: reverse ? a : b });
        surface.splitParagraph();
        expect(texts(editor)).toHaveLength(6);
        surface.type('New');
        expect(texts(editor)[4]).toBe('New');
        if (mode === 'suggest') {
          const reloaded = mount(new Uint8Array(await editor.save()));
          reloaded.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
          expect(texts(reloaded)).toEqual(['First', '', 'Second', 'Third']);
        } else {
          expect(texts(editor)).toEqual(['First', '', 'Sec', '', 'New', 'Third']);
        }
      }
  });

  test('separators cross content-control boundaries without leaving the current control', async () => {
    const control = (body: string) =>
      `<w:sdt><w:sdtPr><w:id w:val="42"/></w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt>`;
    for (const body of [
      item('First') + gap + control(item('Second')),
      control(item('First') + gap) + item('Second'),
      control(item('First') + gap + item('Second')),
    ]) {
      const editor = mount(docx(body));
      enter(editor, 2, 6);
      expect(texts(editor)).toEqual(['First', '', 'Second', '', '']);
      expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.']);
      expect(markers(mount(new Uint8Array(await editor.save())))).toEqual(markers(editor));
      editor.surface!.undo();
      expect(texts(editor)).toEqual(['First', '', 'Second']);
      editor.surface!.redo();
      expect(texts(editor)).toHaveLength(5);
    }
  });

  test.each([
    '<w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml" style="width:12pt;height:12pt"/></w:pict></w:r>',
    '<w:fldSimple w:instr="DATE"><w:r><w:t/></w:r></w:fldSimple>',
    '<w:r><w:footnoteReference w:id="1"/></w:r>',
    '<w:r><w:br/></w:r>',
  ])('non-text content is not a blank separator: %s', (content) => {
    const editor = mount(docx(item('First') + `<w:p>${content}</w:p>` + item('Second')));
    enter(editor, 2, 6);
    expect(texts(editor)).toHaveLength(4);
  });

  test('bookmarks inside a blank separator do not prevent continuation', () => {
    const editor = mount(
      docx(
        item('First') +
          '<w:p><w:bookmarkStart w:id="1" w:name="Blank"/><w:bookmarkEnd w:id="1"/></w:p>' +
          item('Second')
      )
    );
    enter(editor, 2, 6);
    expect(texts(editor)).toHaveLength(5);
  });

  test('bullets and whitespace-only separators follow the same continuation rule', () => {
    const bullets = NUMBERING.replace('decimal', 'bullet').replace('%1.', '•');
    for (const blank of ['', '   ', '&#160;', '&#9;']) {
      const editor = mount(
        docx(item('First') + paragraph(blank) + item('Second'), undefined, bullets)
      );
      enter(editor, 2, 6);
      expect(markers(editor)).toEqual(['•', null, '•', null, '•']);
      expect(texts(editor).slice(-2)).toEqual(['', '']);
    }
  });

  test('list identity and nesting level bound the separator pattern', () => {
    const numbering = NUMBERING.replace(
      '</w:abstractNum>',
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum>'
    ).replace(
      '</w:numbering>',
      '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    );
    for (const second of [
      item('Second').replace('w:numId w:val="1"', 'w:numId w:val="2"'),
      item('Second').replace('w:ilvl w:val="0"', 'w:ilvl w:val="1"'),
    ]) {
      const editor = mount(docx(item('First') + gap + second, undefined, numbering));
      enter(editor, 2, 6);
      expect(texts(editor)).toHaveLength(4);
    }
  });

  test('custom item styles do not leak into the separator; built-in name wins over id', async () => {
    const styles =
      NORMAL +
      '<w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="Custom"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="LocalList"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="Unrelated"/></w:style>';
    const custom = (text: string) => paragraph(text, '<w:pStyle w:val="Custom"/>' + LIST);
    const editor = mount(docx(custom('First') + paragraph('') + custom('Second'), styles));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    expect(
      directParagraphProperties(surface.session.part(), surface.session.paragraphIds()[3]!)
    ).toEqual([{ localName: 'pStyle', attributes: { val: 'LocalList' } }]);
    expect(fragments(editor)[3]!.lines[0]!.box.height).toBeLessThan(
      fragments(editor)[2]!.lines[0]!.box.height
    );
    const reloaded = mount(new Uint8Array(await editor.save()));
    expect(markers(reloaded)).toEqual(['1.', null, '2.', null, '3.']);
  });

  test('the separator inherits default line spacing while the new item keeps its direct override', () => {
    const styles =
      '<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      NORMAL +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>';
    const single = '<w:spacing w:line="240" w:lineRule="auto"/>';
    const editor = mount(docx(item('First', single) + gap + item('Second', single), styles));
    enter(editor, 2, 6);
    const rows = fragments(editor);
    expect(rows[3]!.lines[0]!.box.height / rows[4]!.lines[0]!.box.height).toBeCloseTo(1.15, 5);
  });

  test('a missing built-in is created with the document default as its base and undone atomically', async () => {
    const styles =
      NORMAL.replaceAll('Normal', 'Body') +
      '<w:style w:type="paragraph" w:styleId="Custom"><w:basedOn w:val="Body"/></w:style>';
    const custom = (text: string) => paragraph(text, '<w:pStyle w:val="Custom"/>' + LIST);
    const editor = mount(docx(custom('First') + paragraph('') + custom('Second'), styles));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    expect(
      surface.session.documentStyles().some((style) => style.styleId === 'ListParagraph')
    ).toBe(true);
    expect(JSON.stringify(surface.session.stylesRoot())).toContain('Body');
    const reloaded = mount(new Uint8Array(await editor.save()));
    expect(markers(reloaded)).toEqual(['1.', null, '2.', null, '3.']);
    surface.undo();
    expect(texts(editor)).toEqual(['First', '', 'Second']);
    expect(
      surface.session.documentStyles().some((style) => style.styleId === 'ListParagraph')
    ).toBe(false);
    surface.redo();
    surface.type('New');
    expect(texts(editor)[4]).toBe('New');
    expect(
      surface.session.documentStyles().filter((style) => style.styleId === 'ListParagraph')
    ).toHaveLength(1);
  });

  test('creates the built-in in a relocated styles part and preserves undo and reload', async () => {
    const entries = unzipSync(docx(item('First') + paragraph('') + item('Second'), NORMAL));
    entries['custom/formatting.xml'] = entries['word/styles.xml']!;
    delete entries['word/styles.xml'];
    entries['[Content_Types].xml'] = strToU8(
      new TextDecoder()
        .decode(entries['[Content_Types].xml'])
        .replace('/word/styles.xml', '/custom/formatting.xml')
    );
    entries['word/_rels/document.xml.rels'] = strToU8(
      new TextDecoder()
        .decode(entries['word/_rels/document.xml.rels'])
        .replace('Target="styles.xml"', 'Target="../custom/formatting.xml"')
    );
    const editor = mount(zipSync(entries));
    enter(editor, 2, 6);
    expect(texts(editor)).toHaveLength(5);
    const surface = editor.surface!;
    expect(
      surface.session.documentStyles().some((style) => style.styleId === 'ListParagraph')
    ).toBe(true);
    const saved = new Uint8Array(await editor.save());
    expect(unzipSync(saved)['word/styles.xml']).toBeUndefined();
    expect(markers(mount(saved))).toEqual(['1.', null, '2.', null, '3.']);
    surface.undo();
    expect(texts(editor)).toEqual(['First', '', 'Second']);
    expect(
      surface.session.documentStyles().some((style) => style.styleId === 'ListParagraph')
    ).toBe(false);
    surface.redo();
    surface.type('New');
    expect(texts(editor)[4]).toBe('New');
  });

  test('creates a complete styles part when the document has none', async () => {
    const entries = unzipSync(docx(item('First') + paragraph('') + item('Second')));
    delete entries['word/styles.xml'];
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    );
    const editor = mount(zipSync(entries));
    enter(editor, 2, 6);
    expect(texts(editor)).toHaveLength(5);
    expect(
      editor.surface!.session.documentStyles().some((style) => style.name === 'List Paragraph')
    ).toBe(true);
    const reloaded = mount(new Uint8Array(await editor.save()));
    expect(markers(reloaded)).toEqual(['1.', null, '2.', null, '3.']);
    editor.surface!.undo();
    expect(editor.surface!.session.stylesRoot()).toBeNull();
  });

  test('does not overwrite a character style using the built-in id', () => {
    const styles =
      NORMAL +
      '<w:style w:type="character" w:styleId="ListParagraph"><w:name w:val="Character Face"/></w:style>';
    const editor = mount(docx(item('First') + paragraph('') + item('Second'), styles));
    enter(editor, 2, 6);
    expect(
      editor.surface!.session.documentStyles().map((style) => [style.styleId, style.type])
    ).toContainEqual(['ListParagraph', 'character']);
    expect(
      editor.surface!.session.documentStyles().map((style) => [style.styleId, style.type])
    ).toContainEqual(['ListParagraph1', 'paragraph']);
  });

  test('a newly created built-in suppresses numbering inherited from the default style', () => {
    const styles = NORMAL.replace('</w:style>', `<w:pPr>${LIST}</w:pPr></w:style>`);
    const blank = paragraph('', '<w:numPr><w:numId w:val="0"/></w:numPr>');
    const editor = mount(docx(paragraph('First') + blank + paragraph('Second'), styles));
    enter(editor, 2, 6);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.']);
  });

  test.each(['', ' xmlns:w="urn:foreign" w:flag="keep"'])(
    'style creation preserves alternate prefixes and conflicts: %s',
    async (binding) => {
      const entries = unzipSync(docx(item('First') + paragraph('') + item('Second'), NORMAL));
      entries['word/styles.xml'] = strToU8(
        new TextDecoder()
          .decode(entries['word/styles.xml'])
          .replaceAll('w:', 'x:')
          .replace('xmlns:w', 'xmlns:x')
      );
      entries['word/document.xml'] = strToU8(
        new TextDecoder()
          .decode(entries['word/document.xml'])
          .replaceAll('w:', 'x:')
          .replace('xmlns:w', 'xmlns:x')
          .replace('<x:document ', `<x:document${binding} `)
      );
      const editor = mount(zipSync(entries));
      enter(editor, 2, 6);
      expect(texts(editor)).toHaveLength(5);
      const reloaded = mount(new Uint8Array(await editor.save()));
      expect(markers(reloaded)).toEqual(['1.', null, '2.', null, '3.']);
      editor.surface!.undo();
      expect(texts(editor)).toHaveLength(3);
      editor.surface!.redo();
      expect(markers(editor)).toEqual(markers(reloaded));
    }
  );

  test('style creation journals replay for existing and absent styles parts', () => {
    for (const hasStyles of [true, false]) {
      const entries = unzipSync(docx(paragraph('First'), NORMAL));
      if (!hasStyles) {
        delete entries['word/styles.xml'];
        entries['word/_rels/document.xml.rels'] = strToU8(`<Relationships xmlns="${REL}"/>`);
      }
      const bytes = zipSync(entries);
      const source = openStore(bytes);
      const replica = openStore(bytes);
      const captured = captureOneJournal(source, () =>
        source.transact({ kind: 'body' }, (ctx) => {
          ctx.applyPackage(ensureSeparatorStyle(hasStyles ? 'Normal' : null, 'ListParagraph'));
        })
      );
      expect(captured.result.ok).toBe(true);
      expect(captured.journal).not.toBeNull();
      replayAndCompare(replica, source, captured.journal!);
    }
  });

  test('a following-paragraph style takes precedence over separator continuation, including selected endings', () => {
    const styles =
      NORMAL +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style>';
    for (const selected of [false, true]) {
      const editor = mount(docx(sequence(), styles));
      const surface = editor.surface!;
      const id = surface.session.paragraphIds()[2]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: selected ? 3 : 6 },
        head: { paragraphId: id, offset: 6 },
      });
      surface.splitParagraph();
      expect(texts(editor)).toHaveLength(5);
      expect(markers(editor)[3]).toBeNull();
    }
  });

  test.each([
    ['document defaults', '<w:spacing w:after="160" w:line="360"/>', '', '', ''],
    ['line-unit defaults', '<w:spacing w:afterLines="150" w:beforeLines="50"/>', '', '', ''],
    ['base style', '', '<w:spacing w:before="120" w:after="240"/>', '', ''],
    ['derived style', '', '<w:spacing w:after="240"/>', '<w:spacing w:before="160"/>', ''],
    [
      'direct override',
      '<w:spacing w:after="80"/>',
      '<w:spacing w:before="160"/>',
      '',
      '<w:spacing w:before="0" w:after="360"/>',
    ],
    ['contextual spacing', '<w:spacing w:after="240"/>', '', '<w:contextualSpacing/>', ''],
    [
      'explicit contextual off',
      '<w:spacing w:after="240"/>',
      '<w:contextualSpacing/>',
      '',
      '<w:contextualSpacing w:val="0"/>',
    ],
  ])(
    'Enter retains spacing from %s without flattening inherited values',
    async (_name, defaults, base, derived, direct) => {
      const styles =
        `<w:docDefaults><w:pPrDefault><w:pPr>${defaults}</w:pPr></w:pPrDefault></w:docDefaults>` +
        NORMAL +
        `<w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/><w:pPr>${base}</w:pPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Base"/><w:pPr>${derived}</w:pPr></w:style>`;
      const editor = mount(docx(item('First', direct) + item('Second', direct), styles));
      const before = fragments(editor);
      const distance = before[1]!.lines[0]!.box.y - before[0]!.lines[0]!.box.y;
      enter(editor, 1, 6);
      editor.surface!.type('Third');
      const after = fragments(editor);
      expect(after[2]!.lines[0]!.box.y - after[1]!.lines[0]!.box.y).toBeCloseTo(distance, 5);
      const surface = editor.surface!;
      expect(
        directParagraphProperties(surface.session.part(), surface.session.paragraphIds()[2]!)
      ).toEqual(
        directParagraphProperties(surface.session.part(), surface.session.paragraphIds()[1]!)
      );
      const reloaded = mount(new Uint8Array(await editor.save()));
      expect(fragments(reloaded)[2]!.lines[0]!.box.y).toBeCloseTo(after[2]!.lines[0]!.box.y, 5);
    }
  );
});
